import {describe,expect,it,vi} from "vitest";
import {callbackSource} from "./callback-source";

describe("awaited callback source backpressure",()=>{
 it("retains one item and does not produce the next before consumer resume",async()=>{
  const produced:number[]=[],abort=new AbortController();
  const stream=callbackSource(abort.signal,async emit=>{for(let i=0;i<3;i++){produced.push(i);await emit(i);}});
  expect(await stream.next()).toEqual({done:false,value:0});expect(produced).toEqual([0]);
  await Promise.resolve();expect(produced).toEqual([0]);
  expect(await stream.next()).toEqual({done:false,value:1});expect(produced).toEqual([0,1]);
  expect(await stream.next()).toEqual({done:false,value:2});expect(produced).toEqual([0,1,2]);
  expect((await stream.next()).done).toBe(true);
 });
 it("never turns an error after a partial item into successful EOF",async()=>{
  const stream=callbackSource(new AbortController().signal,async emit=>{await emit(1);throw new Error("source failed");});
  expect((await stream.next()).value).toBe(1);await expect(stream.next()).rejects.toThrow("source failed");
 });
 it("rejects an undefined thrown error as incomplete source",async()=>{
  const stream=callbackSource(new AbortController().signal,async()=>Promise.reject(undefined));
  await expect(stream.next()).rejects.toThrow("account_archive_source_unavailable");
 });
 it("cancels the actual producer and releases its pending callback on return",async()=>{
  let signal:AbortSignal|undefined;const closed=vi.fn();
  const stream=callbackSource(new AbortController().signal,async(emit,current)=>{
   signal=current;try{await emit(1);await emit(2);}finally{closed();}
  });
  await stream.next();await stream.return(undefined);await vi.waitFor(()=>expect(closed).toHaveBeenCalledOnce());
  expect(signal!.aborted).toBe(true);
 });
 it("rejects cancellation while the actual producer has not supplied a chunk",async()=>{
  const abort=new AbortController();let signal:AbortSignal|undefined;
  const stream=callbackSource(abort.signal,async(_emit,current)=>{signal=current;await new Promise<void>(()=>{});});
  const pending=stream.next(),refused=expect(pending).rejects.toThrow();await Promise.resolve();abort.abort();await refused;
  expect(signal!.aborted).toBe(true);
 });
 it("refuses an already cancelled source before calling its producer",async()=>{
  const abort=new AbortController(),produce=vi.fn(async()=>{});abort.abort();
  await expect(callbackSource(abort.signal,produce).next()).rejects.toThrow();expect(produce).not.toHaveBeenCalled();
 });
});
