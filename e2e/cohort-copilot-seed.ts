import { randomBytes } from "node:crypto";
import { adminClient } from "./helpers";
import { EMBRYO_ANALYSIS_GRANT_STATEMENT_KEYS } from "../src/lib/embryos/basis";

/**
 * A published synthetic cohort for the cohort Copilot specs, written with the
 * service role the way `e2e/embryos.spec.ts` seeds its cohorts, plus the one
 * field publication sets (`publication_revision`), because no browser path
 * ingests embryo files yet (`EMBRYO_INGEST_AVAILABLE` is false). The quality
 * rows are invented; there is no genotype row.
 *
 * Each parent's `embryo.analysis` grant is signed through
 * `grant_cohort_purpose_v1`, the one function the `/api/consents` cohort
 * branch calls, with that parent's own account and a fresh operation nonce:
 * no page offers the grant yet. Everything the Copilot scope then reads,
 * checks and stores is the product's own.
 */

export interface SeededEmbryo { ordinal: number; status: "qc_pass" | "qc_marginal" | "qc_fail"; callRate: number }

export async function accountPrincipalOf(accountId: string): Promise<string> {
  const { data, error } = await adminClient().from("subject_principals").select("id").eq("account_id", accountId)
    .eq("principal_kind", "account_subject").eq("status", "active").order("created_at").limit(1).single();
  if (error || !data) throw new Error(`no account principal for ${accountId}: ${error?.message}`);
  return (data as { id: string }).id;
}

export async function seedPublishedCohort(input: { owner: string; parents: string[]; embryos: SeededEmbryo[] })
  : Promise<{ cohortId: string; embryoIds: string[]; subjectIds: string[] }> {
  const admin = adminClient();
  const now = new Date().toISOString();
  const inThirtyDays = new Date(Date.now() + 30 * 86_400_000).toISOString();
  const inTwoYears = new Date(Date.now() + 730 * 86_400_000).toISOString();
  const uploader = await accountPrincipalOf(input.owner);
  const { data: draft, error: draftError } = await admin.from("embryo_cohort_drafts").insert({
    owner_account_id: input.owner, uploader_principal_id: uploader, upload_class: "embryo_own", basis_case: "true_two_parent",
    embryo_count: input.embryos.length, state: "finalized", fixed_expires_at: inThirtyDays, finalized_at: now,
  }).select("id").single();
  if (draftError || !draft) throw new Error(`draft: ${draftError?.message}`);
  const { data: cohort, error: cohortError } = await admin.from("embryo_cohorts").insert({
    draft_id: draft.id, owner_account_id: input.owner, upload_class: "embryo_own", basis_case: "true_two_parent",
    basis_revision: 1, participant_set_revision: 1, donor_attribution_revision: 1, status: "active",
    embryo_count: input.embryos.length, retention_expires_at: inTwoYears, uploaded_at: now, publication_revision: 1,
  }).select("id").single();
  if (cohortError || !cohort) throw new Error(`cohort: ${cohortError?.message}`);
  const parents = await Promise.all(input.parents.map(accountPrincipalOf));
  const { error: setError } = await admin.from("embryo_participant_sets").insert(parents.map(principal_id => ({
    cohort_id: cohort.id, set_kind: "required_upload_principals", principal_id, set_revision: 1, membership_revision: 1 })));
  if (setError) throw new Error(`participants: ${setError.message}`);
  const embryoIds: string[] = [], subjectIds: string[] = [];
  for (const embryo of input.embryos) {
    const { data: subject, error: subjectError } = await admin.from("subjects").insert({
      owner_account_id: input.owner, subject_class: "embryo", upload_class: "embryo_own",
      display_label: `Embryo ${embryo.ordinal + 1}`, lifecycle: "active", cohort_id: cohort.id,
    }).select("id").single();
    if (subjectError || !subject) throw new Error(`subject: ${subjectError?.message}`);
    const { data: row, error: embryoError } = await admin.from("embryos").insert({
      cohort_id: cohort.id, subject_id: subject.id, sample_ordinal: embryo.ordinal, status: embryo.status, retention_expires_at: inTwoYears,
    }).select("id").single();
    if (embryoError || !row) throw new Error(`embryo: ${embryoError?.message}`);
    const { error: qcError } = await admin.from("embryo_qc").insert({
      embryo_id: row.id, sites_expected: 1000, sites_called: Math.round(embryo.callRate * 1000), call_rate: embryo.callRate,
      qc_verdict: embryo.status === "qc_pass" ? "pass" : embryo.status === "qc_marginal" ? "marginal" : "fail",
      qc_reasons: embryo.status === "qc_pass" ? [] : ["embryo_call_rate"],
    });
    if (qcError) throw new Error(`qc: ${qcError.message}`);
    embryoIds.push(row.id);
    subjectIds.push(subject.id);
  }
  return { cohortId: cohort.id, embryoIds, subjectIds };
}

/** One parent's embryo.analysis grant, in their own account, through the cohort grant function. */
export async function grantAnalysis(accountId: string, cohortId: string): Promise<string> {
  const { data, error } = await adminClient().rpc("grant_cohort_purpose_v1", {
    p_account_id: accountId, p_session_id: crypto.randomUUID(), p_cohort_id: cohortId,
    p_artifact_key: "consent.upload-embryo", p_artifact_version: 1,
    p_statement_keys: [...EMBRYO_ANALYSIS_GRANT_STATEMENT_KEYS], p_signing_name_ciphertext: "\\xdeadbeef",
    p_jurisdiction_code: "GB", p_token_nonce: randomBytes(24).toString("base64url"),
  });
  if (error || !data) throw new Error(`analysis grant: ${error?.message}`);
  return data as string;
}
