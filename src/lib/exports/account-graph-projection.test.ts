import {readFileSync} from "node:fs";
import {createHash} from "node:crypto";
import {describe,expect,it} from "vitest";
import {ACCOUNT_GRAPH_CLASSES,accountGraphProjectionDigest,projectAccountGraphRow,type AccountGraphClass} from "./account-graph-projection";
const id=(n:number)=>`8b900000-0000-4000-8000-${String(n).padStart(12,"0")}`;
const account=id(1),principal=id(2),foreign=id(3),cohort=id(4),created="2026-09-30T12:00:00Z",later="2026-10-01T12:00:00Z",hash="f".repeat(64);
const rows:Record<AccountGraphClass,Record<string,unknown>>={
 embryo_cohorts:{id:cohort,draft_id:id(5),owner_account_id:account,upload_class:"embryo_own",basis_case:"true_two_parent",basis_revision:2,
  participant_set_revision:3,donor_attribution_revision:4,recipient_set_revision:5,key_revision:6,lifecycle_revision:7,ingest_revision:8,
  publication_revision:9,status:"active",embryo_count:64,retention_expires_at:later,created_at:created,uploaded_at:created,qc_failed_at:null},
 embryo_basis_bindings:{cohort_id:cohort,basis_case:"parent_deceased",basis_revision:2,participant_set_revision:3,case_artifact_signature_id:id(6),
  reviewed_evidence_id:id(7),legal_review_id:id(8),artifact_matrix_fingerprint:hash,created_at:created},
 embryo_participant_sets:{cohort_id:cohort,set_kind:"disposition_authorities",principal_id:foreign,set_revision:3,membership_revision:2,created_at:created,revoked_at:later},
 embryo_donor_attributions:{id:id(9),cohort_id:cohort,donor_slot:"parent_b",donor_principal_id:foreign,signature_id:id(10),classification:"identified_consented",
  attribution_revision:2,created_at:created,revoked_at:null},
 embryo_disposition_proposals:{id:id(11),embryo_id:id(12),proposer_principal_id:principal,disposition:"transferred",basis_revision:2,authority_set_revision:3,
  status:"confirmed",expires_at:later,created_at:created,confirmed_at:created},
 embryo_disposition_confirmations:{proposal_id:id(11),confirmer_principal_id:foreign,authority_revision:3,confirmed_at:created},
 family_pairs:{id:id(13),subject_a_id:id(14),subject_b_id:id(15),subject_low_id:id(14),subject_high_id:id(15),pair_revision:2,status:"current",created_at:created},
};
const expected:Record<AccountGraphClass,Record<string,unknown>>={
 embryo_cohorts:{id:cohort,owner_is_requester:true,upload_class:"embryo_own",basis_case:"true_two_parent",basis_revision:2,participant_set_revision:3,
  donor_attribution_revision:4,recipient_set_revision:5,key_revision:6,lifecycle_revision:7,ingest_revision:8,publication_revision:9,status:"active",
  embryo_count:64,retention_expires_at:later,created_at:created,uploaded_at:created,qc_failed_at:null},
 embryo_basis_bindings:{cohort_id:cohort,basis_case:"parent_deceased",basis_revision:2,participant_set_revision:3,case_artifact_signature_recorded:true,
  reviewed_evidence_recorded:true,legal_review_recorded:true,artifact_matrix_fingerprint:hash,created_at:created},
 embryo_participant_sets:{cohort_id:cohort,set_kind:"disposition_authorities",participant_is_requester:false,set_revision:3,membership_revision:2,created_at:created,revoked_at:later},
 embryo_donor_attributions:{id:id(9),cohort_id:cohort,donor_slot:"parent_b",donor_is_requester:false,signature_recorded:true,classification:"identified_consented",
  attribution_revision:2,created_at:created,revoked_at:null},
 embryo_disposition_proposals:{id:id(11),embryo_id:id(12),proposer_is_requester:true,disposition:"transferred",basis_revision:2,authority_set_revision:3,
  status:"confirmed",expires_at:later,created_at:created,confirmed_at:created},
 embryo_disposition_confirmations:{proposal_id:id(11),confirmer_is_requester:false,authority_revision:3,confirmed_at:created},
 family_pairs:{id:id(13),pair_revision:2,status:"current",created_at:created},
};
describe("closed graph projection prerequisites, without new export authority",()=>{
 it.each(ACCOUNT_GRAPH_CLASSES)("retains exact recorded %s values while withholding counterparties and internal keys",kind=>{
  const result=projectAccountGraphRow(kind,rows[kind],account,[principal]);expect(result.row).toEqual(expected[kind]);
  expect(result.version).toBe("account-graph-projection-v1");expect(result.kind).toBe(kind);
  expect(JSON.stringify(result.row)).not.toContain(foreign);
  expect(JSON.stringify(result.row)).not.toMatch(/owner_account_id|draft_id|principal_id|signature_id|reviewed_evidence_id|legal_review_id|subject_[ab]_id|subject_(low|high)_id/);
  const digest=createHash("sha256").update(`account-graph-projection-v1|${kind}`).digest();
  const independent=createHash("sha256").update(digest).update(`${result.identity}:${JSON.stringify(expected[kind])}\n`).digest("hex");
  expect(accountGraphProjectionDigest(kind,[result])).toBe(independent);
 });
 it.each(ACCOUNT_GRAPH_CLASSES)("refuses unreviewed %s source columns, including credential/contact/ciphertext fields",kind=>{
  for(const field of ["authority","contact_email","statement_ciphertext","wrapped_key","new_column"])
   expect(()=>projectAccountGraphRow(kind,{...rows[kind],[field]:"private"},account,[principal])).toThrow();
 });
 it.each(ACCOUNT_GRAPH_CLASSES)("refuses unknown %s projected columns rather than hashing a generic JSON record",kind=>{
  const result=projectAccountGraphRow(kind,rows[kind],account,[principal]);
  expect(()=>accountGraphProjectionDigest(kind,[{...result,row:{...result.row,principal_id:foreign}}])).toThrow();
 });
 it("preserves every real composite key column without an invented UUID or loss of same-projection counterparties",()=>{
  const first=projectAccountGraphRow("embryo_participant_sets",rows.embryo_participant_sets,account,[principal]);
  expect(JSON.parse(first.identity)).toEqual([cohort,"disposition_authorities",foreign,2]);
  const second=projectAccountGraphRow("embryo_participant_sets",{...rows.embryo_participant_sets,principal_id:id(16)},account,[principal]);
  expect(second.row).toEqual(first.row);expect(second.identity).not.toBe(first.identity);
  expect(accountGraphProjectionDigest("embryo_participant_sets",[first,second])).not.toBe(accountGraphProjectionDigest("embryo_participant_sets",[first]));
  expect(JSON.parse(projectAccountGraphRow("embryo_disposition_confirmations",rows.embryo_disposition_confirmations,account,[principal]).identity))
   .toEqual([id(11),foreign]);
 });
 it("orders revisions numerically and refuses duplicates, reordering, changed/missing key columns and stale keys",()=>{
  const kind="embryo_participant_sets",a=projectAccountGraphRow(kind,rows[kind],account,[principal]);
  const b=projectAccountGraphRow(kind,{...rows[kind],membership_revision:10},account,[principal]);
  expect(()=>accountGraphProjectionDigest(kind,[a,b])).not.toThrow();
  expect(()=>accountGraphProjectionDigest(kind,[b,a])).toThrow();expect(()=>accountGraphProjectionDigest(kind,[a,a])).toThrow();
  for(const identity of [JSON.stringify([cohort,"disposition_authorities",foreign]),JSON.stringify([cohort,"disposition_authorities",foreign,3]),
   JSON.stringify([cohort,"wrong_set",foreign,2]),JSON.stringify([cohort,"disposition_authorities",foreign,2]).replace(',',', ')])
   expect(()=>accountGraphProjectionDigest(kind,[{...a,identity}])).toThrow();
 });
 it("refuses crossed primary identity/kind/version and reflects same-count recorded changes in the independent content receipt",()=>{
  const a=projectAccountGraphRow("embryo_cohorts",rows.embryo_cohorts,account,[principal]);
  expect(()=>accountGraphProjectionDigest(a.kind,[{...a,identity:JSON.stringify([id(99)])}])).toThrow();
  expect(()=>accountGraphProjectionDigest("family_pairs",[a])).toThrow();
  expect(()=>accountGraphProjectionDigest(a.kind,[{...a,version:"unknown" as never}])).toThrow();
  const b=projectAccountGraphRow(a.kind,{...rows.embryo_cohorts,lifecycle_revision:8},account,[principal]);
  expect(accountGraphProjectionDigest(a.kind,[a])).not.toBe(accountGraphProjectionDigest(b.kind,[b]));
 });
 it("only marks genuine requester identity equality, without publishing either principal/account identifier",()=>{
  expect(projectAccountGraphRow("embryo_participant_sets",{...rows.embryo_participant_sets,principal_id:principal},account,[principal]).row.participant_is_requester).toBe(true);
  expect(projectAccountGraphRow("embryo_cohorts",rows.embryo_cohorts,id(99),[principal]).row.owner_is_requester).toBe(false);
  expect(()=>projectAccountGraphRow("embryo_cohorts",rows.embryo_cohorts,"forged",[principal])).toThrow();
  expect(()=>projectAccountGraphRow("family_pairs",rows.family_pairs,account,["forged"])).toThrow();
 });
 it("refuses impossible recorded basis/donor/cohort/pair shapes under their real physical constraints",()=>{
  expect(()=>projectAccountGraphRow("embryo_cohorts",{...rows.embryo_cohorts,qc_failed_at:created},account,[principal])).toThrow();
  expect(()=>projectAccountGraphRow("embryo_cohorts",{...rows.embryo_cohorts,embryo_count:65},account,[principal])).toThrow();
  expect(()=>projectAccountGraphRow("embryo_basis_bindings",{...rows.embryo_basis_bindings,legal_review_id:null},account,[principal])).toThrow();
  expect(()=>projectAccountGraphRow("embryo_basis_bindings",{...rows.embryo_basis_bindings,basis_case:"true_two_parent"},account,[principal])).toThrow();
  expect(()=>projectAccountGraphRow("embryo_donor_attributions",{...rows.embryo_donor_attributions,signature_id:null},account,[principal])).toThrow();
  expect(()=>projectAccountGraphRow("embryo_disposition_proposals",{...rows.embryo_disposition_proposals,expires_at:created},account,[principal])).toThrow();
  expect(()=>projectAccountGraphRow("family_pairs",{...rows.family_pairs,subject_low_id:id(99)},account,[principal])).toThrow();
 });
 it("pins every source column to the actual generated physical row and all real composite primary key columns",()=>{
  const generated=readFileSync(new URL("../supabase/types.ts",import.meta.url),"utf8");
  for(const kind of ACCOUNT_GRAPH_CLASSES){
   const start=generated.indexOf(`      ${kind}: {`);expect(start).toBeGreaterThan(0);
   const row=generated.slice(start,generated.indexOf("        Insert:",start));
   const physical=[...row.matchAll(/^          ([a-z_]+):/gm)].map(m=>m[1]).sort();
   expect(Object.keys(rows[kind]).sort()).toEqual(physical);
  }
  const cohortSql=readFileSync(new URL("../../../supabase/migrations/20260831223301_embryo_cohorts_and_authority.sql",import.meta.url),"utf8");
  expect(cohortSql).toContain("primary key (cohort_id, set_kind, principal_id, membership_revision)");
  const dispositionSql=readFileSync(new URL("../../../supabase/migrations/20260831224126_reference_registries_and_constraints.sql",import.meta.url),"utf8");
  expect(dispositionSql).toContain("primary key (proposal_id, confirmer_principal_id)");
 });
 it("retains the exact registered held-source exclusion and statement/scientific deferrals",()=>{
  const plan=JSON.parse(readFileSync(new URL("../../../docs/export-member-plan.json",import.meta.url),"utf8"));
  expect(plan.tables["public.other_adult_held_uploads"].disposition).toBe("out-of-scope");
  for(const name of ["public.appeal_intakes","public.correction_requests","public.ancestry_regions","public.portrait_results","private.path_b_report_bindings"])
   expect(plan.tables[name].disposition).toBe("deferred");
 });
 it("does not pretend an encrypted statement, held source or scientific result is readable metadata",()=>{
  for(const kind of ["appeal_intakes","correction_requests","other_adult_held_uploads","ancestry_regions","portrait_results","path_b_report_bindings"])
   expect(()=>projectAccountGraphRow(kind as AccountGraphClass,{},account,[principal])).toThrow("account_archive_class_unavailable");
 });
});
