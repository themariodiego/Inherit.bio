import "server-only";
import {accountOwnStatementCapture} from "./requester-statement-account-members";
import {requesterStatementsOpen} from "@/lib/future-person/requester-statement";
import {createHash} from "node:crypto";
import {z} from "zod";
import {accountArchiveContextSchema} from "./bound-account-archive-worker";
import {ACCOUNT_GRAPH_CLASSES,type AccountGraphClass} from "./account-graph-projection";
import {futurePersonExportSnapshot} from "./future-person-content";

export const ACCOUNT_CLASS_KINDS=["ancestry_regions","appeal_intakes","attestation_contradictions","correction_requests",
 "directional_grants","embryo_basis_bindings","embryo_cohorts","embryo_disposition_confirmations","embryo_disposition_proposals",
 "embryo_donor_attributions","embryo_figures","embryo_participant_sets","embryo_qc","embryo_scores","embryo_variants","embryos",
 "family_pairs","family_sharing_pauses","family_sharing_stops","future_person_claim_objections","future_person_claimant_principals",
 "future_person_claims","portrait_results","report_artifacts","subject_control_refusal_authorities","subject_relationships","suppressions","other_adult_held_uploads","path_b_report_bindings"] as const;
export type AccountClassKind=(typeof ACCOUNT_CLASS_KINDS)[number];
const uuid=z.uuid(),text=z.string(),date=z.iso.datetime({offset:true}),revision=z.number().int().positive().safe();
const count=z.number().int().nonnegative().safe(),hash=z.string().regex(/^[a-f0-9]{64}$/u);
export const accountClassRowSchemas={
 attestation_contradictions:z.object({id:uuid,contradiction_code:text,lifecycle_revision:revision,recorded_at:date,resolved_at:date.nullable()}).strict(),
 directional_grants:z.object({grant_id:uuid,grant_revision:revision,relationship_or_pair_revision:revision,
  direction:z.enum(["subject_to_recipient","a_to_b","b_to_a","self"]),status:z.enum(["current","superseded","revoked","expired"]),created_at:date,ended_at:date.nullable()}).strict(),
 family_sharing_pauses:z.object({id:uuid,paused_by_requester:z.boolean(),ended_by_requester:z.boolean().nullable(),
  paused_at:date,ended_at:date.nullable(),end_reason:z.enum(["resumed","stopped"]).nullable()}).strict(),
 family_sharing_stops:z.object({id:uuid,stopped_by_requester:z.boolean(),ended_at:date}).strict(),
 future_person_claim_objections:z.object({id:uuid,claim_id:uuid,objection_revision:revision,reason_code:text,
  status:z.enum(["submitted","upheld","overruled","withdrawn","expired"]),submitted_at:date,decided_at:date.nullable()}).strict(),
 future_person_claimant_principals:z.object({id:uuid,claim_id:uuid,claimant_revision:revision,
  status:z.enum(["current","superseded","revoked"]),created_at:date}).strict(),
 future_person_claims:z.object({id:uuid,claim_method:z.enum(["record_key","keyless_documentary"]),claim_revision:revision,claimant_revision:revision,
  status:z.enum(["submitted","reviewing","owner_notice","objected","approved","refused","withdrawn","expired"]),submitted_at:date,decided_at:date.nullable()}).strict(),
 subject_control_refusal_authorities:z.object({id:uuid,authority_revision:revision,status:z.enum(["current","revoked","expired"]),created_at:date}).strict(),
 subject_relationships:z.object({id:uuid,relationship_kind:z.enum(["self","uploader","adult_controller","family_member","genetic_parent","co_parent","future_person_claimant"]),
  relationship_revision:revision,status:z.enum(["pending","current","superseded","revoked"]),created_at:date,ended_at:date.nullable()}).strict(),
 suppressions:z.object({id:uuid,condition_id:text,reason_code:text,suppression_revision:revision,active_from:date,ended_at:date.nullable()}).strict(),
} as const;
export type AccountProjectedClass=keyof typeof accountClassRowSchemas;
const scienceKinds=["embryo_figures","embryo_qc","embryo_scores","embryo_variants","embryos","report_artifacts"] as const;
type ScienceKind=(typeof scienceKinds)[number];
function mode(kind:AccountClassKind){return kind in accountClassRowSchemas?"metadata":(scienceKinds as readonly string[]).includes(kind)?"claimed-bound":"unsupported";}
const entry=z.object({kind:z.enum(ACCOUNT_CLASS_KINDS),mode:z.enum(["metadata","claimed-bound","unsupported","graph","path-b-results","excluded","requester-statements"]),rows:count,membershipSha256:hash,
 partitions:z.array(z.object({subjectId:uuid,rows:count}).strict())}).strict();
const inventory=z.object({version:z.literal("account-class-inventory-v1"),authorityReceipt:hash,classes:z.array(entry).length(ACCOUNT_CLASS_KINDS.length),
 boundSnapshots:z.array(futurePersonExportSnapshot),ownStatements:accountOwnStatementCapture.optional()}).strict()
 .refine(v=>new Set(v.classes.map(e=>e.kind)).size===ACCOUNT_CLASS_KINDS.length)
 .refine(v=>v.classes.every(e=>(e.mode===mode(e.kind)||e.mode==="graph"&&(ACCOUNT_GRAPH_CLASSES as readonly string[]).includes(e.kind)
  ||e.mode==="requester-statements"&&["correction_requests","appeal_intakes"].includes(e.kind)&&(e.rows===0||requesterStatementsOpen())&&v.ownStatements!==undefined
  ||e.mode==="path-b-results"&&e.kind==="path_b_report_bindings"||e.mode==="excluded"&&e.kind==="other_adult_held_uploads")&&new Set(e.partitions.map(p=>p.subjectId)).size===e.partitions.length));
const page=z.object({version:z.literal("account-class-page-v1"),kind:z.enum(ACCOUNT_CLASS_KINDS),
 rows:z.array(z.object({id:uuid,subjectId:uuid.nullable(),rowText:text.max(8192)}).strict()).max(500),nextAfterId:uuid.nullable()}).strict();
export type AccountClassRpc=(name:"export_archive_account_classes_v1",args:{p_operation:"context"|"metadata";
 p_export_id:string;p_attempt_id:string;p_authority_receipt:string;p_kind:AccountClassKind|null;p_after_id:string|null},signal:AbortSignal)
 =>PromiseLike<{data:unknown;error:unknown}>;
const unavailable=()=>new Error("account_archive_class_unavailable");
/** Complete class presence is derived by SQL from the real consumed actor and
 * exhaustive partition set. A nonempty unproved producer is a whole refusal.
 * Metadata is named/redacted, paged and independently count/identity/content
 * checked. Bound scientific classes require every actual captured partition;
 * their immutable source and complete members remain the existing reader's
 * responsibility. This door supplies neither human nor source authority. */
export async function prepareAccountClassInventory(options:{reference:{exportId:string;attemptId:string;authorityReceipt:string};
 context:z.infer<typeof accountArchiveContextSchema>;rpc:AccountClassRpc;signal:AbortSignal;
 check:(signal:AbortSignal)=>Promise<unknown>}){
 const context=accountArchiveContextSchema.parse(options.context),subjects=new Set(context.partitions.map(p=>p.subjectId));
 if(context.targetKind!=="account"||context.targetId!==context.actor.accountId||context.authorityReceipt!==options.reference.authorityReceipt)throw unavailable();
 async function bounded<T>(signal:AbortSignal,operation:(current:AbortSignal)=>PromiseLike<T>){
  if(signal.aborted||Date.now()>=Date.parse(context.deadline))throw unavailable();
  const controller=new AbortController(),current=AbortSignal.any([signal,controller.signal]);let stop=()=>{};
  const timer=setTimeout(()=>controller.abort(),Math.min(30_000,Date.parse(context.deadline)-Date.now()));timer.unref();
  const canceled=new Promise<never>((_,reject)=>{stop=()=>reject(unavailable());current.addEventListener("abort",stop,{once:true});});
  try{if(current.aborted)throw unavailable();const result=await Promise.race([Promise.resolve().then(()=>operation(current)),canceled]);
   if(current.aborted||Date.now()>=Date.parse(context.deadline))throw unavailable();return result;
  }finally{clearTimeout(timer);current.removeEventListener("abort",stop);controller.abort();}
 }
 async function call(operation:"context"|"metadata",signal:AbortSignal,kind:AccountClassKind|null=null,after:string|null=null){
  await bounded(signal,current=>options.check(current));
  const result=await bounded(signal,current=>options.rpc("export_archive_account_classes_v1",{
   p_operation:operation,p_export_id:options.reference.exportId,p_attempt_id:options.reference.attemptId,p_authority_receipt:options.reference.authorityReceipt,
   p_kind:kind,p_after_id:after},current));
  if(result.error!==null)throw unavailable();await bounded(signal,current=>options.check(current));return result.data;
 }
 const captured=inventory.parse(await call("context",options.signal)),proved=new Set<AccountClassKind>();
 const expectedBound=context.partitions.filter(p=>p.class==="claimed-bound");
 if(captured.boundSnapshots.length!==expectedBound.length
  ||new Set(captured.boundSnapshots.map(s=>s.source.subjectId)).size!==expectedBound.length
  ||captured.boundSnapshots.some(s=>Date.parse(s.authority.expiresAt)<=Date.now()||s.authority.authorityReceipt!==options.reference.authorityReceipt
   ||!expectedBound.some(p=>p.subjectId===s.source.subjectId&&p.fileIds.length===1&&p.fileIds[0]===s.source.fileId)))throw unavailable();
 if(captured.authorityReceipt!==options.reference.authorityReceipt||captured.classes.some(e=>e.mode==="unsupported"&&e.rows!==0
  ||e.partitions.some(p=>!subjects.has(p.subjectId))||e.partitions.reduce((n,p)=>n+p.rows,0)>e.rows))throw unavailable();
 for(const e of captured.classes)if(e.mode==="unsupported")proved.add(e.kind);
 const check=async(signal:AbortSignal)=>{if(JSON.stringify(inventory.parse(await call("context",signal)))!==JSON.stringify(captured))throw unavailable();};
 async function* records<K extends AccountProjectedClass>(kind:K,signal:AbortSignal){
  if(!(kind in accountClassRowSchemas))throw unavailable();await check(signal);const expected=captured.classes.find(e=>e.kind===kind)!;
  let after:string|null=null,n=0,digest=createHash("sha256").update(`account-class-members-v1|${kind}`).digest();const perSubject=new Map<string,number>();
  for(;;){const rows=page.parse(await call("metadata",signal,kind,after));
   if(rows.kind!==kind||rows.nextAfterId!==(rows.rows.length===500?rows.rows.at(-1)!.id:null))throw unavailable();
   for(const item of rows.rows){if(item.id<=(after??"")||++n>expected.rows||item.subjectId!==null&&!subjects.has(item.subjectId))throw unavailable();
    const row=accountClassRowSchemas[kind].parse(JSON.parse(item.rowText));if(("id" in row?row.id:row.grant_id)!==item.id)throw unavailable();
    digest=createHash("sha256").update(digest).update(`${item.id}:${item.subjectId??""}:${item.rowText}\n`).digest();after=item.id;
    if(item.subjectId!==null)perSubject.set(item.subjectId,(perSubject.get(item.subjectId)??0)+1);
    yield {subjectId:item.subjectId,row};
   }
   if(rows.nextAfterId===null)break;
  }
  if(n!==expected.rows||digest.toString("hex")!==expected.membershipSha256
   ||expected.partitions.length!==perSubject.size||expected.partitions.some(p=>perSubject.get(p.subjectId)!==p.rows))throw unavailable();
  await check(signal);proved.add(kind);
 }
 async function acceptBoundMembership(values:unknown[],signal:AbortSignal){
  await check(signal);
  const snapshots=values.map(v=>futurePersonExportSnapshot.parse(v)),expected=context.partitions.filter(p=>p.class==="claimed-bound");
  if(snapshots.length!==expected.length||new Set(snapshots.map(s=>s.source.subjectId)).size!==expected.length
   ||snapshots.some(s=>!expected.some(p=>p.subjectId===s.source.subjectId&&p.fileIds.length===1&&p.fileIds[0]===s.source.fileId)
    ||s.authority.authorityReceipt!==options.reference.authorityReceipt)
   ||JSON.stringify([...snapshots].sort((a,b)=>a.source.subjectId.localeCompare(b.source.subjectId)))
    !==JSON.stringify([...captured.boundSnapshots].sort((a,b)=>a.source.subjectId.localeCompare(b.source.subjectId))))throw unavailable();
  const counts:Record<ScienceKind,(s:z.infer<typeof futurePersonExportSnapshot>)=>number>={embryo_figures:s=>s.membership.figures,
   embryo_qc:s=>s.membership.qualityReports,embryo_scores:s=>s.membership.scores,embryo_variants:s=>s.membership.variants,embryos:()=>1,report_artifacts:s=>s.membership.reports};
  for(const kind of scienceKinds){const e=captured.classes.find(e=>e.kind===kind)!;
   if(e.rows!==snapshots.reduce((n,s)=>n+counts[kind](s),0)||e.partitions.length!==snapshots.filter(s=>counts[kind](s)>0).length
    ||e.partitions.some(p=>!snapshots.some(s=>s.source.subjectId===p.subjectId&&counts[kind](s)===p.rows)))throw unavailable();
  }
  await check(signal);for(const kind of scienceKinds)proved.add(kind);
 }
 async function acceptGraphMembership(receipts:{kind:AccountGraphClass;rows:number;membershipSha256:string;partitions:{subjectId:string;rows:number}[]}[],signal:AbortSignal){
  await check(signal);
  if(receipts.length!==ACCOUNT_GRAPH_CLASSES.length||new Set(receipts.map(r=>r.kind)).size!==receipts.length)throw unavailable();
  for(const receipt of receipts){const expected=captured.classes.find(e=>e.kind===receipt.kind)!;
   if(expected.mode!=="graph"||expected.rows!==receipt.rows||expected.membershipSha256!==receipt.membershipSha256
    ||JSON.stringify(expected.partitions)!==JSON.stringify(receipt.partitions))throw unavailable();
   proved.add(receipt.kind);
  }await check(signal);
 }
 async function acceptPathBMembership(rows:{id:string;subjectId:string;rowText:string}[],excludedHeldUploads:number,signal:AbortSignal){
  await check(signal);const expected=captured.classes.find(e=>e.kind==="path_b_report_bindings")!,excluded=captured.classes.find(e=>e.kind==="other_adult_held_uploads")!;
  let digest=createHash("sha256").update("account-class-members-v1|path_b_report_bindings").digest(),last="";const counts=new Map<string,number>();
  for(const row of rows){if(!subjects.has(row.subjectId)||row.id<=last)throw unavailable();
   digest=createHash("sha256").update(digest).update(`${row.id}:${row.subjectId}:${row.rowText}\n`).digest();last=row.id;
   counts.set(row.subjectId,(counts.get(row.subjectId)??0)+1);
  }
  if(expected.mode!=="path-b-results"||expected.rows!==rows.length||expected.membershipSha256!==digest.toString("hex")
   ||expected.partitions.length!==counts.size||expected.partitions.some(p=>counts.get(p.subjectId)!==p.rows)
   ||excluded.mode!=="excluded"||excluded.rows!==excludedHeldUploads||excluded.partitions.length!==0)throw unavailable();
  await check(signal);proved.add("path_b_report_bindings");proved.add("other_adult_held_uploads");
 }
 async function acceptRequesterStatementMembership(value:unknown,signal:AbortSignal){
  await check(signal);const actual=accountOwnStatementCapture.parse(value);
  if(JSON.stringify(actual)!==JSON.stringify(captured.ownStatements))throw unavailable();
  const kinds=actual.version==="test-account-own-statements-v2"?["correction_requests","appeal_intakes"] as const:["correction_requests"] as const;
  for(const kind of kinds){const expected=captured.classes.find(e=>e.kind===kind)!;
   const observed=actual.version==="test-account-own-statements-v2"?actual.classes[kind]
    :{rows:actual.corrections,membershipSha256:actual.membershipSha256,partitions:actual.partitions};
   if(expected.mode!=="requester-statements"||expected.rows!==observed.rows||expected.membershipSha256!==observed.membershipSha256
    ||JSON.stringify(expected.partitions)!==JSON.stringify(observed.partitions))throw unavailable();proved.add(kind);
  }await check(signal);
 }

 return {inventory:captured,records,acceptRequesterStatementMembership,acceptBoundMembership,acceptGraphMembership,acceptPathBMembership,check,assertComplete:async(signal:AbortSignal)=>{
  if(proved.size!==ACCOUNT_CLASS_KINDS.length)throw unavailable();await check(signal);
 }};
}
