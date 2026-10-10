import {afterEach,describe,expect,it,vi} from "vitest";
import {createHash} from "node:crypto";
import {readRequesterStatementWholeObject} from "./requester-statement-r2-read";
import {createRequesterStatementRuntime} from "./requester-statement-runtime";
type Gateway=Parameters<typeof readRequesterStatementWholeObject>[0];
type Frame=Parameters<typeof readRequesterStatementWholeObject>[1];
const id=(n:number)=>`81000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
const digest=(bytes:Uint8Array)=>createHash("sha256").update(bytes).digest("hex");
function frame(bytes:Uint8Array,originalDeadline=new Date(Date.now()+10_000).toISOString()):Frame{
 const locator={provider:"archive-r2-current-object-v1" as const,bucket:"inherit-export-test",objectKey:`export/${id(9)}`,
  byteCount:bytes.byteLength,sha256:digest(bytes)};
 return {objectId:id(1),writeBindingSha256:"a".repeat(64),allocationSha256:"b".repeat(64),configurationSha256:"c".repeat(64),originalDeadline,
  writeIdentity:{purpose:"inherit-export-reservation-v1",exportId:id(2),attemptId:id(3),ordinal:0,offset:0,byteCount:bytes.byteLength,
   sha256:digest(bytes),logicalKey:`${"d".repeat(64)}/${id(2)}/${id(3)}-0.part`,reservedAt:new Date().toISOString(),authorityReceipt:"e".repeat(64),locator}};
}
function descriptor(selected:Frame){return {key:selected.writeIdentity.locator.objectKey,version:"synthetic-version",etag:"synthetic-etag",
 size:selected.writeIdentity.byteCount,customMetadata:{state:"owned-payload",allocationSha256:selected.allocationSha256,writeBindingSha256:selected.writeBindingSha256}};}
function deferred(){let resolve!:()=>void,reject!:(error:Error)=>void;
 const promise=new Promise<void>((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};}
afterEach(()=>vi.useRealTimers());
// SOURCE-AUTHORED, UNRUN. The real shared read/verifier and real stream cancel
// execute in these tests. Synthetic descriptors do not prove native authority,
// provider availability, physical provider disposal or a native ACK.
describe("actual unopened R2 body disposal after descriptor refusal",()=>{
 it("registers and waits for the actual unopened cancellation; rejection keeps settlement held",async()=>{
  const runtime=createRequesterStatementRuntime(),bytes=new Uint8Array([17,19,23]),selected=frame(bytes),cancel=deferred(),entered=deferred();
  let pulled=false;
  const body=new ReadableStream<Uint8Array>({pull(){pulled=true;},cancel(){entered.resolve();return cancel.promise;}},{highWaterMark:0});
  const gateway:Gateway={assertReady:async()=>{},readPayload:async()=>({descriptor:{...descriptor(selected),size:bytes.byteLength+1},body})};
  const reading=readRequesterStatementWholeObject(gateway,selected,new AbortController().signal,runtime);
  const refusedRead=expect(reading).rejects.toThrow();await entered.promise;
  expect(pulled).toBe(false);expect(body.locked).toBe(false);
  let returned=false;const settling=runtime.settle(Date.parse(selected.originalDeadline)).then(()=>{returned=true;});
  const refusedSettlement=expect(settling).rejects.toThrow("statement_runtime_disposition_held");
  await Promise.resolve();expect(returned).toBe(false);expect(()=>runtime.assertSettled()).toThrow();
  cancel.reject(new Error("actual-stream-cancellation-failed"));await refusedRead;await refusedSettlement;
  expect(returned).toBe(false);expect(()=>runtime.assertSettled()).toThrow();
 });
 it("keeps the original deadline when actual cancellation finishes late",async()=>{
  vi.useFakeTimers();const runtime=createRequesterStatementRuntime(),bytes=new Uint8Array([29]),selected=frame(bytes,new Date(Date.now()+50).toISOString());
  const cancel=deferred(),entered=deferred();
  const body=new ReadableStream<Uint8Array>({cancel(){entered.resolve();return cancel.promise;}},{highWaterMark:0});
  const gateway:Gateway={assertReady:async()=>{},readPayload:async()=>({descriptor:{...descriptor(selected),key:"refused-key"},body})};
  const reading=readRequesterStatementWholeObject(gateway,selected,new AbortController().signal,runtime);
  const refusedRead=expect(reading).rejects.toThrow("statement_runtime_disposition_held");await entered.promise;
  const settling=runtime.settle(Date.parse(selected.originalDeadline));const refusedSettlement=expect(settling).rejects.toThrow();
  await vi.advanceTimersByTimeAsync(51);await refusedRead;await refusedSettlement;
  cancel.resolve();await Promise.resolve();await Promise.resolve();expect(()=>runtime.assertSettled()).toThrow();
 });
 it("zeros every real consumed chunk and retains the actual complete output until settlement",async()=>{
  const runtime=createRequesterStatementRuntime(),source=new Uint8Array([31,37,41]),selected=frame(source);
  const body=new ReadableStream<Uint8Array>({start(controller){controller.enqueue(source);controller.close();}});
  const gateway:Gateway={assertReady:async()=>{},readPayload:async()=>({descriptor:descriptor(selected),body})};
  const result=await readRequesterStatementWholeObject(gateway,selected,new AbortController().signal,runtime);
  expect([...source]).toEqual([0,0,0]);expect([...result.bytes]).toEqual([31,37,41]);
  await runtime.settle(Date.parse(selected.originalDeadline));runtime.assertSettled();expect([...result.bytes]).toEqual([0,0,0]);
 });
});
