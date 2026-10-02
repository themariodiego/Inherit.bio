import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { historicalClaimedProvenanceProducerSql, validateHistoricalProducerInput, type HistoricalProducerInput } from "./claimed-provenance-historical-fixture";
import { claimedProvenanceProducerSql } from "./claimed-provenance-fixture";
import { HISTORICAL_LINEAGE, HISTORICAL_PROJECT, assertHistoricalParentReceipt, assertHistoricalConcurrencyFixture,
  historicalReceiptCheckSql, historicalAccountOwnedTarget } from "../claimed-provenance-historical-contract.mjs";
import { assertClaimedProvenanceNativeFixture } from "../claimed-provenance-wait-contract.mjs";

const head = "a".repeat(40);
const input: HistoricalProducerInput = {
  parent: { version: "claimed-provenance-historical-parent-request-v1", projectId: HISTORICAL_PROJECT, sourceCommit: head,
    lineage: HISTORICAL_LINEAGE, nativePost: "observed-aborted-before-dispatch",
    accountId: "10000000-0000-4000-8000-000000000001", authSessionId: "10000000-0000-4000-8000-000000000002",
    deletionId: "10000000-0000-4000-8000-000000000003", nonceHash: "b".repeat(64),
    effectiveRequestedAt: "2026-09-24T11:50:00.123Z", noticeEndsAt: "2026-10-01T11:50:00.123Z",
    recordedAt: "2026-10-01T12:00:00.123Z", nonceIssuedAt: "2026-10-01T11:59:59.123Z",
    nonceConsumedAt: "2026-10-01T12:00:00.122Z", nonceExpiresAt: "2026-10-01T12:09:59.123Z",
    envelopeSha256: "f".repeat(64), manifestIdentitySha256: "1".repeat(64), noticeIdentitySha256: "2".repeat(64) },
  subjectId: "10000000-0000-4000-8000-000000000004", claimantSessionHash: "c".repeat(64),
  claimantOperationNonce: "owner-current-claimant-operation-aaaaaaaa", claimantLeaseHash: "d".repeat(64), parentLeaseHash: "e".repeat(64),
  evidence: "synthetic-provider-metadata-only",
};
const prepared = { version: "claimed-provenance-concurrency-historical-fixture-v1", projectId: HISTORICAL_PROJECT, sourceCommit: head,
  accountDeletionId: input.parent.deletionId, claimantManifestId: "10000000-0000-4000-8000-000000000005",
  claimTokenHash: input.claimantLeaseHash, historicalParentRequest: input.parent, evidence: input.evidence };
const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

describe("separate historical receipt and actual protected protocol integration (execution remains unqualified)", () => {
  it("refuses native HTTP202 coercion, wrong clocks, absent immutable hashes and extra authority fields", () => {
    expect(assertHistoricalParentReceipt(input.parent, HISTORICAL_PROJECT, head)).toBe(input.parent);
    for (const changed of [{ ...input.parent, nativePost: "HTTP202" }, { ...input.parent, requestedAt: input.parent.effectiveRequestedAt },
      { ...input.parent, lineage: "native-deletion-accepted" }, { ...input.parent, noticeEndsAt: input.parent.recordedAt },
      { ...input.parent, nonceConsumedAt: "2026-10-01T12:10:00Z" }, { ...input.parent, envelopeSha256: null },
      { ...input.parent, nonceExpiresAt: "2026-10-01T12:10:00Z" }, { ...input.parent, recordedAt: "infinity" },
      { ...input.parent, providerAck: true }])
      expect(() => assertHistoricalParentReceipt(changed, HISTORICAL_PROJECT, head)).toThrow();
    expect(() => assertClaimedProvenanceNativeFixture(prepared, HISTORICAL_PROJECT, head)).toThrow();
  });
  it("requires the current source/project and distinct exact receipt links at preparation and consumption", () => {
    expect(validateHistoricalProducerInput(input, HISTORICAL_PROJECT, head)).toBe(input);
    expect(assertHistoricalConcurrencyFixture(prepared, HISTORICAL_PROJECT, head)).toBe(prepared);
    for (const changed of [{ ...prepared, accountDeletionId: prepared.claimantManifestId },
      { ...prepared, historicalParentRequest: { ...input.parent, sourceCommit: "e".repeat(40) } },
      { ...prepared, evidence: "physical-provider-qualified" }, { ...prepared, nativeParentRequest: input.parent },
      { ...prepared, claimTokenHash: "" }])
      expect(() => assertHistoricalConcurrencyFixture(changed, HISTORICAL_PROJECT, head)).toThrow();
    expect(() => validateHistoricalProducerInput({ ...input, claimantLeaseHash: input.parentLeaseHash }, HISTORICAL_PROJECT, head)).toThrow();
    expect(() => validateHistoricalProducerInput(input, "sequence", head)).toThrow();
  });
  it("binds complete immutable creation identity with NULL-safe equality and no state rewrite", () => {
    const check = historicalReceiptCheckSql(input.parent, HISTORICAL_PROJECT, head);
    for (const field of ["immutable_envelope", "manifest_class", "manifest_revision", "source_binding_fingerprint",
      "semantic_revision", "idempotency_key", "template_payload", "expires_at", "created_at", "not_before", "n.consumed_at is not null"])
      expect(check).toContain(field);
    expect(check).toContain("is not distinct from");
    expect(check).not.toMatch(/update |insert |delete |claim_expires_at|state='executing'/iu);
  });
  it("preserves the complete original protected due/ACK/custody protocol body, not a weaker adapter", () => {
    const historical = historicalClaimedProvenanceProducerSql(input, HISTORICAL_PROJECT, head);
    const native = claimedProvenanceProducerSql({ ...input, parent: {
      version: "claimed-provenance-native-parent-request-v1", projectId: input.parent.projectId,
      sourceCommit: input.parent.sourceCommit, accountId: input.parent.accountId,
      authSessionId: input.parent.authSessionId, deletionId: input.parent.deletionId, nonceHash: input.parent.nonceHash,
      requestedAt: input.parent.effectiveRequestedAt, noticeEndsAt: input.parent.noticeEndsAt,
    } }, HISTORICAL_PROJECT, head);
    const beginning = "  -- The global claim must select this exact receipt, once.";
    const ending = "  insert into pg_temp.claimed_pair_fixture_result";
    const immutableCheck = `  if not (${historicalReceiptCheckSql(input.parent, HISTORICAL_PROJECT, head)}) then\n` +
      "    raise exception using errcode='42501',message='historical immutable creation identity changed';end if;\n";
    expect(historical.includes(immutableCheck)).toBe(true);
    expect(historical.slice(historical.indexOf(beginning), historical.indexOf(ending)).replace(immutableCheck, ""))
      .toBe(native.slice(native.indexOf(beginning), native.indexOf(ending)));
    expect(historical.match(/public\.claim_due_account_deletion_v1\(/gu)).toHaveLength(1);
    expect(historical).not.toMatch(/update public\.(?:account_deletion_requests|retention_rows|retention_due_phases|mail_outbox)|delete from storage\.objects|grant |disable trigger/iu);
  });
  it("retains the entire original both-order controller and exact 57014/250ms rollback proof", () => {
    const native = read("scripts/claimed-provenance-independent-sessions.mjs");
    const historical = read("scripts/claimed-provenance-historical-independent-sessions.mjs");
    const beginning = "  // Real native current authority checks.";
    const ending = "  console.log(";
    expect(historical.slice(historical.indexOf(beginning), historical.lastIndexOf(ending)))
      .toBe(native.slice(native.indexOf(beginning), native.lastIndexOf(ending)));
    expect(historical).toContain("historicalReceiptCheckSql(historical,project,head)");
    expect(historical).toContain("private.assert_account_affected_notice_receipt_v1(");
    expect(historical).toContain("assertClaimedPairWaitReceipt(observed)");
    expect(historical).toContain("assert.match(String(result.error), /57014/");
    expect(historical).toContain("assert.equal(await snapshot(), before");
  });
  it("wires the real aborted-page issuance, actual verifier, creation, producer and receipt consumer separately", () => {
    const helper = read("e2e/helpers/claimed-provenance-historical-request.ts");
    const runner = read("scripts/tools/historical-account-request.run.mts");
    const authority = read("scripts/tools/historical-account-authority.ts");
    for (const value of ['await page.route(pattern, intercept)', 'await route.abort("aborted")', 'await actualFailure',
      'page.getByTestId("delete-account").click()', 'ownerIpc("create"', 'ownerIpc("prepare"',
      "assertHistoricalConcurrencyFixture", "Aborted issuance cannot dispatch, consume or create", "s.file_id=m.file_id"])
      expect(helper).toContain(value);
    expect(helper).not.toMatch(/route\.fulfill|request\.post|mintAccountOperationNonce|console\.|HTTP202.*assert/iu);
    for (const value of ["verifyHistoricalAccountAuthority(observation, client)", "historicalAccountCreationSql(authority)",
      "historicalClaimedProvenanceProducerSql(input.input", "console.warn = console.error", "child.stdin.end(sql)", "setAll: () => { throw"])
      expect(runner).toContain(value);
    expect(authority).toContain("getSensitiveAccountContextFromClient(client)");
    expect(authority).toContain("client.auth.getClaims()");
    expect(authority).toContain("verifyAccountOperationNonce(input.observation.body.nonce, {");
    expect(authority).not.toMatch(/verifyAccountOperationNonce\([^;]*p_effective_at|mintAccountOperationNonce|claims\.amr\s*=/iu);
  });
  it("cannot target production, another local project or a mismatched app/Auth runtime", () => {
    const config = 'project_id = "inherit-integrator-20260930"\n[api]\nport = 54321\n';
    const env = { NODE_ENV: "test", INHERIT_TEST_JURISDICTION: "1", NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
      NEXT_PUBLIC_SITE_URL: "http://127.0.0.1:3105", NEXT_PUBLIC_SUPABASE_ANON_KEY: "unit-marker", BYOK_ENCRYPTION_KEY: "unit-marker" };
    expect(historicalAccountOwnedTarget(config, env).projectId).toBe(HISTORICAL_PROJECT);
    for (const changed of [{ ...env, VERCEL: "1" }, { ...env, NODE_ENV: "production" },
      { ...env, NEXT_PUBLIC_SUPABASE_URL: "https://example.invalid" }, { ...env, NEXT_PUBLIC_SITE_URL: "http://127.0.0.1:3000" },
      { ...env, INHERIT_TEST_JURISDICTION: "0" }]) expect(() => historicalAccountOwnedTarget(config, changed)).toThrow();
    expect(() => historicalAccountOwnedTarget(config.replace(HISTORICAL_PROJECT, "sequence"), env)).toThrow();
    expect(() => historicalAccountOwnedTarget(config + '[api]\nport = 54322\n', env)).toThrow();
  });
});
