import "server-only";
import {z} from "zod";
import {LEGAL_AUDIT_SCHEMA_VERSION,legalAuditEventSchema} from "@/lib/export/legal-audit";
import {exportLegalAuditNote} from "@/copy/settings/data-export";
import {accountArchiveContextSchema} from "./bound-account-archive-worker";
import type {FuturePersonMemberFactory} from "./future-person-member-plan";

export const ORDINARY_SUBJECT_AUDIT_NOTE="These audit records do not identify the subject of each action. Your recorded account actions are in legal-audit.json. This does not mean that nothing happened to this record.";
export const ordinarySubjectAuditSchema=z.object({schema_version:z.literal(LEGAL_AUDIT_SCHEMA_VERSION),
 attribution:z.literal("unrecorded"),attribution_started_at:z.null(),note:z.literal(ORDINARY_SUBJECT_AUDIT_NOTE),
 events:z.tuple([])}).strict();
const auditContext=z.object({version:z.literal("account-archive-audit-v1"),authorityReceipt:z.string().regex(/^[a-f0-9]{64}$/u),
 attributionStartedAt:z.iso.datetime({offset:true}),eventCount:z.number().int().nonnegative().safe()}).strict();
const page=z.object({events:z.array(legalAuditEventSchema).max(500),nextAfterSeq:z.number().int().positive().safe().nullable()}).strict();
export type AccountAuditRpc=(name:"export_archive_account_audit_v1",args:{p_operation:"context"|"events"|"ordinary-subject";
 p_export_id:string;p_attempt_id:string;p_authority_receipt:string;p_subject_id:string|null;p_after_seq:number|null},
 signal:AbortSignal)=>PromiseLike<{data:unknown;error:unknown}>;
const unavailable=()=>new Error("account_archive_audit_unavailable"),encoder=new TextEncoder();
/** No authority is supplied by this projector. The distinct service-only SQL
 * door binds real consumed request/attempt/account/graph before and after each
 * read. One canonical account member contains each actual eligible actor event
 * once, including exact assigned bound-custody events. Ordinary subject members
 * explicitly describe absent historical targeting; they never copy that actor
 * ledger or infer that no action occurred. Assigned Future members stay exact. */
export async function prepareAccountArchiveAuditMembers(options:{reference:{exportId:string;attemptId:string;authorityReceipt:string};
 context:z.infer<typeof accountArchiveContextSchema>;rpc:AccountAuditRpc;signal:AbortSignal;
 check:(signal:AbortSignal)=>Promise<unknown>}){
 const context=accountArchiveContextSchema.parse(options.context),{reference}=options;
 if(context.targetKind!=="account"||context.targetId!==context.actor.accountId||context.authorityReceipt!==reference.authorityReceipt)throw unavailable();
 async function call(operation:"context"|"events"|"ordinary-subject",signal:AbortSignal,subject:string|null=null,after:number|null=null){
  await options.check(signal);if(signal.aborted||Date.now()>=Date.parse(context.deadline))throw unavailable();
  const controller=new AbortController(),combined=AbortSignal.any([signal,controller.signal]);
  const timer=setTimeout(()=>controller.abort(),Math.min(30_000,Date.parse(context.deadline)-Date.now()));timer.unref();let stop=()=>{};
  const canceled=new Promise<never>((_,reject)=>{stop=()=>reject(unavailable());combined.addEventListener("abort",stop,{once:true});});
  try{if(combined.aborted)throw unavailable();const response=await Promise.race([Promise.resolve(options.rpc("export_archive_account_audit_v1",{
   p_operation:operation,p_export_id:reference.exportId,p_attempt_id:reference.attemptId,p_authority_receipt:reference.authorityReceipt,
   p_subject_id:subject,p_after_seq:after},combined)),canceled]);
   if(combined.aborted||response.error!==null)throw unavailable();await options.check(signal);return response.data;
  }finally{clearTimeout(timer);combined.removeEventListener("abort",stop);controller.abort();}
 }
 const snapshot=auditContext.parse(await call("context",options.signal));
 if(snapshot.authorityReceipt!==reference.authorityReceipt)throw unavailable();
 const check=async(signal:AbortSignal)=>{const current=auditContext.parse(await call("context",signal));
  if(JSON.stringify(current)!==JSON.stringify(snapshot))throw unavailable();};
 const factories:FuturePersonMemberFactory[]=[];
 for(const partition of context.partitions.filter(part=>part.class==="ordinary")){
  const value=ordinarySubjectAuditSchema.parse(await call("ordinary-subject",options.signal,partition.subjectId));
  const bytes=encoder.encode(JSON.stringify(value)+"\n");
  factories.push({name:`subjects/${partition.subjectId}/audit-log.json`,rows:0,chunks:async function*(signal){
   await check(signal);const current=ordinarySubjectAuditSchema.parse(await call("ordinary-subject",signal,partition.subjectId));
   if(JSON.stringify(current)!==JSON.stringify(value))throw unavailable();yield bytes;await check(signal);
  }});
 }
 factories.push({name:"legal-audit.json",rows:snapshot.eventCount,chunks:async function*(signal){
  await check(signal);const note=exportLegalAuditNote(new Date(snapshot.attributionStartedAt).toLocaleDateString("en-GB",{
   day:"numeric",month:"long",year:"numeric",timeZone:"UTC"}));
  yield encoder.encode(JSON.stringify({schema_version:LEGAL_AUDIT_SCHEMA_VERSION,attribution_started_at:snapshot.attributionStartedAt,note}).slice(0,-1)+',"events":[');
  let after:number|null=null,count=0,comma=false;
  for(;;){const current=page.parse(await call("events",signal,null,after));
   for(const event of current.events){if(event.seq<=(after??0)||++count>snapshot.eventCount)throw unavailable();after=event.seq;
    yield encoder.encode((comma?",":"")+JSON.stringify(event));comma=true;}
   if(current.nextAfterSeq===null){if(count!==snapshot.eventCount)throw unavailable();break;}
   if(current.events.length!==500||current.nextAfterSeq!==after)throw unavailable();
  }
  await check(signal);yield encoder.encode("]}\n");
 }});
 return factories;
}
