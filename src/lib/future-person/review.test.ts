import crypto from "node:crypto";
import { afterAll, describe, expect, it, vi } from "vitest";

vi.stubEnv("BYOK_ENCRYPTION_KEY", crypto.randomBytes(32).toString("base64"));
const { encryptSecret, decryptSecret } = await import("@/lib/crypto");
const { sealClaimIntake } = await import("./claim-intake");
const { reviewCsrf, reviewCsrfMatches, mintReviewNonce, readReviewNonce,
  reviewDecisionBody, reviewCaseBody, sealReason, downloadCookieHash, DOWNLOAD_COOKIE } = await import("./review");
afterAll(() => vi.unstubAllEnvs());

const ID = "7e000000-0000-4000-8000-000000000001";
const ACCOUNT = "7e000000-0000-4000-8000-000000000002";
const SESSION = "5e000000-0000-4000-8000-000000000001";
const NOW = Date.UTC(2026, 8, 30, 12);

describe("review decision authority binds the case, reviewer and session", () => {
  it("refuses each changed binding and malformed CSRF", () => {
    const csrf = reviewCsrf(ID, ACCOUNT, SESSION);
    expect(reviewCsrfMatches(csrf, ID, ACCOUNT, SESSION)).toBe(true);
    expect(reviewCsrfMatches(csrf, ACCOUNT, ACCOUNT, SESSION)).toBe(false);
    expect(reviewCsrfMatches(csrf, ID, ID, SESSION)).toBe(false);
    expect(reviewCsrfMatches(csrf, ID, ACCOUNT, ID)).toBe(false);
    for (const bad of [null, "", csrf.toUpperCase(), `${csrf}0`])
      expect(reviewCsrfMatches(bad, ID, ACCOUNT, SESSION)).toBe(false);
  });
  it("refuses a nonce for another case, reviewer, session, expired time or modified ciphertext", () => {
    const nonce = mintReviewNonce(ID, ACCOUNT, SESSION, NOW);
    expect(readReviewNonce(nonce, ID, ACCOUNT, SESSION, NOW)).toMatch(/^[A-Za-z0-9_-]+$/u);
    expect(readReviewNonce(nonce, ACCOUNT, ACCOUNT, SESSION, NOW)).toBeNull();
    expect(readReviewNonce(nonce, ID, ID, SESSION, NOW)).toBeNull();
    expect(readReviewNonce(nonce, ID, ACCOUNT, ID, NOW)).toBeNull();
    expect(readReviewNonce(nonce, ID, ACCOUNT, SESSION, NOW + 600001)).toBeNull();
    expect(readReviewNonce(`x${nonce.slice(1)}`, ID, ACCOUNT, SESSION, NOW)).toBeNull();
    expect(readReviewNonce("x".repeat(2049), ID, ACCOUNT, SESSION, NOW)).toBeNull();
  });
  it("accepts only a closed decision body and seals its professional basis", () => {
    const good = { decision: "reject", reviewRevision: 1,
      reason: "The synthetic evidence does not establish the required relationship.", nonce: "synthetic" };
    expect(reviewDecisionBody.safeParse(good).success).toBe(true);
    for (const bad of [{ ...good, matched: true }, { ...good, decision: "release" },
      { ...good, reviewRevision: 0 }, { ...good, reason: "short" }, { ...good, reason: `${good.reason}\u0000` }])
      expect(reviewDecisionBody.safeParse(bad).success).toBe(false);
    const sealed = sealReason(good.reason);
    expect(decryptSecret(Buffer.from(sealed.slice(2), "hex"))).toBe(good.reason);
    expect(sealed).not.toContain(good.reason);
  });
});

describe("review case serialization withholds selectors and fails closed on sealed fields", () => {
  const sealed = sealClaimIntake({ mode: "record-key", recordKey: "0123456789ABCDEFGHJK",
    claimantName: "Synthetic Claimant", claimantDateOfBirth: "2000-01-31",
    contactEmail: "claimant@e2e.local", affirmed: true });
  const row = { claimId: ID, mode: "record-key", state: "document_review_pending", reviewRevision: 1,
    deadline: "2026-10-30T12:00:00.000Z", caseKind: "record_key_unmatched_or_ineligible",
    allowedDecisions: ["reject", "needs-more-information"], photoIdentityDocumentId: ACCOUNT,
    birthRecordDocumentId: SESSION, identityCiphertext: sealed.identityCiphertext.toString("hex"),
    wrappedDataKey: sealed.wrappedDataKey.toString("hex"), parentIdentityCiphertext: null };
  it("projects only registered fields and the opaque unmatched selector", () => {
    const body = reviewCaseBody(row);
    expect(body).toEqual({ claimId: ID, mode: "record-key", state: "document_review_pending", reviewRevision: 1,
      deadline: row.deadline, claimant: { fullName: "Synthetic Claimant", dateOfBirth: "2000-01-31" },
      evidence: { photoIdentityDocumentId: ACCOUNT, birthRecordDocumentId: SESSION },
      case: { kind: "record_key_unmatched_or_ineligible", selectorOutcome: "non_enumerating_unmatched_or_ineligible",
        allowedDecisions: ["reject", "needs-more-information"] }, notice: { state: "not_applicable", noticeRevision: null } });
    expect(JSON.stringify(body)).not.toMatch(/ciphertext|wrappedDataKey|keyHash|network|e2e.local/u);
  });
  it("returns no case for unknown columns, malformed deadlines or unreadable encryption", () => {
    for (const bad of [{ ...row, matchedEmbryoId: ACCOUNT }, { ...row, deadline: "invalid" },
      { ...row, wrappedDataKey: "aa" }, { ...row, wrappedDataKey: encryptSecret("short").toString("hex") },
      { ...row, identityCiphertext: "aa" }, { ...row, caseKind: "record_key", parentIdentityCiphertext: "aa" }])
      expect(reviewCaseBody(bad)).toBeNull();
  });
});

it("download cookies identify exactly one well-formed secret", () => {
  const secret = crypto.randomBytes(32).toString("base64url");
  const cookie = `${DOWNLOAD_COOKIE}=${secret}`;
  const hash = crypto.createHash("sha256").update(secret).digest("hex");
  expect(downloadCookieHash(new Request("http://localhost", { headers: { cookie } }))).toBe(hash);
  for (const bad of ["", `${DOWNLOAD_COOKIE}=short`, `${cookie}; ${cookie}`])
    expect(downloadCookieHash(new Request("http://localhost", { headers: { cookie: bad } }))).toBeNull();
});
