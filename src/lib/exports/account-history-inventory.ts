import "server-only";
import {createHash} from "node:crypto";
import {z} from "zod";
import {accountArchiveContextSchema} from "./bound-account-archive-worker";
import {consentRecipientSchema} from "@/lib/export/consent-recipient";

export const ACCOUNT_HISTORY_KINDS=["legacy-consents","subjects","demographics","principals","bindings",
 "account-consents","signatures","attestations","recipient-grants"] as const;
export type AccountHistoryKind=(typeof ACCOUNT_HISTORY_KINDS)[number];
const uuid=z.uuid(),revision=z.number().int().positive().safe(),count=z.number().int().nonnegative().safe();
const hash=z.string().regex(/^[a-f0-9]{64}$/u),date=z.iso.datetime({offset:true}),text=z.string(),strings=z.array(text);
export const accountHistoryRowSchemas={
 "legacy-consents":z.object({id:uuid,provider_key:text,data_classes:strings,granted_at:date,revoked_at:date.nullable()}).strict(),
 subjects:z.object({id:uuid,subject_class:z.enum(["self","other_adult","embryo"]),upload_class:text,
  display_label:text,lifecycle:text,subject_binding_revision:revision,lifecycle_revision:revision,
  created_at:date,updated_at:date,portrait_acknowledged_at:date.nullable(),independent_login_at:date.nullable()}).strict(),
 demographics:z.object({subject_id:uuid,date_of_birth:z.iso.date().nullable(),chromosomal_sex:text.nullable(),
  demographics_revision:revision,updated_at:date}).strict(),
 principals:z.object({id:uuid,subject_id:uuid.nullable(),principal_kind:text,principal_revision:revision,status:text,created_at:date}).strict(),
 bindings:z.object({id:uuid,subject_id:uuid,subject_principal_id:uuid,account_principal_id:uuid,binding_kind:text,
  binding_revision:revision,status:text,bound_at:date,ended_at:date.nullable()}).strict(),
 "account-consents":z.object({id:uuid,signature_id:uuid,subject_id:uuid.nullable(),cohort_id:uuid.nullable(),
  consent_type:text,scope:strings,provider_key:text.nullable(),grant_revision:revision,granted_at:date,
  expires_at:date.nullable(),revoked_at:date.nullable(),revocation_reason:text.nullable(),copilot_recipient:consentRecipientSchema.nullable()}).strict(),
 signatures:z.object({id:uuid,artifact_key:text,artifact_version:revision,artifact_body_sha256:hash,signer_principal_id:uuid,
  target_kind:text,target_id:uuid,purpose:text.nullable(),statement_keys:strings,jurisdiction_code:text,jurisdiction_revision:revision,
  subject_binding_revision:revision.nullable(),signed_at:date}).strict(),
 attestations:z.object({id:uuid,signature_id:uuid,principal_id:uuid,target_kind:text,target_id:uuid,kind:text,
  statement_keys:strings,affirmed:z.literal(true),attestation_revision:revision,affirmed_at:date}).strict(),
 "recipient-grants":z.object({id:uuid,recipient_principal_id:uuid,provider_id:text,purpose:text,artifact_key:text,
  artifact_version:revision,grant_revision:revision,model_recipient_revision:revision,status:text,created_at:date,ended_at:date.nullable()}).strict(),
} as const;
const inventory=z.object({version:z.literal("account-history-inventory-v1"),authorityReceipt:hash,
 classes:z.array(z.object({kind:z.enum(ACCOUNT_HISTORY_KINDS),rows:count,membershipSha256:hash}).strict())
  .length(ACCOUNT_HISTORY_KINDS.length)}).strict()
 .refine(value=>new Set(value.classes.map(row=>row.kind)).size===ACCOUNT_HISTORY_KINDS.length);
const page=z.object({version:z.literal("account-history-page-v1"),kind:z.enum(ACCOUNT_HISTORY_KINDS),
 rows:z.array(z.object({id:uuid,rowText:text}).strict()).max(500),nextAfterId:uuid.nullable()}).strict();
export type AccountInventoryRpc=(name:"export_archive_account_inventory_v1",args:{p_operation:"context"|"history";
 p_export_id:string;p_attempt_id:string;p_authority_receipt:string;p_kind:AccountHistoryKind|null;p_after_id:string|null},
 signal:AbortSignal)=>PromiseLike<{data:unknown;error:unknown}>;
const unavailable=()=>new Error("account_archive_inventory_unavailable");

/** This is a consumed-request source reader, not an authority or a completed
 * archive. Each independent class receipt pins its complete count, ordered
 * identity and exact named source projection. Rows remain streaming; a missing
 * final row or changed same-count payload refuses before member completion.
 * Canonical source text, receipt hashes and actor fields are internal only. */
export async function prepareAccountHistoryInventory(options:{reference:{exportId:string;attemptId:string;authorityReceipt:string};
 context:z.infer<typeof accountArchiveContextSchema>;rpc:AccountInventoryRpc;signal:AbortSignal;
 check:(signal:AbortSignal)=>Promise<unknown>}){
 const context=accountArchiveContextSchema.parse(options.context),subjects=new Set(context.partitions.map(row=>row.subjectId));
 if(context.targetKind!=="account"||context.targetId!==context.actor.accountId
  ||context.authorityReceipt!==options.reference.authorityReceipt)throw unavailable();
 async function call(operation:"context"|"history",signal:AbortSignal,kind:AccountHistoryKind|null=null,after:string|null=null){
  await options.check(signal);if(signal.aborted||Date.now()>=Date.parse(context.deadline))throw unavailable();
  const stop=new AbortController(),current=AbortSignal.any([signal,stop.signal]);let abort=()=>{};
  const timer=setTimeout(()=>stop.abort(),Math.min(30_000,Date.parse(context.deadline)-Date.now()));timer.unref();
  const stopped=new Promise<never>((_,reject)=>{abort=()=>reject(unavailable());current.addEventListener("abort",abort,{once:true});});
  try{if(current.aborted)throw unavailable();const reply=await Promise.race([Promise.resolve(options.rpc("export_archive_account_inventory_v1",{
   p_operation:operation,p_export_id:options.reference.exportId,p_attempt_id:options.reference.attemptId,
   p_authority_receipt:options.reference.authorityReceipt,p_kind:kind,p_after_id:after},current)),stopped]);
   if(current.aborted||reply.error!==null)throw unavailable();await options.check(signal);return reply.data;
  }finally{clearTimeout(timer);current.removeEventListener("abort",abort);stop.abort();}
 }
 const captured=inventory.parse(await call("context",options.signal));
 if(captured.authorityReceipt!==options.reference.authorityReceipt)throw unavailable();
 const check=async(signal:AbortSignal)=>{const current=inventory.parse(await call("context",signal));
  if(JSON.stringify(current)!==JSON.stringify(captured))throw unavailable();};
 async function* records<K extends AccountHistoryKind>(kind:K,signal:AbortSignal):AsyncGenerator<z.infer<(typeof accountHistoryRowSchemas)[K]>>{
  if(!ACCOUNT_HISTORY_KINDS.includes(kind))throw unavailable();await check(signal);
  const expected=captured.classes.find(row=>row.kind===kind)!;
  let digest=createHash("sha256").update(`account-history-members-v1|${kind}`).digest(),after:string|null=null,n=0;
  for(;;){const result:z.infer<typeof page>=page.parse(await call("history",signal,kind,after));
   if(result.kind!==kind||result.nextAfterId!==(result.rows.length===500?result.rows.at(-1)!.id:null))throw unavailable();
   for(const value of result.rows){if(signal.aborted||Date.now()>=Date.parse(context.deadline)
    ||value.id<=(after??"")||++n>expected.rows)throw unavailable();
    const parsed=accountHistoryRowSchemas[kind].parse(JSON.parse(value.rowText));
    const id="id" in parsed?parsed.id:parsed.subject_id;
    if(id!==value.id||((kind==="subjects"||kind==="demographics")&&!subjects.has(id)))throw unavailable();
    digest=createHash("sha256").update(digest).update(`${value.id}:${value.rowText}\n`).digest();after=value.id;
    yield parsed as z.infer<(typeof accountHistoryRowSchemas)[K]>;
   }
   if(result.nextAfterId===null)break;
  }
  if(n!==expected.rows||digest.toString("hex")!==expected.membershipSha256)throw unavailable();await check(signal);
 }
 return {inventory:captured,records,check};
}
