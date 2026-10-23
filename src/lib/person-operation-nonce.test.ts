import crypto from "node:crypto";
import { afterAll, describe, expect, it, vi } from "vitest";

vi.stubEnv("BYOK_ENCRYPTION_KEY", crypto.randomBytes(32).toString("base64"));
vi.mock("@/lib/account-deletion", async (load) => ({
  ...await load<typeof import("@/lib/account-deletion")>(), getSensitiveAccountContext: async () => null,
}));
const {
  PERSON_OPERATION_NONCE_HEADER, PERSON_OPERATION_NONCE_LIFETIME_MS, PERSON_OPERATION_NONCE_MAX_LENGTH, PERSON_OPERATION_ROUTES,
  isOperationNonceRefusal, mintPersonOperationNonce, personOperationNonceArgs, personOperationNonceFrom, verifyPersonOperationNonce,
} = await import("./person-operation-nonce");
const core = await import("./person-operation-nonce-core");
const { hashOperationNonce } = await import("@/lib/account-deletion");
afterAll(() => vi.unstubAllEnvs());

/**
 * G5.6 (owner decision of 23 October 2026): the one-time nonce of the
 * person-caused writers that recorded none, so their audit events can name
 * who acted (20261023120000_legal_audit_attribution_completeness.sql).
 */
const NOW = 1_800_000_000_000;
const DECLARE = Object.freeze({
  accountId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  sessionId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  operation: "jurisdiction_declare" as const,
  targetId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
});
const OTHER = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

describe("the person operation nonce", () => {
  it("names one registered route per operation", () => {
    expect(PERSON_OPERATION_ROUTES).toEqual({
      jurisdiction_declare: "api.jurisdiction",
      chromosomal_sex_declare: "api.chromosomal-sex",
      family_sharing_pause: "api.family-sharing",
      family_sharing_resume: "api.family-sharing",
      consent_revoke: "api.consent-revoke",
      portrait_acknowledge: "api.family-acknowledge",
      adult_invitation_create: "api.subject-drafts",
    });
  });

  it("verifies for exactly the account, session, operation and target it was minted for", () => {
    const nonce = mintPersonOperationNonce(DECLARE, NOW);
    expect(nonce.length).toBeLessThanOrEqual(PERSON_OPERATION_NONCE_MAX_LENGTH);
    expect(verifyPersonOperationNonce(nonce, DECLARE, NOW)).toEqual({
      nonceHash: hashOperationNonce(nonce), expiresAt: NOW + PERSON_OPERATION_NONCE_LIFETIME_MS,
    });
    for (const changed of [{ accountId: OTHER }, { sessionId: OTHER }, { targetId: OTHER },
      { operation: "chromosomal_sex_declare" as const }, { operation: "consent_revoke" as const }]) {
      expect(verifyPersonOperationNonce(nonce, { ...DECLARE, ...changed }, NOW)).toBeNull();
    }
  });

  it("binds the pause and the resume of one counterpart apart", () => {
    const pause = { ...DECLARE, operation: "family_sharing_pause" as const, targetId: OTHER };
    const nonce = mintPersonOperationNonce(pause, NOW);
    expect(verifyPersonOperationNonce(nonce, pause, NOW)).not.toBeNull();
    expect(verifyPersonOperationNonce(nonce, { ...pause, operation: "family_sharing_resume" }, NOW)).toBeNull();
  });

  it("refuses an expired, future-dated, reshaped or tampered nonce", () => {
    const nonce = mintPersonOperationNonce(DECLARE, NOW);
    expect(verifyPersonOperationNonce(nonce, DECLARE, NOW + PERSON_OPERATION_NONCE_LIFETIME_MS)).toBeNull();
    expect(verifyPersonOperationNonce(nonce, DECLARE, NOW - 1)).toBeNull();
    const [expiresAt, random, mac] = nonce.split(".");
    expect(verifyPersonOperationNonce(`${expiresAt}.${random}.${mac.replace(/^./u, c => c === "0" ? "1" : "0")}`, DECLARE, NOW)).toBeNull();
    expect(verifyPersonOperationNonce(`${Number(expiresAt) + 1}.${random}.${mac}`, DECLARE, NOW)).toBeNull();
    for (const value of ["", "x", `${nonce}.x`, nonce.toUpperCase(), 42, null, undefined, "a".repeat(129)]) {
      expect(verifyPersonOperationNonce(value, DECLARE, NOW)).toBeNull();
    }
  });

  it("refuses to mint or verify for a context that is not canonical", () => {
    expect(() => mintPersonOperationNonce({ ...DECLARE, targetId: "not-a-uuid" }, NOW)).toThrow();
    expect(() => mintPersonOperationNonce({ ...DECLARE, operation: "subject_delete" as never }, NOW)).toThrow();
    expect(verifyPersonOperationNonce(mintPersonOperationNonce(DECLARE, NOW), { ...DECLARE, accountId: "A" }, NOW)).toBeNull();
  });

  it("is the same nonce through the pure module the browser fixtures use", () => {
    const nonce = core.mintPersonOperationNonce(DECLARE, NOW);
    expect(verifyPersonOperationNonce(nonce, DECLARE, NOW)?.nonceHash).toBe(hashOperationNonce(nonce));
  });

  it("mints under an explicitly passed key exactly as under the environment's, and under no other", () => {
    const nonce = core.mintPersonOperationNonce(DECLARE, NOW, process.env.BYOK_ENCRYPTION_KEY);
    expect(verifyPersonOperationNonce(nonce, DECLARE, NOW)?.nonceHash).toBe(hashOperationNonce(nonce));
    const otherKey = crypto.randomBytes(32).toString("base64");
    expect(verifyPersonOperationNonce(core.mintPersonOperationNonce(DECLARE, NOW, otherKey), DECLARE, NOW)).toBeNull();
    expect(() => core.mintPersonOperationNonce(DECLARE, NOW, "short")).toThrow();
  });

  it("reads the nonce from its header, and passes the door only its hash and expiry", () => {
    const nonce = mintPersonOperationNonce(DECLARE);
    const request = new Request("https://inherit.test/api/settings/jurisdiction", { headers: { [PERSON_OPERATION_NONCE_HEADER]: nonce } });
    const verified = personOperationNonceFrom(request, DECLARE);
    expect(verified).not.toBeNull();
    const args = personOperationNonceArgs(verified!);
    expect(args).toEqual({ p_nonce_hash: hashOperationNonce(nonce), p_nonce_expires_at: new Date(verified!.expiresAt).toISOString() });
    expect(JSON.stringify(args)).not.toContain(nonce);
    expect(personOperationNonceFrom(new Request("https://inherit.test/"), DECLARE)).toBeNull();
  });

  it("recognises only the door's own nonce refusal", () => {
    expect(isOperationNonceRefusal({ code: "22023", message: "invalid_operation_nonce" })).toBe(true);
    for (const error of [{ code: "22023", message: "invalid_request" }, { code: "42501", message: "invalid_operation_nonce" }, null, undefined]) {
      expect(isOperationNonceRefusal(error)).toBe(false);
    }
  });
});
