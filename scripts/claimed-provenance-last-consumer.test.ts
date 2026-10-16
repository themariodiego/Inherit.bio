import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { assertClaimedProvenanceCatalog, assertClaimedProvenanceFixture, OWNED_PROJECT } from "./claimed-provenance-lock-contract.mjs";
import patches from "../docs/claimed-provenance-body-patches.json";
import pins from "../docs/claimed-provenance-function-pins.json";
import receiptCatalog from "../docs/claimed-provenance-receipt-catalog.json";

const read = (name: string) => readFileSync(new URL(`../${name}`, import.meta.url), "utf8");
const migration = read("supabase/migrations/20261001036000_claimed_provenance_last_consumer.sql");
const md5 = (text: string) => createHash("md5").update(text).digest("hex");
function body(source: string, name: string) {
  const escaped = name.replaceAll(".", "\\.");
  const match = source.match(new RegExp(`create (?:or replace )?function ${escaped}\\([^)]*\\)[\\s\\S]*?as \\$\\$([\\s\\S]*?)\\$\\$;`, "iu"));
  if (!match) throw new Error(`Missing native function ${name}`);
  return match[1]!;
}
const successor = (name: string) => {
  const patch = patches.find(item => item.name === name)!;
  let current = body(read(`supabase/migrations/${patch.source}`), name);
  for (const [anchor, replacement] of patch.replacements) current = current.replace(anchor!, replacement!);
  return current;
};

describe("exact last-consumer shared provenance source and authority", () => {
  it("reconstructs each guarded successor from the full exact predecessor, preserving every unrelated byte", () => {
    expect(patches).toHaveLength(6);
    for (const patch of patches) {
      let current = body(read(`supabase/migrations/${patch.source}`), patch.name);
      expect(md5(current)).toBe(patch.before);
      for (const [anchor, replacement] of patch.replacements) {
        expect(current.split(anchor!).length - 1).toBe(1);
        expect(migration).toContain(anchor!); expect(migration).toContain(replacement!);
        current = current.replace(anchor!, replacement!);
      }
      expect(md5(current)).toBe(patch.after);
      for (const [, replacement] of patch.replacements.toReversed()) expect(current).toContain(replacement!);
      expect(migration).toContain(`md5(prosrc)='${patch.before}'`);
      expect(migration).toContain(`md5(prosrc)='${patch.after}'`);
      expect(pins.find(item => item.signature === patch.signature)?.body).toBe(patch.after);
    }
    for (const pin of pins.slice(6)) expect(md5(body(migration, pin.signature.split("(")[0]!))).toBe(pin.body);
  });
  it("pins the independently captured complete receipt constraints, indexes and triggers without a normalization fallback", () => {
    const captured = migration.match(/\$receipt_catalog\$([\s\S]*?)\$receipt_catalog\$::jsonb/u)![1]!;
    expect(JSON.parse(captured)).toEqual(receiptCatalog);
    expect(receiptCatalog.map(item => item.relation)).toEqual([
      "private.claimed_embryo_ingest_receipts", "private.claimed_embryo_job_receipts",
    ]);
    expect(receiptCatalog.map(item => item.constraints.length)).toEqual([9, 8]);
    expect(receiptCatalog.map(item => item.indexes.length)).toEqual([2, 2]);
    expect(receiptCatalog.map(item => item.triggers.length)).toEqual([2, 2]);
    for (const exact of ["pg_get_constraintdef(c.oid)", "pg_get_indexdef(i.indexrelid)", "pg_get_triggerdef(t.oid)",
      "has_any_column_privilege", "acl.grantee<>c.relowner", "claimed provenance exact table guard differs",
      "t.tgdeferrable and t.tginitdeferred and t.tgqual is null", "p.proconfig=expected.configuration", "p.proargdefaults is null"])
      expect(migration).toContain(exact);
    expect(migration).not.toMatch(/regexp_replace|lower\(pg_get|disable trigger/iu);
  });
  it("locks actual parent capture in pair order, and locks both native finalizers before any last-consumer decision", () => {
    const capture = successor("private.capture_claimed_embryo_provenance_v1");
    expect(capture).toContain("order by x.session_id,x.worker_job_id,x.file_id loop");
    expect(capture).toContain("private.claimed_provenance_candidate_v1(r.file_id)");
    expect(capture.indexOf("private.lock_claimed_provenance_pairs_v1(candidates)")).toBeLessThan(capture.indexOf("insert into private.claimed_embryo_ingest_receipts"));
    const parent = successor("private.purge_account_owned_cohorts_v1");
    expect(parent.indexOf("private.account_claimed_provenance_candidates_v1")).toBeLessThan(parent.indexOf("delete from public.embryo_ingest_sessions"));
    expect(parent.indexOf("delete from public.worker_jobs")).toBeLessThan(parent.indexOf("private.collect_claimed_provenance_pair_v1"));
    expect(parent.indexOf("private.collect_claimed_provenance_pair_v1")).toBeLessThan(parent.lastIndexOf("delete from private.account_owned_cohort_purges"));
    const claimant = successor("private.finish_future_person_deletion_v1");
    expect(claimant.indexOf("private.lock_claimed_provenance_pairs_v1")).toBeLessThan(claimant.indexOf("private.assert_future_person_deletion_fk_closure_v1"));
    expect(claimant.indexOf("status<>'deleted'" , claimant.indexOf("set constraints public.subjects_claimant_principal_id_fkey immediate"))).toBeLessThan(claimant.indexOf("private.collect_claimed_provenance_pair_v1"));
    const locks = body(migration, "private.lock_claimed_provenance_pairs_v1");
    expect(locks).toContain("order by value#>>'{ingest,id}',value#>>'{job,id}'");
    expect(locks).toContain("pg_advisory_xact_lock(hashtextextended('inherit.claimed-provenance-pair-v1|'" );
    expect(locks).not.toMatch(/delete from|update |insert into/iu);
  });
  it("seals the candidate before fingerprinting and minimizes terminal controls to a closed disposition", () => {
    const prepare = successor("private.prepare_future_person_deletion_v1");
    expect(prepare.indexOf("'sharedProvenance',private.claimed_provenance_candidate_v1(x.file_id)")).toBeLessThan(prepare.indexOf("insert into public.retention_due_phases"));
    expect(prepare).toContain("digest(convert_to(env::text,'UTF8'),'sha256')");
    const finish = successor("private.finish_future_person_deletion_v1");
    const terminal = finish.slice(finish.indexOf("-- Preserve coded terminal controls"));
    expect(terminal).toContain("'sharedProvenanceDisposition',v_shared_disposition");
    expect(terminal).not.toContain("'sharedProvenance',");
    const freeze = successor("private.freeze_future_person_deletion_plan_v1");
    expect(freeze).toContain("not in('absent','collected','retained-for-surviving-provenance','retained-for-live-runtime')");
    expect(prepare).toContain("v_now+interval '7 days'"); expect(prepare).toContain("v_now+interval '30 days'");
    expect(migration).not.toMatch(/create table|alter table|insert into public\.purge_target_stores|grant execute|disable trigger/iu);
  });
  it("requires actual deletion authority and every survivor tuple before removing job then ingest", () => {
    const collect = body(migration, "private.collect_claimed_provenance_pair_v1");
    for (const exact of ["m.state<>'executing'", "m.physical_purge_started_at is null", "phase.immutable_envelope->'sharedProvenance' is distinct from p_candidate",
      "e.status<>'deleted'", "d.storage_completed_at is null", "t.fixed_deadline=d.notice_ends_at", "phase.claim_expires_at<=clock_timestamp()",
      "private.lock_claimed_provenance_pairs_v1", "private.claimed_provenance_pair_state_v1", "'retained-for-surviving-provenance'", "'retained-for-live-runtime'"])
      expect(collect).toContain(exact);
    expect(collect.indexOf("delete from private.claimed_embryo_job_receipts")).toBeLessThan(collect.indexOf("delete from private.claimed_embryo_ingest_receipts"));
    const state = body(migration, "private.claimed_provenance_pair_state_v1");
    for (const exact of ["u.lifecycle in('claimed_unbound','claimed_bound')", "private.assert_future_person_subject_custody_v1(u.id)",
      "private.embryo_canonical_source_parts", "x.source_sha256 is distinct from private.embryo_canonical_source_sha256_v1",
      "x.membership_sha256 is distinct from private.embryo_canonical_membership_sha256_v1", "f.user_id=c.owner_account_id",
      "t.lifecycle_revision=c.lifecycle_revision", "unwind.purpose='source'", "o.source_id=p.id", "o.bucket_id=p.provider_bucket", "o.object_name=p.provider_key"])
      expect(state).toContain(exact);
  });
  it("retains every original claimant assertion in the extended real-producer scenario and authors both finalization orders", () => {
    const original = read("supabase/tests/future_person_claimant_erasure.sql");
    const extended = read("supabase/tests/claimed_provenance_last_consumer.sql");
    let remaining = extended;
    // Entire original source stays byte-identical; this additional scenario
    // retains each original line in order while adding the missing lifecycle.
    for (const line of original.split("\n")) {
      const index = remaining.indexOf(line);
      expect(index, line).toBeGreaterThanOrEqual(0); remaining = remaining.slice(index + line.length);
    }
    expect(extended).toContain("the claimant finalizer preserves the surviving parent source shared pair byte-exact");
    expect(extended).toContain("both exact shared receipts are absent after real last-consumer parent finalization");
    const last = read("supabase/tests/claimed_provenance_last_claimant.sql");
    expect(last).toContain("the genuine claimant request seals the unchanged archived pair without rebuilding historical values");
    expect(last).toContain("the real last claimant finalizer collects the minimum pair only inside complete acknowledged graph disposal");
    for (const sql of [extended, last]) {
      expect(sql).toContain("\\ir fixtures/future_person_deletion_authority.inc");
      expect(sql).toContain("set constraints all immediate;"); expect(sql.trimEnd()).toMatch(/rollback;$/u);
      expect(sql).not.toMatch(/disable trigger|set (?:local )?session_replication_role/iu);
    }
  });
});

const receipt = { version: "claimed-provenance-concurrency-fixture-v1", projectId: OWNED_PROJECT,
  sourceCommit: "a".repeat(40), accountDeletionId: "10000000-0000-0000-0000-000000000001",
  claimantManifestId: "10000000-0000-0000-0000-000000000002", claimTokenHash: "a".repeat(64) };
it("refuses foreign stacks, wrong source, widened fixture fields and crossed authority IDs before a process starts", () => {
  expect(() => assertClaimedProvenanceFixture(receipt, OWNED_PROJECT, receipt.sourceCommit)).not.toThrow();
  for (const changed of [{ ...receipt, providerAck: {} }, { ...receipt, projectId: "sequence" },
    { ...receipt, sourceCommit: "b".repeat(40) }, { ...receipt, claimantManifestId: receipt.accountDeletionId },
    { ...receipt, accountDeletionId: "not-a-uuid" }, { ...receipt, claimTokenHash: "" }])
    expect(() => assertClaimedProvenanceFixture(changed, OWNED_PROJECT, receipt.sourceCommit)).toThrow();
  expect(() => assertClaimedProvenanceFixture(receipt, "sequence", receipt.sourceCommit)).toThrow();
  const runner = read("scripts/claimed-provenance-pair-locks.mjs");
  expect(runner.indexOf("assertClaimedProvenanceFixture(")).toBeLessThan(runner.indexOf('spawn("docker"'));
  for (const exact of ["12_000", "performance.now() + 3000", "await delay(20)", "set local statement_timeout='5s'",
    "held.objsubid=1", "select pg_cancel_backend(${peerPid})", "assert(waiting", "assert.match(String(result.error), /57014/",
    "await holder.query(\"rollback\")", "assert.equal(await snapshot(), before"])
    expect(runner).toContain(exact);
  expect(runner).not.toMatch(/grant |disable trigger|commit[;"']/iu);
});
it("accepts only the complete reviewed native catalog and denies a new API role, body, owner, configuration or field", () => {
  const expected = pins.map(pin => ({ ...pin, owner: "postgres", language: "plpgsql", securityDefiner: true,
    volatility: "v", parallel: "u", defaults: null, apiRoles: [] as string[], foreignAcl: 0, ownerAcl: 1 }));
  expect(() => assertClaimedProvenanceCatalog(expected, pins)).not.toThrow();
  for (const delta of [{ apiRoles: ["service_role"] }, { body: "altered" }, { owner: "service_role" },
    { config: [] }, { args: [] }, { foreignAcl: 1 }, { ownerAcl: 2 }, { providerAck: true }]) {
    const changed = structuredClone(expected); Object.assign(changed[0]!, delta);
    expect(() => assertClaimedProvenanceCatalog(changed, pins)).toThrow();
  }
});
