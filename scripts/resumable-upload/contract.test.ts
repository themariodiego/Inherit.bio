import { describe, expect, it } from "vitest";
import { CREATE_OPT_IN, PREVIEW_APP, PREVIEW_API, PREVIEW_PROJECT, PREVIEW_STORAGE, TUS_PATH,
  validateCredentials, validateGrant, validateLocation, validateTarget } from "./contract";
import { credentials, grant, ids, location, NOW, sessionCookie, token } from "./fixtures";

describe("preview contract guards", () => {
  it("requires the exact preview and an explicit destructive diagnostic opt-in", () => {
    expect(() => validateTarget(PREVIEW_PROJECT, PREVIEW_APP, CREATE_OPT_IN)).not.toThrow();
    for (const args of [["zuvloczwgrayonqabnss", PREVIEW_APP, CREATE_OPT_IN],
      [PREVIEW_PROJECT, "https://inherit.bio", CREATE_OPT_IN], [PREVIEW_PROJECT, PREVIEW_APP, undefined]]) {
      expect(() => validateTarget(...args as [unknown, unknown, unknown])).toThrow("probe_contract_refused");
    }
  });

  it("accepts current synthetic credentials and ordered or unordered complete cookie chunks", () => {
    const input = credentials();
    expect(validateCredentials(input, NOW)).toEqual(input);
    const [name, value] = input.sessionCookie.split("=");
    input.sessionCookie = `${name}.1=${value.slice(150)}; ${name}.0=${value.slice(0, 150)}`;
    expect(validateCredentials(input, NOW)).toEqual(input);
  });

  it.each([
    { sub: ids.upload }, { session_id: ids.upload }, { role: "service_role" }, { iss: "https://inherit.bio/auth/v1" },
    { exp: NOW / 1000 + 119 }, { is_anonymous: true }, { aud: "other" },
  ])("rejects a stale or incorrectly bound session before issuance: %j", overrides => {
    expect(() => validateCredentials({ ...credentials(), sessionCookie: sessionCookie(overrides) }, NOW)).toThrow("probe_contract_refused");
  });

  it("rejects duplicate, gapped, mixed and injected cookies", () => {
    const input = credentials(), [name, value] = input.sessionCookie.split("=");
    for (const sessionCookie of [input.sessionCookie + "; " + input.sessionCookie, `${name}.1=${value}`,
      `${input.sessionCookie}; ${name}.0=${value}`, `${input.sessionCookie}; other=value`, `${input.sessionCookie}\r\nX-Test: secret`]) {
      expect(() => validateCredentials({ ...input, sessionCookie }, NOW)).toThrow("probe_contract_refused");
    }
  });

  it("rejects a privileged, foreign or expired API key and extra credential fields", () => {
    for (const claims of [{ ref: PREVIEW_PROJECT, role: "service_role", exp: NOW / 1000 + 3600 },
      { ref: "zuvloczwgrayonqabnss", role: "anon", exp: NOW / 1000 + 3600 },
      { ref: PREVIEW_PROJECT, role: "anon", exp: NOW / 1000 }]) {
      expect(() => validateCredentials({ ...credentials(), anonKey: token(claims) }, NOW)).toThrow("probe_contract_refused");
    }
    expect(() => validateCredentials({ ...credentials(), serviceKey: "not-a-key" }, NOW)).toThrow("probe_contract_refused");
  });

  it("accepts only the matching fresh 512-byte grant", () => {
    expect(validateGrant(grant(), credentials(), NOW)).toEqual(grant());
    for (const changed of [{ maximumBytes: 513 }, { uploadId: ids.staging }, { stagingKey: ids.upload },
      { bucket: "other" }, { expiresAt: new Date(NOW + 1799_000).toISOString() }]) {
      expect(() => validateGrant({ ...grant(), ...changed }, credentials(), NOW)).toThrow("probe_contract_refused");
    }
  });

  it.each([{ sub: ids.upload }, { session_id: ids.upload }, { jti: ids.session }, { maximum_bytes: 513 },
    { upload_session_id: ids.staging }, { staging_key: ids.upload }, { role: "authenticated" },
    { iat: NOW / 1000 + 1 }, { iat: NOW / 1000 - 61 }, { nbf: NOW / 1000 + 1 },
    { exp: NOW / 1000 + 1801 }, { exp: NOW / 1000 + 119 }, { account_auth_session_revision: 0 },
    { unexpected: "not-allowed" }])("rejects expanded, stale or unbound grant claims: %j", overrides => {
    expect(() => validateGrant(grant(overrides), credentials(), NOW)).toThrow("probe_contract_refused");
  });

  it("accepts only exact canonical provider Locations for this bucket, key and provider version", () => {
    expect(validateLocation(location, validateGrant(grant(), credentials(), NOW))).toBe(location);
    expect(validateLocation(location.replace(PREVIEW_STORAGE, ""), grant())).toBe(location);
    expect(validateLocation(location.replace(PREVIEW_STORAGE, PREVIEW_API), grant())).toBe(location.replace(PREVIEW_STORAGE, PREVIEW_API));
    const suffix = location.slice(PREVIEW_STORAGE.length);
    for (const invalid of [location + "?token=private", location + "#secret", location + "=", location + "/",
      location.replace("https:", "http:"), location.replace(PREVIEW_STORAGE, "https://inherit.bio"),
      `//${new URL(PREVIEW_STORAGE).hostname}${suffix}`, `${PREVIEW_STORAGE}/../${suffix.slice(1)}`,
      `${PREVIEW_STORAGE}${TUS_PATH}/${Buffer.from(`genomes/${ids.upload}/${ids.version}`).toString("base64url")}`,
      `${PREVIEW_STORAGE}${TUS_PATH}/${Buffer.from(`genomes/${ids.staging}/not-a-version`).toString("base64url")}`,
      `${PREVIEW_STORAGE}${TUS_PATH}/${Buffer.from(`genomes/${ids.staging}/${ids.version}/extra`).toString("base64url")}`,
      "not-an-upload-location"]) {
      expect(() => validateLocation(invalid, grant())).toThrow("probe_contract_refused");
    }
  });
});
