import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { GATEWAY_CONFIG, PRODUCTION_JWKS_URL, committedSigningKeys, deployGuardFailures, parseSigningKeys,
  servedSigningKeys } from "./cloudflare-deploy-guard";

const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Synthetic public keys: version-4 uuids and 43-character base64url coordinates.
const KEY_A = { kty: "EC", crv: "P-256", kid: "6f1c2a3e-8b4d-4c5e-9f60-1a2b3c4d5e6f", x: "a".repeat(43), y: "b".repeat(43) };
const KEY_B = { kty: "EC", crv: "P-256", kid: "0d9e8f7a-6b5c-4d3e-8f21-9a8b7c6d5e4f", x: "c".repeat(43), y: "d".repeat(43) };

function gateway(production: unknown, preview: unknown = []) {
  return {
    vars: { SIGNING_PUBLIC_KEYS: JSON.stringify(production) },
    env: { preview: { vars: { SIGNING_PUBLIC_KEYS: JSON.stringify(preview) } } },
  };
}

const served = (status: number, body: unknown) => vi.fn(async () => ({ status, body }));

describe("committed signing keys", () => {
  it("reads the target's own list from the real configuration file", () => {
    const config: unknown = JSON.parse(readFileSync(path.join(REPOSITORY_ROOT, GATEWAY_CONFIG), "utf8"));
    expect(Array.isArray(committedSigningKeys(config, "production"))).toBe(true);
    expect(Array.isArray(committedSigningKeys(config, "preview"))).toBe(true);
  });
  it("keeps only kid, x and y of a well-formed public key", () => {
    expect(parseSigningKeys(JSON.stringify([{ ...KEY_A, alg: "ES256", use: "sig" }]), "test")).toEqual([
      { kid: KEY_A.kid, x: KEY_A.x, y: KEY_A.y },
    ]);
  });
  it("refuses a private component, another curve, a non-uuid kid, and anything that is not a JSON array", () => {
    expect(() => parseSigningKeys(JSON.stringify([{ ...KEY_A, d: "e".repeat(43) }]), "test")).toThrow("private component");
    expect(() => parseSigningKeys(JSON.stringify([{ ...KEY_A, crv: "P-384" }]), "test")).toThrow("P-256");
    expect(() => parseSigningKeys(JSON.stringify([{ ...KEY_A, kid: "primary" }]), "test")).toThrow("uuid");
    expect(() => parseSigningKeys(JSON.stringify([{ ...KEY_A, x: "short" }]), "test")).toThrow("coordinates");
    expect(() => parseSigningKeys("{}", "test")).toThrow("not an array");
    expect(() => parseSigningKeys("[", "test")).toThrow("not JSON");
    expect(() => committedSigningKeys({ vars: {} }, "production")).toThrow("no SIGNING_PUBLIC_KEYS");
    expect(() => committedSigningKeys({ vars: { SIGNING_PUBLIC_KEYS: "[]" } }, "preview")).toThrow("preview");
  });
  it("accepts a served document as a JWKS object or a bare array, and never with a private component", () => {
    expect(servedSigningKeys({ keys: [KEY_A] })).toEqual([{ kid: KEY_A.kid, x: KEY_A.x, y: KEY_A.y }]);
    expect(servedSigningKeys([KEY_A])).toHaveLength(1);
    expect(() => servedSigningKeys({ keys: [{ ...KEY_A, d: "e".repeat(43) }] })).toThrow("private component");
    expect(() => servedSigningKeys({ jwks: [] })).toThrow("neither");
  });
});

describe("the production guard", () => {
  it("refuses an empty key list before asking the app anything", async () => {
    const fetchJwks = served(200, { keys: [KEY_A] });
    const failures = await deployGuardFailures({ target: "production", config: gateway([]), fetchJwks });
    expect(failures).toEqual([expect.stringContaining("empty")]);
    expect(fetchJwks).not.toHaveBeenCalled();
  });
  it("treats a missing route as a failure rather than as nothing to compare", async () => {
    const failures = await deployGuardFailures({ target: "production", config: gateway([KEY_A]), fetchJwks: served(404, null) });
    expect(failures).toEqual([expect.stringContaining("404")]);
  });
  it("treats an unreachable route and an unparseable body the same way", async () => {
    await expect(deployGuardFailures({ target: "production", config: gateway([KEY_A]),
      fetchJwks: () => Promise.reject(new Error("timeout")) })).resolves.toEqual([expect.stringContaining("timeout")]);
    await expect(deployGuardFailures({ target: "production", config: gateway([KEY_A]),
      fetchJwks: served(200, null) })).resolves.toEqual([expect.stringContaining("neither")]);
  });
  it("passes only when every committed key is served with the same kid, x and y", async () => {
    const config = gateway([KEY_A, KEY_B]);
    await expect(deployGuardFailures({ target: "production", config, fetchJwks: served(200, { keys: [KEY_B, KEY_A] }) }))
      .resolves.toEqual([]);
    // The app may serve more keys than the gateway trusts; the reverse is the failure.
    await expect(deployGuardFailures({ target: "production", config: gateway([KEY_A]),
      fetchJwks: served(200, { keys: [KEY_A, KEY_B] }) })).resolves.toEqual([]);
    await expect(deployGuardFailures({ target: "production", config, fetchJwks: served(200, { keys: [KEY_A] }) }))
      .resolves.toEqual([`committed key ${KEY_B.kid} is not served by ${PRODUCTION_JWKS_URL}`]);
    await expect(deployGuardFailures({ target: "production", config: gateway([KEY_A]),
      fetchJwks: served(200, { keys: [{ ...KEY_A, y: "f".repeat(43) }] }) }))
      .resolves.toEqual([expect.stringContaining(KEY_A.kid)]);
  });
  it("names a malformed committed list instead of deploying past it", async () => {
    const config = { vars: { SIGNING_PUBLIC_KEYS: "[{}]" }, env: { preview: { vars: { SIGNING_PUBLIC_KEYS: "[]" } } } };
    await expect(deployGuardFailures({ target: "production", config, fetchJwks: served(200, { keys: [] }) }))
      .resolves.toEqual([expect.stringContaining("not a P-256 EC key")]);
  });
});

describe("the preview guard", () => {
  it("lets an empty preview list through without fetching, but still refuses a malformed one", async () => {
    const fetchJwks = served(200, { keys: [] });
    await expect(deployGuardFailures({ target: "preview", config: gateway([KEY_A], []), fetchJwks })).resolves.toEqual([]);
    await expect(deployGuardFailures({ target: "preview", config: gateway([], [KEY_B]), fetchJwks })).resolves.toEqual([]);
    expect(fetchJwks).not.toHaveBeenCalled();
    const malformed = gateway([], [{ ...KEY_B, d: "e".repeat(43) }]);
    await expect(deployGuardFailures({ target: "preview", config: malformed, fetchJwks }))
      .resolves.toEqual([expect.stringContaining("private component")]);
  });
});
