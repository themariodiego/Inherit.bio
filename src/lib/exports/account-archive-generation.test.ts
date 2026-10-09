import {randomUUID} from "node:crypto";
import {afterEach,describe,expect,it,vi} from "vitest";
import {approvedAccountArchiveGeneration,runAccountArchiveGeneration,type AccountArchiveGenerationCapability,type AccountArchiveDueRpc} from "./account-archive-generation";
const execute=vi.hoisted(()=>vi.fn());
// These tests prove scheduling/closed discovery only. Complete actual ZIP64
// generation is independently exercised in account-archive-worker.test.ts.
vi.mock("./account-archive-worker",()=>({buildAccountArchive:execute}));
afterEach(()=>{vi.useRealTimers();vi.clearAllMocks();});
function fixture(count=2){
 const jobs=Array.from({length:count},()=>({exportId:randomUUID() as string,principalHash:"a".repeat(64),authorityReceipt:"b".repeat(64),deadline:new Date(Date.now()+600000).toISOString()}))
  .sort((a,b)=>a.exportId.localeCompare(b.exportId));
 const rpc=vi.fn<AccountArchiveDueRpc>(async()=>({data:structuredClone(jobs),error:null}));
 const capability:AccountArchiveGenerationCapability={assertReady:vi.fn(async signal=>{signal.throwIfAborted();}),execution:{} as AccountArchiveGenerationCapability["execution"]};
 const signal=new AbortController().signal,factory=vi.fn(()=>rpc);execute.mockResolvedValue({summary:{state:"bytes-complete"}});
 return {jobs,rpc,capability,options:{capability,rpc:factory,signal},factory};
}
describe("exact account-origin worker scheduling",()=>{
 it("defaults closed before any discovery, claim, source or provider work",async()=>{
  const f=fixture();expect(approvedAccountArchiveGeneration()).toBeNull();
  await expect(runAccountArchiveGeneration({...f.options,capability:approvedAccountArchiveGeneration()})).rejects.toThrow();
  expect(f.factory).not.toHaveBeenCalled();expect(execute).not.toHaveBeenCalled();
 });
 it("schedules the ordered exact account-only metadata page once without READY or an adopted attempt",async()=>{
  const f=fixture(16);expect(await runAccountArchiveGeneration(f.options)).toEqual({completed:16});
  expect(f.rpc).toHaveBeenCalledTimes(1);expect(f.rpc.mock.calls[0].slice(0,2)).toEqual(["export_archive_account_due_v1",{p_after:null}]);
  expect(execute.mock.calls.map(([options])=>options.job)).toEqual(f.jobs);
  expect(execute.mock.calls.every(([options])=>options.signal===f.options.signal)).toBe(true);
  expect(f.capability.assertReady).toHaveBeenCalledTimes(17);
  for(const [options]of execute.mock.calls)expect(Object.keys(options).sort()).toEqual(["job","signal"]);
 });
 it("returns an empty drain without claiming byte completion of a nonexistent archive",async()=>{
  const f=fixture(0);expect(await runAccountArchiveGeneration(f.options)).toEqual({completed:0});expect(execute).not.toHaveBeenCalled();
 });
 it.each(["duplicate","unordered","expired","far-deadline","foreign-field","missing-receipt","oversize","bad-identity"])("refuses %s metadata before any attempt",async fault=>{
  // Freeze only the metadata comparison clock: the exact +1ms upper-bound
  // refusal must not become valid while the native async readiness runs.
  vi.useFakeTimers({toFake:["Date"]});
  const f=fixture(fault==="oversize"?17:2);
  if(fault==="duplicate")f.jobs[1]=structuredClone(f.jobs[0]);
  if(fault==="unordered")f.jobs.reverse();
  if(fault==="expired")f.jobs[0].deadline=new Date(Date.now()+30000).toISOString();
  if(fault==="far-deadline")f.jobs[0].deadline=new Date(Date.now()+86400001).toISOString();
  if(fault==="foreign-field")Object.assign(f.jobs[0],{sessionJwt:"withheld"});
  if(fault==="missing-receipt")f.jobs[0].authorityReceipt="";
  if(fault==="bad-identity")f.jobs[0].exportId="foreign";
  await expect(runAccountArchiveGeneration(f.options)).rejects.toThrow();expect(execute).not.toHaveBeenCalled();
 });
 it("refuses provider configuration before discovery and again before each fresh job",async()=>{
  const f=fixture();vi.mocked(f.capability.assertReady).mockRejectedValue(new Error("unproved"));
  await expect(runAccountArchiveGeneration(f.options)).rejects.toThrow();expect(f.factory).not.toHaveBeenCalled();
  const current=fixture();vi.mocked(current.capability.assertReady).mockResolvedValueOnce().mockResolvedValueOnce().mockRejectedValue(new Error("revoked"));
  await expect(runAccountArchiveGeneration(current.options)).rejects.toThrow();expect(execute).toHaveBeenCalledTimes(1);
 });
 it("propagates current-source refusal and uncertain-write cleanup holds without retry/skip/completion",async()=>{
  const f=fixture();const error=Object.assign(new Error("source unavailable"),{cleanupRequired:true});execute.mockRejectedValue(error);
  await expect(runAccountArchiveGeneration(f.options)).rejects.toBe(error);expect(execute).toHaveBeenCalledTimes(1);expect(f.rpc).toHaveBeenCalledTimes(1);
 });
 it("bounds unresponsive discovery/configuration and retains true caller cancellation",async()=>{
  vi.useFakeTimers();const f=fixture();f.rpc.mockImplementation(()=>new Promise(()=>{}));
  const refused=expect(runAccountArchiveGeneration(f.options)).rejects.toThrow();await vi.advanceTimersByTimeAsync(30001);await refused;
  expect(execute).not.toHaveBeenCalled();const controller=new AbortController();controller.abort();
  const cancelled=fixture();await expect(runAccountArchiveGeneration({...cancelled.options,signal:controller.signal})).rejects.toThrow();expect(cancelled.factory).not.toHaveBeenCalled();
 });
});
