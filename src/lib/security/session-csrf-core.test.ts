import crypto from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  SESSION_CSRF_LIFETIME_MS,
  SESSION_CSRF_ROUTES,
  mintSessionCsrf,
  verifySessionCsrf,
  type CsrfSession,
} from "./session-csrf-core";

const KEY = Buffer.alloc(32, 7).toString("base64");
const OTHER_KEY = Buffer.alloc(32, 8).toString("base64");
const NOW = Date.UTC(2026, 9, 23, 12);
const account: CsrfSession = {
  kind: "authenticated",
  accountId: "11111111-1111-4111-8111-111111111111",
  sessionId: "22222222-2222-4222-8222-222222222222",
};
const rights: CsrfSession = { kind: "token", sessionHash: "a".repeat(64) };

beforeEach(() => vi.stubEnv("BYOK_ENCRYPTION_KEY", KEY));
afterEach(() => vi.unstubAllEnvs());

describe("the one-time X-Inherit-CSRF token (session-csrf-core)", () => {
  it("is a fresh random value each time, in the operation nonce's shape", () => {
    const first = mintSessionCsrf(account, "api.jurisdiction", NOW);
    const second = mintSessionCsrf(account, "api.jurisdiction", NOW);
    expect(first).toMatch(/^\d{13}\.[A-Za-z0-9_-]{43}\.[0-9a-f]{64}$/);
    expect(first).not.toBe(second);
    expect(first.startsWith(`${NOW + SESSION_CSRF_LIFETIME_MS}.`)).toBe(true);
    // Nothing that identifies the session or the route travels in it.
    for (const part of [account.accountId, account.sessionId, "api.jurisdiction", "authenticated"]) {
      expect(first).not.toContain(part);
    }
  });

  it("verifies for exactly the session and route it was minted for, and hashes the whole token", () => {
    const token = mintSessionCsrf(account, "api.jurisdiction", NOW);
    expect(verifySessionCsrf(token, account, "api.jurisdiction", NOW + 1)).toEqual({
      tokenHash: crypto.createHash("sha256").update(token, "utf8").digest("hex"),
      expiresAt: NOW + SESSION_CSRF_LIFETIME_MS,
    });
    const rightsToken = mintSessionCsrf(rights, "api.withdraw", NOW);
    expect(verifySessionCsrf(rightsToken, rights, "api.withdraw", NOW + 1)?.expiresAt).toBe(NOW + SESSION_CSRF_LIFETIME_MS);
  });

  it("refuses a missing, empty, repeated, oversized or malformed header", () => {
    const token = mintSessionCsrf(account, "api.jurisdiction", NOW);
    for (const presented of [null, undefined, "", `${token}, ${token}`, `${token}x`, `${"9".repeat(13)}.${"A".repeat(43)}.${"0".repeat(64)}`,
      token.toUpperCase(), token.replace(/\.[^.]+$/u, ""), 42]) {
      expect(verifySessionCsrf(presented, account, "api.jurisdiction", NOW + 1), String(presented)).toBeNull();
    }
  });

  it("refuses a token of another account, another auth session or another purpose session", () => {
    const token = mintSessionCsrf(account, "api.jurisdiction", NOW);
    expect(verifySessionCsrf(token, { ...account, accountId: "33333333-3333-4333-8333-333333333333" }, "api.jurisdiction", NOW + 1)).toBeNull();
    expect(verifySessionCsrf(token, { ...account, sessionId: "44444444-4444-4444-8444-444444444444" }, "api.jurisdiction", NOW + 1)).toBeNull();
    const rightsToken = mintSessionCsrf(rights, "api.withdraw", NOW);
    expect(verifySessionCsrf(rightsToken, { kind: "token", sessionHash: "b".repeat(64) }, "api.withdraw", NOW + 1)).toBeNull();
    // A candidate's hash under the rights-session kind is another session.
    expect(verifySessionCsrf(rightsToken, { kind: "token-candidate", sessionHash: rights.sessionHash }, "api.withdraw", NOW + 1)).toBeNull();
  });

  it("refuses a token minted for another route, and will not mint one for a route of another session kind", () => {
    const token = mintSessionCsrf(account, "api.jurisdiction", NOW);
    expect(verifySessionCsrf(token, account, "api.chromosomal-sex", NOW + 1)).toBeNull();
    expect(verifySessionCsrf(token, account, "auth.sign-out", NOW + 1)).toBeNull();
    const rightsToken = mintSessionCsrf(rights, "api.withdraw", NOW);
    expect(verifySessionCsrf(rightsToken, rights, "api.consent-grant-rights", NOW + 1)).toBeNull();
    expect(() => mintSessionCsrf(rights, "api.jurisdiction", NOW)).toThrow("session_csrf_context_invalid");
    expect(() => mintSessionCsrf(account, "api.withdraw", NOW)).toThrow("session_csrf_context_invalid");
    expect(verifySessionCsrf(rightsToken, account, "api.withdraw", NOW + 1)).toBeNull();
  });

  it("refuses an expired, a not-yet-plausible or an altered token", () => {
    const token = mintSessionCsrf(account, "api.jurisdiction", NOW);
    expect(verifySessionCsrf(token, account, "api.jurisdiction", NOW + SESSION_CSRF_LIFETIME_MS)).toBeNull();
    // An expiry further away than the lifetime was never minted here.
    expect(verifySessionCsrf(token, account, "api.jurisdiction", NOW - 1)).toBeNull();
    const [expiry, random, mac] = token.split(".");
    expect(verifySessionCsrf(`${Number(expiry) + 1}.${random}.${mac}`, account, "api.jurisdiction", NOW + 1)).toBeNull();
    expect(verifySessionCsrf(`${expiry}.${random.slice(0, -1)}${random.at(-1) === "A" ? "B" : "A"}.${mac}`, account, "api.jurisdiction", NOW + 1)).toBeNull();
    expect(verifySessionCsrf(`${expiry}.${random}.${mac.slice(0, -1)}${mac.at(-1) === "0" ? "1" : "0"}`, account, "api.jurisdiction", NOW + 1)).toBeNull();
  });

  it("is keyed: a token minted under another deployment key never verifies, and a local test helper can mint under the server's", () => {
    const foreign = mintSessionCsrf(account, "api.jurisdiction", NOW, OTHER_KEY);
    expect(verifySessionCsrf(foreign, account, "api.jurisdiction", NOW + 1)).toBeNull();
    const helper = mintSessionCsrf(account, "api.jurisdiction", NOW, KEY);
    expect(verifySessionCsrf(helper, account, "api.jurisdiction", NOW + 1)).not.toBeNull();
  });

  it("refuses to mint for an invalid session or time", () => {
    expect(() => mintSessionCsrf({ ...account, accountId: "not-a-uuid" }, "api.jurisdiction", NOW)).toThrow();
    expect(() => mintSessionCsrf({ kind: "token", sessionHash: "short" }, "api.withdraw", NOW)).toThrow();
    expect(() => mintSessionCsrf(account, "api.jurisdiction", -1)).toThrow();
    expect(Object.values(SESSION_CSRF_ROUTES).every((kind) => ["authenticated", "token", "token-candidate"].includes(kind))).toBe(true);
  });
});
