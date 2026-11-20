import crypto from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  SESSION_CSRF_LIFETIME_MS,
  SESSION_CSRF_ROUTES,
  SESSION_CSRF_SECOND_KINDS,
  SESSION_CSRF_STREAM_ROUTES,
  acceptsSessionKind,
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
    // 2026-11-19 (G8.5, the migration stage): the kinds list grew from the
    // three of 20261024220000 to the eight public.consume_session_csrf_v2 accepts.
    expect(new Set(Object.values(SESSION_CSRF_ROUTES))).toEqual(new Set(["authenticated", "token", "token-candidate",
      "reviewer", "upload-session", "claim-session", "evidence-session", "reset-session"]));
    expect(() => mintSessionCsrf({ kind: "upload-session", sessionHash: "a".repeat(64), sessionId: "not-a-uuid" },
      "api.embryo-ingest-configure", NOW)).toThrow();
  });
});

/**
 * The five kinds of G8.5's migration stage. A token of one kind never
 * verifies as another, even where the two bind the same values: a reviewer's
 * and an account's are both the account and its auth session; a claim
 * session's, a reset session's and a rights session's are each one cookie
 * hash. An upload or evidence session's token binds the session id the path
 * names as well as the cookie's hash.
 */
describe("the five later session kinds", () => {
  const reviewer: CsrfSession = { kind: "reviewer", accountId: account.accountId, sessionId: account.sessionId };
  const HASH = "c".repeat(64);
  const SESSION = "55555555-5555-4555-8555-555555555555";

  it("keeps a reviewer token and an account token apart", () => {
    const token = mintSessionCsrf(reviewer, "api.appeal-review", NOW);
    expect(verifySessionCsrf(token, reviewer, "api.appeal-review", NOW + 1)).not.toBeNull();
    expect(verifySessionCsrf(token, account, "api.appeal-review", NOW + 1)).toBeNull();
    expect(() => mintSessionCsrf(reviewer, "api.jurisdiction", NOW)).toThrow("session_csrf_context_invalid");
    expect(() => mintSessionCsrf(account, "api.appeal-review", NOW)).toThrow("session_csrf_context_invalid");
    expect(verifySessionCsrf(mintSessionCsrf(account, "api.jurisdiction", NOW), reviewer, "api.jurisdiction", NOW + 1)).toBeNull();
  });

  it("keeps each cookie kind apart from the others with the same hash", () => {
    const claim: CsrfSession = { kind: "claim-session", sessionHash: HASH };
    const token = mintSessionCsrf(claim, "api.future-person-claim-complete", NOW);
    expect(verifySessionCsrf(token, claim, "api.future-person-claim-complete", NOW + 1)).not.toBeNull();
    for (const kind of ["token", "reset-session", "token-candidate"] as const) {
      expect(verifySessionCsrf(token, { kind, sessionHash: HASH }, "api.future-person-claim-complete", NOW + 1), kind).toBeNull();
    }
    const reset = mintSessionCsrf({ kind: "reset-session", sessionHash: HASH }, "auth.reset-password-submit", NOW);
    expect(verifySessionCsrf(reset, { kind: "reset-session", sessionHash: HASH }, "auth.reset-password-submit", NOW + 1)).not.toBeNull();
    expect(verifySessionCsrf(reset, { kind: "reset-session", sessionHash: "d".repeat(64) }, "auth.reset-password-submit", NOW + 1)).toBeNull();
  });

  it("binds an upload or evidence session's token to the session id as well as the cookie", () => {
    for (const [kind, route] of [["upload-session", "api.embryo-ingest-complete"], ["evidence-session", "api.evidence-complete"]] as const) {
      const session: CsrfSession = { kind, sessionHash: HASH, sessionId: SESSION };
      const token = mintSessionCsrf(session, route, NOW);
      expect(verifySessionCsrf(token, session, route, NOW + 1), kind).not.toBeNull();
      expect(verifySessionCsrf(token, { ...session, sessionId: "66666666-6666-4666-8666-666666666666" }, route, NOW + 1), kind).toBeNull();
      expect(verifySessionCsrf(token, { ...session, sessionHash: "d".repeat(64) }, route, NOW + 1), kind).toBeNull();
    }
    const evidence = mintSessionCsrf({ kind: "evidence-session", sessionHash: HASH, sessionId: SESSION }, "api.evidence-chunk", NOW);
    expect(verifySessionCsrf(evidence, { kind: "upload-session", sessionHash: HASH, sessionId: SESSION }, "api.evidence-chunk", NOW + 1)).toBeNull();
  });

  it("names one chunk stream, api.evidence-chunk, whose value is not spent per chunk (principle 3)", () => {
    expect([...SESSION_CSRF_STREAM_ROUTES]).toEqual(["api.evidence-chunk"]);
    expect(Object.hasOwn(SESSION_CSRF_ROUTES, "api.embryo-ingest-chunk")).toBe(false);
  });
});

/**
 * Owner decision of 19 November 2026, "G8.5: the claim-objection address
 * accepts either kind of session": one route takes a rights or an account
 * session's token. Every other route takes its own kind only.
 */
describe("the one route that takes two kinds of session", () => {
  it("is declared for api.future-person-claim-objection alone, rights first and account second", () => {
    expect(SESSION_CSRF_SECOND_KINDS).toEqual({ "api.future-person-claim-objection": "authenticated" });
    expect(SESSION_CSRF_ROUTES["api.future-person-claim-objection"]).toBe("token");
    const accountToken = mintSessionCsrf(account, "api.future-person-claim-objection", NOW);
    const rightsToken = mintSessionCsrf(rights, "api.future-person-claim-objection", NOW);
    expect(verifySessionCsrf(accountToken, account, "api.future-person-claim-objection", NOW + 1)).not.toBeNull();
    expect(verifySessionCsrf(rightsToken, rights, "api.future-person-claim-objection", NOW + 1)).not.toBeNull();
    expect(verifySessionCsrf(accountToken, rights, "api.future-person-claim-objection", NOW + 1)).toBeNull();
    expect(verifySessionCsrf(rightsToken, account, "api.future-person-claim-objection", NOW + 1)).toBeNull();
  });

  it("does not let any other route take a second kind: each refuses every kind but its own", () => {
    const kinds = ["authenticated", "token", "token-candidate", "reviewer", "upload-session", "claim-session", "evidence-session", "reset-session"] as const;
    for (const route of Object.keys(SESSION_CSRF_ROUTES) as (keyof typeof SESSION_CSRF_ROUTES)[]) {
      const accepted = kinds.filter(kind => acceptsSessionKind(route, kind));
      expect(accepted, route).toEqual(route === "api.future-person-claim-objection"
        ? ["authenticated", "token"] : [SESSION_CSRF_ROUTES[route]]);
    }
    expect(() => mintSessionCsrf(account, "api.withdraw", NOW)).toThrow("session_csrf_context_invalid");
    expect(() => mintSessionCsrf(rights, "api.future-person-claimant-bind", NOW)).toThrow("session_csrf_context_invalid");
  });
});
