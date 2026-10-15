import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
const native=vi.hoisted(()=>({query:vi.fn(),end:vi.fn(),open:vi.fn(),rpc:vi.fn(),retry:vi.fn(),send:vi.fn(),storage:vi.fn(),config:vi.fn()}));
vi.mock("postgres",()=>({default:(config:unknown)=>{native.open(config);return {begin:async(work:(tx:unknown)=>Promise<unknown>)=>work(native.query),end:native.end};}}));
vi.mock("@/lib/supabase/admin",()=>({createAdminClient:()=>({rpc:native.rpc})}));
vi.mock("@/lib/embryos/fragment-storage",()=>({embryoFragmentStorageConfigured:native.storage}));
vi.mock("@/lib/uploads/normalization-database",()=>({normalizationDatabaseConfig:native.config}));
import {configuredTestClaimantDeletion} from "./claimant-deletion-test";
const id="d51f05ba-1130-4b19-a1e5-446297231ce9",token="c".repeat(64);
const env={INHERIT_TEST_JURISDICTION:"1",INHERIT_TEST_CLAIMANT_RIGHTS:"1",INHERIT_TEST_ACCOUNT_ARCHIVE_R2:"1",
 INHERIT_TEST_ACCOUNT_ARCHIVE_R2_DATABASE:"test-only-owned-transport",INHERIT_TEST_ACCOUNT_ARCHIVE_R2_DATABASE_CA_CERT:"test-public-anchor"};
const configuration={bucket:"inherit-export-fixture",bindingSha256:"a".repeat(64),protocol:"r2-current-object-qualified-all-writer-gateway-v1"};
function sqlText(call:unknown[]){return (call[0] as string[]).join("?");}
function execution(values=env,purpose:"request"|"maintenance"="request"){
 const value=configuredTestClaimantDeletion(values,purpose);if(!value)throw new Error("test-capability-missing");return value;
}
beforeEach(()=>{
 vi.clearAllMocks();native.storage.mockReturnValue(true);native.config.mockReturnValue({ssl:{rejectUnauthorized:true}});
 native.end.mockResolvedValue(undefined);native.send.mockResolvedValue({data:{status:"source_pending"},error:null});
 native.retry.mockReturnValue({abortSignal:native.send});native.rpc.mockReturnValue({retry:native.retry});
 native.query.mockImplementation(async(strings:TemplateStringsArray)=>{
  const text=strings.join("?");
  if(text.includes("current_user="))return [{allowed:true}];
  if(text.includes("account_archive_test_configuration_v1"))return [{configuration}];
  if(text.includes("prepare_future_person_deletion_v1"))return [{manifestId:id}];
  if(text.includes("finish_future_person_deletion_v1"))return [{result:{status:"deleted"}}];
  if(text.includes("from public.purge_manifests"))return [{manifestId:id}];
  return [];
 });
});
afterEach(()=>vi.useRealTimers());
describe("TEST claimant actual transport ownership",()=>{
 it.each([{}, {...env,INHERIT_TEST_JURISDICTION:"false"},{...env,INHERIT_TEST_CLAIMANT_RIGHTS:""},{...env,INHERIT_TEST_ACCOUNT_ARCHIVE_R2:""}])("stays closed before any transport for %j",values=>{
  expect(configuredTestClaimantDeletion(values)).toBeNull();expect(native.open).not.toHaveBeenCalled();expect(native.rpc).not.toHaveBeenCalled();
 });
 it("rechecks real native configuration in the same transaction before one genuine prepare",async()=>{
  const e=execution(),signal=new AbortController().signal;
  expect(await e.prepare("b".repeat(64),"nonce-from-real-claimant-control",signal)).toBe(id);
  const calls=native.query.mock.calls.map(sqlText);expect(calls).toHaveLength(4);
  expect(calls[0]).toContain("current_user='postgres' and session_user='postgres'");
  expect(calls[1]).toContain("'statement_timeout','25000'");expect(calls[1]).toContain("'lock_timeout','5000'");
  expect(calls[2]).toContain("private.account_archive_test_configuration_v1()");expect(calls[3]).toContain("private.prepare_future_person_deletion_v1");
  expect(native.query.mock.calls[3].slice(1)).toEqual(["b".repeat(64),"nonce-from-real-claimant-control"]);
  expect(native.open).toHaveBeenCalledWith(expect.objectContaining({max:1,prepare:false,fetch_types:false,connect_timeout:5,idle_timeout:5,max_lifetime:40,debug:false}));
  expect(native.config).toHaveBeenCalledWith(expect.objectContaining({INHERIT_NORMALIZATION_DIRECT_DATABASE:"true",DATABASE_URL:env.INHERIT_TEST_ACCOUNT_ARCHIVE_R2_DATABASE}));
  expect(native.end).toHaveBeenCalledExactlyOnceWith({timeout:0});
 });
 it.each([{...configuration,enabled:true},{...configuration,protocol:"account-owner-does-not-prove-claimant-authority"},null])("refuses invalid native configuration %j without prepare",async value=>{
  native.query.mockImplementation(async(strings:TemplateStringsArray)=>strings.join("").includes("current_user=")?[{allowed:true}]:strings.join("").includes("configuration_v1")?[{configuration:value}]:[]);
  await expect(execution().prepare("b".repeat(64),"nonce",new AbortController().signal)).rejects.toThrow("claimant_deletion_unavailable");
  expect(native.query.mock.calls.map(sqlText).join("\n")).not.toContain("prepare_future_person_deletion_v1");expect(native.end).toHaveBeenCalledTimes(1);
 });
 it("requires actual owner identity rather than a service account claim",async()=>{
  native.query.mockResolvedValue([{allowed:false}]);await expect(execution().finish(id,token,new AbortController().signal)).rejects.toThrow("claimant_deletion_unavailable");
  expect(native.query).toHaveBeenCalledTimes(1);expect(native.end).toHaveBeenCalledTimes(1);
 });
 it("fragment RPC uses exact sealed native door, POST and explicit no retry",async()=>{
  const signal=new AbortController().signal,args={p_operation:"proof",p_manifest:id,p_claim_token_hash:token};
  await execution().parts("future_person_deletion_parts_v1",args).abortSignal(signal);
  expect(native.rpc).toHaveBeenCalledExactlyOnceWith("future_person_deletion_parts_v1",args,{get:false,head:false});
  expect(native.retry).toHaveBeenCalledExactlyOnceWith(false);expect(native.send).toHaveBeenCalledExactlyOnceWith(signal);
 });
 it("refuses an unknown fragment door or already aborted call before client acquisition",async()=>{
  const e=execution(),stop=new AbortController();stop.abort();
  expect(()=>e.parts("wrong-native-door",{}).abortSignal(new AbortController().signal)).toThrow();
  expect(()=>e.parts("future_person_deletion_parts_v1",{}).abortSignal(stop.signal)).toThrow();expect(native.rpc).not.toHaveBeenCalled();
 });
 it("never retries a native unknown finish COMMIT or publishes an inferred terminal",async()=>{
  native.query.mockImplementation(async(strings:TemplateStringsArray)=>{
   if(strings.join("").includes("current_user="))return [{allowed:true}];
   if(strings.join("").includes("finish_future_person_deletion_v1"))throw new Error("arbitrary-private-message");return [];
  });
  await expect(execution().finish(id,token,new AbortController().signal)).rejects.toThrow("claimant_deletion_unavailable");
  expect(native.query.mock.calls.filter(call=>sqlText(call).includes("finish_future_person_deletion_v1"))).toHaveLength(1);expect(native.end).toHaveBeenCalledTimes(1);
 });
 it("does not return a successful native terminal until actual close settles",async()=>{
  let release!:()=>void;native.end.mockImplementation(()=>new Promise<void>(resolve=>{release=resolve;}));
  let settled=false;const work=execution().finish(id,token,new AbortController().signal).then(value=>{settled=true;return value;});
  for(let turn=0;turn<20;turn++)await Promise.resolve();expect(native.end).toHaveBeenCalledTimes(1);expect(settled).toBe(false);
  release();expect(await work).toEqual({status:"deleted"});expect(settled).toBe(true);
 });
 it("failed actual close refuses even when native returned deleted",async()=>{
  native.end.mockRejectedValue(new Error("private-close-detail"));await expect(execution().finish(id,token,new AbortController().signal)).rejects.toThrow();
  expect(native.end).toHaveBeenCalledTimes(1);
 });
 it("a pending actual close cannot manufacture closure at the unchanged 30s bound",async()=>{
  vi.useFakeTimers();let release!:()=>void;native.end.mockImplementation(()=>new Promise<void>(resolve=>{release=resolve;}));
  const work=execution().finish(id,token,new AbortController().signal);const refusal=expect(work).rejects.toThrow();
  for(let turn=0;turn<20;turn++)await Promise.resolve();await vi.advanceTimersByTimeAsync(30_000);await refusal;
  expect(native.end).toHaveBeenCalledTimes(1);release();for(let turn=0;turn<10;turn++)await Promise.resolve();
 });
 it("already-aborted input creates no native query and still closes its actual owned client",async()=>{
  const stop=new AbortController();stop.abort();await expect(execution().finish(id,token,stop.signal)).rejects.toThrow();
  expect(native.query).not.toHaveBeenCalled();expect(native.end).toHaveBeenCalledTimes(1);
 });
 it("closed source gateway prevents configuration/prepare admission",async()=>{
  native.storage.mockReturnValue(false);await expect(execution().prepare("b".repeat(64),"nonce",new AbortController().signal)).rejects.toThrow();
  expect(native.open).not.toHaveBeenCalled();
 });
 it("maintenance after request/config revocation discovers only one genuine sealed due phase",async()=>{
  const revoked={...env,INHERIT_TEST_CLAIMANT_RIGHTS:"",INHERIT_TEST_ACCOUNT_ARCHIVE_R2:""},e=execution(revoked,"maintenance"),signal=new AbortController().signal;
  expect(await e.due(signal)).toEqual([{manifestId:id}]);const text=native.query.mock.calls.map(sqlText).join("\n");
  for(const predicate of ["m.manifest_class='complete-retention'","future-person.claimant-reverification-until-request","future-person-claimed-source-disposal","p.phase_kind='purge'","p.phase_deadline<=clock_timestamp()","p.claim_expires_at<=clock_timestamp()","order by m.id limit 1"])expect(text).toContain(predicate);
  expect(text).not.toContain("prepare_future_person_deletion_v1");expect(text).not.toContain("account_archive_test_configuration_v1");
  expect(await e.finish(id,token,signal)).toEqual({status:"deleted"});expect(native.end).toHaveBeenCalledTimes(2);
  await expect(e.assertReady(signal)).rejects.toThrow();
 });
});

// Ordinary TEST deployments may have no dedicated claimant transport at all.
// These are factory-only controls: no parser, native client or RPC is acquired.
describe("optional claimant maintenance transport",()=>{
 it.each([undefined,""])("is unconfigured for an absent dedicated DSN %j",dsn=>{
  const ordinary={...env,INHERIT_TEST_CLAIMANT_RIGHTS:"",INHERIT_TEST_ACCOUNT_ARCHIVE_R2:"",
   INHERIT_TEST_ACCOUNT_ARCHIVE_R2_DATABASE:dsn};
  expect(configuredTestClaimantDeletion(ordinary,"maintenance")).toBeNull();
  expect(native.config).not.toHaveBeenCalled();expect(native.open).not.toHaveBeenCalled();
  expect(native.query).not.toHaveBeenCalled();expect(native.rpc).not.toHaveBeenCalled();
  expect(native.end).not.toHaveBeenCalled();
 });
});
