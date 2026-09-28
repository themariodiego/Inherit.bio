import crypto from "node:crypto";
import { afterAll, describe, expect, it, vi } from "vitest";

vi.stubEnv("BYOK_ENCRYPTION_KEY", crypto.randomBytes(32).toString("base64"));
vi.stubEnv("INHERIT_HMAC_KEYRING", "");

const { INVITATION_ATTEMPT_OPERATION, invitationQuotaKeys } = await import("./invitation-quota");
const { keyedDigestSet } = await import("./hmac-keyring");

afterAll(() => {
  vi.unstubAllEnvs();
});

const ACCOUNT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

describe("invitation quota keys", () => {
  it("names the registered quota operation", () => {
    expect(INVITATION_ATTEMPT_OPERATION).toBe("global-contact-refusal-bar-v1.invitation-attempt");
  });

  it("sends one account digest per held rate-limit revision", () => {
    const keys = invitationQuotaKeys(ACCOUNT);
    expect(Object.keys(keys)).toEqual(["1"]);
    expect(Object.keys(keys["1"]!)).toEqual(["authenticated-principal"]);
    expect(keys["1"]!["authenticated-principal"]).toMatch(/^[0-9a-f]{64}$/);
  });

  it("never sends the account id itself", () => {
    expect(JSON.stringify(invitationQuotaKeys(ACCOUNT))).not.toContain(ACCOUNT);
  });

  it("keys one account the same way every time and different accounts apart", () => {
    expect(invitationQuotaKeys(ACCOUNT)).toEqual(invitationQuotaKeys(ACCOUNT));
    expect(invitationQuotaKeys(OTHER)["1"]!["authenticated-principal"])
      .not.toBe(invitationQuotaKeys(ACCOUNT)["1"]!["authenticated-principal"]);
  });

  it("namespaces the digest so it matches no bare or contact digest of the same id", () => {
    const digest = invitationQuotaKeys(ACCOUNT)["1"]!["authenticated-principal"];
    expect(digest).not.toBe(keyedDigestSet("rate-limit", ACCOUNT)["1"]);
    expect(digest).not.toBe(keyedDigestSet("contact", ACCOUNT)["1"]);
  });

  it("adds every configured revision, so a rotation never restarts a count", () => {
    vi.stubEnv("INHERIT_HMAC_KEYRING", `2:${crypto.randomBytes(32).toString("base64")}`);
    try {
      const keys = invitationQuotaKeys(ACCOUNT);
      expect(Object.keys(keys)).toEqual(["1", "2"]);
      expect(keys["2"]!["authenticated-principal"]).not.toBe(keys["1"]!["authenticated-principal"]);
    } finally {
      vi.stubEnv("INHERIT_HMAC_KEYRING", "");
    }
  });
});
