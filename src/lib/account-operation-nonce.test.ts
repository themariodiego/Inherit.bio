import crypto from "node:crypto";
import { afterAll, describe, expect, it, vi } from "vitest";

vi.stubEnv("BYOK_ENCRYPTION_KEY", crypto.randomBytes(32).toString("base64"));
const {
  ACCOUNT_OPERATION_NONCE_LIFETIME_MS, ACCOUNT_OPERATION_NONCE_MAX_LENGTH,
  mintAccountOperationNonce, verifyAccountOperationNonce,
} = await import("./account-operation-nonce");
const { hashOperationNonce } = await import("./account-deletion");
afterAll(() => vi.unstubAllEnvs());

const NOW = 1_800_000_000_000;
const DELETE = Object.freeze({
  accountId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  sessionId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  operation: "account_delete" as const,
});

describe("the rendered account operation nonce (brief X1.5)", () => {
  it("verifies for exactly the account, session and operation it was minted for", () => {
    const nonce = mintAccountOperationNonce(DELETE, NOW);
    expect(nonce.length).toBeLessThanOrEqual(ACCOUNT_OPERATION_NONCE_MAX_LENGTH);
    expect(verifyAccountOperationNonce(nonce, DELETE, NOW)).toEqual({
      nonceHash: hashOperationNonce(nonce), expiresAt: NOW + ACCOUNT_OPERATION_NONCE_LIFETIME_MS,
    });
    expect(verifyAccountOperationNonce(nonce, { ...DELETE, accountId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc" }, NOW)).toBeNull();
    expect(verifyAccountOperationNonce(nonce, { ...DELETE, sessionId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc" }, NOW)).toBeNull();
    expect(verifyAccountOperationNonce(nonce, { ...DELETE, operation: "account_delete_cancel" }, NOW)).toBeNull();
  });

  it("carries no identity: the account and session appear nowhere in it", () => {
    const nonce = mintAccountOperationNonce(DELETE, NOW);
    expect(nonce).not.toContain(DELETE.accountId);
    expect(nonce).not.toContain(DELETE.sessionId);
    expect(nonce).toMatch(/^\d{13}\.[A-Za-z0-9_-]{43}\.[0-9a-f]{64}$/u);
  });

  it("expires after ten minutes, and refuses one that claims to live longer", () => {
    const nonce = mintAccountOperationNonce(DELETE, NOW);
    expect(verifyAccountOperationNonce(nonce, DELETE, NOW + ACCOUNT_OPERATION_NONCE_LIFETIME_MS - 1)).not.toBeNull();
    expect(verifyAccountOperationNonce(nonce, DELETE, NOW + ACCOUNT_OPERATION_NONCE_LIFETIME_MS)).toBeNull();
    // Minted "in the future": its expiry is more than ten minutes away now.
    const early = mintAccountOperationNonce(DELETE, NOW + 60_000);
    expect(verifyAccountOperationNonce(early, DELETE, NOW)).toBeNull();
  });

  it("refuses a forged, altered or malformed nonce", () => {
    const nonce = mintAccountOperationNonce(DELETE, NOW);
    const [expiry, random, mac] = nonce.split(".");
    const flip = (value: string) => (value[0] === "a" ? "b" : "a") + value.slice(1);
    for (const tampered of [
      `${Number(expiry) - 1}.${random}.${mac}`,
      `${expiry}.${flip(random)}.${mac}`,
      `${expiry}.${random}.${flip(mac)}`,
      `${expiry}.${random}.${mac.toUpperCase()}`,
      `${expiry}.${random}`,
      `${nonce}.`,
      ` ${nonce}`,
      "a".repeat(ACCOUNT_OPERATION_NONCE_MAX_LENGTH + 1),
      null, 42, undefined,
    ]) {
      expect(verifyAccountOperationNonce(tampered, DELETE, NOW), String(tampered)).toBeNull();
    }
    // A key the server does not hold cannot mint one.
    const foreign = crypto.createHmac("sha256", crypto.randomBytes(32)).update("x").digest("hex");
    expect(verifyAccountOperationNonce(`${expiry}.${random}.${foreign}`, DELETE, NOW)).toBeNull();
  });

  it("is fresh every time, so two renders never share a nonce", () => {
    const first = mintAccountOperationNonce(DELETE, NOW);
    const second = mintAccountOperationNonce(DELETE, NOW);
    expect(first).not.toBe(second);
    expect(verifyAccountOperationNonce(first, DELETE, NOW)?.nonceHash).not.toBe(verifyAccountOperationNonce(second, DELETE, NOW)?.nonceHash);
  });

  it("refuses to mint for a context it cannot bind", () => {
    expect(() => mintAccountOperationNonce({ ...DELETE, accountId: "not-a-uuid" }, NOW)).toThrow("account_operation_context_invalid");
    expect(() => mintAccountOperationNonce({ ...DELETE, operation: "own_upload_artifact_sign" as never }, NOW)).toThrow("account_operation_context_invalid");
  });
});
