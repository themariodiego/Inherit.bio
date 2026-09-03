import crypto from "node:crypto";
import { afterAll, describe, expect, it, vi } from "vitest";

vi.stubEnv("BYOK_ENCRYPTION_KEY", crypto.randomBytes(32).toString("base64"));

const { TIER2_COOKIE_NAME, tier2CookieAttributes, tier2CookieMatches, tier2Digest, authSessionIdFromAccessToken } =
  await import("./tier2");

afterAll(() => {
  vi.unstubAllEnvs();
});

/**
 * The Tier-2 memory (design §1.5): a keyed digest of the account and the
 * auth session, so the acknowledgement cannot be forged in the browser and
 * cannot outlive the session it was given in.
 */

const ACCOUNT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SESSION = "session-one";

function accessToken(payload: Record<string, unknown>): string {
  const part = (value: unknown) =>
    Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
  return `${part({ alg: "none" })}.${part(payload)}.signature`;
}

describe("tier 2 family gate", () => {
  it("is a session cookie, httpOnly and never readable by script", () => {
    expect(TIER2_COOKIE_NAME).toBe("inherit_family_gate");
    const attributes = tier2CookieAttributes();
    expect(attributes).toMatchObject({ httpOnly: true, secure: true, sameSite: "lax", path: "/" });
    expect(attributes).not.toHaveProperty("maxAge");
    expect(attributes).not.toHaveProperty("expires");
  });

  it("digests the account and the session together", () => {
    const digest = tier2Digest(ACCOUNT, SESSION);
    expect(digest).toMatch(/^[0-9a-f]{64}$/);
    expect(tier2Digest(ACCOUNT, SESSION)).toBe(digest);
    expect(tier2Digest(ACCOUNT, "session-two")).not.toBe(digest);
    expect(tier2Digest("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", SESSION)).not.toBe(digest);
    expect(digest).not.toContain(ACCOUNT);
  });

  it("matches only the exact digest for this account in this session", () => {
    const digest = tier2Digest(ACCOUNT, SESSION);
    expect(tier2CookieMatches(digest, ACCOUNT, SESSION)).toBe(true);
    expect(tier2CookieMatches(digest, ACCOUNT, "session-two")).toBe(false);
    expect(tier2CookieMatches("1", ACCOUNT, SESSION)).toBe(false);
    expect(tier2CookieMatches(undefined, ACCOUNT, SESSION)).toBe(false);
    expect(tier2CookieMatches(`${digest.slice(0, 63)}0`, ACCOUNT, SESSION)).toBe(false);
  });

  it("reads the session id from the access token, or nothing at all", () => {
    expect(authSessionIdFromAccessToken(accessToken({ session_id: SESSION }))).toBe(SESSION);
    expect(authSessionIdFromAccessToken(accessToken({}))).toBeNull();
    expect(authSessionIdFromAccessToken("not-a-token")).toBeNull();
  });
});
