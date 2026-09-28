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
const from = (address: string) => new Headers({ "x-real-ip": address });

describe("invitation quota keys", () => {
  it("names the registered quota operation", () => {
    expect(INVITATION_ATTEMPT_OPERATION).toBe("global-contact-refusal-bar-v1.invitation-attempt");
  });

  it("sends one account and one network digest per held rate-limit revision", () => {
    const keys = invitationQuotaKeys(ACCOUNT, from("192.0.2.1"));
    expect(Object.keys(keys)).toEqual(["1"]);
    expect(Object.keys(keys["1"]!).sort()).toEqual(["authenticated-principal", "source-network"]);
    for (const digest of Object.values(keys["1"]!)) expect(digest).toMatch(/^[0-9a-f]{64}$/);
  });

  it("never sends the account id or the address itself", () => {
    for (const address of ["192.0.2.1", "2001:db8:1:2::a"]) {
      const serialized = JSON.stringify(invitationQuotaKeys(ACCOUNT, from(address)));
      expect(serialized).not.toContain(ACCOUNT);
      expect(serialized).not.toContain(address);
      expect(serialized).not.toContain("2001:db8");
    }
  });

  it("keys one account the same from any network, and one network the same for any account", () => {
    const first = invitationQuotaKeys(ACCOUNT, from("192.0.2.1"))["1"]!;
    const moved = invitationQuotaKeys(ACCOUNT, from("198.51.100.9"))["1"]!;
    const other = invitationQuotaKeys(OTHER, from("192.0.2.1"))["1"]!;
    expect(moved["authenticated-principal"]).toBe(first["authenticated-principal"]);
    expect(moved["source-network"]).not.toBe(first["source-network"]);
    expect(other["authenticated-principal"]).not.toBe(first["authenticated-principal"]);
    expect(other["source-network"]).toBe(first["source-network"]);
  });

  it("counts every address inside one IPv6 /64 as one network", () => {
    expect(invitationQuotaKeys(ACCOUNT, from("2001:db8:1:2::a"))["1"]!["source-network"])
      .toBe(invitationQuotaKeys(ACCOUNT, from("2001:db8:1:2:ffff::1"))["1"]!["source-network"]);
  });

  it("keeps the two dimensions and other keyrings apart, even for the same text", () => {
    const keys = invitationQuotaKeys("ipv4:192.0.2.1", from("192.0.2.1"))["1"]!;
    expect(keys["authenticated-principal"]).not.toBe(keys["source-network"]);
    expect(keys["authenticated-principal"]).not.toBe(keyedDigestSet("rate-limit", ACCOUNT)["1"]);
    expect(keys["source-network"]).not.toBe(keyedDigestSet("contact", "ipv4:192.0.2.1")["1"]);
  });

  it("adds every configured revision, so a rotation never restarts a count", () => {
    vi.stubEnv("INHERIT_HMAC_KEYRING", `2:${crypto.randomBytes(32).toString("base64")}`);
    try {
      const keys = invitationQuotaKeys(ACCOUNT, from("192.0.2.1"));
      expect(Object.keys(keys)).toEqual(["1", "2"]);
      expect(keys["2"]!["authenticated-principal"]).not.toBe(keys["1"]!["authenticated-principal"]);
      expect(keys["2"]!["source-network"]).not.toBe(keys["1"]!["source-network"]);
    } finally {
      vi.stubEnv("INHERIT_HMAC_KEYRING", "");
    }
  });
});
