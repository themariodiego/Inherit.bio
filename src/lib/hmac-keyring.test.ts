import crypto from "node:crypto";
import { afterAll, describe, expect, it, vi } from "vitest";

vi.stubEnv("BYOK_ENCRYPTION_KEY", crypto.randomBytes(32).toString("base64"));
vi.stubEnv("INHERIT_HMAC_KEYRING", "");

const {
  contactDigestCandidates,
  contactDigestSet,
  keyedDigestSet,
  keyringRootKeys,
  legacyContactDigest,
} = await import("./hmac-keyring");
const { hmacSecret } = await import("@/lib/crypto");

afterAll(() => {
  vi.unstubAllEnvs();
});

const KEY_2 = crypto.randomBytes(32).toString("base64");
const KEY_3 = crypto.randomBytes(32).toString("base64url");
const ADDRESS = "someone@example.invalid";

describe("keyed digest sets", () => {
  it("keeps revision 1 exactly the digest this deployment has always stored", () => {
    expect(keyedDigestSet("contact", ADDRESS, "")).toEqual({ "1": hmacSecret(ADDRESS, "contact-email-v1") });
    expect(legacyContactDigest(ADDRESS)).toBe(hmacSecret(ADDRESS, "contact-email-v1"));
    expect(contactDigestSet(ADDRESS)).toEqual({ "1": legacyContactDigest(ADDRESS) });
  });

  it("adds one digest per configured revision, each distinct and 64 hex", () => {
    const set = keyedDigestSet("contact", ADDRESS, `2:${KEY_2},3:${KEY_3}`);
    expect(Object.keys(set)).toEqual(["1", "2", "3"]);
    for (const digest of Object.values(set)) expect(digest).toMatch(/^[0-9a-f]{64}$/);
    expect(new Set(Object.values(set)).size).toBe(3);
    expect(set["1"]).toBe(legacyContactDigest(ADDRESS));
  });

  it("derives a revision from its own secret, not from the revision number alone", () => {
    const other = crypto.randomBytes(32).toString("base64");
    expect(keyedDigestSet("contact", ADDRESS, `2:${KEY_2}`)["2"])
      .not.toBe(keyedDigestSet("contact", ADDRESS, `2:${other}`)["2"]);
    expect(keyedDigestSet("contact", ADDRESS, `2:${KEY_2}`)["2"])
      .toBe(keyedDigestSet("contact", ADDRESS, ` 2:${KEY_2} `)["2"]);
  });

  it("separates the contact and rate-limit keyrings under the same secret", () => {
    const contact = keyedDigestSet("contact", ADDRESS, `2:${KEY_2}`);
    const rate = keyedDigestSet("rate-limit", ADDRESS, `2:${KEY_2}`);
    expect(contact["1"]).not.toBe(rate["1"]);
    expect(contact["2"]).not.toBe(rate["2"]);
  });

  it("reads the deployment's keyring when none is passed", () => {
    vi.stubEnv("INHERIT_HMAC_KEYRING", `2:${KEY_2}`);
    try {
      expect(Object.keys(contactDigestSet(ADDRESS))).toEqual(["1", "2"]);
      expect(contactDigestCandidates(ADDRESS)).toEqual(Object.values(contactDigestSet(ADDRESS)));
    } finally {
      vi.stubEnv("INHERIT_HMAC_KEYRING", "");
    }
  });
});

describe("INHERIT_HMAC_KEYRING", () => {
  it("is empty until a rotation", () => {
    expect(keyringRootKeys(undefined)).toEqual([]);
    expect(keyringRootKeys("  ")).toEqual([]);
  });

  it.each([
    ["no revision", KEY_2],
    ["revision 1, which is derived", `1:${KEY_2}`],
    ["revision 0", `0:${KEY_2}`],
    ["a short key", `2:${crypto.randomBytes(16).toString("base64")}`],
    ["a long key", `2:${crypto.randomBytes(48).toString("base64")}`],
    ["a repeated revision", `2:${KEY_2},2:${KEY_3}`],
    ["one key under two revisions", `2:${KEY_2},3:${KEY_2}`],
    ["an empty entry", `2:${KEY_2},`],
    ["a non-base64 key", `2:${"!".repeat(43)}=`],
  ])("refuses %s rather than dropping a revision", (_case, setting) => {
    expect(() => keyringRootKeys(setting)).toThrow(/INHERIT_HMAC_KEYRING/);
  });

  it("never names a secret in its errors", () => {
    let message = "";
    try { keyringRootKeys(`1:${KEY_2}`); } catch (error) { message = (error as Error).message; }
    expect(message).not.toContain(KEY_2);
  });
});
