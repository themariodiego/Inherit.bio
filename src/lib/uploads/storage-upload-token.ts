import "server-only";

import crypto from "node:crypto";
import { z } from "zod";

const uuid = z.uuid().regex(/^[0-9a-f-]+$/);
const positiveInteger = z.number().int().positive().safe();
const coordinate = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
const signingKeySchema = z.object({
  kty: z.literal("EC"), crv: z.literal("P-256"), kid: uuid,
  x: coordinate, y: coordinate, d: coordinate,
  alg: z.literal("ES256").optional(), use: z.literal("sig").optional(),
  key_ops: z.array(z.enum(["sign", "verify"])).refine(ops => ops.includes("sign")).optional(),
  ext: z.boolean().optional(),
}).strict();

/** These values must come from the committed atomic upload-issuance receipt,
 * never from a browser request, metadata field or ordinary user access token. */
export const storageUploadAuthorizationSchema = z.object({
  accountId: uuid,
  sessionId: uuid,
  accountAuthSessionRevision: positiveInteger,
  uploadId: uuid,
  jti: uuid,
  stagingKey: uuid,
  maximumBytes: positiveInteger,
  expiresAt: z.iso.datetime({ offset: true }),
}).strict().refine(value => value.jti !== value.sessionId);
export type StorageUploadAuthorization = z.infer<typeof storageUploadAuthorizationSchema>;

export class UploadTokenUnavailable extends Error {
  constructor() { super("upload_token_unavailable"); this.name = "UploadTokenUnavailable"; }
}

function issuer(): string {
  const url = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "");
  const local = !process.env.VERCEL && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if ((url.protocol !== "https:" && !(local && url.protocol === "http:"))
    || url.username || url.password || url.search || url.hash || url.pathname !== "/") {
    throw new UploadTokenUnavailable();
  }
  return url.origin + "/auth/v1";
}

function signingKey() {
  const value = signingKeySchema.parse(JSON.parse(process.env.INHERIT_UPLOAD_SIGNING_JWK ?? ""));
  for (const coordinateValue of [value.x, value.y, value.d]) {
    if (Buffer.from(coordinateValue, "base64url").toString("base64url") !== coordinateValue) {
      throw new UploadTokenUnavailable();
    }
  }
  // Reject a copied public key paired with a different private scalar.
  const curve = crypto.createECDH("prime256v1");
  curve.setPrivateKey(Buffer.from(value.d, "base64url"));
  const point = curve.getPublicKey(undefined, "uncompressed");
  const supplied = Buffer.concat([Buffer.from([4]), Buffer.from(value.x, "base64url"), Buffer.from(value.y, "base64url")]);
  if (!crypto.timingSafeEqual(point, supplied)) throw new UploadTokenUnavailable();
  return { kid: value.kid, key: crypto.createPrivateKey({ key: value, format: "jwk" }) };
}

/** Internal prepared-object capability. Separate audience; never an Auth token.
 * Callers must have checked the exact registered claim/member/disposition. */
export function mintPreparedObjectCapability(claim: {
  operation: "put" | "get" | "tombstone"; bucket: string; objectKey: string;
  byteCount: number; sha256: string; expiresAt: string;
  providerVersion?: string; etag?: string; start?: number; end?: number;
}): string {
  try {
    const now = Math.floor(Date.now() / 1000);
    const exp = Math.min(now + 30, Math.floor(Date.parse(claim.expiresAt) / 1000));
    if (!Number.isSafeInteger(exp) || exp <= now) throw new UploadTokenUnavailable();
    const { kid, key } = signingKey();
    const header = Buffer.from(JSON.stringify({ alg: "ES256", kid, typ: "JWT" })).toString("base64url");
    const payload = Buffer.from(JSON.stringify({ ...claim, iss: issuer(), aud: "inherit-prepared-object-v1",
      iat: now, nbf: now, exp })).toString("base64url");
    const input = header + "." + payload;
    return input + "." + crypto.sign("sha256", Buffer.from(input), { key, dsaEncoding: "ieee-p1363" }).toString("base64url");
  } catch { throw new UploadTokenUnavailable(); }
}

/** Check deployment readiness before the database commits an upload lease. */
export function assertStorageUploadSignerAvailable(): void {
  try { signingKey(); issuer(); } catch { throw new UploadTokenUnavailable(); }
}

/** The key stays server-side. The bearer belongs only in ephemeral memory and
 * the Authorization header for its one Storage INSERT. It is not a refresh,
 * login, database, download or general application token. */
export function mintStorageUploadToken(input: StorageUploadAuthorization, now = Date.now()): string {
  try {
    const authorization = storageUploadAuthorizationSchema.parse(input);
    if (!Number.isSafeInteger(now) || now <= 0) throw new UploadTokenUnavailable();
    const issuedAt = Math.floor(now / 1000);
    const databaseExpiry = Math.floor(Date.parse(authorization.expiresAt) / 1000);
    // Database and application clocks can straddle a second boundary. Always
    // shorten the bearer to both ceilings; never extend its persisted lease.
    const expiresAt = Math.min(databaseExpiry, issuedAt + 30 * 60);
    if (!Number.isSafeInteger(expiresAt) || expiresAt <= issuedAt) {
      throw new UploadTokenUnavailable();
    }
    const { kid, key } = signingKey();
    const header = Buffer.from(JSON.stringify({ alg: "ES256", kid, typ: "JWT" })).toString("base64url");
    const payload = Buffer.from(JSON.stringify({
      iss: issuer(), aud: "inherit-storage-upload", role: "inherit_upload_only",
      sub: authorization.accountId, session_id: authorization.sessionId,
      account_auth_session_revision: authorization.accountAuthSessionRevision,
      upload_session_id: authorization.uploadId, jti: authorization.jti,
      staging_key: authorization.stagingKey, maximum_bytes: authorization.maximumBytes,
      iat: issuedAt, nbf: issuedAt, exp: expiresAt,
    })).toString("base64url");
    const signingInput = header + "." + payload;
    const signature = crypto.sign("sha256", Buffer.from(signingInput), { key, dsaEncoding: "ieee-p1363" });
    return signingInput + "." + signature.toString("base64url");
  } catch {
    // Never forward JWK parser errors, private scalars, token claims or input.
    throw new UploadTokenUnavailable();
  }
}
