import {createHash,randomUUID} from "node:crypto";
import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
import {runNextFuturePersonRelocation,runFuturePersonRelocationLoop,type RelocationRpc} from "./relocation-worker";
const sha=(bytes:Uint8Array)=>createHash("sha256").update(bytes).digest("hex");
const signal=()=>new AbortController().signal;
beforeEach(()=>vi.stubEnv("INHERIT_TEST_JURISDICTION","1"));afterEach(()=>vi.unstubAllEnvs());
function fixture(kind:"copy"|"new"|"old"="copy"){
 const bytes=new TextEncoder().encode("# synthetic exact canonical part\n"),attemptId=randomUUID(),relocationId=randomUUID(),accountId=randomUUID();
 const target={bindingId:randomUUID(),relocationId,attemptId,accountId,bucket:"inherit-embryo-test",oldKey:`embryo/${randomUUID()}`,
  oldVersion:"1".repeat(32),oldEtag:"2".repeat(32),newKey:`claimant/${accountId}/${attemptId}`,byteCount:bytes.length,sha256:sha(bytes),
  expiresAt:new Date(Date.now()+60000).toISOString()};
 const identity={providerVersion:"3".repeat(32),etag:"2".repeat(32),byteCount:bytes.length};
 const receipt={kind:kind==="old"?"old":"new",target,identity:kind==="old"?identity:null};
 const work=kind==="copy"?{kind:"copy",relocationId}:{kind:"cleanup",relocationId,attemptId};
 const calls:Array<{name:string;args:Record<string,unknown>}>=[],answers=new Map<string,unknown>([
  ["future_person_relocation_work_v1",work],["claim_future_person_relocation_v1",target],["check_future_person_relocation_v1",true],
  ["swap_future_person_relocation_v1",true],["fence_future_person_relocation_v1",true],
  ["claim_future_person_relocation_cleanup_v1",receipt],["check_future_person_relocation_cleanup_v1",true],
  ["finish_future_person_relocation_v1",true]]);
 const rpc:RelocationRpc=(name,args)=>({abortSignal:async()=>{calls.push({name,args});const value=answers.get(name);
  if(value instanceof Error)return {data:null,error:value};return {data:value,error:null};}});
 const copy=vi.fn(async()=>identity),read=vi.fn(async()=>bytes),evidence={disposition:"payload-tombstoned" as const,
  providerVersion:"4".repeat(32),etag:"d41d8cd98f00b204e9800998ecf8427e" as const,byteCount:0 as const,sha256:"e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855" as const};
 const dispose=vi.fn(async()=>evidence);
 return {bytes,target,identity,receipt,calls,answers,rpc,copy,read,dispose,evidence};
}
describe("registered relocation orchestration (RPC seam, no database/provider acceptance claim)",()=>{
 it("uses only TEST-LOCAL and the server's exact queued item",async()=>{
  const f=fixture();vi.stubEnv("INHERIT_TEST_JURISDICTION","0");
  await expect(runNextFuturePersonRelocation({signal:signal(),...f})).rejects.toThrow();expect(f.calls).toEqual([]);
  vi.stubEnv("INHERIT_TEST_JURISDICTION","1");f.answers.set("future_person_relocation_work_v1",null);
  expect(await runNextFuturePersonRelocation({signal:signal(),...f})).toBe("idle");expect(f.copy).not.toHaveBeenCalled();
 });
 it("checks around copy and full readback, then commits the exact bytes before any old disposal",async()=>{
  const f=fixture();expect(await runNextFuturePersonRelocation({signal:signal(),...f})).toBe("swapped");
  expect(f.calls.map(c=>c.name)).toEqual(["future_person_relocation_work_v1","claim_future_person_relocation_v1",
   "check_future_person_relocation_v1","check_future_person_relocation_v1","check_future_person_relocation_v1","swap_future_person_relocation_v1"]);
  const swap=f.calls.at(-1)!;expect(swap.args).toMatchObject({p_target:f.target,p_identity:f.identity,p_bytes:f.bytes.length,p_sha256:sha(f.bytes)});
  expect(swap.args.p_token_hash).toMatch(/^[0-9a-f]{64}$/);expect(f.dispose).not.toHaveBeenCalled();
 });
 it("refuses a crossed queued/claim tuple before storage",async()=>{
  const f=fixture();f.answers.set("claim_future_person_relocation_v1",{...f.target,relocationId:randomUUID()});
  expect(await runNextFuturePersonRelocation({signal:signal(),...f})).toBe("failure_pending");
  expect(f.copy).not.toHaveBeenCalled();expect(f.read).not.toHaveBeenCalled();expect(f.dispose).not.toHaveBeenCalled();
  expect(f.calls.at(-1)?.name).toBe("fence_future_person_relocation_v1");
 });
 it("fences only the new attempt after stale authority, corruption or transport failure",async()=>{
  for(const failure of ["stale","corrupt","copy"]){const f=fixture();
   if(failure==="stale")f.answers.set("check_future_person_relocation_v1",false);
   if(failure==="corrupt")f.read.mockResolvedValue(new Uint8Array([1]));
   if(failure==="copy")f.copy.mockRejectedValue(new Error("synthetic transport failure"));
   expect(await runNextFuturePersonRelocation({signal:signal(),...f})).toBe("failure_pending");
   expect(f.calls.some(c=>c.name==="swap_future_person_relocation_v1")).toBe(false);
   expect(f.calls.at(-1)?.name).toBe("fence_future_person_relocation_v1");expect(f.dispose).not.toHaveBeenCalled();
  }
 });
 it("never directly deletes the destination after an uncertain committed-swap response",async()=>{
  const f=fixture();f.answers.set("swap_future_person_relocation_v1",new Error("response lost"));
  f.answers.set("fence_future_person_relocation_v1",false);
  expect(await runNextFuturePersonRelocation({signal:signal(),...f})).toBe("failure_pending");
  expect(f.dispose).not.toHaveBeenCalled();expect(f.calls.at(-1)?.name).toBe("fence_future_person_relocation_v1");
 });
 it.each(["old","new"] as const)("executes only the exact persisted %s cleanup disposition",async kind=>{
  const f=fixture(kind);expect(await runNextFuturePersonRelocation({signal:signal(),...f})).toBe(kind==="old"?"complete":"cleaned");
  expect(f.dispose).toHaveBeenCalledWith(f.target,kind,expect.any(AbortSignal),kind==="old"?f.identity:undefined);
  expect(f.calls.at(-1)?.args).toMatchObject({p_attempt:f.target.attemptId,p_expected:f.receipt,p_evidence:f.evidence});
  expect(f.copy).not.toHaveBeenCalled();expect(f.read).not.toHaveBeenCalled();
 });
 it("refuses stale/crossed cleanup claims before any marker",async()=>{
  for(const failure of ["stale","crossed"]){const f=fixture("old");
   if(failure==="stale")f.answers.set("check_future_person_relocation_cleanup_v1",false);
   else f.answers.set("claim_future_person_relocation_cleanup_v1",{...f.receipt,target:{...f.target,attemptId:randomUUID()}});
   await expect(runNextFuturePersonRelocation({signal:signal(),...f})).rejects.toThrow();
   expect(f.dispose).not.toHaveBeenCalled();expect(f.calls.some(c=>c.name==="finish_future_person_relocation_v1")).toBe(false);
  }
 });
 it("lets only the expiry reaper request a tokenless temporary fence",async()=>{
  const f=fixture();f.answers.set("future_person_relocation_work_v1",{kind:"expired",
   relocationId:f.target.relocationId,attemptId:f.target.attemptId});
  expect(await runNextFuturePersonRelocation({signal:signal(),...f})).toBe("failure_pending");
  expect(f.calls.at(-1)).toEqual({name:"fence_future_person_relocation_v1",
   args:{p_id:f.target.relocationId,p_token_hash:null}});
  expect(f.copy).not.toHaveBeenCalled();expect(f.dispose).not.toHaveBeenCalled();
 });
 it("refuses unbounded or foreign operator options before doing work",async()=>{
  const runNext=vi.fn(async()=>"idle" as const);
  for(const maximumIterations of [0,-1,1001,Infinity,1.5])
   await expect(runFuturePersonRelocationLoop({signal:signal(),maximumIterations,runNext,emit:()=>{}})).rejects.toThrow();
  vi.stubEnv("INHERIT_TEST_JURISDICTION","0");
  await expect(runFuturePersonRelocationLoop({signal:signal(),maximumIterations:1,runNext,emit:()=>{}})).rejects.toThrow();
  expect(runNext).not.toHaveBeenCalled();
 });
 it("emits only fixed result codes, reports failed work and respects a bounded run",async()=>{
  for(const result of ["swapped","complete","cleaned","failure_pending"] as const){
   const runNext=vi.fn(async()=>result),events:string[]=[];
   expect(await runFuturePersonRelocationLoop({signal:signal(),maximumIterations:1,runNext,emit:e=>events.push(e)}))
    .toEqual({hadFailure:result==="failure_pending"});
   expect(runNext).toHaveBeenCalledTimes(1);expect(events).toEqual([`relocation_${result}`]);
  }
  const events:string[]=[];
  expect(await runFuturePersonRelocationLoop({signal:signal(),maximumIterations:1,
   runNext:async()=>{throw new Error("synthetic private failure detail");},emit:e=>events.push(e)})).toEqual({hadFailure:true});
  expect(events).toEqual(["relocation_failed"]);
 });
 it("stops an aborted idle worker without a second claim",async()=>{
  const controller=new AbortController(),events:string[]=[],runNext=vi.fn(async()=>{
   controller.abort();return "idle" as const;});
  expect(await runFuturePersonRelocationLoop({signal:controller.signal,runNext,emit:e=>events.push(e)})).toEqual({hadFailure:false});
  expect(runNext).toHaveBeenCalledTimes(1);expect(events).toEqual(["relocation_idle","worker_stopped"]);
 });
});
