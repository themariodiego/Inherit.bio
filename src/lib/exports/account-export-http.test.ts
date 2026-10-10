import {randomUUID} from "node:crypto";
import {afterEach,describe,expect,it,vi} from "vitest";
import {presentAccountExportCreate,postAccountExport,pollAccountExport,currentAccountExportActor,
 type AccountExportHttpDependencies,type AccountExportRequestRpc} from "./account-export-http";
import {ACCOUNT_EXPORT_COOKIE,accountExportCookieHash,createAccountExportCookie,mintAccountExportCsrf} from "./account-export-session";
import {mintExportOperation} from "./export-operation-token";
const auth=vi.hoisted(()=>({user:vi.fn(),claims:vi.fn()}));
vi.mock("@/lib/supabase/server",()=>({createClient:async()=>({auth:{getUser:auth.user,getClaims:auth.claims}})}));
vi.stubEnv("BYOK_ENCRYPTION_KEY",Buffer.alloc(32,9).toString("base64"));
afterEach(()=>{vi.useRealTimers();vi.clearAllMocks();});
function fixture(){
 const actor={accountId:randomUUID(),sessionId:randomUUID()},exportId=randomUUID();
 const capture={principalId:randomUUID(),principalHash:"a".repeat(64),originBinding:"b".repeat(64),authorityReceipt:"c".repeat(64),
  accountRevision:1,lifecycleRevision:1,principalGraphRevision:1,subjectPartitions:[randomUUID()],fileCount:0};
 let status="queued",cookieHash="",consumed=false;
 const response=vi.fn(async(args:Parameters<AccountExportRequestRpc>[1])=>{
  if(args.p_origin.accountId!==actor.accountId||args.p_origin.sessionId!==actor.sessionId)return {data:null,error:{code:"42501"}};
  if(args.p_operation==="capture")return {data:structuredClone(capture),error:null};
  const payload=args.p_payload as Record<string,unknown>;
  if(args.p_operation==="create"){
   if(consumed)return {data:null,error:{code:"23505"}};consumed=true;cookieHash=String(payload.exportCookieHash);
   return {data:{exportId,exportRevision:1,status:"queued",authorityReceipt:capture.authorityReceipt},error:null};
  }
  if(payload.exportId!==exportId||payload.exportCookieHash!==cookieHash)return {data:null,error:{code:"42501"}};
  return {data:{exportId,exportRevision:1,status,expiresAt:null},error:null};
 });
 const rpc=vi.fn<AccountExportRequestRpc>((name,args,options)=>{
  expect(name).toBe("export_archive_request_v1");expect(options).toEqual({get:false,head:false});
  return {retry:enabled=>{expect(enabled).toBe(false);return {abortSignal:async signal=>{
   signal.throwIfAborted();const result=await response(args);signal.throwIfAborted();return result;
  }}}};
 });
 const generation={assertReady:vi.fn(async(signal:AbortSignal)=>{signal.throwIfAborted();}),
  execution:{} as NonNullable<AccountExportHttpDependencies["generation"]>["execution"]};
 const deps:AccountExportHttpDependencies={actor:vi.fn(async()=>actor),origin:()=>"https://test.e2e.local",rpc:vi.fn(()=>rpc),generation};
 return {actor,exportId,capture,deps,rpc,response,generation,setStatus:(value:string)=>{status=value;}};
}
type Presentation=NonNullable<Awaited<ReturnType<typeof presentAccountExportCreate>>>;
function post(proof:Presentation,headers:Record<string,string>={},body:unknown={operation:proof.operation,nonce:proof.nonce},url="https://test.e2e.local/api/export"){
 return new Request(url,{method:"POST",headers:{origin:"https://test.e2e.local","sec-fetch-site":"same-origin","sec-fetch-mode":"cors",
  "content-type":"application/json","x-inherit-csrf":proof.csrf,...headers},body:JSON.stringify(body)});
}
async function presentation(f:ReturnType<typeof fixture>){return (await presentAccountExportCreate(f.deps,new AbortController().signal))!;}
async function queued(f:ReturnType<typeof fixture>){const proof=await presentation(f),result=await postAccountExport(post(proof),f.deps);
 expect(result.status).toBe(202);return result.headers.get("set-cookie")!.split(";")[0];}
describe("consumed account export HTTP source",()=>{
 it("presents read-only distinct action/CSRF then atomically queues and polls one exact cookie-bound job",async()=>{
  const f=fixture(),proof=await presentation(f);expect(f.rpc.mock.calls.map(([,a])=>a.p_operation)).toEqual(["capture"]);
  expect(proof.csrf).not.toBe(proof.nonce);expect(f.generation.assertReady).not.toHaveBeenCalled();
  const result=await postAccountExport(post(proof),f.deps);expect(result.status).toBe(202);
  expect(await result.json()).toEqual({status:"preparing",exportId:f.exportId});expect(result.headers.has("location")).toBe(false);
  const cookie=result.headers.get("set-cookie")!;expect(cookie).toMatch(/^__Host-inherit-export=[a-f0-9-]{36}\.[A-Za-z0-9_-]{43}; Path=\/; Secure; HttpOnly; SameSite=Strict; Max-Age=86400$/u);
  const value=cookie.split(";")[0].split("=")[1],secret=value.split(".")[1];
  const created=f.rpc.mock.calls.find(([,a])=>a.p_operation==="create")![1];
  expect((created.p_payload as Record<string,unknown>).exportCookieHash).toBe(accountExportCookieHash(secret,f.actor));
  expect(JSON.stringify(created)).not.toContain(secret);expect(created.p_csrf_binding).toMatch(/^[a-f0-9]{64}$/u);
  const before=f.rpc.mock.calls.length;
  for(const state of ["queued","building"]){f.setStatus(state);const polled=await pollAccountExport(new Request("https://test.e2e.local/api/export",{headers:{cookie:cookie.split(";")[0]}}),f.deps);
   expect(polled.status).toBe(202);expect(await polled.json()).toEqual({status:"preparing",exportId:f.exportId});expect(polled.headers.has("set-cookie")).toBe(false);}
  expect(f.rpc.mock.calls.slice(before).map(([,a])=>a.p_operation)).toEqual(["check","check"]);
  expect(f.generation.assertReady).toHaveBeenCalledTimes(1);
 });
 it("validates genuine Auth getUser/getClaims identity and expiry before service capture",async()=>{
  const f=fixture();auth.user.mockResolvedValue({data:{user:{id:f.actor.accountId}},error:null});
  auth.claims.mockResolvedValue({data:{claims:{sub:f.actor.accountId,session_id:f.actor.sessionId,role:"authenticated",exp:Math.floor(Date.now()/1000)+60}},error:null});
  expect(await currentAccountExportActor()).toEqual(f.actor);
  for(const patch of [{sub:randomUUID()},{session_id:"missing"},{role:"service_role"},{exp:0},{exp:NaN}]){
   auth.claims.mockResolvedValue({data:{claims:{sub:f.actor.accountId,session_id:f.actor.sessionId,role:"authenticated",exp:Math.floor(Date.now()/1000)+60,...patch}},error:null});
   expect(await currentAccountExportActor()).toBeNull();}
  f.deps.actor=async()=>null;const proof=await presentation(fixture());
  expect((await postAccountExport(post(proof),f.deps)).status).toBe(401);expect(f.deps.rpc).not.toHaveBeenCalled();
 });
 it.each(["origin","sec-fetch-site","sec-fetch-mode"])("refuses the missing %s transport proof before a protected RPC",async header=>{
  const f=fixture(),proof=await presentation(f);f.rpc.mockClear();
  expect((await postAccountExport(post(proof,{[header]:""}),f.deps)).status).toBe(403);expect(f.rpc).not.toHaveBeenCalled();
 });
 it("refuses a matching alias Origin that is not the trusted configured canonical origin",async()=>{
  const f=fixture(),proof=await presentation(f);f.rpc.mockClear();
  const result=await postAccountExport(post(proof,{origin:"https://alias.e2e.local"},undefined,"https://alias.e2e.local/api/export"),f.deps);
  expect(result.status).toBe(403);expect(f.rpc).not.toHaveBeenCalled();
 });
 it.each(["query","type","unknown-body","empty-body","oversized"])("rejects %s without a create",async fault=>{
  const f=fixture(),proof=await presentation(f);f.rpc.mockClear();
  const body=fault==="unknown-body"?{operation:"create",nonce:proof.nonce,target:f.actor.accountId}:fault==="empty-body"?{}:
   fault==="oversized"?{operation:"create",nonce:"x".repeat(5000)}:{operation:"create",nonce:proof.nonce};
  const response=await postAccountExport(post(proof,fault==="type"?{"content-type":"text/plain"}:{},body,
   fault==="query"?"https://test.e2e.local/api/export?target=foreign":"https://test.e2e.local/api/export"),f.deps);
  expect(response.status).toBe(422);expect(f.rpc).not.toHaveBeenCalled();
 });
 it.each(["operation-as-csrf","missing-csrf","changed-receipt","foreign-session","expired-pair"])("refuses %s with zero job/cookie",async fault=>{
  const f=fixture(),proof=await presentation(f);f.rpc.mockClear();
  if(fault==="changed-receipt")f.capture.authorityReceipt="d".repeat(64);
  if(fault==="foreign-session")f.actor.sessionId=randomUUID();
  if(fault==="expired-pair"){vi.useFakeTimers({toFake:["Date"]});vi.setSystemTime(Date.now()+300000);}
  const result=await postAccountExport(post(proof,{"x-inherit-csrf":fault==="operation-as-csrf"?proof.nonce:fault==="missing-csrf"?"":proof.csrf}),f.deps);
  expect(result.status).toBe(403);expect(result.headers.has("set-cookie")).toBe(false);
  expect(f.rpc.mock.calls.every(([,a])=>a.p_operation==="capture")).toBe(true);
 });
 it("refuses an invalid operation and replay without replacing a cookie or retrying an uncertain create",async()=>{
  const f=fixture(),proof=await presentation(f);
  expect((await postAccountExport(post(proof,{}, {operation:"create",nonce:proof.csrf}),f.deps)).status).toBe(404);
  expect((await postAccountExport(post(proof),f.deps)).status).toBe(202);
  const replay=await postAccountExport(post(proof),f.deps);expect(replay.status).toBe(404);expect(replay.headers.has("set-cookie")).toBe(false);
  const uncertain=fixture(),other=await presentation(uncertain);uncertain.response.mockImplementation(async args=>args.p_operation==="create"?{data:null,error:{code:"08006"}}:{data:uncertain.capture,error:null});
  const failed=await postAccountExport(post(other),uncertain.deps);expect(failed.status).toBe(503);expect(failed.headers.has("set-cookie")).toBe(false);
  expect(uncertain.rpc.mock.calls.filter(([,a])=>a.p_operation==="create")).toHaveLength(1);
 });
 it("does not interchange two genuine independently issued CSRF/action pairs",async()=>{
  const f=fixture(),first=await presentation(f),second=await presentation(f);expect(first.csrf).not.toBe(second.csrf);expect(first.nonce).not.toBe(second.nonce);
  const result=await postAccountExport(post(first,{"x-inherit-csrf":second.csrf}),f.deps);
  expect(result.status).toBe(404);expect(result.headers.has("set-cookie")).toBe(false);expect(f.rpc.mock.calls.some(([,a])=>a.p_operation==="create")).toBe(false);
 });
 it("keeps an opaque current-owner refusal after the presentation/capture race before enqueue",async()=>{
  const f=fixture(),proof=await presentation(f);f.response.mockImplementation(async args=>args.p_operation==="create"?{data:null,error:{code:"42501"}}:{data:f.capture,error:null});
  const response=await postAccountExport(post(proof),f.deps);expect(response.status).toBe(404);expect(await response.json()).toEqual({error:"not_found"});
  expect(response.headers.has("set-cookie")).toBe(false);expect(f.rpc.mock.calls.filter(([,a])=>a.p_operation==="create")).toHaveLength(1);
 });
 it.each(["absent","unproved","cancelled"])("refuses %s provider capability before request creation",async fault=>{
  const f=fixture(),proof=await presentation(f);f.rpc.mockClear();
  if(fault==="absent")f.deps.generation=null;
  if(fault==="unproved")f.generation.assertReady.mockRejectedValue(new Error("unproved"));
  const abort=new AbortController(),request=new Request(post(proof),{signal:abort.signal});if(fault==="cancelled")
   f.generation.assertReady.mockImplementation(async()=>{abort.abort();});
  const response=await postAccountExport(request,f.deps);expect(response.status).toBe(503);expect(response.headers.has("set-cookie")).toBe(false);
  expect(f.rpc.mock.calls.every(([,a])=>a.p_operation==="capture")).toBe(true);
 });
 it("keeps the unchanged thirty-second configuration boundary even for an ignored cancellation",async()=>{
  const f=fixture(),proof=await presentation(f);vi.useFakeTimers();
  f.generation.assertReady.mockImplementation(()=>new Promise<void>(()=>{}));
  const pending=postAccountExport(post(proof),f.deps);await vi.advanceTimersByTimeAsync(30001);
  expect((await pending).status).toBe(503);expect(f.rpc.mock.calls.some(([,a])=>a.p_operation==="create")).toBe(false);
 });
 it("polls only the exact cookie and current origin, with no credentials or rotation",async()=>{
  const f=fixture(),cookie=await queued(f),before=f.rpc.mock.calls.length;
  for(const header of ["",`${cookie}; ${cookie}`,`${ACCOUNT_EXPORT_COOKIE}=invalid`,createAccountExportCookie(f.actor).header(f.exportId).split(";")[0]]){
   const response=await pollAccountExport(new Request("https://test.e2e.local/api/export",{headers:{cookie:header}}),f.deps);
   expect(response.status).toBe(404);expect(response.headers.has("set-cookie")).toBe(false);}
  expect(f.rpc.mock.calls.slice(before).every(([,a])=>a.p_operation==="check")).toBe(true);
  expect((await pollAccountExport(new Request("https://test.e2e.local/api/export?exportId=foreign",{headers:{cookie}}),f.deps)).status).toBe(422);
  f.actor.sessionId=randomUUID();expect((await pollAccountExport(new Request("https://test.e2e.local/api/export",{headers:{cookie}}),f.deps)).status).toBe(404);
 });
 it("refuses terminal/ready states and never fabricates download metadata or writes open-ready",async()=>{
  const f=fixture(),cookie=await queued(f),before=f.rpc.mock.calls.length;
  for(const state of ["failed","revoked","expired","purged","ready"]){f.setStatus(state);
   const result=await pollAccountExport(new Request("https://test.e2e.local/api/export",{headers:{cookie}}),f.deps);
   expect(result.status).toBe(state==="ready"?503:404);expect(result.headers.has("set-cookie")).toBe(false);
   expect(await result.json()).toEqual({error:state==="ready"?"unavailable":"not_found"});}
  const csrf=mintAccountExportCsrf({actor:f.actor,originBinding:f.capture.originBinding,authorityReceipt:f.capture.authorityReceipt,operation:"open-ready"});
  const nonce=mintExportOperation({routeId:"api.export",origin:"authenticated",principalId:f.capture.principalId,targetKind:"account",targetId:f.actor.accountId,
   exportContract:"account-export-v1",originBinding:f.capture.originBinding,authorityReceipt:f.capture.authorityReceipt,csrfBinding:csrf.binding,
   operation:"open-ready",exportId:f.exportId,exportRevision:1});
  const response=await postAccountExport(post({operation:"create",nonce:nonce.token,csrf:csrf.token},{cookie},{operation:"open-ready",nonce:nonce.token}),f.deps);
  expect(response.status).toBe(503);expect(response.headers.has("set-cookie")).toBe(false);
  expect(f.rpc.mock.calls.slice(before).every(([,a])=>["capture","check"].includes(a.p_operation))).toBe(true);
 });
});
