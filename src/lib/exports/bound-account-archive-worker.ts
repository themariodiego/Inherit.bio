import "server-only";
import {z} from "zod";
import {buildClaimantArchive,type ClaimantMemberRpc} from "./future-person-archive-worker";
import {prepareBoundAccountArchiveSource,type BoundArchiveSourceRpc} from "./bound-account-source";
import {boundSourceManifestSchema} from "@/lib/future-person/bound-source-reader";
import {boundClaimantAuditMember} from "./bound-claimant-legal-audit";
const uuid=z.uuid(),hash=z.string().regex(/^[a-f0-9]{64}$/u),date=z.iso.datetime({offset:true});
export const accountArchiveContextSchema=z.object({version:z.literal("account-archive-members-v1"),
 targetKind:z.enum(["account","subject"]),targetId:uuid,authorityReceipt:hash,deadline:date,capturedAt:date,
 actor:z.object({accountId:uuid,sessionId:uuid}).strict(),fileCount:z.number().int().nonnegative().safe(),
 partitions:z.array(z.object({subjectId:uuid,class:z.enum(["ordinary","claimed-bound"]),
  fileCount:z.number().int().nonnegative().safe(),fileIds:z.array(uuid)}).strict()).min(1)}).strict()
 .refine(value=>new Set(value.partitions.map(row=>row.subjectId)).size===value.partitions.length)
 .refine(value=>value.partitions.every(row=>row.fileIds.length===row.fileCount&&new Set(row.fileIds).size===row.fileCount))
 .refine(value=>value.partitions.reduce((n,row)=>n+row.fileCount,0)===value.fileCount)
 .refine(value=>new Set(value.partitions.flatMap(row=>row.fileIds)).size===value.fileCount);
export type AccountMemberRpc=(name:"export_archive_account_members_v1",args:{p_operation:string;p_export_id:string;
 p_attempt_id:string;p_authority_receipt:string;p_subject_id:string|null;p_after_id:string|null},signal:AbortSignal)
 =>PromiseLike<{data:unknown;error:unknown}>;
export type AccountBoundSourceRpc=(name:"export_archive_account_bound_source_v1",args:Parameters<BoundArchiveSourceRpc>[1]&
 {p_subject_id:string},signal:AbortSignal)=>PromiseLike<{data:unknown;error:unknown}>;
const unavailable=()=>new Error("account_archive_unavailable");
/** Complete actual bound-subject partition executor for an account-origin job.
 * The whole-account assembler must additionally consume every server-selected
 * ordinary/non-self/cohort partition; this function never silently accepts an
 * account target or incomplete partition set. It generates an unpublished ZIP
 * with all historical members AND every actual current canonical part, under
 * genuine consumed-request, source and writing-attempt authority. No human JWT,
 * analytical grant, READY transition or delivery capability is introduced. */
export async function buildBoundAccountArchive(options:Omit<Parameters<typeof buildClaimantArchive>[0],
 "memberRpc"|"auditMemberSchema"|"sourceMembers">&{memberRpc:AccountMemberRpc;sourceRpc:AccountBoundSourceRpc}){
 let context:z.infer<typeof accountArchiveContextSchema>|undefined,attempt:string|undefined;
 async function call(operation:string,currentAttempt:string,subject:string|null,after:string|null,signal:AbortSignal){
  if(signal.aborted||Date.now()>=Date.parse(options.job.deadline))throw unavailable();
  const timeout=new AbortController(),combined=AbortSignal.any([signal,timeout.signal]);
  const timer=setTimeout(()=>timeout.abort(),Math.min(30_000,Date.parse(options.job.deadline)-Date.now()));timer.unref();let abort=()=>{};
  const stopped=new Promise<never>((_,reject)=>{abort=()=>reject(unavailable());combined.addEventListener("abort",abort,{once:true});});
  try{if(combined.aborted)throw unavailable();const response=await Promise.race([Promise.resolve(options.memberRpc("export_archive_account_members_v1",{
   p_operation:operation,p_export_id:options.job.exportId,p_attempt_id:currentAttempt,p_authority_receipt:options.job.authorityReceipt,
   p_subject_id:subject,p_after_id:after},combined)),stopped]);
   if(combined.aborted||response.error!==null)throw unavailable();return response.data;
  }finally{clearTimeout(timer);combined.removeEventListener("abort",abort);timeout.abort();}
 }
 async function checkContext(currentAttempt:string,signal:AbortSignal){
  const parsed=accountArchiveContextSchema.safeParse(await call("context",currentAttempt,null,null,signal));
  if(!parsed.success||parsed.data.authorityReceipt!==options.job.authorityReceipt||parsed.data.deadline!==options.job.deadline
   ||parsed.data.targetKind!=="subject"||parsed.data.partitions.length!==1||parsed.data.fileCount!==1
   ||parsed.data.partitions[0].class!=="claimed-bound"||parsed.data.partitions[0].subjectId!==parsed.data.targetId
   ||(attempt&&attempt!==currentAttempt)||(context&&JSON.stringify(context)!==JSON.stringify(parsed.data)))throw unavailable();
  attempt=currentAttempt;context??=parsed.data;return context;
 }
 const memberRpc:ClaimantMemberRpc=async(_name,args,signal)=>{
  const scope=await checkContext(args.p_attempt_id,signal);
  const data=await call(args.p_operation==="context"?"bound-context":args.p_operation,args.p_attempt_id,scope.targetId,args.p_after_id,signal);
  await checkContext(args.p_attempt_id,signal);return {data,error:null};
 };
 return buildClaimantArchive({...options,memberRpc,auditMemberSchema:boundClaimantAuditMember,
  sourceMembers:async(signal,snapshot)=>{
   if(!attempt||!context)throw unavailable();const scope=await checkContext(attempt,signal);
   if(snapshot.source.subjectId!==scope.targetId||snapshot.source.fileId!==scope.partitions[0].fileIds[0])throw unavailable();
   const sourceRpc:BoundArchiveSourceRpc=async(_name,args,current)=>{
    const response=await options.sourceRpc("export_archive_account_bound_source_v1",{...args,p_subject_id:scope.targetId},current);
    if(response.error!==null)return response;
    const parsed=z.object({version:z.literal("bound-account-archive-source-v1"),exportId:uuid,attemptId:uuid,authorityReceipt:hash,
      source:boundSourceManifestSchema}).strict().safeParse(response.data);
    if(!parsed.success||parsed.data.source.actor.accountId!==scope.actor.accountId||parsed.data.source.actor.sessionId!==scope.actor.sessionId
     ||parsed.data.source.subjectId!==scope.targetId||parsed.data.source.fileId!==snapshot.source.fileId)throw unavailable();return response;
   };
   const source=await prepareBoundAccountArchiveSource({exportId:options.job.exportId,attemptId:attempt,
    authorityReceipt:options.job.authorityReceipt},sourceRpc,options.signal,signal);
   await checkContext(attempt,signal);
   if(source.provenance.subjectId!==snapshot.source.subjectId||source.provenance.fileId!==snapshot.source.fileId
    ||source.provenance.sourceSha256!==snapshot.source.sourceSha256||source.provenance.membershipSha256!==snapshot.source.membershipSha256
    ||source.provenance.publicationRevision!==snapshot.source.publicationRevision)throw unavailable();return source;
  }});
}
