import {beforeEach,describe,expect,it,vi} from "vitest";
import {createHash} from "node:crypto";
import {createAccountArchiveR2Writer,disposeAccountArchiveR2Segment} from "./account-archive-r2";
import {r2AllocationDigest,type R2CurrentReservation,type R2CurrentDescriptor} from "./archive-r2-current-fence";
import {createRequesterStatementRuntime} from "./requester-statement-runtime";
import {approvedAccountArchiveGeneration} from "./account-archive-generation";
import type {ArchiveAttempt} from "./archive-segments";
import type {RequesterStatementR2Gateway} from "./requester-statement-r2";

const db=vi.hoisted(()=>({events:[] as string[],frame:null as unknown,current:null as unknown,reservation:null as unknown,
 completeId:"",failCommit:0,commits:0,failClose:false,drift:false}));
vi.mock("@/lib/uploads/normalization-database",()=>({normalizationDatabaseConfig:()=>({host:"synthetic",database:"synthetic",username:"postgres"})}));
vi.mock("postgres",()=>({default:()=>({
 begin:async(work:(tx:(strings:TemplateStringsArray,...values:unknown[])=>Promise<unknown[]>)=>Promise<unknown>)=>{
  const value=await work(async strings=>{
   const text=strings.join("?");
   if(text.includes("current_user="))return [{allowed:true}];
   if(text.includes("set_config"))return [];
   const name=text.match(/private\.([a-z0-9_]+)/u)?.[1];db.events.push(name??"unknown");
   if(name==="reserve_account_archive_r2_write_v1")return [{frame:db.frame}];
   if(name==="current_account_archive_r2_write_v1")return [{frame:db.current??db.frame}];
   if(name==="complete_account_archive_r2_write_v1")return [{id:db.completeId}];
   if(name==="claim_account_archive_r2_disposal_v1")return [{frame:db.reservation}];
   if(name==="check_account_archive_r2_disposal_v1")return [{frame:db.drift?{...db.reservation as object,authorityReceipt:"f".repeat(64)}:db.reservation}];
   if(name==="ack_account_archive_r2_disposal_v1")return [{acknowledged:true}];
   throw new Error("unexpected-native-door");
  });
  db.commits++;if(db.commits===db.failCommit)throw new Error("unknown-commit-response");
  db.events.push("commit");return value;
 },end:async()=>{db.events.push("close");if(db.failClose)throw new Error("close-failed");}
})}));
const id=(n:number)=>`84000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
const digest=(bytes:Uint8Array)=>createHash("sha256").update(bytes).digest("hex");
const env={INHERIT_TEST_JURISDICTION:"1",INHERIT_TEST_ACCOUNT_ARCHIVE_R2:"1"};
const receipt="e".repeat(64);
function fixture(){
 const bytes=new Uint8Array([31,37,41]),runtime=createRequesterStatementRuntime(),stop=new AbortController(),deadline=Date.now()+30_000;
 const attempt:ArchiveAttempt={version:"archive-segments-v1",exportId:id(1),attemptId:id(2),principalHash:"d".repeat(64),bucket:"exports"};
 const segment={ordinal:0,offset:0,sizeBytes:3,sha256:digest(bytes),objectKey:`${attempt.principalHash}/${attempt.exportId}/${attempt.attemptId}-0.part`};
 const locator={provider:"archive-r2-current-object-v1" as const,bucket:"inherit-export-test",objectKey:`export/${id(9)}`,byteCount:3,sha256:segment.sha256};
 const frame={objectId:id(3),writeIdentity:{purpose:"inherit-export-reservation-v1" as const,exportId:attempt.exportId,attemptId:attempt.attemptId,
  ordinal:0,offset:0,byteCount:3,sha256:segment.sha256,logicalKey:segment.objectKey,reservedAt:new Date().toISOString(),authorityReceipt:receipt,locator},
  allocationSha256:r2AllocationDigest(locator.bucket,locator.objectKey),writeBindingSha256:"a".repeat(64),configurationSha256:"b".repeat(64),
  originalDeadline:new Date(deadline-5_000).toISOString()};
 db.frame=frame;db.completeId=frame.objectId;
 const descriptor={key:locator.objectKey,version:"version1",etag:"etag1",size:3,
  customMetadata:{state:"owned-payload",allocationSha256:frame.allocationSha256,writeBindingSha256:frame.writeBindingSha256}};
 const chunk=bytes.slice();
 const gateway:RequesterStatementR2Gateway={assertReady:async()=>{db.events.push("ready");},
  createPayload:async()=>{db.events.push("create");return descriptor;},
  readPayload:async()=>({descriptor,body:new ReadableStream({start(c){c.enqueue(chunk);c.close();}})}),
  disposalProvider:{assertReady:async()=>{},serializeExactKey:async(_b,_s,work)=>work(),headCurrent:async()=>null,
   readCurrent:async()=>{throw new Error("not-selected");},replaceWithEmptyMarker:async()=>{throw new Error("not-selected");}}};
 const write=(selected=gateway)=>createAccountArchiveR2Writer({gateway:selected,authorityReceipt:receipt,deadline,runtime,env});
 return {bytes,chunk,runtime,stop,deadline,attempt,segment,frame,descriptor,gateway,write};
}
beforeEach(()=>{Object.assign(db,{events:[],frame:null,current:null,reservation:null,completeId:"",failCommit:0,commits:0,failClose:false,drift:false});});
// These exercise the actual adapter, complete reader, mutable-buffer runtime
// and current-object fence with synthetic native/provider responses. Native SQL
// authority is checked separately by account_archive_r2_reservations.sql.
describe("dedicated account R2 write",()=>{
 it("keeps an explicit account configuration and generation opt-in closed by default",()=>{
  const f=fixture();expect(()=>createAccountArchiveR2Writer({gateway:f.gateway,authorityReceipt:receipt,deadline:f.deadline,runtime:f.runtime,env:{}})).toThrow();
  expect(approvedAccountArchiveGeneration()).toBeNull();expect(db.events).toEqual([]);
 });
 it("refuses the actual default environment without its separate account opt-in",()=>{
  vi.stubEnv("INHERIT_TEST_JURISDICTION","1");vi.stubEnv("INHERIT_TEST_ACCOUNT_ARCHIVE_R2",undefined);
  try{
   const f=fixture();expect(()=>createAccountArchiveR2Writer({gateway:f.gateway,authorityReceipt:receipt,
    deadline:f.deadline,runtime:f.runtime})).toThrow("account_archive_r2_unavailable");
   expect(db.events).toEqual([]);expect(approvedAccountArchiveGeneration()).toBeNull();
  }finally{vi.unstubAllEnvs();}
 });
 it("commits allocation before provider work, reads actual EOF/hash and ACKs only its native object",async()=>{
  const f=fixture();expect(await f.write()(f.attempt,f.segment,f.bytes,f.stop.signal)).toEqual({objectId:f.frame.objectId});
  expect(db.events.indexOf("commit")).toBeLessThan(db.events.indexOf("create"));
  expect(db.events.indexOf("create")).toBeLessThan(db.events.indexOf("complete_account_archive_r2_write_v1"));
  expect([...f.chunk]).toEqual([0,0,0]);expect([...f.bytes]).toEqual([31,37,41]);
  expect(db.events.filter(x=>x.startsWith("complete_"))).toEqual(["complete_account_archive_r2_write_v1"]);
  await f.runtime.settle(f.deadline);f.runtime.assertSettled();expect(approvedAccountArchiveGeneration()).toBeNull();
 });
 it.each(["exportId","attemptId","authorityReceipt","logicalKey"] as const)("refuses a foreign native %s before CREATE",async key=>{
  const f=fixture();db.frame={...f.frame,writeIdentity:{...f.frame.writeIdentity,[key]:key.endsWith("Id")?id(99):"f".repeat(64)}};
  await expect(f.write()(f.attempt,f.segment,f.bytes,f.stop.signal)).rejects.toThrow();expect(db.events).not.toContain("create");
 });
 it("refuses changed allocation/current frame before provider work",async()=>{
  const f=fixture();db.current={...f.frame,configurationSha256:"c".repeat(64)};
  await expect(f.write()(f.attempt,f.segment,f.bytes,f.stop.signal)).rejects.toThrow();expect(db.events).not.toContain("create");
 });
 it("refuses wrong input hash before any native allocation",async()=>{
  const f=fixture();await expect(f.write()(f.attempt,f.segment,new Uint8Array([1,2,3]),f.stop.signal)).rejects.toThrow();expect(db.events).toEqual([]);
 });
 it("never retries or adopts an unknown reservation COMMIT",async()=>{
  const f=fixture(),write=f.write();db.failCommit=1;
  await expect(write(f.attempt,f.segment,f.bytes,f.stop.signal)).rejects.toThrow();
  await expect(write(f.attempt,f.segment,f.bytes,f.stop.signal)).rejects.toThrow();
  expect(db.events.filter(x=>x==="reserve_account_archive_r2_write_v1")).toHaveLength(1);expect(db.events).not.toContain("create");
 });
 it("keeps a lost CREATE response pending and never performs native completion or resubmits",async()=>{
  const f=fixture(),write=f.write({...f.gateway,createPayload:async()=>{db.events.push("create");throw new Error("lost-response");}});
  await expect(write(f.attempt,f.segment,f.bytes,f.stop.signal)).rejects.toThrow();
  await expect(write(f.attempt,f.segment,f.bytes,f.stop.signal)).rejects.toThrow();
  expect(db.events.filter(x=>x==="create")).toHaveLength(1);expect(db.events).not.toContain("complete_account_archive_r2_write_v1");
 });
 it.each(["truncated","wrong-hash","wrong-version"])("refuses %s whole readback before native ACK",async reason=>{
  const f=fixture(),chunk=reason==="truncated"?new Uint8Array([31]):reason==="wrong-hash"?new Uint8Array([1,2,3]):f.bytes.slice();
  const gateway={...f.gateway,readPayload:async()=>({descriptor:{...f.descriptor,version:reason==="wrong-version"?"version2":"version1"},
   body:new ReadableStream<Uint8Array>({start(c){c.enqueue(chunk);c.close();}})})};
  await expect(f.write(gateway)(f.attempt,f.segment,f.bytes,f.stop.signal)).rejects.toThrow();
  expect(db.events).not.toContain("complete_account_archive_r2_write_v1");expect([...chunk]).toEqual(Array(chunk.length).fill(0));
 });
 it("refuses revocation after CREATE without a native ACK",async()=>{
  const f=fixture();const gateway={...f.gateway,createPayload:async()=>{f.stop.abort();return f.descriptor;}};
  await expect(f.write(gateway)(f.attempt,f.segment,f.bytes,f.stop.signal)).rejects.toThrow();expect(db.events).not.toContain("complete_account_archive_r2_write_v1");
 });
 it("does not return success on a foreign completion identity or unknown final COMMIT",async()=>{
  const f=fixture();db.completeId=id(99);await expect(f.write()(f.attempt,f.segment,f.bytes,f.stop.signal)).rejects.toThrow();
  const g=fixture();db.completeId=g.frame.objectId;db.failCommit=db.commits+2;
  await expect(g.write()(g.attempt,g.segment,g.bytes,g.stop.signal)).rejects.toThrow();
 });
 it("keeps actual native close failure in the owned runtime disposition",async()=>{
  const f=fixture();db.failClose=true;await expect(f.write()(f.attempt,f.segment,f.bytes,f.stop.signal)).rejects.toThrow();
  await expect(f.runtime.settle(f.deadline)).rejects.toThrow("statement_runtime_disposition_held");expect(()=>f.runtime.assertSettled()).toThrow();
 });
});
function disposal(){
 const f=fixture(),reservation:R2CurrentReservation={version:"archive-r2-current-cleanup-reservation-v1",exportId:f.attempt.exportId,
  attemptId:f.attempt.attemptId,ordinal:0,authorityReceipt:receipt,reservationSha256:"c".repeat(64),locator:f.frame.writeIdentity.locator,
  writeIdentity:f.frame.writeIdentity,writeBindingSha256:f.frame.writeBindingSha256,allocationSha256:f.frame.allocationSha256,
  cleanupNotBefore:new Date(Date.now()-1_000).toISOString(),claimExpiresAt:new Date(Date.now()+20_000).toISOString()};
 db.reservation=reservation;
 let current:R2CurrentDescriptor={objectKey:reservation.locator.objectKey,version:"version1",etag:"etag1",byteCount:3,
  allocationSha256:reservation.allocationSha256,kind:"owned-payload",writeBindingSha256:reservation.writeBindingSha256};
 let payload:Uint8Array=f.bytes.slice(),malformedRead=false,cancelFails=false;
 const provider:RequesterStatementR2Gateway["disposalProvider"]={assertReady:async()=>{},serializeExactKey:async(_b,_s,work)=>work(),
  headCurrent:async()=>current,readCurrent:async()=>({descriptor:malformedRead?{...current,etag:"foreign-etag"}:current,
   body:new ReadableStream<Uint8Array>({pull(c){if(payload.byteLength)c.enqueue(payload.slice());c.close();},cancel(){if(cancelFails)throw new Error("actual-cancel-failed");}},{highWaterMark:0})}),
  replaceWithEmptyMarker:async()=>{db.events.push("marker");current={objectKey:reservation.locator.objectKey,version:"marker1",etag:"marker-etag",
   byteCount:0,allocationSha256:reservation.allocationSha256,kind:"permanent-empty-fence",writeBindingSha256:null};payload=new Uint8Array();return current;}};
 const run=()=>disposeAccountArchiveR2Segment({attemptId:f.attempt.attemptId,ordinal:0,gateway:{...f.gateway,disposalProvider:provider},
  runtime:f.runtime,signal:f.stop.signal,env});
 return {...f,run,setPayload:(bytes:Uint8Array)=>{payload=bytes;},failUnreadCancel:()=>{malformedRead=true;cancelFails=true;}};
}
describe("account-owned permanent disposal",()=>{
 it("rechecks the exact native claim, verifies payload and empty EOF before native disposal ACK",async()=>{
  const f=disposal();await f.run();expect(db.events.indexOf("marker")).toBeLessThan(db.events.indexOf("ack_account_archive_r2_disposal_v1"));
  expect(db.events.filter(x=>x==="check_account_archive_r2_disposal_v1").length).toBeGreaterThan(2);
  await f.runtime.settle(f.deadline);f.runtime.assertSettled();
 });
 it("refuses a changed native authority/claim before marker or ACK",async()=>{
  const f=disposal();db.drift=true;await expect(f.run()).rejects.toThrow();expect(db.events).not.toContain("marker");
  expect(db.events).not.toContain("ack_account_archive_r2_disposal_v1");
 });
 it("refuses a foreign current payload hash rather than disposing or adopting it",async()=>{
  const f=disposal();f.setPayload(new Uint8Array([1,2,3]));await expect(f.run()).rejects.toThrow();
  expect(db.events).not.toContain("marker");expect(db.events).not.toContain("ack_account_archive_r2_disposal_v1");
 });
 it("tracks actual unopened cancellation failure and never supplies a disposal ACK",async()=>{
  const f=disposal();f.failUnreadCancel();await expect(f.run()).rejects.toThrow();
  expect(db.events).not.toContain("ack_account_archive_r2_disposal_v1");
  await expect(f.runtime.settle(f.deadline)).rejects.toThrow("statement_runtime_disposition_held");
 });
});
