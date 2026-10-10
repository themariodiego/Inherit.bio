import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { EXPECTED_PROTECTED_OBJECTION_CATALOG, PROTECTED_OBJECTION_CATALOG_SQL,
  PROTECTED_OBJECTION_DELETE, assertDirectServiceObjectionDenied,
  assertProtectedObjectionCatalog, statementProbeRole } from "./invitation-lock-owner-contract.mjs";

const root = path.resolve(__dirname, "..");
const read = (name: string) => readFileSync(path.join(root, name), "utf8");
function body(migration: string, name: string) {
  const text = read(`supabase/migrations/${migration}`);
  const expression = new RegExp(`create (?:or replace )?function ${name.replaceAll(".", "\\.")}\\([^;]*?\\bas\\s+(\\$[a-z_]*\\$)([\\s\\S]*?)\\1;`, "iu");
  return text.match(expression)![2]!;
}
const md5 = (text: string) => createHash("md5").update(text).digest("hex");

describe("the independently verified protected objection lock path", () => {
  it("uses the native owner only for the exact reviewed protected table, never as an ACL fallback", () => {
    expect(statementProbeRole("future_person_claim_objections")).toBe("postgres");
    for (const table of ["legal_evidence_ingest_sessions", "legal_evidence_fragments", "legal_evidence_documents",
      "legal_evidence_review_copies", "legal_evidence_working_data", "legal_evidence_assignments",
      "reviewed_evidence", "legal_reviews", "embryo_basis_bindings", "future_person_claim_documents",
      "correction_assignments", "appeal_evidence", "another_denied_table", "public.future_person_claim_objections"])
      expect(statementProbeRole(table)).toBe("service_role");
    expect(PROTECTED_OBJECTION_DELETE).toBe("delete from public.future_person_claim_objections where false");
  });
  it("pins actual current native executor and both Auth/link entrypoint bodies, not an invented owner helper", () => {
    const source = "20261001027000_future_person_account_objection.sql";
    for (const item of EXPECTED_PROTECTED_OBJECTION_CATALOG.native)
      expect(md5(body(source, item.signature.split("(")[0]!))).toBe(item.body);
    const executor = body(source, "private.record_keyless_owner_objection_v1");
    expect(executor).toContain("insert into public.future_person_claim_objections");
    const account = body(source, "public.submit_future_person_account_objection_v1");
    expect(account).toContain("private.keyless_owner_account_v1(p_notice)");
    expect(account).toContain("private.consume_embryo_operation_nonce_v1");
    const link = body(source, "public.submit_future_person_owner_objection_v1");
    expect(link).toContain("private.keyless_owner_rights_session_v1(p_session_hash,true)");
    expect(link).toContain("private.consume_future_person_rights_nonce_v1(rs,p_nonce)");
  });
  it("pins the real statement trigger and the original advisory-lock function", () => {
    const source = read("supabase/migrations/20260906064136_refused_evidence_write_fence.sql");
    expect(source).toContain("create trigger evidence_transition_lock before insert or update or delete on public.%I");
    expect(source).toContain("for each statement execute function private.lock_evidence_transition_v1()");
    expect(md5(body("20260906064136_refused_evidence_write_fence.sql", "private.lock_evidence_transition_v1")))
      .toBe(EXPECTED_PROTECTED_OBJECTION_CATALOG.triggerFunction.body);
    expect(md5(body("20260906051253_invitation_refusal_transaction.sql", "private.lock_invitation_transitions_v1")))
      .toBe(EXPECTED_PROTECTED_OBJECTION_CATALOG.transitionFunction.body);
    expect(read("supabase/migrations/20261001023000_future_person_owner_objection_prerequisite.sql"))
      .toContain("revoke all on public.future_person_claim_objections from public,anon,authenticated,inherit_upload_only,service_role;");
    expect(PROTECTED_OBJECTION_CATALOG_SQL).toContain("has_any_column_privilege");
    expect(PROTECTED_OBJECTION_CATALOG_SQL).not.toMatch(/grant |alter |create |delete |update /iu);
  });
  it("accepts only the exact reviewed owner, denied ACL, enabled trigger and native source contract", () => {
    expect(() => assertProtectedObjectionCatalog(structuredClone(EXPECTED_PROTECTED_OBJECTION_CATALOG))).not.toThrow();
    type MutableCatalog = Omit<typeof EXPECTED_PROTECTED_OBJECTION_CATALOG, "apiTableAccess" | "apiColumnAccess"> & {
      apiTableAccess: string[];
      apiColumnAccess: string[];
    };
    const mutations = [
      (value: typeof EXPECTED_PROTECTED_OBJECTION_CATALOG) => { value.tableOwner = "service_role"; },
      (value: typeof EXPECTED_PROTECTED_OBJECTION_CATALOG) => { value.rowSecurity = false; },
      (value: MutableCatalog) => { value.apiTableAccess = ["service_role"]; },
      (value: MutableCatalog) => { value.apiColumnAccess = ["authenticated"]; },
      (value: typeof EXPECTED_PROTECTED_OBJECTION_CATALOG) => { value.foreignTableAcl = 1; },
      (value: typeof EXPECTED_PROTECTED_OBJECTION_CATALOG) => { value.trigger.enabled = "D"; },
      (value: typeof EXPECTED_PROTECTED_OBJECTION_CATALOG) => { value.trigger.type = 31; },
      (value: typeof EXPECTED_PROTECTED_OBJECTION_CATALOG) => { value.triggerFunction.body = "changed"; },
      (value: typeof EXPECTED_PROTECTED_OBJECTION_CATALOG) => { value.transitionFunction.body = "changed"; },
      (value: typeof EXPECTED_PROTECTED_OBJECTION_CATALOG) => { value.native[0]!.owner = "service_role"; },
      (value: typeof EXPECTED_PROTECTED_OBJECTION_CATALOG) => { value.native[0]!.body = "changed"; },
      (value: typeof EXPECTED_PROTECTED_OBJECTION_CATALOG) => { value.native[0]!.roles = ["service_role"]; },
      (value: typeof EXPECTED_PROTECTED_OBJECTION_CATALOG) => { value.native[0]!.securityDefiner = false; },
    ];
    for (const mutate of mutations) {
      const altered = structuredClone(EXPECTED_PROTECTED_OBJECTION_CATALOG); mutate(altered);
      expect(() => assertProtectedObjectionCatalog(altered)).toThrow("Protected objection owner/ACL/trigger/native source contract differs");
    }
    for (const missing of [null, {}, { ...EXPECTED_PROTECTED_OBJECTION_CATALOG, extra: "unreviewed" }])
      expect(() => assertProtectedObjectionCatalog(missing)).toThrow();
  });
  it("requires this table's actual 42501 denial and rejects success, other failures and cancellation", () => {
    expect(() => assertDirectServiceObjectionDenied(new Error("ERROR: 42501: permission denied for table future_person_claim_objections"))).not.toThrow();
    for (const error of [null, "returned early", new Error("57014: query cancelled"),
      new Error("42501: permission denied for table other"), new Error("55000: permission denied for table future_person_claim_objections"),
      new Error("42501: permission denied for table future_person_claim_objections;57014")])
      expect(() => assertDirectServiceObjectionDenied(error)).toThrow();
  });
  it("retains all original probes, exact independent-session lock observations and timing/cancellation assertions", () => {
    const runner = read("scripts/invitation-transition-locks.mjs");
    const originalFunctions = ["create_embryo_cohort_draft_v1", "sign_embryo_artifact_v1", "create_embryo_draft_invitation_v1",
      "finalize_embryo_cohort_v1", "activate_rights_session_v1", "accept_embryo_co_parent_invitation_v1",
      "create_adult_subject_invitation_v1", "respond_adult_subject_invitation_v1", "expire_due_adult_subject_invitations_v1",
      "claim_mail_outbox", "authorize_mail_submission_v1", "read_co_parent_refusal_v1", "refuse_co_parent_invitation_session_v1",
      "expire_invitation_refusal_receipts_v1", "run_due_embryo_retention_phases_v1", "claim_refused_invitation_draft_purge_v1",
      "finish_refused_invitation_draft_purge_v1", "authorize_refused_invitation_storage_v1"];
    const block = runner.slice(runner.indexOf("const probes = ["), runner.indexOf("const statements = ["));
    expect([...block.matchAll(/"([a-z0-9_]+)\(/gu)].map(match => match[1])).toEqual(originalFunctions);
    const tableBlock = runner.match(/\.\.\.\[([\s\S]*?)\]\s*\.map\(\(table\)/u)![1]!;
    expect([...tableBlock.matchAll(/"([a-z0-9_]+)"/gu)].map(match => match[1])).toEqual([
      "legal_evidence_ingest_sessions", "legal_evidence_fragments", "legal_evidence_documents",
      "legal_evidence_review_copies", "legal_evidence_working_data", "legal_evidence_assignments",
      "reviewed_evidence", "legal_reviews", "embryo_basis_bindings", "future_person_claim_documents",
      "future_person_claim_objections", "correction_assignments", "appeal_evidence",
    ]);
    for (const exact of ["12_000", "Date.now() + 3000", "await delay(20)", "set local statement_timeout='5s'",
      "set local idle_in_transaction_session_timeout='10s'", "classid=1869509217 and objid=1 and objsubid=2 and not granted",
      "select pg_cancel_backend(${pid})", 'assert(waiting, `${probe.name}: did not wait on the transition lock;',
      'assert.match(String(result.error), /57014/, "Probe must end by query cancellation")']) expect(runner).toContain(exact);
    expect(runner.indexOf("assertProtectedObjectionCatalog(JSON.parse")).toBeLessThan(runner.indexOf("select pg_advisory_lock(1869509217,1)"));
    expect(runner.indexOf("assertDirectServiceObjectionDenied(result.error)")).toBeLessThan(runner.indexOf("for (const probe of statements)"));
    expect(runner).not.toMatch(/grant |disable trigger|set.*lock_timeout/iu);
  });
});
