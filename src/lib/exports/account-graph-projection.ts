import "server-only";
import {createHash} from "node:crypto";
import {z} from "zod";

const uuid=z.uuid(),date=z.iso.datetime({offset:true}),revision=z.number().int().positive().safe();
const basis=z.enum(["true_two_parent","anonymous_donor","identified_donor_consented","parent_deceased","sole_legal_authority"]);
const setKind=z.enum(["required_upload_principals","disposition_authorities","notice_recipients","record_key_recipients","attribution_principals"]);
const nullableDate=date.nullable(),nullableId=uuid.nullable();
export const ACCOUNT_GRAPH_CLASSES=["embryo_cohorts","embryo_basis_bindings","embryo_participant_sets","embryo_donor_attributions",
 "embryo_disposition_proposals","embryo_disposition_confirmations","family_pairs"] as const;
export type AccountGraphClass=(typeof ACCOUNT_GRAPH_CLASSES)[number];
/** These are the current physical row columns, not an authority DTO. Unknown
 * columns fail until reviewed; a transport key never becomes archive content. */
export const accountGraphSourceSchemas={
 embryo_cohorts:z.object({id:uuid,draft_id:uuid,owner_account_id:uuid,upload_class:z.enum(["embryo_own","embryo_third_party"]),basis_case:basis,
  basis_revision:revision,participant_set_revision:revision,donor_attribution_revision:revision,recipient_set_revision:revision,key_revision:revision,
  lifecycle_revision:revision,ingest_revision:revision,publication_revision:revision.nullable(),status:z.enum(["upload_pending","ingesting","active",
   "restricted","purge_queued","purged","claimed_bound"]),embryo_count:z.number().int().min(1).max(64),retention_expires_at:date,
  created_at:date,uploaded_at:nullableDate,qc_failed_at:nullableDate}).strict().refine(v=>v.uploaded_at===null||v.qc_failed_at===null),
 embryo_basis_bindings:z.object({cohort_id:uuid,basis_case:basis,basis_revision:revision,participant_set_revision:revision,
  case_artifact_signature_id:nullableId,reviewed_evidence_id:nullableId,legal_review_id:nullableId,
  artifact_matrix_fingerprint:z.string().regex(/^[a-f0-9]{64}$/u),created_at:date}).strict()
  .refine(v=>(v.basis_case==="true_two_parent")===(v.case_artifact_signature_id===null))
  .refine(v=>!["parent_deceased","sole_legal_authority"].includes(v.basis_case)||v.reviewed_evidence_id!==null&&v.legal_review_id!==null),
 embryo_participant_sets:z.object({cohort_id:uuid,set_kind:setKind,principal_id:uuid,set_revision:revision,membership_revision:revision,
  created_at:date,revoked_at:nullableDate}).strict(),
 embryo_donor_attributions:z.object({id:uuid,cohort_id:uuid,donor_slot:z.enum(["parent_a","parent_b"]),donor_principal_id:nullableId,
  signature_id:nullableId,classification:z.enum(["anonymous","identified_pending","identified_consented","refused","revoked"]),
  attribution_revision:revision,created_at:date,revoked_at:nullableDate}).strict()
  .refine(v=>v.classification!=="identified_consented"||v.donor_principal_id!==null&&v.signature_id!==null),
 embryo_disposition_proposals:z.object({id:uuid,embryo_id:uuid,proposer_principal_id:uuid,disposition:z.enum(["stored","transferred","donated","discarded"]),
  basis_revision:revision,authority_set_revision:revision,status:z.enum(["pending","confirmed","expired","cancelled"]),
  expires_at:date,created_at:date,confirmed_at:nullableDate}).strict().refine(v=>Date.parse(v.expires_at)>Date.parse(v.created_at)),
 embryo_disposition_confirmations:z.object({proposal_id:uuid,confirmer_principal_id:uuid,authority_revision:revision,confirmed_at:date}).strict(),
 family_pairs:z.object({id:uuid,subject_a_id:uuid,subject_b_id:uuid,subject_low_id:nullableId,subject_high_id:nullableId,
  pair_revision:revision,status:z.enum(["pending","current","revoked","purged"]),created_at:date}).strict()
  .refine(v=>v.subject_a_id!==v.subject_b_id&&v.subject_low_id===[v.subject_a_id,v.subject_b_id].sort()[0]
   &&v.subject_high_id===[v.subject_a_id,v.subject_b_id].sort()[1]),
} as const;

/** Exact real primary keys, including all columns of composite identities.
 * The closed tuple is used only inside the worker page/hash protocol. In
 * particular a counterparty principal in a key is never serialized as a row. */
export const accountGraphIdentitySchemas={
 embryo_cohorts:z.tuple([uuid]),embryo_basis_bindings:z.tuple([uuid]),
 embryo_participant_sets:z.tuple([uuid,setKind,uuid,revision]),embryo_donor_attributions:z.tuple([uuid]),
 embryo_disposition_proposals:z.tuple([uuid]),embryo_disposition_confirmations:z.tuple([uuid,uuid]),family_pairs:z.tuple([uuid]),
} as const;
export const accountGraphRowSchemas={
 embryo_cohorts:z.object({id:uuid,owner_is_requester:z.boolean(),upload_class:z.enum(["embryo_own","embryo_third_party"]),basis_case:basis,
  basis_revision:revision,participant_set_revision:revision,donor_attribution_revision:revision,recipient_set_revision:revision,key_revision:revision,
  lifecycle_revision:revision,ingest_revision:revision,publication_revision:revision.nullable(),status:z.enum(["upload_pending","ingesting","active",
   "restricted","purge_queued","purged","claimed_bound"]),embryo_count:z.number().int().min(1).max(64),retention_expires_at:date,
  created_at:date,uploaded_at:nullableDate,qc_failed_at:nullableDate}).strict().refine(v=>v.uploaded_at===null||v.qc_failed_at===null),
 embryo_basis_bindings:z.object({cohort_id:uuid,basis_case:basis,basis_revision:revision,participant_set_revision:revision,
  case_artifact_signature_recorded:z.boolean(),reviewed_evidence_recorded:z.boolean(),legal_review_recorded:z.boolean(),
  artifact_matrix_fingerprint:z.string().regex(/^[a-f0-9]{64}$/u),created_at:date}).strict()
  .refine(v=>(v.basis_case==="true_two_parent")===!v.case_artifact_signature_recorded)
  .refine(v=>!["parent_deceased","sole_legal_authority"].includes(v.basis_case)||v.reviewed_evidence_recorded&&v.legal_review_recorded),
 embryo_participant_sets:z.object({cohort_id:uuid,set_kind:setKind,participant_is_requester:z.boolean(),set_revision:revision,membership_revision:revision,
  created_at:date,revoked_at:nullableDate}).strict(),
 embryo_donor_attributions:z.object({id:uuid,cohort_id:uuid,donor_slot:z.enum(["parent_a","parent_b"]),donor_is_requester:z.boolean(),
  signature_recorded:z.boolean(),classification:z.enum(["anonymous","identified_pending","identified_consented","refused","revoked"]),
  attribution_revision:revision,created_at:date,revoked_at:nullableDate}).strict()
  .refine(v=>v.classification!=="identified_consented"||v.signature_recorded),
 embryo_disposition_proposals:z.object({id:uuid,embryo_id:uuid,proposer_is_requester:z.boolean(),disposition:z.enum(["stored","transferred","donated","discarded"]),
  basis_revision:revision,authority_set_revision:revision,status:z.enum(["pending","confirmed","expired","cancelled"]),
  expires_at:date,created_at:date,confirmed_at:nullableDate}).strict().refine(v=>Date.parse(v.expires_at)>Date.parse(v.created_at)),
 embryo_disposition_confirmations:z.object({proposal_id:uuid,confirmer_is_requester:z.boolean(),authority_revision:revision,confirmed_at:date}).strict(),
 family_pairs:z.object({id:uuid,pair_revision:revision,status:z.enum(["pending","current","revoked","purged"]),created_at:date}).strict(),
} as const;
export type AccountGraphProjection={version:"account-graph-projection-v1";kind:AccountGraphClass;identity:string;row:Record<string,unknown>};
/** Pure privacy projection only. The future consumed graph reader must establish
 * actual current actor, complete partition/grant membership, attempt and source
 * authority before selecting a row, then recheck it before admitting bytes.
 * This function is deliberately absent from the current closed executor. */
export function projectAccountGraphRow(kind:AccountGraphClass,value:unknown,requesterAccountId:string,requesterPrincipals:readonly string[]):AccountGraphProjection{
 uuid.parse(requesterAccountId);const mine=new Set(z.array(uuid).parse(requesterPrincipals));let key:unknown[],row:Record<string,unknown>;
 switch(kind){
  case "embryo_cohorts":{const v=accountGraphSourceSchemas[kind].parse(value);key=[v.id];row={id:v.id,owner_is_requester:v.owner_account_id===requesterAccountId,
   upload_class:v.upload_class,basis_case:v.basis_case,basis_revision:v.basis_revision,participant_set_revision:v.participant_set_revision,
   donor_attribution_revision:v.donor_attribution_revision,recipient_set_revision:v.recipient_set_revision,key_revision:v.key_revision,
   lifecycle_revision:v.lifecycle_revision,ingest_revision:v.ingest_revision,publication_revision:v.publication_revision,status:v.status,
   embryo_count:v.embryo_count,retention_expires_at:v.retention_expires_at,created_at:v.created_at,uploaded_at:v.uploaded_at,qc_failed_at:v.qc_failed_at};break;}
  case "embryo_basis_bindings":{const v=accountGraphSourceSchemas[kind].parse(value);key=[v.cohort_id];row={cohort_id:v.cohort_id,basis_case:v.basis_case,
   basis_revision:v.basis_revision,participant_set_revision:v.participant_set_revision,case_artifact_signature_recorded:v.case_artifact_signature_id!==null,
   reviewed_evidence_recorded:v.reviewed_evidence_id!==null,legal_review_recorded:v.legal_review_id!==null,
   artifact_matrix_fingerprint:v.artifact_matrix_fingerprint,created_at:v.created_at};break;}
  case "embryo_participant_sets":{const v=accountGraphSourceSchemas[kind].parse(value);key=[v.cohort_id,v.set_kind,v.principal_id,v.membership_revision];
   row={cohort_id:v.cohort_id,set_kind:v.set_kind,participant_is_requester:mine.has(v.principal_id),set_revision:v.set_revision,
    membership_revision:v.membership_revision,created_at:v.created_at,revoked_at:v.revoked_at};break;}
  case "embryo_donor_attributions":{const v=accountGraphSourceSchemas[kind].parse(value);key=[v.id];row={id:v.id,cohort_id:v.cohort_id,donor_slot:v.donor_slot,
   donor_is_requester:v.donor_principal_id!==null&&mine.has(v.donor_principal_id),signature_recorded:v.signature_id!==null,classification:v.classification,
   attribution_revision:v.attribution_revision,created_at:v.created_at,revoked_at:v.revoked_at};break;}
  case "embryo_disposition_proposals":{const v=accountGraphSourceSchemas[kind].parse(value);key=[v.id];row={id:v.id,embryo_id:v.embryo_id,
   proposer_is_requester:mine.has(v.proposer_principal_id),disposition:v.disposition,basis_revision:v.basis_revision,
   authority_set_revision:v.authority_set_revision,status:v.status,expires_at:v.expires_at,created_at:v.created_at,confirmed_at:v.confirmed_at};break;}
  case "embryo_disposition_confirmations":{const v=accountGraphSourceSchemas[kind].parse(value);key=[v.proposal_id,v.confirmer_principal_id];
   row={proposal_id:v.proposal_id,confirmer_is_requester:mine.has(v.confirmer_principal_id),authority_revision:v.authority_revision,confirmed_at:v.confirmed_at};break;}
  case "family_pairs":{const v=accountGraphSourceSchemas[kind].parse(value);key=[v.id];row={id:v.id,pair_revision:v.pair_revision,status:v.status,created_at:v.created_at};break;}
  default:throw new Error("account_archive_class_unavailable");
 }
 const tuple=accountGraphIdentitySchemas[kind].parse(key);
 return {version:"account-graph-projection-v1",kind,identity:JSON.stringify(tuple),row:accountGraphRowSchemas[kind].parse(row)};
}
/** Ordered source receipts include real composite key identity and exact projected
 * JSON. They cannot substitute for a current SQL capture or scientific proof. */
function compareIdentity(a:readonly(string|number)[],b:readonly(string|number)[]){
 for(let i=0;i<a.length;i++){if(typeof a[i]!==typeof b[i])throw new Error("account_archive_class_unavailable");
  if(a[i]!==b[i])return a[i]<b[i]?-1:1;}
 return 0;
}
export function accountGraphProjectionDigest(kind:AccountGraphClass,values:Iterable<AccountGraphProjection>):string{
 let digest=createHash("sha256").update(`account-graph-projection-v1|${kind}`).digest(),previous:(string|number)[]|null=null;
 for(const value of values){
  z.object({version:z.literal("account-graph-projection-v1"),kind:z.enum(ACCOUNT_GRAPH_CLASSES),identity:z.string().max(512),row:z.unknown()}).strict().parse(value);
  if(value.version!=="account-graph-projection-v1"||value.kind!==kind)throw new Error("account_archive_class_unavailable");
  const tuple=accountGraphIdentitySchemas[kind].parse(JSON.parse(value.identity)),identity=JSON.stringify(tuple);
  const row=accountGraphRowSchemas[kind].parse(value.row);
  const primary="id" in row?row.id:"proposal_id" in row?row.proposal_id:row.cohort_id;
  if(tuple[0]!==primary||kind==="embryo_participant_sets"&&(tuple[1]!==row.set_kind||tuple[3]!==row.membership_revision))
   throw new Error("account_archive_class_unavailable");
  if(identity!==value.identity||previous!==null&&compareIdentity(tuple,previous)<=0)throw new Error("account_archive_class_unavailable");
  digest=createHash("sha256").update(digest).update(`${identity}:${JSON.stringify(row)}\n`).digest();previous=tuple;
 }
 return digest.toString("hex");
}
