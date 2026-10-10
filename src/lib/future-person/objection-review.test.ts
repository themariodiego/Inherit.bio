import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sealNoticePackage } from "./notice-package";
import { sealOwnerObjection } from "./owner-objection";
import { mintObjectionReviewNonce, readObjectionReviewNonce, shapeObjectionReview,
  mintAssignedObjectionNonce, readAssignedObjectionNonce, objectionDecisionBody, objectionDecisionScope } from "./objection-review";
const id = (n: number) => `61000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const statement = "The claim should receive further documentary review.";
const human = { fullName: "Synthetic Claimant", dateOfBirth: "2000-01-01", photoIdentityReviewed: true as const,
  birthRecordReviewed: true as const, adultAgeConfirmed: true as const };
const scope = { reviewId: id(1), documentaryRevision: 1, photoDocumentId: id(3), photoSha256: "a".repeat(64), birthDocumentId: id(4), birthSha256: "b".repeat(64) };
beforeEach(() => vi.stubEnv("BYOK_ENCRYPTION_KEY", Buffer.alloc(32, 20).toString("base64")));
afterEach(() => vi.unstubAllEnvs());
function row() {
  const minimum = sealNoticePackage(human, { childDateOfBirth: human.dateOfBirth, childPlaceOfBirth: "Synthetic City", parentNames: ["Synthetic Parent"] }, scope);
  const objection = sealOwnerObjection(statement, { claimId: id(1), noticeId: id(2), noticeRevision: 2 });
  return { operation: "claim-objection", claimId: id(1), reviewRevision: 3, noticeId: id(2), noticeRevision: 2,
    noticeDeadline: "2026-10-30T00:00:00.000Z", deadline: "2026-11-15T00:00:00.000Z", documentaryRevision: 1,
    photoDocumentId: id(3), photoSha256: "a".repeat(64), birthDocumentId: id(4), birthSha256: "b".repeat(64),
    comparisonCiphertext: minimum.ciphertext.slice(2), wrappedComparisonKey: minimum.wrappedKey.slice(2),
    objection: { id: id(5), objectionRevision: 1, initialNoticeRevision: 2,
      statementCiphertext: objection.ciphertext.slice(2), wrappedStatementKey: objection.wrappedKey.slice(2) } };
}
describe("closed assigned objection shaping", () => {
  it("opens only the actual separately sealed minimum and owner statement, returning exactly registered fields", () => {
    const shaped = shapeObjectionReview(row(), id(5));
    expect(shaped).toEqual({ objectionId: id(5), claimId: id(1), statement, objectionRevision: 1, claimReviewRevision: 3,
      noticeRevision: 2, noticeRecipientRole: "current-owner-pseudonymous-role", deadline: "2026-11-15T00:00:00.000Z",
      claimant: { fullName: human.fullName, dateOfBirth: human.dateOfBirth }, reviewPackage: {
        photoIdentityDocumentId: id(3), birthRecordDocumentId: id(4), documentaryAttestation: { outcome: "positive", reviewRevision: 1 },
        selectedProfile: { childDateOfBirth: human.dateOfBirth, childPlaceOfBirth: "Synthetic City", parentNames: ["Synthetic Parent"] } } });
    expect(JSON.stringify(shaped)).not.toMatch(/ciphertext|wrapped|contact|objectKey|candidate|credential|token/iu);
  });
  it("refuses wrong operation, object, claim, notice, documentary revision, document or digest before a public case exists", () => {
    const original = row();
    for (const changed of [{ ...original, operation: "claim-release" }, { ...original, claimId: id(20) },
      { ...original, noticeId: id(21) }, { ...original, documentaryRevision: 2 }, { ...original, photoDocumentId: id(20) },
      { ...original, photoSha256: "c".repeat(64) }, { ...original, birthDocumentId: original.photoDocumentId },
      { ...original, claimant: "unexpected" }, { ...original, objection: { ...original.objection, initialNoticeRevision: 3 } },
      { ...original, objection: { ...original.objection, contactEmail: "synthetic@e2e.local" } }]) expect(shapeObjectionReview(changed, id(5))).toBeNull();
    expect(shapeObjectionReview(original, id(20))).toBeNull();
  });
  it("refuses tampered, swapped or shredded keys and ciphertext independently", () => {
    const original = row(), next = row();
    for (const changed of [{ ...original, comparisonCiphertext: "00".repeat(128) }, { ...original, wrappedComparisonKey: next.wrappedComparisonKey },
      { ...original, wrappedComparisonKey: "00".repeat(72) }, { ...original, objection: { ...original.objection, wrappedStatementKey: next.objection.wrappedStatementKey } },
      { ...original, objection: { ...original.objection, statementCiphertext: "00".repeat(128) } },
      { ...original, objection: { ...original.objection, wrappedStatementKey: "00".repeat(72) } }]) expect(shapeObjectionReview(changed, id(5))).toBeNull();
  });
  it("separates the fresh objection decision proof from every other operation and caller", () => {
    const now = Date.now(), proof = mintObjectionReviewNonce(id(5), id(6), id(7), now);
    expect(readObjectionReviewNonce(proof, id(5), id(6), id(7), now)).toMatch(/^[A-Za-z0-9_-]{16,256}$/u);
    for (const tuple of [[id(1), id(6), id(7)], [id(5), id(8), id(7)], [id(5), id(6), id(8)]])
      expect(readObjectionReviewNonce(proof, tuple[0]!, tuple[1]!, tuple[2]!, now)).toBeNull();
    expect(readObjectionReviewNonce(proof, id(5), id(6), id(7), now + 600001)).toBeNull();
  });
  it("binds the assigned decision to all three current revisions and refuses the former unbound proof", () => {
    const now = Date.now(), revisions = { objectionRevision: 1, claimReviewRevision: 3, noticeRevision: 2 };
    const proof = mintAssignedObjectionNonce(id(5), id(6), id(7), revisions, now);
    expect(readAssignedObjectionNonce(proof, id(5), id(6), id(7), revisions, now)).toMatch(/^[A-Za-z0-9_-]{16,256}$/u);
    for (const key of Object.keys(revisions) as (keyof typeof revisions)[]) {
      expect(readAssignedObjectionNonce(proof, id(5), id(6), id(7), { ...revisions, [key]: revisions[key] + 1 }, now)).toBeNull();
    }
    for (const tuple of [[id(20), id(6), id(7)], [id(5), id(20), id(7)], [id(5), id(6), id(20)]])
      expect(readAssignedObjectionNonce(proof, tuple[0]!, tuple[1]!, tuple[2]!, revisions, now)).toBeNull();
    expect(readAssignedObjectionNonce(proof, id(5), id(6), id(7), revisions, now + 600001)).toBeNull();
    expect(readAssignedObjectionNonce(mintObjectionReviewNonce(id(5), id(6), id(7), now), id(5), id(6), id(7), revisions, now)).toBeNull();
  });
  it("accepts only the registered three decisions, current revisions and professional basis", () => {
    const body = { decision: "uphold-objection", objectionRevision: 1, claimReviewRevision: 3, noticeRevision: 2,
      reason: "  The complete documents need a further human decision.  ", nonce: "proof" };
    expect(objectionDecisionBody.parse(body).reason).toBe(body.reason.trim());
    for (const given of [{ ...body, decision: "approve-release" }, { ...body, noticeRevision: 0 },
      { ...body, claimReviewRevision: Number.MAX_SAFE_INTEGER + 1 }, { ...body, reason: "Too short" },
      { ...body, reason: "x".repeat(2001) }, { ...body, reason: `${body.reason}\u0085` },
      { ...body, nonce: "x".repeat(2049) }, { ...body, subjectId: id(20) }])
      expect(objectionDecisionBody.safeParse(given).success).toBe(false);
    expect(objectionDecisionScope(row(), id(5))?.wrappedComparisonKey).toMatch(/^[0-9a-f]{144}$/u);
    expect(objectionDecisionScope({ ...row(), comparisonCiphertext: "00".repeat(128) }, id(5))).toBeNull();
  });
});
