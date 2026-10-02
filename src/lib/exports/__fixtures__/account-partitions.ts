import {createHash,randomUUID} from "node:crypto";
import {vi} from "vitest";
import {ACCOUNT_HISTORY_KINDS,type AccountHistoryKind,prepareAccountHistoryInventory,type AccountInventoryRpc} from "../account-history-inventory";
import {ACCOUNT_CLASS_KINDS,accountClassRowSchemas,type AccountProjectedClass,prepareAccountClassInventory,type AccountClassRpc} from "../account-class-inventory";
import {prepareAccountArchiveMetadata,type AccountMetadataRpc} from "../account-member-metadata";
import type {z} from "zod";
import type {accountArchiveContextSchema} from "../bound-account-archive-worker";
const date="2026-10-01T00:00:00.000Z";
export async function accountPartitionFixture(total=1103,selected?:{actor:{accountId:string;sessionId:string};reference:{exportId:string;attemptId:string;authorityReceipt:string}}){
 const actor=selected?.actor??{accountId:randomUUID(),sessionId:randomUUID()},self=randomUUID(),adult=randomUUID(),foreign=randomUUID();
 const reference=selected?.reference??{exportId:randomUUID(),attemptId:randomUUID(),authorityReceipt:"a".repeat(64)},abort=new AbortController(),
  check=vi.fn<(signal:AbortSignal)=>Promise<void>>(async()=>{});
 const context:z.infer<typeof accountArchiveContextSchema>={version:"account-archive-members-v1",targetKind:"account",targetId:actor.accountId,
  authorityReceipt:reference.authorityReceipt,deadline:new Date(Date.now()+600000).toISOString(),capturedAt:date,actor,fileCount:0,
  partitions:[{subjectId:self,class:"ordinary",fileCount:0,fileIds:[]},{subjectId:adult,class:"ordinary",fileCount:0,fileIds:[]}]};
 const subject=(id:string,subject_class:"self"|"other_adult")=>({id,subject_class,upload_class:"adult",display_label:"Your own record",lifecycle:"active",
  subject_binding_revision:1,lifecycle_revision:1,created_at:date,updated_at:date,portrait_acknowledged_at:null,independent_login_at:null});
 const principal=randomUUID(),signature=randomUUID();
 const historyRows:Record<AccountHistoryKind,Record<string,unknown>[]>={
  "legacy-consents":Array.from({length:total},()=>({id:randomUUID(),provider_key:"synthetic-model",data_classes:["reports"],granted_at:date,revoked_at:null})),
  subjects:[subject(self,"self"),subject(adult,"other_adult")],
  demographics:[{subject_id:adult,date_of_birth:"1990-01-01",chromosomal_sex:null,demographics_revision:1,updated_at:date}],
  principals:[{id:principal,subject_id:adult,principal_kind:"account_subject",principal_revision:1,status:"active",created_at:date}],
  bindings:[{id:randomUUID(),subject_id:adult,subject_principal_id:principal,account_principal_id:randomUUID(),binding_kind:"own_account",
   binding_revision:1,status:"current",bound_at:date,ended_at:null}],
  "account-consents":[{id:randomUUID(),signature_id:signature,subject_id:adult,cohort_id:null,consent_type:"cloud_model",scope:["copilot"],provider_key:"synthetic-model",
   grant_revision:1,granted_at:date,expires_at:null,revoked_at:null,revocation_reason:null,copilot_recipient:{providerLabel:"Synthetic",
    origin:"https://model.e2e.local",revision:1,providerClass:"cloud",baseUrl:"https://model.e2e.local/v1",provider:"openai_compatible",model:"synthetic-model"}}],
  signatures:[{id:signature,artifact_key:"terms",artifact_version:1,artifact_body_sha256:"c".repeat(64),signer_principal_id:principal,target_kind:"subject",target_id:foreign,
   purpose:null,statement_keys:[],jurisdiction_code:"GB",jurisdiction_revision:1,subject_binding_revision:null,signed_at:date}],
  attestations:[{id:randomUUID(),signature_id:signature,principal_id:principal,target_kind:"subject",target_id:adult,kind:"dna-is-own",statement_keys:["affirmed"],
   affirmed:true,attestation_revision:1,affirmed_at:date}],
  "recipient-grants":[{id:randomUUID(),recipient_principal_id:principal,provider_id:"synthetic-model",purpose:"copilot",artifact_key:"cloud-model",artifact_version:1,
   grant_revision:1,model_recipient_revision:1,status:"revoked",created_at:date,ended_at:date}],
 };
 const projections:Record<AccountProjectedClass,Record<string,unknown>>={
  attestation_contradictions:{contradiction_code:"source_refused",lifecycle_revision:2,recorded_at:date,resolved_at:null},
  directional_grants:{grant_revision:3,relationship_or_pair_revision:2,direction:"self",status:"current",created_at:date,ended_at:null},
  family_sharing_pauses:{paused_by_requester:false,ended_by_requester:null,paused_at:date,ended_at:null,end_reason:null},
  family_sharing_stops:{stopped_by_requester:true,ended_at:date},
  future_person_claim_objections:{claim_id:randomUUID(),objection_revision:2,reason_code:"documentary_review",status:"overruled",submitted_at:date,decided_at:date},
  future_person_claimant_principals:{claim_id:randomUUID(),claimant_revision:2,status:"current",created_at:date},
  future_person_claims:{claim_method:"record_key",claim_revision:2,claimant_revision:2,status:"approved",submitted_at:date,decided_at:date},
  subject_control_refusal_authorities:{authority_revision:2,status:"revoked",created_at:date},
  subject_relationships:{relationship_kind:"self",relationship_revision:2,status:"current",created_at:date,ended_at:null},
  suppressions:{condition_id:"synthetic-condition",reason_code:"source_corrected",suppression_revision:2,active_from:date,ended_at:null},
 };
 const classRows=Object.fromEntries((Object.keys(accountClassRowSchemas) as AccountProjectedClass[]).map(kind=>{
  const id=randomUUID();return [kind,[{id,subjectId:kind.startsWith("family_")?null:adult,
   rowText:JSON.stringify({...projections[kind],[kind==="directional_grants"?"grant_id":"id"]:id})}]];
 })) as Record<AccountProjectedClass,{id:string;subjectId:string|null;rowText:string}[]>;
 const historySource=Object.fromEntries(ACCOUNT_HISTORY_KINDS.map(kind=>[kind,historyRows[kind].map(row=>({
  id:String(row.id??row.subject_id),rowText:JSON.stringify(row)})).sort((a,b)=>a.id.localeCompare(b.id))])) as Record<AccountHistoryKind,{id:string;rowText:string}[]>;
 const historyContext={version:"account-history-inventory-v1",authorityReceipt:reference.authorityReceipt,classes:ACCOUNT_HISTORY_KINDS.map(kind=>{
  let digest=createHash("sha256").update(`account-history-members-v1|${kind}`).digest();
  for(const row of historySource[kind])digest=createHash("sha256").update(digest).update(`${row.id}:${row.rowText}\n`).digest();
  return {kind,rows:historySource[kind].length,membershipSha256:digest.toString("hex")};
 })};
 const classContext={version:"account-class-inventory-v1",authorityReceipt:reference.authorityReceipt,boundSnapshots:[],classes:ACCOUNT_CLASS_KINDS.map(kind=>{
  const rows=classRows[kind as AccountProjectedClass]??[];let digest=createHash("sha256").update(`account-class-members-v1|${kind}`).digest();
  for(const row of rows)digest=createHash("sha256").update(digest).update(`${row.id}:${row.subjectId??""}:${row.rowText}\n`).digest();
  return {kind,mode:kind in accountClassRowSchemas?"metadata":["embryo_figures","embryo_qc","embryo_scores","embryo_variants","embryos","report_artifacts"].includes(kind)?"claimed-bound":"unsupported",
   rows:rows.length,membershipSha256:digest.toString("hex"),partitions:rows.some(row=>row.subjectId!==null)?[{subjectId:adult,rows:1}]:[]};
 })};
 const inventoryRpc=vi.fn<AccountInventoryRpc>(async(_name,args)=>{
  if(args.p_operation==="context")return {data:structuredClone(historyContext),error:null};
  const rows=historySource[args.p_kind!].filter(row=>row.id>(args.p_after_id??"")).slice(0,500);
  return {data:{version:"account-history-page-v1",kind:args.p_kind,rows:structuredClone(rows),nextAfterId:rows.length===500?rows.at(-1)!.id:null},error:null};
 });
 const classRpc=vi.fn<AccountClassRpc>(async(_name,args)=>{
  if(args.p_operation==="context")return {data:structuredClone(classContext),error:null};
  const rows=classRows[args.p_kind as AccountProjectedClass].filter(row=>row.id>(args.p_after_id??"")).slice(0,500);
  return {data:{version:"account-class-page-v1",kind:args.p_kind,rows:structuredClone(rows),nextAfterId:rows.length===500?rows.at(-1)!.id:null},error:null};
 });
 const profile={id:actor.accountId,date_of_birth:"1990-01-01",jurisdiction_code:"GB",jurisdiction_subdivision:null,jurisdiction_revision:1,
  jurisdiction_declared_at:date,jurisdiction_attestation_version:1,jurisdiction_attestation_sha256:"c".repeat(64)};
 const purposeGrant={grant_id:randomUUID(),grant_revision:1,target_kind:"subject",target_id:adult,purpose:"reports.monogenic",artifact_key:"own-reports",
  artifact_version:1,artifact_body_sha256:"c".repeat(64),signature_id:signature,signer_principal_id:principal,data_subject_principal_id:principal,
  subject_binding_revision:1,jurisdiction_code:"GB",jurisdiction_revision:1,granted_at:date,expires_at:null,revoked_at:null,revocation_reason:null};
 const metadataRpc=vi.fn<AccountMetadataRpc>(async(_name,args)=>({data:{version:"account-archive-metadata-v1",operation:args.p_operation,
  rows:args.p_operation==="context"?[{profileCount:1,purposeGrantCount:1,fileCount:0}]:args.p_operation==="profile"?[profile]:
   args.p_operation==="purpose-grants"&&args.p_after_id===null?[purposeGrant]:[]},error:null}));
 const common={reference,context,signal:abort.signal,check};
 const history=await prepareAccountHistoryInventory({...common,rpc:inventoryRpc});
 const classes=await prepareAccountClassInventory({...common,rpc:classRpc});
 const metadata=await prepareAccountArchiveMetadata({...common,files:[],rpc:metadataRpc});
 return {options:{context,history,classes,metadata,signal:abort.signal,check},self,adult,foreign,reference,context,abort,check,
  historyRows,historySource,historyContext,classRows,classContext,inventoryRpc,classRpc,metadataRpc,profile,purposeGrant};
}
