import {randomUUID} from "node:crypto";
import {afterEach,describe,expect,it,vi} from "vitest";
import {postSubjectExport,pollSubjectExport,presentSubjectExportCreate,presentSubjectExportOpen,subjectExportRefusal,
 SUBJECT_EXPORT_REFUSALS,type SubjectExportHttpDependencies,type SubjectExportRequestRpc} from "./subject-export-http";
import {accountExportCookieHash,subjectExportCookieHash,readSubjectExportCookie} from "./account-export-session";
import {hmacSecret} from "@/lib/crypto";
vi.mock("@/lib/supabase/server",()=>({createClient:async()=>({auth:{}})}));
vi.stubEnv("BYOK_ENCRYPTION_KEY",Buffer.alloc(32,9).toString("base64"));
afterEach(()=>{vi.useRealTimers();vi.clearAllMocks();});

const ORIGIN="https://test.e2e.local";
function fixture(options:{refuse?:{code:string;message:string}}={}){
 const actor={accountId:randomUUID(),sessionId:randomUUID()},subject=randomUUID(),exportId=randomUUID();
 const capture={principalId:randomUUID(),principalHash:"a".repeat(64),originBinding:"b".repeat(64),authorityReceipt:"c".repeat(64),
  accountRevision:1,lifecycleRevision:3,principalGraphRevision:1,subjectPartitions:[subject],fileCount:1};
 let status="queued",cookieHash="",consumed=false,refuse=options.refuse;
 const response=vi.fn(async(args:Parameters<SubjectExportRequestRpc>[1]):Promise<{data:unknown;error:{code:string;message?:string}|null}>=>{
  if(args.p_origin.accountId!==actor.accountId||args.p_origin.sessionId!==actor.sessionId||args.p_subject_id!==subject)
   return {data:null,error:{code:"42501",message:"not_found"}};
  if(refuse)return {data:null,error:refuse};
  if(args.p_operation==="capture")return {data:structuredClone(capture),error:null};
  const payload=args.p_payload as Record<string,unknown>;
  if(args.p_operation==="create"){
   if(consumed)return {data:null,error:{code:"55000",message:"export_already_pending"}};consumed=true;cookieHash=String(payload.exportCookieHash);
   return {data:{exportId,exportRevision:1,status:"queued",authorityReceipt:capture.authorityReceipt},error:null};
  }
  if(payload.exportId!==exportId||payload.exportCookieHash!==cookieHash)return {data:null,error:{code:"42501",message:"not_found"}};
  return {data:{exportId,exportRevision:1,status,expiresAt:null},error:null};
 });
 const rpc=vi.fn<SubjectExportRequestRpc>((name,args,options)=>{
  expect(name).toBe("subject_export_request_v1");expect(options).toEqual({get:false,head:false});
  return {retry:enabled=>{expect(enabled).toBe(false);return {abortSignal:async signal=>{
   signal.throwIfAborted();const result=await response(args);signal.throwIfAborted();return result;
  }}}};
 });
 const generation={assertReady:vi.fn(async(signal:AbortSignal)=>{signal.throwIfAborted();}),
  execution:{} as NonNullable<SubjectExportHttpDependencies["generation"]>["execution"]};
 const deps:SubjectExportHttpDependencies={actor:vi.fn(async()=>actor),origin:()=>ORIGIN,rpc:vi.fn(()=>rpc),generation};
 return {actor,subject,exportId,capture,deps,rpc,generation,setStatus:(value:string)=>{status=value;},
  refuse:(value:{code:string;message:string}|undefined)=>{refuse=value;}};
}
type Fixture=ReturnType<typeof fixture>;
const route=(f:Fixture)=>`${ORIGIN}/api/subjects/${f.subject}/export`;
function post(f:Fixture,proof:{operation:string;nonce:string;csrf:string},headers:Record<string,string>={},
 body:unknown={operation:proof.operation,nonce:proof.nonce}){
 return new Request(route(f),{method:"POST",headers:{origin:ORIGIN,"sec-fetch-site":"same-origin","sec-fetch-mode":"cors",
  "content-type":"application/json","x-inherit-csrf":proof.csrf,...headers},body:JSON.stringify(body)});
}
async function presentation(f:Fixture){
 const value=await presentSubjectExportCreate(f.deps,f.subject,new AbortController().signal);
 if(!value||"refusal" in value)throw new Error("no presentation");return value;
}
const JOINT={code:"0A000",message:"export_joint_results_pending"};

describe("api.subject-export HTTP",()=>{
 it("presents, queues one subject-bound job and polls it with the record's own cookie",async()=>{
  const f=fixture(),proof=await presentation(f);
  expect(f.rpc.mock.calls.map(([,a])=>[a.p_operation,a.p_subject_id])).toEqual([["capture",f.subject]]);
  const result=await postSubjectExport(post(f,proof),f.subject,f.deps);expect(result.status).toBe(202);
  expect(await result.json()).toEqual({status:"preparing",exportId:f.exportId});
  const cookie=result.headers.get("set-cookie")!;
  expect(cookie).toMatch(/^__Host-inherit-export=[a-f0-9-]{36}\.[A-Za-z0-9_-]{43}; Path=\/; Secure; HttpOnly; SameSite=Strict; Max-Age=86400$/u);
  const secret=cookie.split(";")[0].split("=")[1].split(".")[1];
  const created=f.rpc.mock.calls.find(([,a])=>a.p_operation==="create")![1];
  const stored=(created.p_payload as Record<string,unknown>).exportCookieHash;
  expect(stored).toBe(subjectExportCookieHash(secret,f.actor,f.subject));
  expect(stored).not.toBe(accountExportCookieHash(secret,f.actor));
  // Its own HMAC context, never the account cookie's.
  expect(stored).toBe(hmacSecret(JSON.stringify([f.actor,f.subject,secret]),"subject-export-cookie-v1"));
  expect(stored).not.toBe(hmacSecret(JSON.stringify([f.actor,f.subject,secret]),"account-export-cookie-v1"));
  expect(JSON.stringify(created)).not.toContain(secret);
  const envelope=(created.p_payload as {envelope:Record<string,unknown>}).envelope;
  expect(envelope).toMatchObject({routeId:"api.subject-export",targetKind:"subject",targetId:f.subject,exportContract:"subject-export-v1",operation:"create"});
  for(const state of ["queued","building"]){f.setStatus(state);
   const polled=await pollSubjectExport(new Request(route(f),{headers:{cookie:cookie.split(";")[0]}}),f.subject,f.deps);
   expect(polled.status).toBe(202);expect(await polled.json()).toEqual({status:"preparing",exportId:f.exportId});expect(polled.headers.has("set-cookie")).toBe(false);}
  f.setStatus("failed");
  expect((await pollSubjectExport(new Request(route(f),{headers:{cookie:cookie.split(";")[0]}}),f.subject,f.deps)).status).toBe(404);
  expect(f.generation.assertReady).toHaveBeenCalledTimes(1);
 });
 it("binds the cookie to the record: another record's id cannot poll it",async()=>{
  const f=fixture(),proof=await presentation(f),cookie=(await postSubjectExport(post(f,proof),f.subject,f.deps)).headers.get("set-cookie")!.split(";")[0];
  const other=randomUUID(),request=new Request(`${ORIGIN}/api/subjects/${other}/export`,{headers:{cookie}});
  expect(readSubjectExportCookie(request,f.actor,other)!.hash).not.toBe(readSubjectExportCookie(request,f.actor,f.subject)!.hash);
  const polled=await pollSubjectExport(request,other,f.deps);
  expect(polled.status).toBe(404);expect(await polled.json()).toEqual({error:"not_found"});
 });
 it("states the one closed refusal while the record has live joint results, before any field is read",async()=>{
  const f=fixture(),proof=await presentation(f);f.refuse(JOINT);f.rpc.mockClear();
  for(const request of [post(f,proof),post(f,proof,{"content-type":"text/plain"}),post(f,proof,{},{operation:"create"}),post(f,proof,{"x-inherit-csrf":"forged"})]){
   const refused=await postSubjectExport(request,f.subject,f.deps);
   expect(refused.status).toBe(422);expect(await refused.json()).toEqual({error:"invalid_request",issues:["jointResults"]});
  }
  expect(f.rpc.mock.calls.every(([,a])=>a.p_operation==="capture")).toBe(true);expect(f.generation.assertReady).not.toHaveBeenCalled();
  expect(await presentSubjectExportCreate(f.deps,f.subject,new AbortController().signal)).toEqual({refusal:"jointResults"});
  expect(SUBJECT_EXPORT_REFUSALS).toEqual(["jointResults"]);
 });
 it("refuses a job whose record gained joint results after the request, on the next poll",async()=>{
  const f=fixture(),proof=await presentation(f),cookie=(await postSubjectExport(post(f,proof),f.subject,f.deps)).headers.get("set-cookie")!.split(";")[0];
  f.refuse(JOINT);const polled=await pollSubjectExport(new Request(route(f),{headers:{cookie}}),f.subject,f.deps);
  expect(polled.status).toBe(422);expect(await polled.json()).toEqual({error:"invalid_request",issues:["jointResults"]});
 });
 it("maps only the database's own joint-results code to the refusal",async()=>{
  for(const error of [{code:"0A000",message:"export_partition_projection_unavailable"},{code:"0A000",message:"jointResults"},{code:"22023",message:"export_joint_results_pending"}]){
   const f=fixture(),proof=await presentation(f);f.refuse(error);
   const result=await postSubjectExport(post(f,proof),f.subject,f.deps);
   expect(result.status).toBe(error.code==="22023"?422:503);
   expect(await result.json()).toEqual(error.code==="22023"?{error:"invalid_request",issues:["request"]}:{error:"unavailable"});
  }
  expect(subjectExportRefusal(new Error("export_joint_results_pending"))).toBeNull();
 });
 it("answers resource-not-found-v1 for a record that is not the caller's own ordinary record, before field validation",async()=>{
  const f=fixture(),proof=await presentation(f);f.refuse({code:"42501",message:"not_found"});
  for(const request of [post(f,proof),post(f,proof,{"content-type":"text/plain"}),post(f,proof,{},{bad:true})]){
   const result=await postSubjectExport(request,f.subject,f.deps);expect(result.status).toBe(404);expect(await result.json()).toEqual({error:"not_found"});
  }
  const malformed=await postSubjectExport(post(f,proof),"not-a-uuid",f.deps);
  expect(malformed.status).toBe(404);expect(f.rpc.mock.calls.some(([,a])=>a.p_subject_id==="not-a-uuid")).toBe(false);
 });
 it("keeps the transport, CSRF and one-time nonce checks of the account route",async()=>{
  const f=fixture(),proof=await presentation(f);f.rpc.mockClear();
  for(const header of ["origin","sec-fetch-site","sec-fetch-mode"])
   expect((await postSubjectExport(post(f,proof,{[header]:""}),f.subject,f.deps)).status).toBe(403);
  expect(f.rpc).not.toHaveBeenCalled();
  expect((await postSubjectExport(post(f,proof,{"x-inherit-csrf":"forged"}),f.subject,f.deps)).status).toBe(403);
  expect((await postSubjectExport(post(f,proof,{},{operation:"create",nonce:"forged"}),f.subject,f.deps)).status).toBe(404);
  expect((await postSubjectExport(post(f,proof,{},{operation:"create",nonce:proof.nonce,extra:1}),f.subject,f.deps)).status).toBe(422);
  expect((await postSubjectExport(new Request(route(f)+"?x=1",post(f,proof)),f.subject,f.deps)).status).toBe(422);
  expect(f.generation.assertReady).not.toHaveBeenCalled();
  expect(f.rpc.mock.calls.some(([,a])=>a.p_operation==="create")).toBe(false);
 });
 it("needs a configured generation capability and genuine Auth",async()=>{
  const f=fixture(),proof=await presentation(f);
  const closed=await postSubjectExport(post(f,proof),f.subject,{...f.deps,generation:null});
  expect(closed.status).toBe(503);expect(f.rpc.mock.calls.some(([,a])=>a.p_operation==="create")).toBe(false);
  expect((await postSubjectExport(post(f,proof),f.subject,{...f.deps,actor:async()=>null})).status).toBe(401);
  expect((await pollSubjectExport(new Request(route(f)),f.subject,{...f.deps,actor:async()=>null})).status).toBe(401);
 });
 it("answers resource-not-found-v1 for a poll without the record's cookie and never creates one",async()=>{
  const f=fixture();const polled=await pollSubjectExport(new Request(route(f)),f.subject,f.deps);
  expect(polled.status).toBe(404);expect(polled.headers.has("set-cookie")).toBe(false);expect(f.rpc).not.toHaveBeenCalled();
  expect((await pollSubjectExport(new Request(route(f)+"?a=1"),f.subject,f.deps)).status).toBe(422);
 });
 it("presents no open proof without a delivery capability or a ready export",async()=>{
  const f=fixture(),proof=await presentation(f),cookie=(await postSubjectExport(post(f,proof),f.subject,f.deps)).headers.get("set-cookie")!.split(";")[0];
  const request=new Request(route(f),{headers:{cookie}});
  expect(await presentSubjectExportOpen(request,f.deps,f.subject,new AbortController().signal)).toBeNull();
  const delivery={assertReady:vi.fn(async()=>{}),ready:vi.fn(async()=>{throw new Error("unexpected");})};
  expect(await presentSubjectExportOpen(request,{...f.deps,delivery},f.subject,new AbortController().signal)).toBeNull();
  expect(delivery.ready).not.toHaveBeenCalled();
 });
});
