import crypto from "node:crypto";
import { afterAll, describe, expect, it, vi } from "vitest";

vi.stubEnv("BYOK_ENCRYPTION_KEY", crypto.randomBytes(32).toString("base64"));

const { TIER2_EMBRYO_COOKIE_NAME, tier2CookieAttributes, tier2CookieMatches, tier2Digest } = await import("./tier2");
const family = await import("@/lib/family/tier2");

afterAll(() => {
  vi.unstubAllEnvs();
});

/**
 * The Embryo domain's Tier-2 memory (design §1.5): the same mechanism as
 * Family under its own cookie and digest context, so one acknowledgement
 * never silently opens the other boundary.
 */

const ACCOUNT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SESSION = "session-one";

describe("tier 2 embryo gate", () => {
  it("is a session cookie of its own, httpOnly and never readable by script", () => {
    expect(TIER2_EMBRYO_COOKIE_NAME).toBe("inherit_embryo_gate");
    expect(TIER2_EMBRYO_COOKIE_NAME).not.toBe(family.TIER2_COOKIE_NAME);
    const attributes = tier2CookieAttributes();
    expect(attributes).toMatchObject({ httpOnly: true, secure: true, sameSite: "lax", path: "/" });
    expect(attributes).not.toHaveProperty("maxAge");
    expect(attributes).not.toHaveProperty("expires");
  });

  it("digests the account and the session under a context distinct from Family's", () => {
    const digest = tier2Digest(ACCOUNT, SESSION);
    expect(digest).toMatch(/^[0-9a-f]{64}$/);
    expect(tier2Digest(ACCOUNT, SESSION)).toBe(digest);
    expect(tier2Digest(ACCOUNT, "session-two")).not.toBe(digest);
    expect(tier2Digest("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", SESSION)).not.toBe(digest);
    expect(family.tier2Digest(ACCOUNT, SESSION)).not.toBe(digest);
    expect(digest).not.toContain(ACCOUNT);
  });

  it("matches only the exact digest for this account in this session, and never Family's", () => {
    const digest = tier2Digest(ACCOUNT, SESSION);
    expect(tier2CookieMatches(digest, ACCOUNT, SESSION)).toBe(true);
    expect(tier2CookieMatches(family.tier2Digest(ACCOUNT, SESSION), ACCOUNT, SESSION)).toBe(false);
    expect(tier2CookieMatches(digest, ACCOUNT, "session-two")).toBe(false);
    expect(tier2CookieMatches(undefined, ACCOUNT, SESSION)).toBe(false);
    expect(tier2CookieMatches("1", ACCOUNT, SESSION)).toBe(false);
    const tampered = `${digest.slice(0, 63)}${digest.endsWith("0") ? "1" : "0"}`;
    expect(tier2CookieMatches(tampered, ACCOUNT, SESSION)).toBe(false);
  });
});
