import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
const rpc = vi.hoisted(() => vi.fn());
vi.mock("@/lib/supabase/admin", async () => {
 const { createClient } = await import("@supabase/supabase-js");
 return { createAdminClient: () => createClient("https://synthetic.invalid", "synthetic-key", {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }, global: { fetch: async (input, init) => {
   const result = await rpc(new URL(String(input)).pathname.split("/").at(-1), JSON.parse(String(init?.body)), init?.signal);
   return Response.json(result.error ?? result.data, { status: result.error ? 400 : 200 });
  } },
 }) };
});
import { loadPublicAppealDecisionNotice } from "./public-appeal-decision-notice";
import { sealNewAppeal } from "./appeal-case-envelope";
import { sealAppealDecisionReference } from "./public-appeal-review";
import { RIGHTS_COOKIE_NAME, rightsSessionHash } from "@/lib/embryos/rights-session";
const id = (n: number) => `84000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const now = Date.now();
const scope = { version: 1, caseKind: "appeal", caseId: id(1), originalAuthorPrincipalId: id(2), initialStatementRevision: 1,
 originalSubmittedAt: new Date(now - 8 * 86400000).toISOString(), originalDeadline: new Date(now + 22 * 86400000).toISOString(), intakeKind: "subject-objection" };
function nativeNotice() {
 const sealed = sealNewAppeal(scope, { kind: "subject-objection", claimantName: "Synthetic Claimant", contactEmail: "synthetic@example.test",
  statement: "This is the original statement for this synthetic case.", affirmed: true });
 const nonce = "a".repeat(64), reference = sealAppealDecisionReference(sealed.wrappedCaseKeyHex, id(1), id(4), nonce);
 return { scope, wrappedCaseKeyHex: sealed.wrappedCaseKeyHex, decisions: [{ documentId: id(4), documentKind: "appeal-subject-source-control",
  decision: "rejected", nonceHash: nonce, referenceHash: reference.hash, referenceCiphertextHex: reference.ciphertext.slice(2) }] };
}
const secret = "A".repeat(43);
const request = (extra = "") => new Request(`https://inherit.bio/withdraw/session${extra}`, { headers: { cookie: `${RIGHTS_COOKIE_NAME}=${secret}` } });
beforeEach(() => {
 vi.clearAllMocks(); vi.stubEnv("INHERIT_TEST_JURISDICTION", "1"); vi.stubEnv("INHERIT_TEST_REQUESTER_STATEMENTS", "1");
 vi.stubEnv("BYOK_ENCRYPTION_KEY", Buffer.alloc(32, 83).toString("base64"));
});
afterEach(() => vi.unstubAllEnvs());
describe("later original-recipient notice", () => {
 it("opens only a native-authorized encrypted result even after the original seven-day link", async () => {
  const raw = nativeNotice(); rpc.mockResolvedValue({ data: raw, error: null });
  const result = await loadPublicAppealDecisionNotice(request());
  expect(result?.deadline).toBe(scope.originalDeadline); expect(result?.decisions[0]?.decisionReference).toMatch(/^[0-9a-f]{48}$/u);
  expect(Object.keys(result!)).toEqual(["deadline", "decisions"]);
  expect(rpc).toHaveBeenCalledExactlyOnceWith("read_public_appeal_decision_notice_v1", { p_session_hash: rightsSessionHash(secret) }, expect.any(AbortSignal));
  expect(JSON.stringify(result)).not.toMatch(/recipient|reviewer|target|wrappedCaseKey|nonceHash|Ciphertext/u);
 });
 it.each([null, { code: "42501" }])("does not substitute a case/reference/contact for refused native authority %j", async error => {
  rpc.mockResolvedValue({ data: null, error }); expect(await loadPublicAppealDecisionNotice(request())).toBeNull(); expect(rpc).toHaveBeenCalledOnce();
 });
 it("keeps configuration closed and refuses URL identity before native access", async () => {
  vi.stubEnv("INHERIT_TEST_REQUESTER_STATEMENTS", "0"); expect(await loadPublicAppealDecisionNotice(request())).toBeNull();
  vi.stubEnv("INHERIT_TEST_REQUESTER_STATEMENTS", "1"); expect(await loadPublicAppealDecisionNotice(request("?case=foreign"))).toBeNull();
  expect(rpc).not.toHaveBeenCalled();
 });
 it("refuses foreign ciphertext, forged digest, extra notes and expired original clock", async () => {
  const raw = nativeNotice();
  for (const value of [{ ...raw, scope: { ...scope, caseId: id(9) } },
   { ...raw, decisions: [{ ...raw.decisions[0], referenceHash: "b".repeat(64) }] },
   { ...raw, decisions: [{ ...raw.decisions[0], notes: "private reviewer content" }] },
   { ...raw, scope: { ...scope, originalDeadline: new Date(now - 1).toISOString() } }]) {
   rpc.mockResolvedValue({ data: value, error: null }); expect(await loadPublicAppealDecisionNotice(request())).toBeNull();
  }
 });
 it("refuses uncertain or aborted reads without adopting a notice", async () => {
  rpc.mockRejectedValue(new Error("uncertain")); expect(await loadPublicAppealDecisionNotice(request())).toBeNull();
  const stop = new AbortController(); stop.abort();
  expect(await loadPublicAppealDecisionNotice(new Request(request(), { signal: stop.signal }))).toBeNull(); expect(rpc).toHaveBeenCalledOnce();
 });
});
describe("native notice has independent rights and no intake renewal", () => {
 const sql = readFileSync(path.resolve(__dirname, "../../..", "supabase/migrations/20261009224501_public_appeal_decision_notice_continuation.sql"), "utf8");
 it("uses one exact decision event and only the previously verified original case recipient", () => {
  expect(sql).toContain("after insert on private.public_appeal_document_decisions");
  expect(sql).toContain("'appeal-decision-notice-v1|'||new.id");
  expect(sql).toContain("rights.token_hash_id=token.id and rights.principal_id=intake.author_principal_id");
  expect(sql).toContain("rights.status='consumed' and rights.ended_at is not null");
  expect(sql).toContain("least(created+interval '7 days',intake.deadline)");
  expect(sql).not.toMatch(/update private\.new_public_appeal_intakes|update private\.new_public_appeal_evidence_state|set status='active'/u);
 });
 it("never registers file upload, target access or generic source rights for the new purpose", () => {
  expect(sql).toContain("('appeal-decision-notice',null,'read-decision-notice','api.appeal-decision-notice')");
  expect(sql).toContain("return public.read_appeal_decision_before_notice_v1(p_session_hash)");
  expect(sql).toContain("rights.last_activity_at<=clock_timestamp()-interval '15 minutes'");
  expect(sql).toContain("rights.expires_at>rights.created_at+interval '60 minutes'");
  expect(sql).toContain("delete from private.public_appeal_decision_notices where case_id=p_id");
  expect(sql).not.toContain("grant select");
 });
});
