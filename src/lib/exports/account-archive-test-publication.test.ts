import {createHash} from "node:crypto";
import {beforeEach,describe,expect,it,vi} from "vitest";
import {completeTestAccountArchive,readTestAccountArchiveChunk} from "./account-archive-test-publication";
import {createRequesterStatementRuntime} from "./requester-statement-runtime";
import {r2AllocationDigest} from "./archive-r2-current-fence";
import type {buildAccountArchive} from "./account-archive-worker";
import type {RequesterStatementR2Gateway} from "./requester-statement-r2";
import {approvedAccountArchiveGeneration} from "./account-archive-generation";
const native=vi.hoisted(()=>({events:[] as string[],page:null as unknown,current:null as unknown,ready:null as unknown,
 error:"",changes:false,reads:0,commits:0,unknownCommit:0,grantNext:0}));
vi.mock("@/lib/uploads/normalization-database",()=>({normalizationDatabaseConfig:()=>({host:"synthetic",database:"synthetic",username:"postgres"})}));
vi.mock("postgres",()=>({default:()=>({begin:async(work:(tx:(strings:TemplateStringsArray,...values:unknown[])=>Promise<unknown[]>)=>Promise<unknown>)=>{
 const value=await work(async(strings,...values)=>{
  const sql=strings.join("?");if(sql.includes("current_user="))return [{allowed:true}];if(sql.includes("set_config"))return [];
  const name=sql.match(/private\.([a-z0-9_]+)/u)?.[1]??"unknown";native.events.push(name);
  if(native.error===name)throw new Error("native-refusal");
  if(name==="account_archive_test_manifest_page_v1")return [{page:native.page}];
  if(name==="current_account_archive_test_object_v1"){
   if(values.length===5&&values[1]!==native.grantNext)throw new Error("sequence");
   return [{entry:native.changes&&++native.reads>1?{...native.current as object,providerVersion:"changed"}:native.current}];
  }
  if(name==="complete_test_account_archive_v1")return [{ready:native.ready}];
  if(name==="ack_test_account_archive_download_v1"){
   if(values[1]!==native.grantNext)throw new Error("sequence");native.grantNext++;return [{acknowledged:true}];
  }
  throw new Error("unknown-door");
 });if(++native.commits===native.unknownCommit)throw new Error("unknown-commit");return value;
},end:async()=>{}})}));
const id=(n:number)=>`85000000-0000-4000-8000-${String(n).padStart(12,"0")}`,hash=(b:Uint8Array|string)=>createHash("sha256").update(b).digest("hex");
const env={INHERIT_TEST_JURISDICTION:"1",INHERIT_TEST_ACCOUNT_ARCHIVE_R2:"1"};
function fixture(){
 const bytes=Uint8Array.from([31,37,41]),receipt="a".repeat(64),deadline=new Date(Date.now()+180_000).toISOString();
 const attempt={version:"archive-segments-v1" as const,exportId:id(1),attemptId:id(2),principalHash:"b".repeat(64),bucket:"exports" as const};
 const segment={ordinal:0,offset:0,sizeBytes:3,sha256:hash(bytes),objectId:id(3),objectKey:`${attempt.principalHash}/${attempt.exportId}/${attempt.attemptId}-0.part`};
 const locator={provider:"archive-r2-current-object-v1" as const,bucket:"inherit-export-test",objectKey:`export/${id(4)}`,byteCount:3,sha256:segment.sha256};
 const frame={objectId:segment.objectId,writeIdentity:{purpose:"inherit-export-reservation-v1" as const,exportId:attempt.exportId,
  attemptId:attempt.attemptId,ordinal:0,offset:0,byteCount:3,sha256:segment.sha256,logicalKey:segment.objectKey,
  authorityReceipt:receipt,reservedAt:new Date().toISOString(),locator},writeBindingSha256:"c".repeat(64),
  allocationSha256:r2AllocationDigest(locator.bucket,locator.objectKey),configurationSha256:"d".repeat(64),originalDeadline:deadline};
 const entry={segment,frame,providerVersion:"version1",providerEtag:"etag1"};
 const summary={state:"bytes-complete" as const,attempt,authorityReceipt:receipt,sizeBytes:3,sha256:segment.sha256,segmentCount:1,pageCount:1,
  manifestSha256:hash(JSON.stringify([0,0,3,segment.sha256,segment.objectKey,segment.objectId])+"\n")};
 const completionProof={version:"complete-account-zip64-producer-v1" as const,memberCount:2,payloadBytes:1,memberSha256:"e".repeat(64),manifestMemberSha256:"f".repeat(64)};
 const result={summary,memberCount:2,payloadBytes:1,completionProof} as Awaited<ReturnType<typeof buildAccountArchive>>;
 const job={exportId:attempt.exportId,principalHash:attempt.principalHash,authorityReceipt:receipt,deadline};
 const ready={status:"ready" as const,exportId:attempt.exportId,attemptId:attempt.attemptId,sizeBytes:3,sha256:summary.sha256,
  manifestSha256:summary.manifestSha256,expiresAt:deadline,authorityReceipt:receipt,principalHash:attempt.principalHash,
  segmentCount:1,pageCount:1,memberCount:2,payloadBytes:1,memberSha256:completionProof.memberSha256,manifestMemberSha256:completionProof.manifestMemberSha256};
 native.page={page:0,sizeBytes:3,segmentCount:1,pageCount:1,sha256:summary.sha256,manifestSha256:summary.manifestSha256,segments:[entry]};
 native.current={frame,providerVersion:entry.providerVersion,providerEtag:entry.providerEtag};native.ready=ready;
 const descriptor={key:locator.objectKey,version:"version1",etag:"etag1",size:3,
  customMetadata:{state:"owned-payload",allocationSha256:frame.allocationSha256,writeBindingSha256:frame.writeBindingSha256}};
 const chunks:Uint8Array[]=[],gateway:RequesterStatementR2Gateway={assertReady:async()=>{},createPayload:async()=>{throw new Error("no-write-during-publication");},
  readPayload:async()=>{native.events.push("physical-read");const chunk=bytes.slice();chunks.push(chunk);
   return {descriptor,body:new ReadableStream<Uint8Array>({start(c){c.enqueue(chunk);c.close();}})};},
  disposalProvider:{assertReady:async()=>{},serializeExactKey:async(_b,_s,work)=>work(),headCurrent:async()=>null,
   readCurrent:async()=>{throw new Error("not-selected");},replaceWithEmptyMarker:async()=>{throw new Error("not-selected");}}};
 const runtime=createRequesterStatementRuntime(),stop=new AbortController(),signal=stop.signal;
 const complete=(selected=gateway)=>completeTestAccountArchive({job,result,gateway:selected,runtime,signal,env});
 const download=(selected=gateway)=>readTestAccountArchiveChunk({ready,ordinal:0,downloadHash:"9".repeat(64),
  origin:{kind:"account",accountId:id(10),sessionId:id(11)},gateway:selected,runtime,signal,env});
 return {bytes,job,result,ready,entry,descriptor,gateway,chunks,runtime,stop,signal,complete,download};
}
beforeEach(()=>Object.assign(native,{events:[],page:null,current:null,ready:null,error:"",changes:false,reads:0,commits:0,unknownCommit:0,grantNext:0}));
describe("closed TEST complete account publication",()=>{
 it("requires every complete physical read before native READY, preserving closed production",async()=>{
  const f=fixture();expect(await f.complete()).toEqual(f.ready);
  expect(native.events.indexOf("physical-read")).toBeLessThan(native.events.indexOf("complete_test_account_archive_v1"));
  expect(native.events.filter(x=>x==="current_account_archive_test_object_v1")).toHaveLength(2);
  expect(f.chunks.every(chunk=>chunk.every(b=>b===0))).toBe(true);
  await f.runtime.settle(Date.parse(f.job.deadline));f.runtime.assertSettled();expect(approvedAccountArchiveGeneration()).toBeNull();
 });
 it.each(["missing-page","missing-member","wrong-order","wrong-native-hash","foreign-frame"])("refuses %s without native READY",async fault=>{
  const f=fixture(),page=native.page as {segments:typeof f.entry[];manifestSha256:string};
  if(fault==="missing-page")native.page=null;if(fault==="missing-member")page.segments=[];
  if(fault==="wrong-order")page.segments[0].segment.ordinal=1;
  if(fault==="wrong-native-hash")page.manifestSha256="0".repeat(64);
  if(fault==="foreign-frame")page.segments[0].frame.writeIdentity.authorityReceipt="0".repeat(64);
  await expect(f.complete()).rejects.toThrow();expect(native.events).not.toContain("complete_test_account_archive_v1");
 });
 it.each(["truncated","overrun","hash","version","etag"])("rejects %s provider EOF/identity without READY",async fault=>{
  const f=fixture(),payload=fault==="truncated"?f.bytes.slice(0,2):fault==="overrun"?new Uint8Array([31,37,41,43]):fault==="hash"?new Uint8Array([1,2,3]):f.bytes.slice();
  const gateway={...f.gateway,readPayload:async()=>({descriptor:{...f.descriptor,
   ...(fault==="version"?{version:"wrong"}:{}),...(fault==="etag"?{etag:"wrong"}:{})},
   body:new ReadableStream<Uint8Array>({start(c){c.enqueue(payload);c.close();}})})};
  await expect(f.complete(gateway)).rejects.toThrow();expect(native.events).not.toContain("complete_test_account_archive_v1");expect(payload.every(b=>b===0)).toBe(true);
 });
 it("checks source currentness again after the actual read",async()=>{
  const f=fixture();native.changes=true;await expect(f.complete()).rejects.toThrow();expect(native.events).not.toContain("complete_test_account_archive_v1");
 });
 it("never adopts an unknown READY COMMIT",async()=>{
  const f=fixture();native.unknownCommit=3;await expect(f.complete()).rejects.toThrow();
  expect(native.events.filter(x=>x==="complete_test_account_archive_v1")).toHaveLength(1);
 });
 it("withholds bytes until complete native manifest and consumed current download grant succeed",async()=>{
  const f=fixture(),lease=await f.download();expect([...lease.bytes]).toEqual([...f.bytes]);
  expect(native.events.indexOf("account_archive_test_manifest_page_v1")).toBeLessThan(native.events.indexOf("physical-read"));
  expect(native.events.at(-1)).toBe("ack_test_account_archive_download_v1");expect(native.grantNext).toBe(1);
  await lease.release();expect(lease.bytes.every(b=>b===0)).toBe(true);f.runtime.assertSettled();
  const second=createRequesterStatementRuntime();await expect(readTestAccountArchiveChunk({ready:f.ready,ordinal:0,downloadHash:"9".repeat(64),
   origin:{kind:"account",accountId:id(10),sessionId:id(11)},gateway:f.gateway,runtime:second,signal:f.signal,env})).rejects.toThrow();
 });
 it("clears the actual consumer lease on cancellation and preserves settlement for release",async()=>{
  const f=fixture(),lease=await f.download();f.stop.abort();expect(lease.bytes.every(b=>b===0)).toBe(true);
  await lease.release();f.runtime.assertSettled();
 });
 it("refuses revoked native grant before payload access",async()=>{
  const f=fixture();native.error="account_archive_test_manifest_page_v1";await expect(f.download()).rejects.toThrow();expect(native.events).not.toContain("physical-read");
 });
 it("clears bytes on unknown download ACK COMMIT without retry or returning a lease",async()=>{
  const f=fixture();native.unknownCommit=2;await expect(f.download()).rejects.toThrow();
  expect(native.events.filter(x=>x==="ack_test_account_archive_download_v1")).toHaveLength(1);expect(f.chunks.every(c=>c.every(b=>b===0))).toBe(true);
 });
});
