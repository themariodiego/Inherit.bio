import crypto from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mintStorageUploadToken, UploadTokenUnavailable } from "./storage-upload-token";

const now = Date.parse("2026-09-06T12:00:00Z");
const authorization = {
  accountId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  sessionId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  accountAuthSessionRevision: 3,
  uploadId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  jti: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
  stagingKey: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
  maximumBytes: 1024,
  expiresAt: new Date(now + 1_800_000).toISOString(),
};
function keyPair() {
  const pair = crypto.generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  return { ...pair, jwk: { ...pair.privateKey.export({ format: "jwk" }), kid: crypto.randomUUID() } };
}
let pair: ReturnType<typeof keyPair>;
beforeEach(() => {
  pair = keyPair();
  vi.stubEnv("INHERIT_UPLOAD_SIGNING_JWK", JSON.stringify(pair.jwk));
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://inherit.bio");
  vi.stubEnv("VERCEL", "");
});
afterEach(() => vi.unstubAllEnvs());
function decode(token: string) {
  const [header, payload, signature] = token.split(".");
  return {
    header: JSON.parse(Buffer.from(header, "base64url").toString()),
    payload: JSON.parse(Buffer.from(payload, "base64url").toString()),
    signature: Buffer.from(signature, "base64url"), input: header + "." + payload,
  };
}
describe("dedicated Storage upload JWT signing", () => {
  it("signs the exact restricted claim set with ES256 and a verifiable 64-byte JWS signature", () => {
    const token = decode(mintStorageUploadToken(authorization, now));
    expect(token.header).toEqual({ alg: "ES256", kid: pair.jwk.kid, typ: "JWT" });
    expect(token.payload).toEqual({
      iss: "https://inherit.bio/auth/v1", aud: "inherit-storage-upload", role: "inherit_upload_only",
      sub: authorization.accountId, session_id: authorization.sessionId, account_auth_session_revision: 3,
      upload_session_id: authorization.uploadId, jti: authorization.jti, staging_key: authorization.stagingKey,
      maximum_bytes: authorization.maximumBytes,
      iat: now / 1000, nbf: now / 1000, exp: now / 1000 + 1800,
    });
    expect(token.signature).toHaveLength(64);
    expect(crypto.verify("sha256", Buffer.from(token.input),
      { key: pair.publicKey, dsaEncoding: "ieee-p1363" }, token.signature)).toBe(true);
    expect(crypto.verify("sha256", Buffer.from(token.input + "x"),
      { key: pair.publicKey, dsaEncoding: "ieee-p1363" }, token.signature)).toBe(false);
  });
  it("keeps an earlier database expiry and rounds it down, never extending authority", () => {
    const token = decode(mintStorageUploadToken({
      ...authorization, expiresAt: new Date(now + 71_999).toISOString(),
    }, now + 100));
    expect(token.payload.exp).toBe(now / 1000 + 71);
  });
  it.each([0, -1, 1_801_000, 7_200_000])("refuses invalid or overlong expiry offset %s", offset => {
    const expiresAt = new Date(now + offset).toISOString();
    expect(() => mintStorageUploadToken({ ...authorization, expiresAt }, now)).toThrow(UploadTokenUnavailable);
  });
  it("refuses extra claims rather than minting a caller-selected audience or role", () => {
    for (const extra of [{ role: "service_role" }, { aud: "authenticated" }, { refresh_token: "not-allowed" },
      { email: "synthetic@e2e.local" }, { user_metadata: { age: 18 } }]) {
      expect(() => mintStorageUploadToken({ ...authorization, ...extra }, now)).toThrow("upload_token_unavailable");
    }
  });
  it.each([
    ["sessionId", authorization.jti], ["accountId", authorization.accountId.toUpperCase()],
    ["accountAuthSessionRevision", 0], ["uploadId", "missing"], ["stagingKey", "../another-object"],
    ["expiresAt", "not-a-time"],
  ])("refuses an invalid %s without exposing it in errors", (key, value) => {
    expect(() => mintStorageUploadToken({ ...authorization, [key]: value }, now)).toThrow("upload_token_unavailable");
  });
  it.each([NaN, Infinity, 0, -1, now + 0.5])("requires a finite safe-integer issuance time %s", time => {
    expect(() => mintStorageUploadToken(authorization, time)).toThrow(UploadTokenUnavailable);
  });
  it("has no symmetric, user-token or service-role fallback when the key is absent", () => {
    vi.stubEnv("INHERIT_UPLOAD_SIGNING_JWK", "");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "not-an-upload-signing-key");
    vi.stubEnv("BYOK_ENCRYPTION_KEY", crypto.randomBytes(32).toString("base64"));
    expect(() => mintStorageUploadToken(authorization, now)).toThrow("upload_token_unavailable");
  });
  it("rejects malformed, unsupported and mismatched key material with one opaque error", () => {
    for (const key of [
      "not-json", {}, { ...pair.jwk, kid: undefined }, { ...pair.jwk, alg: "HS256" },
      { ...pair.jwk, crv: "P-384" }, { ...pair.jwk, key_ops: ["verify"] },
      { ...pair.jwk, d: keyPair().jwk.d }, { ...pair.jwk, d: "A".repeat(43) },
    ]) {
      vi.stubEnv("INHERIT_UPLOAD_SIGNING_JWK", JSON.stringify(key));
      try { mintStorageUploadToken(authorization, now); expect.fail("must refuse invalid key"); }
      catch (error) {
        expect(error).toBeInstanceOf(UploadTokenUnavailable);
        expect((error as Error).message).toBe("upload_token_unavailable");
        expect((error as Error).message).not.toContain(pair.jwk.d!);
      }
    }
  });
  it("uses the current configured key id on rotation without caching the old secret", () => {
    const old = decode(mintStorageUploadToken(authorization, now));
    const replacement = keyPair();
    vi.stubEnv("INHERIT_UPLOAD_SIGNING_JWK", JSON.stringify(replacement.jwk));
    const next = decode(mintStorageUploadToken(authorization, now));
    expect(next.header.kid).toBe(replacement.jwk.kid);
    expect(next.header.kid).not.toBe(old.header.kid);
    expect(crypto.verify("sha256", Buffer.from(next.input),
      { key: replacement.publicKey, dsaEncoding: "ieee-p1363" }, next.signature)).toBe(true);
    expect(crypto.verify("sha256", Buffer.from(next.input),
      { key: pair.publicKey, dsaEncoding: "ieee-p1363" }, next.signature)).toBe(false);
  });
  it("accepts local HTTP only off the hosted platform and refuses issuer ambiguity", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:54321");
    expect(decode(mintStorageUploadToken(authorization, now)).payload.iss).toBe("http://127.0.0.1:54321/auth/v1");
    vi.stubEnv("VERCEL", "1");
    expect(() => mintStorageUploadToken(authorization, now)).toThrow(UploadTokenUnavailable);
    for (const url of ["http://inherit.bio", "https://inherit.bio/path", "https://inherit.bio?query",
      "https://inherit.bio#fragment", "https://user@inherit.bio", ""]) {
      vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", url);
      expect(() => mintStorageUploadToken(authorization, now)).toThrow(UploadTokenUnavailable);
    }
  });
});
