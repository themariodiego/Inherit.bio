import { CREATE_OPT_IN, PREVIEW_API, PREVIEW_APP, PREVIEW_PROJECT, PREVIEW_STORAGE, SYNTHETIC_ACCOUNT, TUS_PATH,
  type ProbeCredentials, type ProbeGrant } from "./contract";

/** Synthetic, deliberately unsigned fixtures. Never accepted by a real issuer. */
export const NOW = Date.parse("2026-09-22T00:00:00.000Z");
export const ids = { session: "10000000-0000-4000-8000-000000000001", upload: "10000000-0000-4000-8000-000000000002",
  staging: "10000000-0000-4000-8000-000000000003", version: "10000000-0000-4000-8000-000000000004",
  jti: "10000000-0000-4000-8000-000000000005", kid: "10000000-0000-4000-8000-000000000006" };
export function token(claims: unknown, header: Record<string, string> = { alg: "ES256", typ: "JWT", kid: ids.kid }) {
  return [Buffer.from(JSON.stringify(header)).toString("base64url"), Buffer.from(JSON.stringify(claims)).toString("base64url"),
    Buffer.alloc(header.alg === "HS256" ? 32 : 64).toString("base64url")].join(".");
}
export function sessionCookie(overrides: Record<string, unknown> = {}) {
  const access_token = token({ iss: `${PREVIEW_API}/auth/v1`, aud: "authenticated", role: "authenticated",
    sub: SYNTHETIC_ACCOUNT, session_id: ids.session, is_anonymous: false, exp: NOW / 1000 + 3600, ...overrides });
  return `sb-${PREVIEW_PROJECT}-auth-token=base64-${Buffer.from(JSON.stringify({ access_token })).toString("base64url")}`;
}
export function credentials(): ProbeCredentials {
  return { project: PREVIEW_PROJECT, appOrigin: PREVIEW_APP, accountId: SYNTHETIC_ACCOUNT,
    sessionId: ids.session, sessionCookie: sessionCookie(), protectionBypass: "synthetic-not-a-provider-key",
    anonKey: token({ ref: PREVIEW_PROJECT, role: "anon", exp: NOW / 1000 + 3600 }, { alg: "HS256", typ: "JWT" }) };
}
export function grant(overrides: Record<string, unknown> = {}): ProbeGrant {
  return { transport: "direct-storage", uploadId: ids.upload, bucket: "genomes", stagingKey: ids.staging,
    uploadToken: token({ iss: `${PREVIEW_API}/auth/v1`, aud: "inherit-storage-upload", role: "inherit_upload_only",
      sub: SYNTHETIC_ACCOUNT, session_id: ids.session, account_auth_session_revision: 1, upload_session_id: ids.upload,
      jti: ids.jti, staging_key: ids.staging, maximum_bytes: 512, iat: NOW / 1000, nbf: NOW / 1000, exp: NOW / 1000 + 1800,
      ...overrides }), authorizationHeader: "Bearer {uploadToken}", maximumBytes: 512,
    expiresAt: new Date(NOW + 1800_000).toISOString() };
}
export const location = `${PREVIEW_STORAGE}${TUS_PATH}/${Buffer.from(`genomes/${ids.staging}/${ids.version}`).toString("base64url")}`;
export const options = () => ({ project: PREVIEW_PROJECT, appOrigin: PREVIEW_APP, optIn: CREATE_OPT_IN, credentials: credentials() });
