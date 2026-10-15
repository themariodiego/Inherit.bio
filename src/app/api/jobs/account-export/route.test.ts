import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
import {POST,maxDuration} from "./route";
import type {AccountArchiveDueRpc} from "@/lib/exports/account-archive-generation";
const f=vi.hoisted(()=>({enabled:true,events:[] as string[],readyFail:false,generationFail:false,disposalFail:false,
 ready:vi.fn(),generation:vi.fn(),disposal:vi.fn(),rpc:vi.fn(),admin:vi.fn()}));
vi.mock("@/lib/exports/account-archive-test-capabilities",()=>({configuredTestAccountArchive:()=>f.enabled?{
 generation:{assertReady:f.ready},delivery:{}}:null}));
vi.mock("@/lib/exports/account-archive-generation",()=>({runAccountArchiveGeneration:f.generation}));
vi.mock("@/lib/exports/account-archive-test-disposal",()=>({runTestAccountArchiveDisposal:f.disposal}));
vi.mock("@/lib/supabase/admin",()=>({createAdminClient:f.admin}));
const placeholder="unit-test-operator-placeholder";
function request(operation="generation",init:RequestInit={}){
 const headers=new Headers(init.headers);headers.set("Authorization",`Bearer ${placeholder}`);
 headers.set("X-Inherit-Account-Export-Operation",operation);
 return new Request("https://synthetic.invalid/api/jobs/account-export",{method:"POST",...init,
  headers});
}
beforeEach(()=>{
 vi.clearAllMocks();Object.assign(f,{enabled:true,events:[],readyFail:false,generationFail:false,disposalFail:false});
 vi.stubEnv("JOBS_SECRET",placeholder);vi.stubEnv("CRON_SECRET",undefined);
 f.ready.mockImplementation(async(signal:AbortSignal)=>{expect(signal.aborted).toBe(false);f.events.push("actual-ready");if(f.readyFail)throw new Error("synthetic private detail");});
 f.rpc.mockReturnValue({retry:vi.fn(enabled=>{expect(enabled).toBe(false);return {abortSignal:vi.fn(async(signal:AbortSignal)=>{
  expect(signal.aborted).toBe(false);return {data:[],error:null};})};})});
 f.admin.mockReturnValue({rpc:f.rpc});
 f.generation.mockImplementation(async(options:{capability:unknown;rpc:()=>AccountArchiveDueRpc;signal:AbortSignal})=>{
  f.events.push("actual-generation");expect(options.capability).toEqual({assertReady:f.ready});
  const rpc=options.rpc();await rpc("export_archive_account_due_v1",{p_after:null},options.signal);
  if(f.generationFail)throw new Error("synthetic provider output");return {completed:0};
 });
 f.disposal.mockImplementation(async(options:{signal:AbortSignal})=>{
  f.events.push("actual-disposal");expect(options.signal.aborted).toBe(false);
  if(f.disposalFail)throw new Error("synthetic provider output");return {completed:0};
 });
});
afterEach(()=>vi.unstubAllEnvs());
describe("closed TEST account export worker route",()=>{
 it("invokes the real generation adapter after native/provider configuration with no retry or request selectors",async()=>{
  const response=await POST(request());expect(response.status).toBe(204);expect(await response.text()).toBe("");
  expect(response.headers.get("cache-control")).toBe("no-store");expect(f.events).toEqual(["actual-ready","actual-generation"]);
  expect(f.rpc).toHaveBeenCalledWith("export_archive_account_due_v1",{p_after:null},{get:false,head:false});
  expect(f.disposal).not.toHaveBeenCalled();expect(maxDuration).toBe(300);
 });
 it("dispatches only the fixed disposal worker after the same actual TEST configuration gate",async()=>{
  expect((await POST(request("disposal"))).status).toBe(204);expect(f.events).toEqual(["actual-ready","actual-disposal"]);
  expect(f.generation).not.toHaveBeenCalled();expect(f.admin).not.toHaveBeenCalled();
 });
 it("selects the current Cron credential at call time without an inherited jobs fallback",async()=>{
  vi.stubEnv("JOBS_SECRET",undefined);vi.stubEnv("CRON_SECRET",placeholder);
  expect((await POST(request())).status).toBe(204);vi.stubEnv("CRON_SECRET",undefined);
  expect((await POST(request())).status).toBe(401);expect(f.generation).toHaveBeenCalledTimes(1);
 });
 it.each(["missing","foreign","blank"])("refuses %s authorization before configuration or source access",async fault=>{
  const value=request();if(fault==="missing")value.headers.delete("authorization");
  if(fault==="foreign")value.headers.set("authorization","Bearer foreign-placeholder");
  if(fault==="blank"){vi.stubEnv("JOBS_SECRET","");value.headers.set("authorization","Bearer ");}
  expect((await POST(value)).status).toBe(401);expect(f.events).toEqual([]);expect(f.admin).not.toHaveBeenCalled();
 });
 it.each(["query","body","false-length","transfer","unknown-operation","no-operation","get"])("refuses %s without configuration or worker admission",async fault=>{
  let value=request();
  if(fault==="query")value=new Request(value.url+"?accountId=foreign",value);
  if(fault==="body")value=request("generation",{body:"{}",headers:{"Content-Length":"0"}});
  if(fault==="false-length")value.headers.set("content-length","garbage");
  if(fault==="transfer")value.headers.set("transfer-encoding","chunked");
  if(fault==="unknown-operation")value.headers.set("x-inherit-account-export-operation","cleanup-all");
  if(fault==="no-operation")value.headers.delete("x-inherit-account-export-operation");
  if(fault==="get")value=request("generation",{method:"GET"});
  expect((await POST(value)).status).toBe(400);expect(f.events).toEqual([]);expect(f.admin).not.toHaveBeenCalled();
 });
 it("does not adopt an ordinary generation capability while TEST configuration is absent",async()=>{
  f.enabled=false;const response=await POST(request());expect(response.status).toBe(503);expect(f.events).toEqual([]);
  expect(f.admin).not.toHaveBeenCalled();
 });
 it("refuses a preconsumed nonempty body instead of treating its remaining EOF as an empty operator request",async()=>{
  const value=request("generation",{body:"{}"});await value.text();
  expect((await POST(value)).status).toBe(400);expect(f.events).toEqual([]);expect(f.admin).not.toHaveBeenCalled();
 });
 it.each(["configuration","generation","disposal"])("suppresses private %s errors and does not replay",async fault=>{
  f.readyFail=fault==="configuration";f.generationFail=fault==="generation";f.disposalFail=fault==="disposal";
  const response=await POST(request(fault==="disposal"?"disposal":"generation"));expect(response.status).toBe(503);
  expect(await response.json()).toEqual({error:"account_export_worker_unavailable"});expect(f.ready).toHaveBeenCalledTimes(1);
  expect(f.generation.mock.calls.length+f.disposal.mock.calls.length).toBe(fault==="configuration"?0:1);
 });
 it("refuses an already canceled operator request without a native or provider call",async()=>{
  const controller=new AbortController();controller.abort();
  expect((await POST(request("generation",{signal:controller.signal}))).status).toBe(503);
  expect(f.ready).not.toHaveBeenCalled();expect(f.generation).not.toHaveBeenCalled();expect(f.admin).not.toHaveBeenCalled();
 });
});
