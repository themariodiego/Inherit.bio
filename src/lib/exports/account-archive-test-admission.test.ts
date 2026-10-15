import {beforeEach,describe,expect,it,vi} from "vitest";
import {assertTestAccountArchiveFixtureAdmission} from "./account-archive-test-admission";

const f=vi.hoisted(()=>({enabled:true,value:null as unknown,rows:1,events:[] as string[],
 failReadyAt:0,readyCount:0,failCommit:false,ready:vi.fn(),owner:vi.fn()}));
vi.mock("./account-archive-test-capabilities",()=>({configuredTestAccountArchive:()=>f.enabled?{generation:{assertReady:f.ready}}:null}));
vi.mock("./account-archive-r2",()=>({withAccountArchiveR2Owner:f.owner}));
const configuration={bucket:"inherit-export-invented-test",bindingSha256:"a".repeat(64),
 protocol:"r2-current-object-qualified-all-writer-gateway-v1"};
beforeEach(()=>{
 vi.clearAllMocks();Object.assign(f,{enabled:true,value:{configuration,accountJobs:0,liveDownloads:0,undisposedAllocations:0},
  rows:1,events:[],failReadyAt:0,readyCount:0,failCommit:false});
 f.ready.mockImplementation(async(signal:AbortSignal)=>{
  expect(signal.aborted).toBe(false);f.events.push("actual-configuration");
  if(++f.readyCount===f.failReadyAt)throw new Error("invented private configuration detail");
 });
 f.owner.mockImplementation(async(_env:unknown,signal:AbortSignal,runtime:{track:unknown},work:(tx:unknown)=>Promise<unknown>)=>{
  expect(signal.aborted).toBe(false);expect(runtime.track).toBeTypeOf("function");
  const value=await work(async(strings:TemplateStringsArray,...args:unknown[])=>{
   const sql=strings.join("?");expect(args).toEqual([]);expect(sql).toMatch(/^select jsonb_build_object\(/u);
   expect(sql).toContain("private.account_archive_test_configuration_v1()");
   expect(sql).toContain("undisposedAllocations");expect(sql).not.toMatch(/\b(?:insert|update|delete|truncate|setval)\b/iu);
   f.events.push("actual-empty-state");return Array.from({length:f.rows},()=>({state:f.value}));
  });
  if(f.failCommit)throw new Error("invented unknown native COMMIT");f.events.push("native-close");return value;
 });
});
const run=()=>assertTestAccountArchiveFixtureAdmission({signal:new AbortController().signal,env:{}});
describe("actual private TEST archive fixture admission",()=>{
 it("checks the real configuration around a complete read-only empty obligation census",async()=>{
  const result=await run();expect(result).toEqual({version:"account-archive-test-fixture-admission-v1",
   configurationSha256:expect.stringMatching(/^[a-f0-9]{64}$/u),accountJobs:0,liveDownloads:0,undisposedAllocations:0});
  expect(Object.keys(result)).not.toContain("bucket");expect(f.events).toEqual([
   "actual-configuration","actual-empty-state","native-close","actual-configuration"]);
 });
 it.each(["accountJobs","liveDownloads","undisposedAllocations"])("refuses genuine nonempty %s without resetting or adopting it",async field=>{
  f.value={configuration,accountJobs:0,liveDownloads:0,undisposedAllocations:0,[field]:1};
  await expect(run()).rejects.toThrow("account_archive_test_fixture_unavailable");
  expect(f.readyCount).toBe(1);expect(f.owner).toHaveBeenCalledTimes(1);
 });
 it.each(["foreign-field","disabled-config","unsafe-count","null-state","zero-rows","two-rows","unknown-commit"])("refuses %s with no fixture mutation or public private detail",async fault=>{
  if(fault==="foreign-field")f.value={configuration,accountJobs:0,liveDownloads:0,undisposedAllocations:0,providerReceipt:{fake:true}};
  if(fault==="disabled-config")f.value={configuration:{...configuration,protocol:"unqualified"},accountJobs:0,liveDownloads:0,undisposedAllocations:0};
  if(fault==="unsafe-count")f.value={configuration,accountJobs:Number.MAX_SAFE_INTEGER+1,liveDownloads:0,undisposedAllocations:0};
  if(fault==="null-state")f.value=null;
  if(fault==="zero-rows")f.rows=0;if(fault==="two-rows")f.rows=2;if(fault==="unknown-commit")f.failCommit=true;
  await expect(run()).rejects.toThrow(/^account_archive_test_fixture_unavailable$/u);expect(f.owner).toHaveBeenCalledTimes(1);
 });
 it.each([1,2])("refuses private configuration failure at check %i without leaking its cause",async position=>{
  f.failReadyAt=position;await expect(run()).rejects.toThrow(/^account_archive_test_fixture_unavailable$/u);
  expect(f.owner).toHaveBeenCalledTimes(position===1?0:1);
 });
 it("cannot acquire a native fixture with ordinary configuration or an already canceled signal",async()=>{
  f.enabled=false;await expect(run()).rejects.toThrow();f.enabled=true;
  const stop=new AbortController();stop.abort();
  await expect(assertTestAccountArchiveFixtureAdmission({signal:stop.signal})).rejects.toThrow();
  expect(f.ready).not.toHaveBeenCalled();expect(f.owner).not.toHaveBeenCalled();
 });
});
