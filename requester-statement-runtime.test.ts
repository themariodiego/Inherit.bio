import {afterEach,describe,expect,it,vi} from "vitest";
import {createRequesterStatementRuntime} from "./src/lib/exports/requester-statement-runtime";
function deferred<T>(){
 let resolve!:(value:T)=>void,reject!:(reason:unknown)=>void;
 const promise=new Promise<T>((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};
}
afterEach(()=>vi.useRealTimers());
// AUTHORED, UNRUN. Real byte arrays and delayed tasks exercise the registry.
// Native ACK/provider/whole user flow qualification is separately required.
describe("actual producer task and mutable-buffer disposal",()=>{
 it("waits for an admitted read and its actual cancellation before clearing bytes",async()=>{
  const runtime=createRequesterStatementRuntime(),read=deferred<void>(),cancel=deferred<void>();
  const bytes=runtime.own(new Uint8Array([13,17,19]));
  const pending=runtime.track("read",()=>read.promise),cleanup=runtime.cleanup("reader-cancel",()=>cancel.promise);
  let acknowledged=false;const settled=runtime.settle(Date.now()+10_000).then(()=>{runtime.assertSettled();acknowledged=true;});
  await Promise.resolve();expect(acknowledged).toBe(false);expect([...bytes]).toEqual([13,17,19]);
  read.resolve();await pending;await Promise.resolve();expect(acknowledged).toBe(false);
  cancel.resolve();await cleanup;await settled;expect(acknowledged).toBe(true);expect([...bytes]).toEqual([0,0,0]);
 });
 it("expires the caller while retaining pending work and refusing an ACK",async()=>{
  vi.useFakeTimers();const runtime=createRequesterStatementRuntime(),read=deferred<void>();
  const bytes=runtime.own(new Uint8Array([7,8]));const pending=runtime.track("late-read",()=>read.promise);
  let acknowledged=false;
  const settled=runtime.settle(Date.now()+50).then(()=>{acknowledged=true;});
  const refused=expect(settled).rejects.toThrow("statement_runtime_disposition_held");
  await vi.advanceTimersByTimeAsync(51);await refused;expect(acknowledged).toBe(false);
  expect(()=>runtime.assertSettled()).toThrow();expect([...bytes]).toEqual([7,8]);
  read.resolve();await pending;await Promise.resolve();await Promise.resolve();
  expect([...bytes]).toEqual([0,0]);expect(acknowledged).toBe(false);expect(()=>runtime.assertSettled()).toThrow();
 });
 it("keeps a failed real cancellation held even after every task returns",async()=>{
  const runtime=createRequesterStatementRuntime();const bytes=runtime.own(new Uint8Array([23]));
  const cleanup=runtime.cleanup("reader-cancel",async()=>{throw new Error("actual-cancel-failed");});
  await expect(cleanup).rejects.toThrow();await expect(runtime.settle(Date.now()+1000)).rejects.toThrow();
  expect([...bytes]).toEqual([0]);expect(()=>runtime.assertSettled()).toThrow();
 });
 it("refuses new producer admission during closing and accepts real cleanup",async()=>{
  const runtime=createRequesterStatementRuntime(),producer=deferred<void>();
  const pending=runtime.track("producer",()=>producer.promise),settled=runtime.settle(Date.now()+1000);
  expect(()=>runtime.track("late-producer",async()=>true)).toThrow();
  const bytes=runtime.own(new Uint8Array([29]));await runtime.cleanup("finally-clear",()=>runtime.clear(bytes));
  producer.resolve();await pending;await settled;expect([...bytes]).toEqual([0]);runtime.assertSettled();
 });
});
