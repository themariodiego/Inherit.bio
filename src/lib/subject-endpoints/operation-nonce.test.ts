import crypto from "node:crypto";
import { afterAll, describe, expect, it, vi } from "vitest";

vi.stubEnv("BYOK_ENCRYPTION_KEY", crypto.randomBytes(32).toString("base64"));
const {
  SUBJECT_OPERATION_NONCE_LIFETIME_MS, SUBJECT_OPERATION_NONCE_MAX_LENGTH, SUBJECT_OPERATION_ROUTES,
  mintSubjectOperationNonce, verifySubjectOperationNonce,
} = await import("./operation-nonce");
const { mintAccountOperationNonce, verifyAccountOperationNonce } = await import("@/lib/account-operation-nonce");
const { hashOperationNonce } = await import("@/lib/account-deletion");
afterAll(() => vi.unstubAllEnvs());

const NOW = 1_800_000_000_000;
const STOP = Object.freeze({
  accountId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  sessionId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  operation: "subject_sharing_stop" as const,
  subjectId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
});
const OTHER = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

describe("the subject-route operation nonce", () => {
  it("names one registered route per operation", () => {
    expect(SUBJECT_OPERATION_ROUTES).toEqual({
      subject_sharing_stop: "api.subject-sharing",
      subject_delete: "api.subject-delete",
      subject_transfer: "api.subject-transfer",
    });
  });

  it("verifies for exactly the account, session, operation and subject it was minted for", () => {
    const nonce = mintSubjectOperationNonce(STOP, NOW);
    expect(nonce.length).toBeLessThanOrEqual(SUBJECT_OPERATION_NONCE_MAX_LENGTH);
    expect(verifySubjectOperationNonce(nonce, STOP, NOW)).toEqual({
      nonceHash: hashOperationNonce(nonce), expiresAt: NOW + SUBJECT_OPERATION_NONCE_LIFETIME_MS,
    });
    for (const changed of [{ accountId: OTHER }, { sessionId: OTHER }, { subjectId: OTHER }]) {
      expect(verifySubjectOperationNonce(nonce, { ...STOP, ...changed }, NOW)).toBeNull();
    }
  });

  it("is bound to its operation: a stop code never deletes and a delete code never stops", () => {
    const stop = mintSubjectOperationNonce(STOP, NOW);
    const remove = mintSubjectOperationNonce({ ...STOP, operation: "subject_delete" }, NOW);
    expect(verifySubjectOperationNonce(stop, { ...STOP, operation: "subject_delete" }, NOW)).toBeNull();
    expect(verifySubjectOperationNonce(remove, STOP, NOW)).toBeNull();
    expect(verifySubjectOperationNonce(remove, { ...STOP, operation: "subject_delete" }, NOW)).not.toBeNull();
  });

  it("is bound to its operation: a transfer code never deletes and a delete code never transfers", () => {
    const transfer = mintSubjectOperationNonce({ ...STOP, operation: "subject_transfer" }, NOW);
    const remove = mintSubjectOperationNonce({ ...STOP, operation: "subject_delete" }, NOW);
    expect(verifySubjectOperationNonce(transfer, { ...STOP, operation: "subject_delete" }, NOW)).toBeNull();
    expect(verifySubjectOperationNonce(transfer, STOP, NOW)).toBeNull();
    expect(verifySubjectOperationNonce(remove, { ...STOP, operation: "subject_transfer" }, NOW)).toBeNull();
    expect(verifySubjectOperationNonce(transfer, { ...STOP, operation: "subject_transfer" }, NOW)).not.toBeNull();
  });

  it("carries no identity: the account, session and subject appear nowhere in it", () => {
    const nonce = mintSubjectOperationNonce(STOP, NOW);
    for (const id of [STOP.accountId, STOP.sessionId, STOP.subjectId]) expect(nonce).not.toContain(id);
    expect(nonce).toMatch(/^\d{13}\.[A-Za-z0-9_-]{43}\.[0-9a-f]{64}$/u);
  });

  it("expires after ten minutes, and refuses one that claims to live longer", () => {
    const nonce = mintSubjectOperationNonce(STOP, NOW);
    expect(verifySubjectOperationNonce(nonce, STOP, NOW + SUBJECT_OPERATION_NONCE_LIFETIME_MS - 1)).not.toBeNull();
    expect(verifySubjectOperationNonce(nonce, STOP, NOW + SUBJECT_OPERATION_NONCE_LIFETIME_MS)).toBeNull();
    const longer = mintSubjectOperationNonce(STOP, NOW + 1);
    expect(verifySubjectOperationNonce(longer, STOP, NOW)).toBeNull();
  });

  it("refuses a tampered random part, MAC or expiry, and every malformed value", () => {
    const nonce = mintSubjectOperationNonce(STOP, NOW);
    const [expiry, random, digest] = nonce.split(".");
    const flip = (text: string) => (text[0] === "a" ? "b" : "a") + text.slice(1);
    for (const tampered of [`${expiry}.${flip(random)}.${digest}`, `${expiry}.${random}.${flip(digest)}`,
      `${Number(expiry) - 1}.${random}.${digest}`, `${nonce}x`, "", null, 7, { nonce }, "x".repeat(200)]) {
      expect(verifySubjectOperationNonce(tampered, STOP, NOW)).toBeNull();
    }
  });

  it("is not interchangeable with an account operation nonce in either direction", () => {
    const account = mintAccountOperationNonce({ accountId: STOP.accountId, sessionId: STOP.sessionId, operation: "account_delete" }, NOW);
    expect(verifySubjectOperationNonce(account, STOP, NOW)).toBeNull();
    const subject = mintSubjectOperationNonce(STOP, NOW);
    expect(verifyAccountOperationNonce(subject, { accountId: STOP.accountId, sessionId: STOP.sessionId, operation: "account_delete" }, NOW)).toBeNull();
  });

  it("refuses to mint or verify for a context that is not canonical", () => {
    expect(() => mintSubjectOperationNonce({ ...STOP, subjectId: "s-cccc" }, NOW)).toThrow("subject_operation_context_invalid");
    expect(() => mintSubjectOperationNonce({ ...STOP, operation: "stop" as never }, NOW)).toThrow("subject_operation_context_invalid");
    const nonce = mintSubjectOperationNonce(STOP, NOW);
    expect(verifySubjectOperationNonce(nonce, { ...STOP, subjectId: STOP.subjectId.toUpperCase() }, NOW)).toBeNull();
  });
});
