import "server-only";
import {z} from "zod";
import {createClient} from "@/lib/supabase/server";
import {createAdminClient} from "@/lib/supabase/admin";
import {hasEmptyRequestBody} from "@/lib/empty-request-body";
import {applicationOrigin} from "@/lib/app-origin";
import {ownUploadJson} from "@/lib/uploads/own-upload-context";
import {mintExportOperation,verifyExportOperation,EXPORT_OPERATION_TOKEN_MAX_LENGTH} from "./export-operation-token";
import {accountExportActor,mintAccountExportCsrf,verifyAccountExportCsrf,createAccountExportCookie,
 readAccountExportCookie,type AccountExportActor} from "./account-export-session";
import {approvedAccountArchiveGeneration,type AccountArchiveGenerationCapability} from "./account-archive-generation";

const uuid=z.uuid(),hash=z.string().regex(/^[a-f0-9]{64}$/u),revision=z.number().int().positive().safe();
const captureSchema=z.object({principalId:uuid,principalHash:hash,originBinding:hash,authorityReceipt:hash,
 accountRevision:revision,lifecycleRevision:revision,principalGraphRevision:revision,
 subjectPartitions:z.array(uuid).min(1),fileCount:z.number().int().nonnegative().safe()}).strict()
 .refine(value=>new Set(value.subjectPartitions).size===value.subjectPartitions.length);
const createSchema=z.object({exportId:uuid,exportRevision:revision,status:z.literal("queued"),authorityReceipt:hash}).strict();
const statusSchema=z.object({exportId:uuid,exportRevision:revision,
 status:z.enum(["queued","building","ready","failed","revoked","expired","purged"]),expiresAt:z.iso.datetime({offset:true}).nullable()}).strict();
const bodySchema=z.object({operation:z.enum(["create","open-ready"]),nonce:z.string().min(1).max(EXPORT_OPERATION_TOKEN_MAX_LENGTH)}).strict();
export type AccountExportRequestRpc=(name:"export_archive_request_v1",args:{p_operation:"capture"|"create"|"check";
 p_origin:{kind:"account";accountId:string;sessionId:string};p_target_kind:"account";p_target_id:string;
 p_payload:unknown;p_csrf_binding:string|null},options:{get:false;head:false})=>{
 retry:(enabled:false)=>{abortSignal:(signal:AbortSignal)=>PromiseLike<{data:unknown;error:{code?:string}|null}>}};
export type AccountExportHttpDependencies={actor:()=>Promise<AccountExportActor|null>;origin:()=>string;rpc:()=>AccountExportRequestRpc;
 generation:AccountArchiveGenerationCapability|null};
const unavailable=()=>ownUploadJson({error:"unavailable"},503);
const notFound=()=>ownUploadJson({error:"not_found"},404);
const forbidden=()=>ownUploadJson({error:"request_forbidden"},403);
const invalid=()=>ownUploadJson({error:"invalid_request",issues:["request"]},422);
const unauthenticated=()=>ownUploadJson({error:"unauthenticated"},401);
class RequestFailure extends Error {constructor(readonly code?:string){super("account_export_unavailable");}}
const errorResponse=(error:unknown)=>error instanceof RequestFailure&&["42501","23505"].includes(error.code??"")?notFound()
 :error instanceof RequestFailure&&error.code==="22023"?invalid()
 :error instanceof RequestFailure&&error.code==="55000"?ownUploadJson({error:"state_conflict"},409):unavailable();

/** The genuine Auth client validates the JWT. The complete service capture
 * then locks/rechecks the exact current own session, revisions and full source
 * graph. No body, cookie, user metadata or worker supplies these actor IDs. */
export async function currentAccountExportActor():Promise<AccountExportActor|null>{
 const client=await createClient();
 const [user,claims]=await Promise.all([client.auth.getUser(),client.auth.getClaims()]);
 const jwt=claims.data?.claims;
 if(user.error||claims.error||!user.data.user||jwt?.sub!==user.data.user.id||jwt.role!=="authenticated"
  ||typeof jwt.session_id!=="string"||!Number.isSafeInteger(jwt.exp)||Number(jwt.exp)*1000<=Date.now())return null;
 const parsed=accountExportActor.safeParse({accountId:jwt.sub,sessionId:jwt.session_id});return parsed.success?parsed.data:null;
}
export function accountExportHttpDependencies():AccountExportHttpDependencies{
 return {actor:currentAccountExportActor,origin:applicationOrigin,rpc:()=>{const admin=createAdminClient();return admin.rpc.bind(admin) as unknown as AccountExportRequestRpc;},
  generation:approvedAccountArchiveGeneration()};
}
async function bounded<T>(signal:AbortSignal,work:(signal:AbortSignal)=>PromiseLike<T>,milliseconds=30_000):Promise<T>{
 const stop=new AbortController(),current=AbortSignal.any([signal,stop.signal]);let interrupt=()=>{};
 const timer=setTimeout(()=>stop.abort(),milliseconds);timer.unref();
 const aborted=new Promise<never>((_,reject)=>{interrupt=()=>reject(new RequestFailure());current.addEventListener("abort",interrupt,{once:true});});
 try{if(current.aborted)throw new RequestFailure();const value=await Promise.race([Promise.resolve().then(()=>work(current)),aborted]);
  if(current.aborted)throw new RequestFailure();return value;
 }finally{clearTimeout(timer);current.removeEventListener("abort",interrupt);stop.abort();}
}
function origin(actor:AccountExportActor){return {kind:"account" as const,...actor};}
async function invoke(rpc:AccountExportRequestRpc,actor:AccountExportActor,operation:"capture"|"create"|"check",
 signal:AbortSignal,payload:unknown=null,csrf:string|null=null){
 return bounded(signal,async current=>{
  const result=await rpc("export_archive_request_v1",{p_operation:operation,p_origin:origin(actor),p_target_kind:"account",
   p_target_id:actor.accountId,p_payload:payload,p_csrf_binding:csrf},{get:false,head:false}).retry(false).abortSignal(current);
  if(result.error)throw new RequestFailure(result.error.code);return result.data;
 });
}
function operationContext(actor:AccountExportActor,capture:z.infer<typeof captureSchema>,csrfBinding:string){
 return {routeId:"api.export" as const,origin:"authenticated" as const,principalId:capture.principalId,targetKind:"account" as const,
  targetId:actor.accountId,exportContract:"account-export-v1" as const,originBinding:capture.originBinding,
  authorityReceipt:capture.authorityReceipt,csrfBinding,operation:"create" as const};
}
/** Explicit server-rendered action presentation only. A poll never invokes
 * this function, issues proofs, changes cookies, creates jobs or sessions. */
export async function presentAccountExportCreate(deps:AccountExportHttpDependencies,signal:AbortSignal){
 const actor=await deps.actor();if(!actor||signal.aborted)return null;
 const capture=captureSchema.parse(await invoke(deps.rpc(),actor,"capture",signal));
 const csrf=mintAccountExportCsrf({actor,originBinding:capture.originBinding,authorityReceipt:capture.authorityReceipt,operation:"create"});
 const operation=mintExportOperation(operationContext(actor,capture,csrf.binding));
 return Object.freeze({operation:"create" as const,nonce:operation.token,csrf:csrf.token});
}
async function readBody(request:Request){
 if(!request.body)return null;const reader=request.body.getReader();let chunks:Uint8Array[]=[];let length=0;
 try{return await bounded(request.signal,async signal=>{
  for(;;){if(signal.aborted)throw new RequestFailure();const value=await reader.read();if(value.done)break;
   length+=value.value.length;if(length>4096)throw new RequestFailure("22023");chunks.push(value.value);}
  const body=JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(Buffer.concat(chunks)));chunks=[];return body;
 },1000);}catch{return null;}finally{void reader.cancel().catch(()=>{});reader.releaseLock();}
}
export async function postAccountExport(request:Request,deps:AccountExportHttpDependencies):Promise<Response>{
 try{
  const actor=await deps.actor();if(!actor)return unauthenticated();
  const url=new URL(request.url);
  if(request.method!=="POST"||url.origin!==deps.origin()||request.headers.get("origin")!==url.origin||request.headers.get("sec-fetch-site")!=="same-origin"
   ||request.headers.get("sec-fetch-mode")!=="cors")return forbidden();
  if(url.search||request.headers.get("content-type")?.split(";")[0].trim().toLowerCase()!=="application/json")return invalid();
  const body=bodySchema.safeParse(await readBody(request));if(!body.success)return invalid();
  const rpc=deps.rpc(),capture=captureSchema.parse(await invoke(rpc,actor,"capture",request.signal));
  const csrf=verifyAccountExportCsrf(request.headers.get("x-inherit-csrf"),{actor,originBinding:capture.originBinding,
   authorityReceipt:capture.authorityReceipt,operation:body.data.operation});if(!csrf)return forbidden();
  if(body.data.operation==="open-ready"){
   const cookie=readAccountExportCookie(request,actor);if(!cookie)return notFound();
   const status=statusSchema.parse(await invoke(rpc,actor,"check",request.signal,{exportId:cookie.exportId,exportCookieHash:cookie.hash}));
   if(status.exportId!==cookie.exportId||status.status!=="ready")return notFound();
   const verified=verifyExportOperation(body.data.nonce,{...operationContext(actor,capture,csrf),operation:"open-ready",
    exportId:status.exportId,exportRevision:status.exportRevision});if(!verified)return notFound();
   // Current authority, distinct action and CSRF are still required even while
   // provider publication is closed. No open-ready write or create fallback.
   return unavailable();
  }
  const envelope=verifyExportOperation(body.data.nonce,operationContext(actor,capture,csrf));if(!envelope)return notFound();
  if(!deps.generation)return unavailable();
  await bounded(request.signal,signal=>deps.generation!.assertReady(signal));
  // The cookie value is random memory until SQL atomically creates this one
  // request and consumes the exact operation/CSRF pair. An uncertain response
  // is never retried or replaced, and no credential is returned on refusal.
  const pendingCookie=createAccountExportCookie(actor);
  const result=createSchema.parse(await invoke(rpc,actor,"create",request.signal,
   {envelope,exportCookieHash:pendingCookie.hash},csrf));
  if(result.authorityReceipt!==capture.authorityReceipt||result.exportRevision!==1)throw new RequestFailure();
  // The opaque ID selects the row; only its recorded secret hash plus the
  // genuine current principal/session can authorize that exact row.
  const response=ownUploadJson({status:"preparing",exportId:result.exportId},202);
  response.headers.set("set-cookie",pendingCookie.header(result.exportId));return response;
 }catch(error){return errorResponse(error);}
}
export async function pollAccountExport(request:Request,deps:AccountExportHttpDependencies):Promise<Response>{
 try{
  const actor=await deps.actor();if(!actor)return unauthenticated();
  if(request.method!=="GET"||new URL(request.url).search||!(await hasEmptyRequestBody(request)))return invalid();
  const cookie=readAccountExportCookie(request,actor);if(!cookie)return notFound();
  const status=statusSchema.parse(await invoke(deps.rpc(),actor,"check",request.signal,{exportId:cookie.exportId,exportCookieHash:cookie.hash}));
  if(status.exportId!==cookie.exportId)throw new RequestFailure();
  if(status.status==="queued"||status.status==="building")return ownUploadJson({status:"preparing",exportId:status.exportId},202);
  // Existing check intentionally returns no size/hash/member-complete proof.
  // Never fabricate a ready DTO or issue a download from status alone.
  return status.status==="ready"?unavailable():notFound();
 }catch(error){return errorResponse(error);}
}
