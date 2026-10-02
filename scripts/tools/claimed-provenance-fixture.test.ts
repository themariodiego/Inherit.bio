import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { claimedProvenanceProducerSql, SHARED_RECEIPT_PROJECT, validateClaimedProvenanceProducerInput,
  type ClaimedProvenanceProducerInput } from "./claimed-provenance-fixture";
import { assertClaimedPairWaitReceipt, claimedPairWaitSql, assertClaimedProvenanceNativeFixture } from "../claimed-provenance-wait-contract.mjs";

const head = "a".repeat(40);
const fixture: ClaimedProvenanceProducerInput = {
  parent: { version: "claimed-provenance-native-parent-request-v1", projectId: SHARED_RECEIPT_PROJECT, sourceCommit: head,
    accountId: "10000000-0000-4000-8000-000000000001", authSessionId: "10000000-0000-4000-8000-000000000002",
    deletionId: "10000000-0000-4000-8000-000000000003", nonceHash: "b".repeat(64),
    requestedAt: "2026-10-01T12:00:00.123Z", noticeEndsAt: "2026-10-08T12:00:00.123Z" },
  subjectId: "10000000-0000-4000-8000-000000000004", claimantSessionHash: "c".repeat(64),
  claimantOperationNonce: "actual-owner-claimant-operation-aaaaaaaa", claimantLeaseHash: "d".repeat(64), parentLeaseHash: "e".repeat(64),
  evidence: "synthetic-provider-metadata-only",
};
const read = (name: string) => readFileSync(new URL(`../../${name}`, import.meta.url), "utf8");

describe("a native request never becomes a fabricated due or disposal authority", () => {
  it("accepts only the closed exact owned source, distinct authority IDs and seven-day receipt", () => {
    expect(validateClaimedProvenanceProducerInput(fixture, SHARED_RECEIPT_PROJECT, head)).toBe(fixture);
    for (const change of [
      { ...fixture, candidate: {} }, { ...fixture, clock: fixture.parent.requestedAt },
      { ...fixture, subjectId: fixture.parent.accountId }, { ...fixture, claimantSessionHash: "not-a-hash" },
      { ...fixture, parentLeaseHash: fixture.claimantLeaseHash }, { ...fixture, evidence: "provider-delivered" },
      { ...fixture, parent: { ...fixture.parent, noticeEndsAt: "2026-10-09T12:00:00.123Z" } },
      { ...fixture, parent: { ...fixture.parent, noticeEndsAt: "infinity" } },
      { ...fixture, parent: { ...fixture.parent, providerAck: true } },
      { ...fixture, claimantOperationNonce: "a".repeat(15) }, { ...fixture, claimantOperationNonce: "a".repeat(257) },
    ]) expect(() => validateClaimedProvenanceProducerInput(change as ClaimedProvenanceProducerInput, SHARED_RECEIPT_PROJECT, head)).toThrow();
    expect(() => validateClaimedProvenanceProducerInput(fixture, "sequence", head)).toThrow();
    expect(() => validateClaimedProvenanceProducerInput(fixture, SHARED_RECEIPT_PROJECT, "f".repeat(40))).toThrow();
  });
  it("requires the real consumed nonce, original notice envelope and due boundary before the one queue claim", () => {
    const sql = claimedProvenanceProducerSql(fixture, SHARED_RECEIPT_PROJECT, head);
    for (const text of ["n.operation='account_delete' and n.consumed_at is not null", "'originalNoticeEndsAt'",
      "private.assert_account_affected_notice_receipt_v1(d.id,phase.immutable_envelope)",
      "native seven-day notice is not due", "synthetic queue is not isolated", "exact parent claim unavailable"])
      expect(sql).toContain(text);
    expect(sql.match(/public\.claim_due_account_deletion_v1\(/gu)).toHaveLength(1);
    expect(sql.indexOf("native seven-day notice is not due")).toBeLessThan(sql.indexOf("public.claim_due_account_deletion_v1("));
    expect(sql).not.toMatch(/update public\.(?:account_deletion_requests|retention_rows|retention_due_phases|mail_outbox)|insert into public\.account_deletion_requests|grant |disable trigger|session_replication_role|interval '8 days'/iu);
  });
  it("cannot substitute the old six-field receipt or another native parent request at the independent controller", () => {
    const prepared = { version: "claimed-provenance-concurrency-native-fixture-v1", projectId: SHARED_RECEIPT_PROJECT,
      sourceCommit: head, accountDeletionId: fixture.parent.deletionId,
      claimantManifestId: "10000000-0000-4000-8000-000000000005", claimTokenHash: fixture.claimantLeaseHash,
      nativeParentRequest: fixture.parent };
    expect(() => assertClaimedProvenanceNativeFixture(prepared, SHARED_RECEIPT_PROJECT, head)).not.toThrow();
    for (const changed of [{ ...prepared, version: "claimed-provenance-concurrency-fixture-v1" },
      { ...prepared, nativeParentRequest: { ...prepared.nativeParentRequest, deletionId: prepared.claimantManifestId } },
      { ...prepared, nativeParentRequest: { ...prepared.nativeParentRequest, nonceHash: "" } },
      { ...prepared, nativeParentRequest: { ...prepared.nativeParentRequest, requestedAt: "infinity" } },
      { ...prepared, nativeParentRequest: { ...prepared.nativeParentRequest, providerAck: true } }])
      expect(() => assertClaimedProvenanceNativeFixture(changed, SHARED_RECEIPT_PROJECT, head)).toThrow();
  });
  it("derives every candidate/object from current custody/native inventories and refuses absent prior physical disposal", () => {
    const sql = claimedProvenanceProducerSql(fixture, SHARED_RECEIPT_PROJECT, head);
    for (const text of ["rs.target_id is distinct from", "private.assert_future_person_subject_custody_v1(rs.target_id)",
      "private.claimed_provenance_candidate_v1(c.source_file_id)", "after_candidate is distinct from original_candidate",
      "private.prepare_future_person_deletion_v1(", "public.future_person_deletion_parts_v1('claim'",
      "public.future_person_deletion_parts_v1('acknowledge'", "prior exact identity-object disposal required",
      "prior exact original-object disposal required", "public.confirm_claim_document_objects_deleted_v1(",
      "private.embryo_ingest_disposal_receipt_v1(disposal)", "public.complete_account_deletion_storage_v1(",
      "set constraints all immediate", "synthetic-provider-metadata-only"])
      expect(sql).toContain(text);
    expect(sql).not.toMatch(/delete from storage\.objects|delete from private\.claim_documents|update .*status='deleted'|\.finish_future_person_deletion_v1\(/iu);
  });
  it("observes the actual account POST without replaying, editing or leaking its page-issued signed nonce", () => {
    const native = read("e2e/helpers/claimed-provenance-native-request.ts");
    for (const text of ["auth.auth.getClaims()", 'observeNativeResponses(page, { deletion: "^/api/account/delete$" })',
      'page.getByTestId("delete-account").click()', "assert.equal(response.status, 202", "assert.equal(count, 1",
      "createHash(\"sha256\").update(body.nonce)", "n.consumed_at is not null", "begin read only", "page.off(\"request\", observeRequest)"])
      expect(native).toContain(text);
    expect(native).not.toMatch(/page\.route|request\.post|mintAccountOperationNonce|verifyAccountOperationNonce|console\.|claims\.amr\s*=|update public|insert into public/iu);
  });
});

describe("owned separate-session observation keeps the native 250ms refusal", () => {
  const scope = { holderPid: 101, peerPid: 102, peerStartedAt: "2026-10-01T12:00:00.123Z",
    peerName: "claimed-pair-owned-peer-10000000-0000-4000-8000-000000000001-0", lockKey: "-12345" };
  const receipt = { version: "claimed-pair-wait-v1", exactPairWaiting: true, exactOwnedPeer: true, cancelled: true, queryElapsedMs: 12.5 };
  it("refuses unknown peers, malformed pair keys and caller-supplied authority or timing", () => {
    expect(() => claimedPairWaitSql(scope)).not.toThrow();
    for (const changed of [{ ...scope, peerPid: scope.holderPid }, { ...scope, peerPid: -1 },
      { ...scope, peerName: "another-running-session" }, { ...scope, peerStartedAt: "infinity" },
      { ...scope, lockKey: "9223372036854775808" }, { ...scope, timeoutMs: 500 }, { ...scope, candidate: {} }])
      expect(() => claimedPairWaitSql(changed)).toThrow();
  });
  it("checks the same backend/pair/blocker and cancels inside one owner invocation before the original ceiling", () => {
    const sql = claimedPairWaitSql(scope);
    for (const text of ["current_user<>'postgres'", "pg_stat_clear_snapshot()", "held.objsubid=1",
      "peer.backend_start=", "peer.application_name=", "peer.wait_event_type='Lock'", "pg_catalog.pg_blocking_pids(peer.pid)",
      "elapsed_ms>=250", "pg_catalog.pg_cancel_backend(peer.pid)", "peer.pid=102", "peer.query_start=peer_query_started_at",
      "cancelled is distinct from true", "interval '3 seconds'", "pg_catalog.pg_sleep(0.001)"])
      expect(sql).toContain(text);
    const cancellation = sql.indexOf("select pg_catalog.pg_cancel_backend(peer.pid)");
    const afterCancellation = sql.indexOf("elapsed_ms:=extract(epoch from clock_timestamp()-peer_query_started_at)*1000", cancellation);
    expect(afterCancellation).toBeGreaterThan(cancellation);
    expect(sql.indexOf("insert into pg_temp.claimed_pair_wait_receipt")).toBeGreaterThan(afterCancellation);
    expect(sql).not.toMatch(/set .*lock_timeout|grant |update |delete |create function|query\s*[=~]/iu);
  });
  it("refuses a missed window, false cancellation or a widened observation instead of accepting a timeout", () => {
    expect(() => assertClaimedPairWaitReceipt(receipt)).not.toThrow();
    for (const changed of [{ ...receipt, queryElapsedMs: 250 }, { ...receipt, queryElapsedMs: -1 },
      { ...receipt, queryElapsedMs: Number.NaN }, { ...receipt, exactPairWaiting: false },
      { ...receipt, exactOwnedPeer: false }, { ...receipt, cancelled: false }, { ...receipt, providerAck: true }])
      expect(() => assertClaimedPairWaitReceipt(changed)).toThrow();
    const controller = read("scripts/claimed-provenance-independent-sessions.mjs");
    expect(controller.indexOf("const observing = observer.query(")).toBeLessThan(controller.indexOf("const attempt = peer.query("));
    for (const text of ["assertClaimedPairWaitReceipt(observed)", "assert.match(String(result.error), /57014/",
      "set constraints all immediate", "await holder.query(\"rollback\")", "assert.equal(await snapshot(), before",
      "assert(await ledgerSnapshot() === beforeLedger", "'public','private','auth','storage'", "child.stdin.end()"])
      expect(controller).toContain(text);
    expect(controller).not.toMatch(/grant |disable trigger|set .*lock_timeout|console\.log\(.*(?:error|fixture|token)/iu);
  });
});
