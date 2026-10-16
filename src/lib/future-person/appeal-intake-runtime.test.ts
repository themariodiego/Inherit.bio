import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
import {createClient} from "@supabase/supabase-js";
import {APPEAL_INTAKE_REQUEST_LIMIT_MS,createAppealIntakeRuntime} from "./appeal-intake-runtime";
import {readAppealIntakeJson} from "./appeal-intake-json";
function deferred<T>(){let resolve!:(value:T)=>void;const promise=new Promise<T>(done=>{resolve=done;});return {promise,resolve};}
async function flush(){for(let index=0;index<20;index++)await Promise.resolve();}
beforeEach(()=>vi.useFakeTimers({toFake:["setTimeout","clearTimeout","Date","performance"]}));
afterEach(()=>vi.useRealTimers());
// AUTHORED UNRUN. Real streams and the actual installed cold RPC builder run
// through a synthetic fetch seam. No network, native commit or disposal ACK.
describe("appeal intake owns the original caller clock and real late tasks",()=>{
 it("zeros the oversized actual body before an unsettled cancellation, without claiming disposal",async()=>{
  const chunk=new Uint8Array(64*1024+1).fill(91),cancel=deferred<void>();let cancellationStarted=false;
  const body=new ReadableStream<Uint8Array>({start(controller){controller.enqueue(chunk);},cancel(){cancellationStarted=true;return cancel.promise;}});
  const request=new Request("https://synthetic.invalid/api/appeals",{method:"POST",body,duplex:"half"} as RequestInit);
  const owner=createAppealIntakeRuntime(request.signal);const read=readAppealIntakeJson(request,owner).catch(()=>null);
  await flush();expect(cancellationStarted).toBe(true);expect(chunk.every(byte=>byte===0)).toBe(true);
  expect(owner.disposition().ownedMutableBuffers).toBe(0);expect(owner.disposition().pendingActualTasks).toBeGreaterThan(0);
  await vi.advanceTimersByTimeAsync(APPEAL_INTAKE_REQUEST_LIMIT_MS);await read;await owner.finish();
  expect(owner.disposition().cleanupHeld).toBe(true);expect(owner.disposition().pendingActualTasks).toBeGreaterThan(0);
  expect(body.locked).toBe(true);cancel.resolve();await flush();expect(body.locked).toBe(false);
  expect(owner.disposition().pendingActualTasks).toBe(0);expect(owner.disposition().cleanupHeld).toBe(true);
 });
 it("keeps cancellation rejection as a hold after clearing the actual body",async()=>{
  const chunk=new Uint8Array(64*1024+1).fill(92);
  const body=new ReadableStream<Uint8Array>({start(controller){controller.enqueue(chunk);},cancel(){return Promise.reject(new Error("synthetic_cancel"));}});
  const request=new Request("https://synthetic.invalid/api/appeals",{method:"POST",body,duplex:"half"} as RequestInit);
  const owner=createAppealIntakeRuntime(request.signal);await expect(readAppealIntakeJson(request,owner)).rejects.toThrow("appeal_intake_body_held");
  await owner.finish();expect(chunk.every(byte=>byte===0)).toBe(true);expect(owner.disposition().cleanupHeld).toBe(true);
  expect(owner.disposition().pendingActualTasks).toBe(0);expect(body.locked).toBe(false);
 });
 it("owns and clears a real stream chunk that arrives after request abort and caller return",async()=>{
  let source!:ReadableStreamDefaultController<Uint8Array>;
  const body=new ReadableStream<Uint8Array>({start(controller){source=controller;}}),reader=body.getReader();
  const abort=new AbortController(),owner=createAppealIntakeRuntime(abort.signal),chunk=new Uint8Array(23).fill(93);
  const actual=owner.read(async()=>{const result=await reader.read();if(result.value)owner.own(result.value);return result;});
  const wait=owner.wait(actual).catch(()=>null);await flush();abort.abort();await wait;await owner.finish();
  expect(owner.disposition().pendingActualTasks).toBe(1);expect(owner.disposition().cleanupHeld).toBe(true);
  source.enqueue(chunk);await actual;source.close();reader.releaseLock();await flush();
  expect(chunk.every(byte=>byte===0)).toBe(true);expect(owner.disposition().ownedMutableBuffers).toBe(0);
  expect(owner.disposition().pendingActualTasks).toBe(0);expect(owner.disposition().cleanupHeld).toBe(true);
 });
 it("uses the same remaining deadline for real prepare and commit and preserves late commit uncertainty",async()=>{
  const prepare=deferred<Response>(),commit=deferred<Response>(),calls:{name:string;signal:AbortSignal|null|undefined}[]=[];
  const client=createClient("https://synthetic.invalid","synthetic-key",{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},
   global:{fetch:(input,init)=>{const name=new URL(String(input)).pathname.split("/").at(-1)!;calls.push({name,signal:init?.signal});
    return name==="prepare_new_public_appeal_v1"?prepare.promise:commit.promise;}}});
  const owner=createAppealIntakeRuntime(new AbortController().signal),deadline=owner.originalDeadline;
  const prepared=owner.rpc("public-prepare",()=>client.rpc("prepare_new_public_appeal_v1").retry(false).abortSignal(owner.signal));
  await flush();await vi.advanceTimersByTimeAsync(20_000);prepare.resolve(Response.json({synthetic:true}));await owner.wait(prepared);
  const actual=owner.rpc("public-commit",()=>client.rpc("commit_new_public_appeal_v1").retry(false).abortSignal(owner.signal));
  const wait=owner.wait(actual).catch(()=>null);await flush();expect(calls.map(call=>call.name)).toEqual(["prepare_new_public_appeal_v1","commit_new_public_appeal_v1"]);
  expect(calls.every(call=>call.signal===owner.signal)).toBe(true);expect(owner.originalDeadline).toBe(deadline);
  await vi.advanceTimersByTimeAsync(9_999);expect(owner.signal.aborted).toBe(false);
  await vi.advanceTimersByTimeAsync(1);await wait;await owner.finish();expect(owner.signal.aborted).toBe(true);
  expect(owner.disposition().lateCommitUncertain).toBe(true);expect(owner.disposition().pendingActualTasks).toBe(1);
  expect(owner.rpc("public-commit",()=>{throw new Error("second execution");})).toBe(actual);
  commit.resolve(Response.json(true));await actual;await flush();expect(calls).toHaveLength(2);
  expect(owner.disposition().pendingActualTasks).toBe(0);expect(owner.disposition().lateCommitUncertain).toBe(true);
  expect(owner.disposition().cleanupHeld).toBe(true);
 });
 it.each(["suspension-prepare","public-prepare","public-commit"] as const)("registers one real %s operation and aborts it without retry",async label=>{
  const response=deferred<Response>(),signals:(AbortSignal|null|undefined)[]=[];
  const client=createClient("https://synthetic.invalid","synthetic-key",{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},
   global:{fetch:(_input,init)=>{signals.push(init?.signal);return response.promise;}}});
  const abort=new AbortController(),owner=createAppealIntakeRuntime(abort.signal);
  const actual=owner.rpc(label,()=>client.rpc("synthetic_appeal_rpc").retry(false).abortSignal(owner.signal));
  const wait=owner.wait(actual).catch(()=>null);await flush();expect(signals).toEqual([owner.signal]);
  abort.abort();await wait;await owner.finish();expect(signals[0]?.aborted).toBe(true);
  expect(owner.disposition().pendingActualTasks).toBe(1);response.resolve(Response.json(null));await actual;await flush();
  expect(signals).toHaveLength(1);expect(owner.disposition().cleanupHeld).toBe(true);
 });
 it("refuses an already aborted request before starting a cold producer",async()=>{
  const abort=new AbortController();abort.abort();const owner=createAppealIntakeRuntime(abort.signal),work=vi.fn();
  expect(()=>owner.rpc("public-prepare",work)).toThrow("appeal_intake_runtime_held");expect(work).not.toHaveBeenCalled();
  await owner.finish();expect(owner.disposition().cleanupHeld).toBe(true);expect(owner.disposition().pendingActualTasks).toBe(0);
 });
});
