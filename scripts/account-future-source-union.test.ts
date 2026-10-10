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

  it("uses that exact literal inventory in each original complete-census consumer", () => {
    for (const name of ["future_person_claimant_erasure", "future_person_export_members", "future_person_export_source"]) {
      const sql = read(`supabase/tests/${name}.sql`);
      expect(sql).toContain("158::bigint");
      expect(sql).toContain("\\ir fixtures/purge_store_census_158.inc");
      expect(sql).not.toContain("\\ir fixtures/purge_store_census_155.inc");
    }
    expect(read("supabase/tests/v2_contracts.sql")).toContain("158::bigint");
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
