import "server-only";
import {z} from "zod";
import {accountArchiveContextSchema} from "./bound-account-archive-worker";
import {ownExportSnapshotSchema} from "./own-subject-content";
const uuid=z.uuid(),positive=z.number().int().positive().safe(),count=z.number().int().nonnegative().safe();
const date=z.iso.datetime({offset:true}),hash=z.string().regex(/^[a-f0-9]{64}$/u),country=z.string().regex(/^[A-Z]{2}$/u);
const counts=z.object({profileCount:z.literal(1),purposeGrantCount:count,fileCount:count}).strict();
const profile=z.object({id:uuid,date_of_birth:z.iso.date().nullable(),jurisdiction_code:country.nullable(),
 jurisdiction_subdivision:z.string().nullable(),jurisdiction_revision:positive,jurisdiction_declared_at:date.nullable(),
 jurisdiction_attestation_version:positive.nullable(),jurisdiction_attestation_sha256:hash.nullable()}).strict();
const grant=z.object({grant_id:uuid,grant_revision:positive,target_kind:z.literal("subject"),target_id:uuid,purpose:z.string(),
 artifact_key:z.string(),artifact_version:positive,artifact_body_sha256:hash,signature_id:uuid,signer_principal_id:uuid,
 data_subject_principal_id:uuid,subject_binding_revision:positive,jurisdiction_code:country,jurisdiction_revision:positive,
 granted_at:date,expires_at:date.nullable(),revoked_at:date.nullable(),revocation_reason:z.string().nullable()}).strict();
const fileCount=z.object({fileId:uuid,subjectId:uuid,revision:positive,variantCount:count,observedCallCount:count}).strict();
export type AccountMetadataOperation="context"|"profile"|"purpose-grants"|"legacy-counts";
export type AccountMetadataRpc=(name:"export_archive_account_metadata_v1",args:{p_operation:AccountMetadataOperation;
 p_export_id:string;p_attempt_id:string;p_authority_receipt:string;p_after_id:string|null},signal:AbortSignal)
 =>PromiseLike<{data:unknown;error:unknown}>;
const unavailable=()=>new Error("account_archive_metadata_unavailable");
/** Complete actual metadata pages under the distinct consumed-request worker
 * door. Counters/descriptors remain internal; the archive projector must list
 * its exported fields explicitly. This supplies no JWT or source authority. */
export async function prepareAccountArchiveMetadata(options:{reference:{exportId:string;attemptId:string;authorityReceipt:string};
 context:z.infer<typeof accountArchiveContextSchema>;files:z.infer<typeof ownExportSnapshotSchema>[];
 rpc:AccountMetadataRpc;signal:AbortSignal;check:(signal:AbortSignal)=>Promise<unknown>}){
 const context=accountArchiveContextSchema.parse(options.context),files=options.files.map(file=>ownExportSnapshotSchema.parse(file));
 if(context.targetKind!=="account"||context.targetId!==context.actor.accountId
  ||context.authorityReceipt!==options.reference.authorityReceipt)throw unavailable();
 const subjects=new Set(context.partitions.map(part=>part.subjectId));
 const expected=new Map(context.partitions.filter(part=>part.class==="ordinary").flatMap(part=>part.fileIds.map(id=>[id,part.subjectId] as const)));
 if(files.length!==expected.size||new Set(files.map(file=>file.file.id)).size!==expected.size
  ||files.some(file=>expected.get(file.file.id)!==file.file.subject_id||file.binding.accountId!==context.actor.accountId
   ||file.binding.sessionId!==context.actor.sessionId))throw unavailable();
 async function call<T>(operation:AccountMetadataOperation,schema:z.ZodType<T>,maximum:number,signal:AbortSignal,after:string|null=null){
  await options.check(signal);if(signal.aborted||Date.now()>=Date.parse(context.deadline))throw unavailable();
  const controller=new AbortController(),combined=AbortSignal.any([signal,controller.signal]);let stop=()=>{};
  const timer=setTimeout(()=>controller.abort(),Math.min(30_000,Date.parse(context.deadline)-Date.now()));timer.unref();
  const canceled=new Promise<never>((_,reject)=>{stop=()=>reject(unavailable());combined.addEventListener("abort",stop,{once:true});});
  try{if(combined.aborted)throw unavailable();const response=await Promise.race([Promise.resolve(options.rpc("export_archive_account_metadata_v1",{
   p_operation:operation,p_export_id:options.reference.exportId,p_attempt_id:options.reference.attemptId,
   p_authority_receipt:options.reference.authorityReceipt,p_after_id:after},combined)),canceled]);
   if(combined.aborted||response.error!==null)throw unavailable();
   const value=z.object({version:z.literal("account-archive-metadata-v1"),operation:z.literal(operation),rows:z.array(schema).max(maximum)}).strict().parse(response.data);
   await options.check(signal);return value.rows;
  }finally{clearTimeout(timer);combined.removeEventListener("abort",stop);controller.abort();}
 }
 const snapshot=await call("context",counts,1,options.signal);
 if(snapshot.length!==1||snapshot[0].fileCount!==expected.size)throw unavailable();
 const check=async(signal:AbortSignal)=>{const current=await call("context",counts,1,signal);
  if(JSON.stringify(current)!==JSON.stringify(snapshot))throw unavailable();};
 const profiles=await call("profile",profile,1,options.signal);
 if(profiles.length!==1||profiles[0].id!==context.actor.accountId)throw unavailable();
 const purposeGrants:z.infer<typeof grant>[]=[],fileCounts:z.infer<typeof fileCount>[]=[];
 let after:string|null=null;
 for(;;){const page:z.infer<typeof grant>[]=await call("purpose-grants",grant,500,options.signal,after);await check(options.signal);if(!page.length)break;
  for(const row of page){if(row.grant_id<=(after??"")||!subjects.has(row.target_id)||purposeGrants.length>=snapshot[0].purposeGrantCount)throw unavailable();
   after=row.grant_id;purposeGrants.push(row);}
 }
 if(purposeGrants.length!==snapshot[0].purposeGrantCount)throw unavailable();
 after=null;
 for(;;){const page:z.infer<typeof fileCount>[]=await call("legacy-counts",fileCount,100,options.signal,after);await check(options.signal);if(!page.length)break;
  for(const row of page){if(row.fileId<=(after??"")||expected.get(row.fileId)!==row.subjectId||fileCounts.length>=expected.size)throw unavailable();
   after=row.fileId;fileCounts.push(row);}
 }
 if(fileCounts.length!==expected.size||new Set(fileCounts.map(row=>row.fileId)).size!==expected.size)throw unavailable();
 const byId=new Map(fileCounts.map(row=>[row.fileId,row]));
 for(const source of files){const rows=byId.get(source.file.id)!;
  if(source.preparedSource){if(rows.variantCount!==0||rows.observedCallCount!==0)throw unavailable();}
  else if(source.normalized){if(source.file.variant_count===null||rows.variantCount!==source.file.variant_count)throw unavailable();}
  else if(rows.variantCount!==0||rows.observedCallCount!==0)throw unavailable();
 }
 await check(options.signal);
 return {profiles,purposeGrants,fileCounts,check};
}
