import {describe,expect,it} from "vitest";
import {createZip64Archive} from "./src/lib/exports/archive-zip64";
import {createRequesterStatementRuntime} from "./src/lib/exports/requester-statement-runtime";
import {createRequesterStatementMemorySpool} from "./src/lib/exports/requester-statement-spool";
function deferred(){let resolve!:()=>void;const promise=new Promise<void>(yes=>{resolve=yes;});return {promise,resolve};}

// AUTHORED, UNRUN. This exercises actual local ZIP/stream cancellation and
// mutable arrays. The synthetic receipt is not native/provider authority proof.
describe("marked ZIP waits for the actual source cancellation",()=>{
 it("does not settle while an opened member's cancel callback is still pending",async()=>{
  const runtime=createRequesterStatementRuntime(),pending=deferred(),started=deferred();
  const bytes=runtime.own(new Uint8Array([43,47,53])),signal=new AbortController().signal;
  const deadline=Date.now()+10_000,receipt="a".repeat(64);
  const member={name:"my-correction-statements.json",sizeBytes:bytes.byteLength,
   open:async()=>new ReadableStream<Uint8Array>({
    pull(controller){controller.enqueue(bytes);},
    async cancel(){started.resolve();await pending.promise;runtime.clear(bytes);},
   },{highWaterMark:0})};
  const zip=createZip64Archive({members:(async function*(){yield member;})(),expectedMemberCount:1,
   expectedPayloadBytes:bytes.byteLength,modifiedAt:Date.UTC(2026,9,4),deadline,signal,
   authorityReceipt:receipt,checkAuthority:async()=>receipt,
   spool:createRequesterStatementMemorySpool(runtime),sensitiveRuntime:runtime});
  const reader=zip.getReader(),header=(await reader.read()).value!;
  const cancel=reader.cancel();await started.promise;
  let acknowledged=false;
  const settled=runtime.settle(deadline).then(()=>{runtime.assertSettled();acknowledged=true;});
  await Promise.resolve();expect(acknowledged).toBe(false);expect([...bytes]).toEqual([43,47,53]);
  pending.resolve();await cancel;await settled;reader.releaseLock();
  expect(acknowledged).toBe(true);expect(bytes.every(byte=>byte===0)).toBe(true);
  expect(header.every(byte=>byte===0)).toBe(true);
 });
 it("holds disposition after the real source cancel callback fails",async()=>{
  const runtime=createRequesterStatementRuntime(),signal=new AbortController().signal,receipt="b".repeat(64);
  const bytes=runtime.own(new Uint8Array([59])),deadline=Date.now()+10_000;
  const zip=createZip64Archive({members:(async function*(){yield {name:"my-correction-statements.json",sizeBytes:1,
   open:async()=>new ReadableStream<Uint8Array>({cancel(){throw new Error("actual-source-cancel-failed");}},{highWaterMark:0})};})(),
   expectedMemberCount:1,expectedPayloadBytes:1,modifiedAt:Date.UTC(2026,9,4),deadline,signal,
   authorityReceipt:receipt,checkAuthority:async()=>receipt,spool:createRequesterStatementMemorySpool(runtime),sensitiveRuntime:runtime});
  const reader=zip.getReader();await reader.read();await expect(reader.cancel()).rejects.toThrow();reader.releaseLock();
  await expect(runtime.settle(deadline)).rejects.toThrow();expect(()=>runtime.assertSettled()).toThrow();
  expect([...bytes]).toEqual([0]);
 });
});
