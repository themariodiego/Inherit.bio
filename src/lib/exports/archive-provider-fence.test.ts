import {createHash} from "node:crypto";
import {afterEach,describe,expect,it,vi} from "vitest";
import {fenceArchiveReservation,type ArchiveCleanupReservation,type ArchivePermanentFenceProvider,
 type ArchiveProviderBinding} from "./archive-provider-fence";

// Authored synthetic callback tests only. They do not prove a provider's CAS,
// complete history, physical ownership, fence, deletion or an approved issuer.
const empty="e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
const exportId="10000000-0000-4000-8000-000000000001",attemptId="20000000-0000-4000-8000-000000000002";
const physical="export/30000000-0000-4000-8000-000000000003",hash="a".repeat(64),bindingHash="b".repeat(64);
function fixture(){
 const locator={provider:"archive-permanent-fence-v1" as const,bucket:"inherit-export-synthetic",objectKey:physical,byteCount:7,sha256:hash};
 const reservation:ArchiveCleanupReservation={version:"archive-cleanup-reservation-v1",exportId,attemptId,ordinal:0,
  authorityReceipt:hash,reservationSha256:"c".repeat(64),locator,writeBindingSha256:bindingHash,
  writeIdentity:{purpose:"inherit-export-reservation-v1",exportId,attemptId,ordinal:0,offset:0,byteCount:7,sha256:hash,
   logicalKey:`${"d".repeat(64)}/${exportId}/${attemptId}-0.part`,reservedAt:new Date(Date.now()-60_000).toISOString(),authorityReceipt:hash,locator},
  cleanupNotBefore:new Date(Date.now()-1).toISOString(),claimExpiresAt:new Date(Date.now()+30_000).toISOString()};
 const marker={objectKey:physical,version:"marker-1",etag:"empty-etag",byteCount:0,sha256:empty,
  kind:"permanent-empty-fence",expiresAt:null};
 const inspect=vi.fn(async(_binding:ArchiveProviderBinding,_after:string|null,_signal:AbortSignal):Promise<unknown>=>{
  void _binding;void _after;void _signal;
  return {expected:reservation,currentVersion:null,currentEtag:null,versions:[],nextCursor:null};});
 const ensure=vi.fn(async(_binding:ArchiveProviderBinding,_observed:Parameters<ArchivePermanentFenceProvider["ensurePermanentMarker"]>[1],_signal:AbortSignal):Promise<unknown>=>{
  void _binding;void _observed;void _signal;return marker;});
 const read=vi.fn(async(_binding:ArchiveProviderBinding,_marker:Parameters<ArchivePermanentFenceProvider["readExactMarker"]>[1],_signal:AbortSignal):Promise<{descriptor:unknown;body:ReadableStream<Uint8Array>}>=>{
  void _binding;void _marker;void _signal;
  return {descriptor:marker,body:new ReadableStream<Uint8Array>({start(c){c.close();}})};});
 const list=vi.fn(async(_binding:ArchiveProviderBinding,_after:string|null,_signal:AbortSignal):Promise<unknown>=>{
  void _binding;void _after;void _signal;
  return {versions:[{objectKey:physical,version:marker.version,deleteMarker:false,byteCount:0}],nextCursor:null};});
 const remove=vi.fn(async(_binding:ArchiveProviderBinding,_version:string,_signal:AbortSignal):Promise<unknown>=>{
  void _binding;void _version;void _signal;throw new Error("unexpected delete");});
 const current=vi.fn(async(_expected:Readonly<ArchiveCleanupReservation>,_signal:AbortSignal):Promise<unknown>=>{
  void _expected;void _signal;return reservation;});
 const provider:ArchivePermanentFenceProvider={assertReady:async()=>{},
  serializeExactKey:async<T>(_binding:ArchiveProviderBinding,_signal:AbortSignal,work:()=>Promise<T>)=>work(),
  inspectExactKeyBeforeMutation:inspect,ensurePermanentMarker:ensure,readExactMarker:read,listExactKeyVersions:list,deleteExactVersion:remove};
 const stop=new AbortController();const run=()=>fenceArchiveReservation({reservation,provider,checkCurrent:current,signal:stop.signal});
 return {reservation,marker,inspect,ensure,read,list,remove,current,provider,stop,run};
}
afterEach(()=>{vi.useRealTimers();vi.clearAllMocks();});
describe("archive cleanup safe extent and final coordinator authority",()=>{
 it("accepts an extent ending exactly at the safe integer limit without allocating payload bytes",async()=>{
  const f=fixture(),ordinal=2_251_799_813,byteCount=2_740_991;
  f.reservation.ordinal=ordinal;f.reservation.locator.byteCount=byteCount;
  f.reservation.writeIdentity={...f.reservation.writeIdentity,ordinal,offset:ordinal*4_000_000,byteCount,
   logicalKey:`${"d".repeat(64)}/${exportId}/${attemptId}-${ordinal}.part`};
  expect(f.reservation.writeIdentity.offset+byteCount).toBe(Number.MAX_SAFE_INTEGER);
  await expect(f.run()).resolves.toMatchObject({disposition:"payload-tombstoned",marker:f.marker});
  expect(f.ensure).toHaveBeenCalledOnce();expect(f.read).toHaveBeenCalledTimes(2);
  expect(f.remove).not.toHaveBeenCalled();
 });
 it("refuses the next unsafe extent before currentness or provider work",async()=>{
  const f=fixture(),ordinal=2_251_799_813,byteCount=2_740_992,ready=vi.fn(async()=>{});
  f.reservation.ordinal=ordinal;f.reservation.locator.byteCount=byteCount;
  f.reservation.writeIdentity={...f.reservation.writeIdentity,ordinal,offset:ordinal*4_000_000,byteCount,
   logicalKey:`${"d".repeat(64)}/${exportId}/${attemptId}-${ordinal}.part`};
  expect(f.reservation.writeIdentity.offset).toBe(9_007_199_252_000_000);
  expect(f.reservation.writeIdentity.offset+byteCount).toBe(9_007_199_254_740_992);
  await expect(fenceArchiveReservation({reservation:f.reservation,provider:{...f.provider,assertReady:ready},
   checkCurrent:f.current,signal:f.stop.signal})).rejects.toMatchObject({issues:[expect.objectContaining({code:"custom",path:[]})]});
  expect(f.current).not.toHaveBeenCalled();expect(ready).not.toHaveBeenCalled();
  expect(f.inspect).not.toHaveBeenCalled();expect(f.ensure).not.toHaveBeenCalled();
  expect(f.read).not.toHaveBeenCalled();expect(f.list).not.toHaveBeenCalled();expect(f.remove).not.toHaveBeenCalled();
 });
 it("refuses a revoked claim after a valid callback before coordinator return",async()=>{
  const f=fixture();let completed!:()=>void,release!:()=>void;
  const callbackComplete=new Promise<void>(resolve=>{completed=resolve;});
  const coordinatorRelease=new Promise<void>(resolve=>{release=resolve;});
  const coordinator:ArchivePermanentFenceProvider["serializeExactKey"]=async(_binding,_signal,work)=>{
   const result=await work();expect(result).toMatchObject({version:"archive-permanent-fence-evidence-v1",
    reservationSha256:f.reservation.reservationSha256,marker:f.marker,deletedVersionCount:0,disposition:"payload-tombstoned"});
   completed();await coordinatorRelease;return result;
  };
  const running=fenceArchiveReservation({reservation:f.reservation,provider:{...f.provider,serializeExactKey:coordinator},
   checkCurrent:f.current,signal:f.stop.signal});void running.catch(()=>{});
  try{
   await Promise.race([callbackComplete,running.then(()=>{throw new Error("synthetic_coordinator_did_not_pause");})]);
   expect(f.ensure).toHaveBeenCalledOnce();expect(f.read).toHaveBeenCalledTimes(2);expect(f.list).toHaveBeenCalledTimes(2);
   const currentCalls=f.current.mock.calls.length;expect(Date.now()).toBeLessThan(Date.parse(f.reservation.claimExpiresAt));
   f.current.mockResolvedValue({...f.reservation,claimExpiresAt:new Date(Date.now()-1).toISOString()});
   release();await expect(running).rejects.toThrow("archive_cleanup_unavailable");
   expect(f.current.mock.calls.length).toBeGreaterThan(currentCalls);expect(f.remove).not.toHaveBeenCalled();
  }finally{release();f.stop.abort();}
 });
 it("refuses lost readiness after a valid callback before coordinator return",async()=>{
  const f=fixture(),ready=vi.fn(async()=>{});let completed!:()=>void,release!:()=>void;
  const callbackComplete=new Promise<void>(resolve=>{completed=resolve;});
  const coordinatorRelease=new Promise<void>(resolve=>{release=resolve;});
  const coordinator:ArchivePermanentFenceProvider["serializeExactKey"]=async(_binding,_signal,work)=>{
   const result=await work();expect(result).toMatchObject({version:"archive-permanent-fence-evidence-v1",
    reservationSha256:f.reservation.reservationSha256,marker:f.marker,deletedVersionCount:0,disposition:"payload-tombstoned"});
   completed();await coordinatorRelease;return result;
  };
  const running=fenceArchiveReservation({reservation:f.reservation,provider:{...f.provider,assertReady:ready,serializeExactKey:coordinator},
   checkCurrent:f.current,signal:f.stop.signal});void running.catch(()=>{});
  try{
   await Promise.race([callbackComplete,running.then(()=>{throw new Error("synthetic_coordinator_did_not_pause");})]);
   expect(f.ensure).toHaveBeenCalledOnce();expect(f.read).toHaveBeenCalledTimes(2);expect(f.list).toHaveBeenCalledTimes(2);
   const readyCalls=ready.mock.calls.length;expect(Date.now()).toBeLessThan(Date.parse(f.reservation.claimExpiresAt));
   ready.mockRejectedValue(new Error("synthetic_post_release_policy_unavailable"));
   release();await expect(running).rejects.toThrow("synthetic_post_release_policy_unavailable");
   expect(ready.mock.calls.length).toBeGreaterThan(readyCalls);expect(f.remove).not.toHaveBeenCalled();
  }finally{release();f.stop.abort();}
 });
});
describe("unbound archive ownership and marker-stream source successor",()=>{
 it("passes the complete immutable binding to all operations, inspects before mutation and retains exact empty EOF evidence",async()=>{
  const f=fixture();const proof=await f.run();expect(proof).toMatchObject({reservationSha256:f.reservation.reservationSha256,
   marker:f.marker,deletedVersionCount:0,disposition:"payload-tombstoned"});
  expect(f.inspect.mock.invocationCallOrder[0]).toBeLessThan(f.ensure.mock.invocationCallOrder[0]);
  for(const calls of [f.inspect.mock.calls,f.ensure.mock.calls,f.read.mock.calls,f.list.mock.calls])
   for(const args of calls){expect(args[0]).toEqual(f.reservation);expect(Object.isFrozen(args[0])).toBe(true);
    expect(Object.isFrozen(args[0].writeIdentity)).toBe(true);expect(Object.isFrozen(args[0].locator)).toBe(true);}
  expect(f.ensure.mock.calls[0][1]).toEqual({currentVersion:null,currentEtag:null,versions:[]});
  expect(f.remove).not.toHaveBeenCalled();expect(f.read).toHaveBeenCalledTimes(2);expect(f.list).toHaveBeenCalledTimes(2);
 });
 it.each(["binding","count","digest","key","delete-marker","missing-current"])("refuses %s history before any marker replacement or deletion",async fault=>{
  const f=fixture();const row={objectKey:physical,version:"payload-1",etag:"payload-etag",deleteMarker:false,byteCount:7,
   kind:"verified-owned-payload",writeBindingSha256:bindingHash,verifiedSha256:hash};
  const changed={...row,...(fault==="binding"?{writeBindingSha256:"e".repeat(64)}:fault==="count"?{byteCount:8}
   :fault==="digest"?{verifiedSha256:"e".repeat(64)}:fault==="key"?{objectKey:"export/40000000-0000-4000-8000-000000000004"}
    :fault==="delete-marker"?{deleteMarker:true}:{})};
  f.inspect.mockResolvedValue({expected:f.reservation,currentVersion:fault==="missing-current"?"unknown":row.version,
   currentEtag:row.etag,versions:[changed],nextCursor:null});
  await expect(f.run()).rejects.toThrow("archive_cleanup_unavailable");expect(f.ensure).not.toHaveBeenCalled();expect(f.remove).not.toHaveBeenCalled();
 });
 it("supplies the observed current CAS and stops if the adapter refuses a changed history",async()=>{
  const f=fixture();f.ensure.mockImplementation(async(_binding,observed)=>{
   expect(observed).toEqual({currentVersion:null,currentEtag:null,versions:[]});throw new Error("atomic changed-history refusal");});
  await expect(f.run()).rejects.toThrow("atomic changed-history refusal");expect(f.read).not.toHaveBeenCalled();expect(f.remove).not.toHaveBeenCalled();
 });
 it("cancels a returned marker stream when the post-read current check fails, without awaiting cancellation",async()=>{
  const f=fixture(),cancel=vi.fn(()=>new Promise<void>(()=>{}));let returned=false;
  f.read.mockImplementation(async()=>{returned=true;return {descriptor:f.marker,body:new ReadableStream<Uint8Array>({cancel})};});
  f.current.mockImplementation(async()=>{if(returned)throw new Error("stale current");return f.reservation;});
  await expect(f.run()).rejects.toThrow("stale current");expect(cancel).toHaveBeenCalled();expect(f.remove).not.toHaveBeenCalled();
 });
 it("cancels a marker stream before a bad descriptor can escape, without awaiting cancellation",async()=>{
  const f=fixture(),cancel=vi.fn(()=>new Promise<void>(()=>{}));
  f.read.mockResolvedValue({descriptor:{...f.marker,etag:"different"},body:new ReadableStream<Uint8Array>({cancel})});
  await expect(f.run()).rejects.toThrow("archive_cleanup_unavailable");expect(cancel).toHaveBeenCalled();expect(f.list).not.toHaveBeenCalled();
 });
 it("owns and cancels a read response arriving after the unchanged claim bound; no listing/deletion/evidence follows",async()=>{
  vi.useFakeTimers();const f=fixture(),cancel=vi.fn(()=>new Promise<void>(()=>{}));
  let resolve!:(value:{descriptor:unknown;body:ReadableStream<Uint8Array>})=>void;
  f.read.mockImplementation(()=>new Promise(done=>{resolve=done;}));
  const refusal=expect(f.run()).rejects.toThrow("archive_cleanup_unavailable");await vi.advanceTimersByTimeAsync(30_001);await refusal;
  expect(f.read).toHaveBeenCalledOnce();resolve({descriptor:f.marker,body:new ReadableStream<Uint8Array>({cancel})});
  await vi.advanceTimersByTimeAsync(1);expect(cancel).toHaveBeenCalled();expect(f.list).not.toHaveBeenCalled();expect(f.remove).not.toHaveBeenCalled();
 });
 it("cancels an owned stream on caller abort while a noncooperative post-read current check is held",async()=>{
  vi.useFakeTimers();const f=fixture(),cancel=vi.fn(()=>new Promise<void>(()=>{}));let returned=false;
  f.read.mockImplementation(async()=>{returned=true;return {descriptor:f.marker,body:new ReadableStream<Uint8Array>({cancel})};});
  f.current.mockImplementation(async()=>returned?new Promise<unknown>(()=>{}):f.reservation);
  const refusal=expect(f.run()).rejects.toThrow("archive_cleanup_unavailable");await vi.advanceTimersByTimeAsync(1);
  expect(f.read).toHaveBeenCalledOnce();f.stop.abort();await refusal;expect(cancel).toHaveBeenCalled();expect(f.list).not.toHaveBeenCalled();
 });
});


// These additive callbacks test the algorithm's nonempty deletion path only.
// They do not supply any actual provider ownership or physical deletion proof.
function ownedPayloadFixture(){
 const f=fixture();
 const owned={objectKey:physical,version:"payload-1",etag:"payload-etag",deleteMarker:false,byteCount:7,
  kind:"verified-owned-payload",writeBindingSha256:bindingHash,verifiedSha256:hash};
 const before=[{objectKey:physical,version:f.marker.version,deleteMarker:false,byteCount:0},
  {objectKey:physical,version:owned.version,deleteMarker:false,byteCount:7}];
 const after=[before[0]];
 f.inspect.mockResolvedValue({expected:f.reservation,currentVersion:owned.version,currentEtag:owned.etag,
  versions:[owned],nextCursor:null});
 f.list.mockResolvedValueOnce({versions:before,nextCursor:null}).mockResolvedValueOnce({versions:after,nextCursor:null});
 f.remove.mockResolvedValue({objectKey:physical,version:owned.version,deleted:true});
 return {...f,owned,before,after};
}
describe("additive owned-payload deletion and acknowledgement refusals",()=>{
 it("deletes only the inspected owned payload version and proves complete marker inventories and both EOF reads",async()=>{
  const f=ownedPayloadFixture();let eofReads=0;
  f.read.mockImplementation(async()=>({descriptor:f.marker,body:new ReadableStream<Uint8Array>({
   pull(c){eofReads++;c.close();}}, {highWaterMark:0})}));
  const proof=await f.run();
  expect(proof).toEqual({version:"archive-permanent-fence-evidence-v1",reservationSha256:f.reservation.reservationSha256,
   marker:f.marker,completeListingSha256:createHash("sha256").update(JSON.stringify(f.after)).digest("hex"),
   deletedVersionCount:1,disposition:"payload-tombstoned"});
  expect(Object.isFrozen(proof)).toBe(true);expect(Object.isFrozen(proof.marker)).toBe(true);
  expect(f.inspect).toHaveBeenCalledOnce();expect(f.ensure).toHaveBeenCalledOnce();
  expect(f.ensure.mock.calls[0][1]).toEqual({currentVersion:f.owned.version,currentEtag:f.owned.etag,versions:[f.owned]});
  expect(f.remove).toHaveBeenCalledOnce();expect(f.remove.mock.calls[0][0]).toEqual(f.reservation);
  expect(f.remove.mock.calls[0][1]).toBe(f.owned.version);expect(f.remove.mock.calls[0][2]).toBeInstanceOf(AbortSignal);
  expect(f.remove.mock.calls.every(([,version])=>version!==f.marker.version)).toBe(true);
  expect(f.list).toHaveBeenCalledTimes(2);expect(f.read).toHaveBeenCalledTimes(2);expect(eofReads).toBe(2);
  for(const [binding,cursor]of f.list.mock.calls){expect(binding).toEqual(f.reservation);expect(cursor).toBeNull();}
  for(const [binding,marker]of f.read.mock.calls){expect(binding).toEqual(f.reservation);expect(marker).toEqual(f.marker);}
  const order=[f.inspect.mock.invocationCallOrder[0],f.ensure.mock.invocationCallOrder[0],f.read.mock.invocationCallOrder[0],
   f.list.mock.invocationCallOrder[0],f.remove.mock.invocationCallOrder[0],f.list.mock.invocationCallOrder[1],f.read.mock.invocationCallOrder[1]];
  for(let i=1;i<order.length;i++)expect(order[i-1]).toBeLessThan(order[i]);
 });
 it("refuses unknown post-marker history before deleting even the otherwise owned payload",async()=>{
  const f=ownedPayloadFixture();f.list.mockReset();
  f.list.mockResolvedValue({versions:[...f.before,{objectKey:physical,version:"unknown-2",deleteMarker:false,byteCount:7}],nextCursor:null});
  await expect(f.run()).rejects.toThrow("archive_cleanup_unavailable");
  expect(f.inspect).toHaveBeenCalledOnce();expect(f.ensure).toHaveBeenCalledOnce();
  expect(f.read).toHaveBeenCalledOnce();expect(f.list).toHaveBeenCalledOnce();expect(f.remove).not.toHaveBeenCalled();
 });
 it.each(["key","version","deleted-false"] as const)("refuses %s deletion acknowledgement without issuing completion evidence",async fault=>{
  const f=ownedPayloadFixture();f.remove.mockResolvedValue({
   objectKey:fault==="key"?"export/40000000-0000-4000-8000-000000000004":physical,
   version:fault==="version"?"foreign-version":f.owned.version,deleted:fault!=="deleted-false"});
  const running=f.run();
  if(fault==="deleted-false")await expect(running).rejects.toMatchObject({name:"ZodError"});
  else await expect(running).rejects.toThrow("archive_cleanup_unavailable");
  expect(f.remove).toHaveBeenCalledOnce();expect(f.remove.mock.calls[0][0]).toEqual(f.reservation);
  expect(f.remove.mock.calls[0][1]).toBe(f.owned.version);
  expect(f.list).toHaveBeenCalledOnce();expect(f.read).toHaveBeenCalledOnce();
 });
});
