import "server-only";
import {z} from "zod";
import {createAdminClient} from "@/lib/supabase/admin";
import {hasEmptyRequestBody} from "@/lib/empty-request-body";
import {applicationOrigin} from "@/lib/app-origin";
import {ownUploadJson} from "@/lib/uploads/own-upload-context";
import {mintExportOperation,verifyExportOperation,EXPORT_OPERATION_TOKEN_MAX_LENGTH} from "./export-operation-token";
import {mintAccountExportCsrf,verifyAccountExportCsrf,createSubjectExportCookie,readSubjectExportCookie,
 type AccountExportActor} from "./account-export-session";
import {approvedAccountArchiveGeneration} from "./account-archive-generation";
import {currentAccountExportActor,type AccountExportHttpDependencies} from "./account-export-http";
import {randomBytes,createHash} from "node:crypto";
import {currentAccountExportReady,publicAccountExportReady} from "./account-export-delivery";
import {ACCOUNT_ARCHIVE_CHUNK_BYTES,ACCOUNT_ARCHIVE_FILENAME,accountExportDownload} from "./account-export-delivery-contract";
import {configuredTestAccountArchive} from "./account-archive-test-capabilities";

/** api.subject-export's closed refusal list (invalid-request-v1 issues). The
 * one stated reason the owner's two-step decision names: the record has live
 * joint results, which this first step never exports. */
export const SUBJECT_EXPORT_REFUSALS=["jointResults"] as const;
export type SubjectExportRefusal=(typeof SUBJECT_EXPORT_REFUSALS)[number];

const uuid=z.uuid(),hash=z.string().regex(/^[a-f0-9]{64}$/u),revision=z.number().int().positive().safe();
const captureSchema=z.object({principalId:uuid,principalHash:hash,originBinding:hash,authorityReceipt:hash,
 accountRevision:revision,lifecycleRevision:revision,principalGraphRevision:revision,
 subjectPartitions:z.array(uuid).length(1),fileCount:z.number().int().nonnegative().safe()}).strict();
const createSchema=z.object({exportId:uuid,exportRevision:revision,status:z.literal("queued"),authorityReceipt:hash}).strict();
const statusSchema=z.object({exportId:uuid,exportRevision:revision,
 status:z.enum(["queued","building","ready","failed","revoked","expired","purged"]),expiresAt:z.iso.datetime({offset:true}).nullable()}).strict();
const bodySchema=z.object({operation:z.enum(["create","open-ready"]),nonce:z.string().min(1).max(EXPORT_OPERATION_TOKEN_MAX_LENGTH)}).strict();
export type SubjectExportRequestRpc=(name:"subject_export_request_v1",args:{p_operation:"capture"|"create"|"check"|"open-ready";
 p_origin:{kind:"account";accountId:string;sessionId:string};p_subject_id:string;
 p_payload:unknown;p_csrf_binding:string|null},options:{get:false;head:false})=>{
 retry:(enabled:false)=>{abortSignal:(signal:AbortSignal)=>PromiseLike<{data:unknown;error:{code?:string;message?:string}|null}>}};
export type SubjectExportHttpDependencies=Omit<AccountExportHttpDependencies,"rpc">&{rpc:()=>SubjectExportRequestRpc};
const unavailable=()=>ownUploadJson({error:"unavailable"},503);
const notFound=()=>ownUploadJson({error:"not_found"},404);
const forbidden=()=>ownUploadJson({error:"request_forbidden"},403);
const invalid=(issues:readonly string[]=["request"])=>ownUploadJson({error:"invalid_request",issues},422);
const unauthenticated=()=>ownUploadJson({error:"unauthenticated"},401);
class RequestFailure extends Error {constructor(readonly code?:string,readonly reason?:string){super("subject_export_unavailable");}}
/** The closed refusal: only the database's own joint-results code maps to it. */
export function subjectExportRefusal(error:unknown):SubjectExportRefusal|null{
 return error instanceof RequestFailure&&error.code==="0A000"&&error.reason==="export_joint_results_pending"?"jointResults":null;
}
const errorResponse=(error:unknown)=>subjectExportRefusal(error)?invalid([subjectExportRefusal(error)!])
 :error instanceof RequestFailure&&["42501","23505"].includes(error.code??"")?notFound()
 :error instanceof RequestFailure&&error.code==="22023"?invalid()
 :error instanceof RequestFailure&&error.code==="55000"?ownUploadJson({error:"state_conflict"},409):unavailable();

export function subjectExportHttpDependencies():SubjectExportHttpDependencies{
 const test=configuredTestAccountArchive();
 return {actor:currentAccountExportActor,origin:applicationOrigin,rpc:()=>{const admin=createAdminClient();return admin.rpc.bind(admin) as unknown as SubjectExportRequestRpc;},
  generation:approvedAccountArchiveGeneration()??test?.generation??null,delivery:test?.delivery??null};
}
async function bounded<T>(signal:AbortSignal,work:(signal:AbortSignal)=>PromiseLike<T>,milliseconds=30_000):Promise<T>{
 const stop=new AbortController(),current=AbortSignal.any([signal,stop.signal]);let interrupt=()=>{};
 const timer=setTimeout(()=>stop.abort(),milliseconds);timer.unref();
 const aborted=new Promise<never>((_,reject)=>{interrupt=()=>reject(new RequestFailure());current.addEventListener("abort",interrupt,{once:true});});
 try{if(current.aborted)throw new RequestFailure();const value=await Promise.race([Promise.resolve().then(()=>work(current)),aborted]);
  if(current.aborted)throw new RequestFailure();return value;
 }finally{clearTimeout(timer);current.removeEventListener("abort",interrupt);stop.abort();}
}
async function invoke(rpc:SubjectExportRequestRpc,actor:AccountExportActor,subjectId:string,operation:"capture"|"create"|"check"|"open-ready",
 signal:AbortSignal,payload:unknown=null,csrf:string|null=null){
 return bounded(signal,async current=>{
  const result=await rpc("subject_export_request_v1",{p_operation:operation,p_origin:{kind:"account",...actor},p_subject_id:subjectId,
   p_payload:payload,p_csrf_binding:csrf},{get:false,head:false}).retry(false).abortSignal(current);
  if(result.error)throw new RequestFailure(result.error.code,result.error.message);return result.data;
 });
}
async function capture(rpc:SubjectExportRequestRpc,actor:AccountExportActor,subjectId:string,signal:AbortSignal){
 const value=captureSchema.parse(await invoke(rpc,actor,subjectId,"capture",signal));
 if(value.subjectPartitions[0]!==subjectId)throw new RequestFailure();return value;
}
function operationContext(subjectId:string,value:z.infer<typeof captureSchema>,csrfBinding:string){
 return {routeId:"api.subject-export" as const,origin:"authenticated" as const,principalId:value.principalId,targetKind:"subject" as const,
  targetId:subjectId,exportContract:"subject-export-v1" as const,originBinding:value.originBinding,
  authorityReceipt:value.authorityReceipt,csrfBinding,operation:"create" as const};
}
const subjectId=(value:unknown)=>{const parsed=uuid.safeParse(value);return parsed.success?parsed.data.toLowerCase():null;};

/** Explicit server-rendered action presentation for one record. A refusal
 * (joint results) is returned as its closed reason; no proof is minted. */
export async function presentSubjectExportCreate(deps:SubjectExportHttpDependencies,subject:string,signal:AbortSignal)
 :Promise<{operation:"create";nonce:string;csrf:string}|{refusal:SubjectExportRefusal}|null>{
 const id=subjectId(subject),actor=await deps.actor();if(!id||!actor||signal.aborted)return null;
 let value:z.infer<typeof captureSchema>;
 try{value=await capture(deps.rpc(),actor,id,signal);}
 catch(error){const refusal=subjectExportRefusal(error);if(refusal)return {refusal};throw error;}
 const csrf=mintAccountExportCsrf({actor,originBinding:value.originBinding,authorityReceipt:value.authorityReceipt,operation:"create"});
 const operation=mintExportOperation(operationContext(id,value,csrf.binding));
 return Object.freeze({operation:"create" as const,nonce:operation.token,csrf:csrf.token});
}
/** The distinct open proof, only for this record's own current ready export. */
export async function presentSubjectExportOpen(request:Request,deps:SubjectExportHttpDependencies,subject:string,signal:AbortSignal){
 const id=subjectId(subject);if(!id||!deps.delivery||signal.aborted)return null;
 const actor=await deps.actor();if(!actor)return null;
 const cookie=readSubjectExportCookie(request,actor,id);if(!cookie)return null;
 const rpc=deps.rpc(),value=await capture(rpc,actor,id,signal);
 const status=statusSchema.parse(await invoke(rpc,actor,id,"check",signal,{exportId:cookie.exportId,exportCookieHash:cookie.hash}));
 if(status.exportId!==cookie.exportId||status.status!=="ready")return null;
 const ready=await bounded(signal,current=>currentAccountExportReady({delivery:deps.delivery!,actor,
  exportId:cookie.exportId,exportCookieHash:cookie.hash,signal:current}));
 if(ready.authorityReceipt!==value.authorityReceipt)return null;
 const csrf=mintAccountExportCsrf({actor,originBinding:value.originBinding,authorityReceipt:value.authorityReceipt,operation:"open-ready"});
 const action=mintExportOperation({...operationContext(id,value,csrf.binding),operation:"open-ready",
  exportId:status.exportId,exportRevision:status.exportRevision});
 return Object.freeze({...publicAccountExportReady(ready),operation:"open-ready" as const,nonce:action.token,csrf:csrf.token});
}
async function readBody(request:Request){
 if(!request.body)return null;const reader=request.body.getReader();let chunks:Uint8Array[]=[];let length=0;
 try{return await bounded(request.signal,async signal=>{
  for(;;){if(signal.aborted)throw new RequestFailure();const value=await reader.read();if(value.done)break;
   length+=value.value.length;if(length>4096)throw new RequestFailure("22023");chunks.push(value.value);}
  const body=JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(Buffer.concat(chunks)));chunks=[];return body;
 },1000);}catch{return null;}finally{void reader.cancel().catch(()=>{});reader.releaseLock();}
}
/** POST /api/subjects/[id]/export. Whether the route subject is this
 * caller's own ordinary record is answered first (an opaque 404 otherwise,
 * invalid-request-v1.authorizationPrecedence), then the stated refusal, then
 * the request fields, the CSRF proof and the one-time operation nonce. */
export async function postSubjectExport(request:Request,subject:string,deps:SubjectExportHttpDependencies):Promise<Response>{
 try{
  const actor=await deps.actor();if(!actor)return unauthenticated();
  const url=new URL(request.url);
  if(request.method!=="POST"||url.origin!==deps.origin()||request.headers.get("origin")!==url.origin||request.headers.get("sec-fetch-site")!=="same-origin"
   ||request.headers.get("sec-fetch-mode")!=="cors")return forbidden();
  const id=subjectId(subject);if(!id)return notFound();
  const rpc=deps.rpc(),value=await capture(rpc,actor,id,request.signal);
  if(url.search||request.headers.get("content-type")?.split(";")[0].trim().toLowerCase()!=="application/json")return invalid();
  const body=bodySchema.safeParse(await readBody(request));if(!body.success)return invalid();
  const csrf=verifyAccountExportCsrf(request.headers.get("x-inherit-csrf"),{actor,originBinding:value.originBinding,
   authorityReceipt:value.authorityReceipt,operation:body.data.operation});if(!csrf)return forbidden();
  if(body.data.operation==="open-ready"){
   const cookie=readSubjectExportCookie(request,actor,id);if(!cookie)return notFound();
   const status=statusSchema.parse(await invoke(rpc,actor,id,"check",request.signal,{exportId:cookie.exportId,exportCookieHash:cookie.hash}));
   if(status.exportId!==cookie.exportId||status.status!=="ready")return notFound();
   const verified=verifyExportOperation(body.data.nonce,{...operationContext(id,value,csrf),operation:"open-ready",
    exportId:status.exportId,exportRevision:status.exportRevision});if(!verified)return notFound();
   if(!deps.delivery)return unavailable();
   const ready=await bounded(request.signal,current=>currentAccountExportReady({delivery:deps.delivery!,actor,
    exportId:cookie.exportId,exportCookieHash:cookie.hash,signal:current}));
   if(ready.authorityReceipt!==value.authorityReceipt)throw new RequestFailure();
   const secretBytes=randomBytes(32);let secret:string;
   try{secret=secretBytes.toString("base64url");}finally{secretBytes.fill(0);}
   const downloadHash=createHash("sha256").update(secret).digest("hex");
   const opened=z.object({downloadSessionId:uuid,expiresAt:z.iso.datetime({offset:true}),
    chunkBytes:z.literal(ACCOUNT_ARCHIVE_CHUNK_BYTES),sizeBytes:z.number().int().positive().safe(),sha256:hash}).strict()
    .parse(await invoke(rpc,actor,id,"open-ready",request.signal,{exportId:cookie.exportId,envelope:verified,
     downloadCookieHash:downloadHash,exportCookieHash:cookie.hash},csrf));
   if(opened.sizeBytes!==ready.sizeBytes||opened.sha256!==ready.sha256||Date.parse(opened.expiresAt)<=Date.now()
    ||Date.parse(opened.expiresAt)>Date.parse(ready.expiresAt)||Date.parse(opened.expiresAt)>Date.now()+3_600_000)throw new RequestFailure();
   const response=ownUploadJson(accountExportDownload.parse({session:opened.downloadSessionId,filename:ACCOUNT_ARCHIVE_FILENAME,
    sizeBytes:opened.sizeBytes,sha256:opened.sha256,chunkBytes:opened.chunkBytes,chunkCount:ready.segmentCount,
    chunkRoute:`/api/downloads/${opened.downloadSessionId}/chunks/{sequence}`}),200);
   response.headers.set("set-cookie",`__Host-inherit-download=${secret}; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=${Math.max(1,Math.floor((Date.parse(opened.expiresAt)-Date.now())/1000))}`);
   return response;
  }
  const envelope=verifyExportOperation(body.data.nonce,operationContext(id,value,csrf));if(!envelope)return notFound();
  if(!deps.generation)return unavailable();
  await bounded(request.signal,signal=>deps.generation!.assertReady(signal));
  const pendingCookie=createSubjectExportCookie(actor,id);
  const result=createSchema.parse(await invoke(rpc,actor,id,"create",request.signal,
   {envelope,exportCookieHash:pendingCookie.hash},csrf));
  if(result.authorityReceipt!==value.authorityReceipt||result.exportRevision!==1)throw new RequestFailure();
  const response=ownUploadJson({status:"preparing",exportId:result.exportId},202);
  response.headers.set("set-cookie",pendingCookie.header(result.exportId));return response;
 }catch(error){return errorResponse(error);}
}
/** GET /api/subjects/[id]/export: poll this record's own cookie-bound export.
 * No cookie is resource-not-found-v1; nothing is created or rotated. */
export async function pollSubjectExport(request:Request,subject:string,deps:SubjectExportHttpDependencies):Promise<Response>{
 try{
  const actor=await deps.actor();if(!actor)return unauthenticated();
  if(request.method!=="GET"||new URL(request.url).search||!(await hasEmptyRequestBody(request)))return invalid();
  const id=subjectId(subject);if(!id)return notFound();
  const cookie=readSubjectExportCookie(request,actor,id);if(!cookie)return notFound();
  const status=statusSchema.parse(await invoke(deps.rpc(),actor,id,"check",request.signal,{exportId:cookie.exportId,exportCookieHash:cookie.hash}));
  if(status.exportId!==cookie.exportId)throw new RequestFailure();
  if(status.status==="queued"||status.status==="building")return ownUploadJson({status:"preparing",exportId:status.exportId},202);
  if(status.status!=="ready")return notFound();
  if(!deps.delivery)return unavailable();
  const ready=await bounded(request.signal,current=>currentAccountExportReady({delivery:deps.delivery!,actor,
   exportId:cookie.exportId,exportCookieHash:cookie.hash,signal:current}));
  return ownUploadJson(publicAccountExportReady(ready),200);
 }catch(error){return errorResponse(error);}
}
