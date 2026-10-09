import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sealNewAppeal } from "./appeal-case-envelope";
import { appealReviewRow } from "./public-appeal-review";
import { appealCaseContext, appealCaseDecisionBody, appealCaseReasonAad, mintAppealCaseReviewNonce,
 publicAppealCaseReviewBody, readAppealCaseReviewNonce, sealAppealCaseReason } from "./public-appeal-case-decision";
import { mintReviewNonce } from "./review";
import { openNewCaseBytes, unwrapNewCaseKey } from "./new-case-envelope-crypto";
const id = (n: number) => `87000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const scope = { version: 1, caseKind: "appeal", caseId: id(1), originalAuthorPrincipalId: id(2), initialStatementRevision: 1,
 originalSubmittedAt: new Date().toISOString(), originalDeadline: new Date(Date.now() + 30 * 86400000).toISOString(), intakeKind: "subject-objection" };
function current() {
 const { format, ...encrypted } = sealNewAppeal(scope, { kind: "subject-objection", claimantName: "Synthetic Claimant", contactEmail: "synthetic@example.test",
  statement: "This complete original request asks for a human review of source control.", affirmed: true }); void format;
 return { contextVersion: "appeal-case-final-context-v1", caseId: id(1), caseKind: "subject-objection", scope, reviewRevision: 1, evidenceRevision: 1,
  deadline: scope.originalDeadline, ...encrypted, documents: [], documentDecisionsAvailable: false, allowedDecisions: ["reject"] };
}
const binding = { caseId: id(1), accountId: id(3), sessionId: id(4), reviewRevision: 1, evidenceRevision: 1 };
beforeEach(() => vi.stubEnv("BYOK_ENCRYPTION_KEY", Buffer.alloc(32, 81).toString("base64")));
afterEach(() => vi.unstubAllEnvs());
describe("separate native final-rejection context", () => {
 it("admits incomplete evidence only in the separate rejection context, preserving the complete documentary decoder", () => {
  const row = current(); expect(appealCaseContext.safeParse(row).success).toBe(true);
  const body = publicAppealCaseReviewBody(row)!; expect(body.evidence).toEqual([]); expect(body.targetBinding.state).toBe("unresolved");
  expect(body.contactEmail).toBe("synthetic@example.test"); expect(JSON.stringify(body)).not.toContain(row.wrappedCaseKeyHex);
  const { contextVersion, documentDecisionsAvailable, allowedDecisions, ...documentary } = row;
  void contextVersion; void documentDecisionsAvailable; void allowedDecisions;
  expect(appealReviewRow.safeParse(documentary).success).toBe(false);
 });
 it("refuses to claim documentary review availability without the exact whole kind-bound set", () => {
  expect(appealCaseContext.safeParse({ ...current(), documentDecisionsAvailable: true }).success).toBe(false);
  const doc = { documentId: id(5), documentKind: "appeal-photo-identity", sha256: "a".repeat(64), decision: null };
  expect(appealCaseContext.safeParse({ ...current(), documents: [doc, doc] }).success).toBe(false);
  expect(appealCaseContext.safeParse({ ...current(), documents: [{ ...doc, documentKind: "appeal-genetic-parent-authority" }] }).success).toBe(false);
 });
 it.each([{ targetId: id(7) }, { reviewerNotes: "private" }, { allowedDecisions: ["approve-access"] }, { scope: { ...scope, caseId: id(7) } }])(
  "refuses expanded or foreign native context %j", extra => expect(publicAppealCaseReviewBody({ ...current(), ...extra })).toBeNull());
 it("does not open swapped same-size encrypted packages as a readable case", () => {
  expect(publicAppealCaseReviewBody({ ...current(), wrappedCaseKeyHex: "e".repeat(144) })).toBeNull();
 });
});
describe("exact current final-case operation", () => {
 it("binds the form to own account, own session, exact case and both native revisions", () => {
  const token = mintAppealCaseReviewNonce(binding, 1000); expect(readAppealCaseReviewNonce(token, binding, 1001)).toMatch(/^[A-Za-z0-9_-]+$/u);
  for (const changed of [{ caseId: id(8) }, { accountId: id(8) }, { sessionId: id(8) }, { reviewRevision: 2 }, { evidenceRevision: 2 }])
   expect(readAppealCaseReviewNonce(token, { ...binding, ...changed }, 1001)).toBeNull();
  expect(readAppealCaseReviewNonce(token, binding, 601001)).toBeNull();
  expect(readAppealCaseReviewNonce(mintReviewNonce(id(1), id(3), id(4), 1000), binding, 1001)).toBeNull();
 });
 const body = { decision: "reject", reviewRevision: 1, reason: "The available record does not prove the stated source control.", nonce: "synthetic-case-form" };
 it("accepts only the registered reason and reject branch with no target selector", () => {
  expect(appealCaseDecisionBody.parse(body).reason).toBe(body.reason);
  for (const extra of [{ decision: "approve-access" }, { decision: "needs-more-information" }, { targetId: id(8) }, { evidenceRevision: 1 }, { reason: "short" }, { reason: "\u0000" + body.reason }])
   expect(appealCaseDecisionBody.safeParse({ ...body, ...extra }).success).toBe(false);
 });
 it("encrypts a professional reason only for this exact case and consumed operation", () => {
  const row = current(), nonceHash = "a".repeat(64), sealed = Buffer.from(sealAppealCaseReason(body.reason, row.wrappedCaseKeyHex, id(1), nonceHash).slice(2), "hex");
  const key = unwrapNewCaseKey(row.wrappedCaseKeyHex); let plain: Buffer | null = null;
  try {
   plain = openNewCaseBytes(key, appealCaseReasonAad(id(1), nonceHash), sealed); expect(plain?.toString("utf8")).toBe(body.reason);
   expect(openNewCaseBytes(key, appealCaseReasonAad(id(8), nonceHash), sealed)).toBeNull();
   expect(openNewCaseBytes(key, appealCaseReasonAad(id(1), "b".repeat(64)), sealed)).toBeNull();
   expect(sealed.includes(Buffer.from(body.reason))).toBe(false);
  } finally { plain?.fill(0); key.fill(0); sealed.fill(0); }
 });
});
