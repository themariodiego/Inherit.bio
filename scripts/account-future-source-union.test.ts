import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(__dirname, "..");
const read = (name: string) => readFileSync(path.join(root, name), "utf8");
const receipts = [
  ["variant-rows", "private.claimed_embryo_ingest_receipts"],
  ["variant-rows", "private.claimed_embryo_job_receipts"],
  ["worker-and-model-working-state", "private.account_owned_cohort_purges"],
] as const;
const requesterStores = [
  ["appeal-and-correction-working-packages", "private.account_requester_statement_capsules", "20261009183314_account_requester_statement_members.sql"],
  ["generated-artifacts", "private.account_archive_r2_allocations", "20261009184100_account_archive_r2_reservations.sql"],
  ["appeal-and-correction-working-packages", "private.new_correction_intakes", "20261009193600_new_correction_intake.sql"],
  ["appeal-and-correction-working-packages", "private.new_public_appeal_intakes", "20261009200845_new_public_appeal_intake.sql"],
  ["legal-evidence-working-and-private-objects", "private.appeal_document_sessions", "20261009204626_public_appeal_evidence_session.sql"],
  ["legal-evidence-working-and-private-objects", "private.appeal_document_fragments", "20261009204626_public_appeal_evidence_session.sql"],
  ["appeal-and-correction-working-packages", "private.appeal_documents", "20261009204626_public_appeal_evidence_session.sql"],
  ["appeal-and-correction-working-packages", "private.new_public_appeal_evidence_state", "20261009204626_public_appeal_evidence_session.sql"],
  ["appeal-and-correction-working-packages", "private.public_appeal_pending_reviews", "20261009204626_public_appeal_evidence_session.sql"],
  ["appeal-and-correction-working-packages", "private.public_appeal_provisional_targets", "20261009224500_public_appeal_matched_review.sql"],
  ["appeal-and-correction-working-packages", "private.public_appeal_review_downloads", "20261009224500_public_appeal_matched_review.sql"],
  ["appeal-and-correction-working-packages", "private.public_appeal_review_chunks", "20261009224500_public_appeal_matched_review.sql"],
  ["appeal-and-correction-working-packages", "private.public_appeal_document_decisions", "20261009224500_public_appeal_matched_review.sql"],
  ["appeal-and-correction-working-packages", "private.public_appeal_decision_notices", "20261009224501_public_appeal_decision_notice_continuation.sql"],
  ["appeal-and-correction-working-packages", "private.public_appeal_case_decisions", "20261010001000_public_appeal_final_rejection.sql"],
] as const;
function inventory(text: string) {
  const block = text.slice(text.indexOf("from (values"), text.indexOf(") expected(target_id,store_name)"));
  return [...block.matchAll(/\('([^']+)','([^']+)'\)/gu)].map((match) => [match[1], match[2]].join("|"));
}

describe("the complete account and Future source union", () => {
  it("retains every independently reviewed 155 pair and adds only the three actual account stores", () => {
    const predecessor = inventory(read("supabase/tests/fixtures/purge_store_census_155.inc"));
    const combined = inventory(read("supabase/tests/fixtures/purge_store_census_158.inc"));
    expect(predecessor).toHaveLength(155);
    expect(combined).toHaveLength(158);
    expect(new Set(combined).size).toBe(158);
    expect(combined.sort()).toEqual([...predecessor, ...receipts.map((pair) => pair.join("|"))].sort());
    const migration = read("supabase/migrations/20260930235000_account_cohort_purge.sql");
    for (const [target, name] of receipts) {
      expect(migration).toContain(`select '${target}','${name}',coalesce(max(store_order),0)+1`);
      expect(migration).toContain(`create table ${name}`);
    }
  });

  it("retains all 158 historical pairs and adds exactly the 15 real requester, R2 and appeal stores", () => {
    const predecessor = inventory(read("supabase/tests/fixtures/purge_store_census_158.inc"));
    const current = inventory(read("supabase/tests/fixtures/purge_store_census_173.inc"));
    expect(current).toHaveLength(173);
    expect(new Set(current).size).toBe(173);
    expect(current.sort()).toEqual([...predecessor, ...requesterStores.map(([target, name]) => `${target}|${name}`)].sort());
    for (const [target, name, filename] of requesterStores) {
      const source = read(`supabase/migrations/${filename}`).replace(/\s+/gu, "");
      expect(source).toContain(`createtable${name}(`);
      expect(source).toContain(`'${target}','${name}',`);
    }
  });

  it("uses the current exact literal inventory in all four complete-census consumers", () => {
    for (const name of ["claimed_provenance_last_consumer", "future_person_claimant_erasure", "future_person_export_members", "future_person_export_source"]) {
      const sql = read(`supabase/tests/${name}.sql`);
      expect(sql).toContain("173::bigint");
      expect(sql).toContain("\\ir fixtures/purge_store_census_173.inc");
      expect(sql).not.toContain("\\ir fixtures/purge_store_census_158.inc");
      expect(sql).not.toContain("\\ir fixtures/purge_store_census_155.inc");
    }
    expect(read("supabase/tests/v2_contracts.sql")).toContain("173::bigint");
  });

  it("preserves protected/withheld Future classifications and the account provenance exclusions in the 249-table plan", () => {
    const plan = JSON.parse(read("docs/export-member-plan.json")) as {
      tables: Record<string, { disposition: string; withheld?: string[]; scope?: string }>;
    };
    expect(Object.keys(plan.tables)).toHaveLength(249);
    for (const name of ["private.claimed_embryo_ingest_receipts", "private.claimed_embryo_job_receipts"])
      expect(plan.tables[name]?.disposition).toBe("deferred");
    expect(plan.tables["private.account_owned_cohort_purges"]?.disposition).toBe("excluded-internal");
    expect(plan.tables["public.future_person_claim_review_packages"]?.disposition).toBe("excluded-protected");
    expect(plan.tables["private.future_person_binding_config"]?.disposition).toBe("reference");
    for (const name of ["private.future_person_account_bindings",
      "private.future_person_object_relocations", "private.future_person_relocation_attempts"])
      expect(plan.tables[name]?.disposition).toBe("excluded-credential");
    expect(plan.tables["public.genome_files"]?.withheld).toContain("export_content_revision");
    expect(plan.tables["public.legal_audit_log"]?.scope).toContain("private.future_person_audit_selector_v1");
  });
});
