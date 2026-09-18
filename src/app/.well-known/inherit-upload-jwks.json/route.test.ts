import crypto from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";

function signer() {
  const pair = crypto.generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  return { ...pair.privateKey.export({ format: "jwk" }), kid: crypto.randomUUID() } as Record<string, string>;
}

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://inherit.bio");
  vi.stubEnv("VERCEL", "");
});
afterEach(() => vi.unstubAllEnvs());

describe("GET /.well-known/inherit-upload-jwks.json", () => {
  it("serves exactly the signer's public key, cacheable, with no private member", async () => {
    const jwk = signer();
    vi.stubEnv("INHERIT_UPLOAD_SIGNING_JWK", JSON.stringify(jwk));
    const response = GET();
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toMatch(/^application\/json/);
    expect(response.headers.get("cache-control")).toBe("public, max-age=300");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    const body = await response.json();
    expect(body).toEqual({ keys: [{ kty: "EC", crv: "P-256", kid: jwk.kid, x: jwk.x, y: jwk.y, alg: "ES256", use: "sig" }] });
    expect(JSON.stringify(body)).not.toContain(jwk.d);
  });

  it.each([
    ["no signer", ""],
    ["not JSON", "{"],
    ["a public-only key", JSON.stringify(Object.fromEntries(Object.entries(signer()).filter(([name]) => name !== "d")))],
  ])("answers 503 and no-store when the signer is unavailable (%s)", async (_label, value) => {
    vi.stubEnv("INHERIT_UPLOAD_SIGNING_JWK", value);
    const response = GET();
    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ error: "unavailable" });
  });

  it("answers 503 when the public coordinates do not belong to the private scalar", async () => {
    const one = signer(), other = signer();
    vi.stubEnv("INHERIT_UPLOAD_SIGNING_JWK", JSON.stringify({ ...one, x: other.x, y: other.y }));
    const response = GET();
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "unavailable" });
  });
});
