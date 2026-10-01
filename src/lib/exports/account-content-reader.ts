import "server-only";
import {z} from "zod";
import {accountArchiveContextSchema,type AccountMemberRpc} from "./bound-account-archive-worker";
import {ownExportSnapshotSchema,ownSubjectExportContent,type OwnExportRpc,type OwnExportSnapshot} from "./own-subject-content";
const unavailable=()=>new Error("account_archive_content_unavailable");
export type AccountContentOperation="history"|"chats"|"chat-messages"|"check"|"variants"|"observed"|"reports"|"prs"|"ancestry";
export type AccountContentRpc=(name:"export_archive_account_content_v1",args:{p_operation:AccountContentOperation;
 p_export_id:string;p_attempt_id:string;p_authority_receipt:string;p_payload:Record<string,unknown>},signal:AbortSignal)
 =>PromiseLike<{data:unknown;error:unknown}>;
/** Real worker composition: account/session and exact source membership come
 * only from the consumed durable request, never a caller JWT or uploader key.
 * No source is read until the complete current context and exhaustive ordinary
 * file set match. Every delegated page still uses both the same writing attempt
 * and the original exact per-file source/current purpose guard. Unsupported
 * nonself/cohort/joint graphs remain a whole-request SQL refusal. */
export async function createAccountContentReader(options:{reference:{exportId:string;attemptId:string;authorityReceipt:string};
 deadline:string;memberRpc:AccountMemberRpc;contentRpc:AccountContentRpc;signal:AbortSignal;
 check:(signal:AbortSignal)=>Promise<unknown>}){
 let captured:z.infer<typeof accountArchiveContextSchema>|undefined;
 async function wait<T>(signal:AbortSignal,work:(signal:AbortSignal)=>PromiseLike<T>):Promise<T>{
  await options.check(signal);if(signal.aborted||Date.now()>=Date.parse(options.deadline))throw unavailable();
  const controller=new AbortController(),combined=AbortSignal.any([signal,controller.signal]);let interrupt=()=>{};
  const timer=setTimeout(()=>controller.abort(),Math.min(30_000,Date.parse(options.deadline)-Date.now()));timer.unref();
  const canceled=new Promise<never>((_,reject)=>{interrupt=()=>reject(unavailable());combined.addEventListener("abort",interrupt,{once:true});});
  try{if(combined.aborted)throw unavailable();const result=await Promise.race([Promise.resolve(work(combined)),canceled]);
   if(combined.aborted)throw unavailable();await options.check(signal);return result;
  }finally{clearTimeout(timer);combined.removeEventListener("abort",interrupt);controller.abort();}
 }
 async function call(operation:string,after:string|null,signal:AbortSignal){
  const result=await wait(signal,current=>options.memberRpc("export_archive_account_members_v1",{
   p_operation:operation,p_export_id:options.reference.exportId,p_attempt_id:options.reference.attemptId,
   p_authority_receipt:options.reference.authorityReceipt,p_subject_id:null,p_after_id:after},current));
  if(result.error!==null)throw unavailable();return result.data;
 }
 async function context(signal:AbortSignal){
  const parsed=accountArchiveContextSchema.parse(await call("context",null,signal));
  if(parsed.targetKind!=="account"||parsed.targetId!==parsed.actor.accountId||parsed.authorityReceipt!==options.reference.authorityReceipt
   ||parsed.deadline!==options.deadline||(captured&&JSON.stringify(parsed)!==JSON.stringify(captured)))throw unavailable();
  captured??=parsed;return parsed;
 }
 const scope=await context(options.signal),files:OwnExportSnapshot[]=[];
 const expected=new Map(scope.partitions.filter(part=>part.class==="ordinary").flatMap(part=>part.fileIds.map(file=>[file,part.subjectId] as const)));
 let after:string|null=null;
 for(;;){const page=z.array(ownExportSnapshotSchema).max(100).parse(await call("ordinary-files",after,options.signal));
  await context(options.signal);if(!page.length)break;
  for(const file of page){if(file.file.id<=(after??"")||expected.get(file.file.id)!==file.file.subject_id
   ||file.binding.accountId!==scope.actor.accountId||file.binding.sessionId!==scope.actor.sessionId)throw unavailable();
   after=file.file.id;files.push(file);}
 }
 if(files.length!==expected.size||new Set(files.map(file=>file.file.id)).size!==expected.size)throw unavailable();
 const byId=new Map(files.map(file=>[file.file.id,file]));
 async function content(operation:AccountContentOperation,payload:Record<string,unknown>,signal:AbortSignal){
  await context(signal);const reply=await wait(signal,current=>options.contentRpc("export_archive_account_content_v1",{
   p_operation:operation,p_export_id:options.reference.exportId,p_attempt_id:options.reference.attemptId,
   p_authority_receipt:options.reference.authorityReceipt,p_payload:payload},current));
  if(reply.error!==null)throw unavailable();await context(signal);return reply.data;
 }
 const rpc:OwnExportRpc=async(_name,args)=>{
  if(args.p_operation==="list"||args.p_account_id!==scope.actor.accountId||args.p_session_id!==scope.actor.sessionId
   ||args.p_file_id===null||args.p_snapshot===null||!byId.has(args.p_file_id)
   ||JSON.stringify(ownExportSnapshotSchema.parse(args.p_snapshot))!==JSON.stringify(byId.get(args.p_file_id)))throw unavailable();
  return {data:await content(args.p_operation,{fileId:args.p_file_id,snapshot:args.p_snapshot,
   ...(args.p_operation!=="check"?{offset:args.p_offset}:{})},options.signal),error:null};
 };
 const active=()=>{if(options.signal.aborted||Date.now()>=Date.parse(options.deadline))throw unavailable();};
 return {context:scope,files,content,check:context,
  own:ownSubjectExportContent(rpc,scope.actor,active,{signal:options.signal})};
}
