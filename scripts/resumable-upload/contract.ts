import { z } from "zod";

export const PREVIEW_PROJECT = "iofjhrtcyawjjhuxbgfd";
export const PREVIEW_APP = "https://inherit-24p1eqxmf-mariodiego.vercel.app";
export const PREVIEW_API = `https://${PREVIEW_PROJECT}.supabase.co`;
export const PREVIEW_STORAGE = `https://${PREVIEW_PROJECT}.storage.supabase.co`;
export const SYNTHETIC_ACCOUNT = "1858a7cf-d37d-408d-a01a-738c4077c8cd";
export const TUS_PATH = "/storage/v1/upload/resumable";
export const DECLARED_BYTES = 512;
export const MAX_PROVIDER_REQUESTS = 6;
export const REQUEST_TIMEOUT_MS = 15_000;
export const RUN_TIMEOUT_MS = 120_000;
export const CREATE_OPT_IN = "create-one-empty-preview-upload";
const uuid = z.uuid().regex(/^[0-9a-f-]+$/);
const integer = z.number().int().positive().safe();

/** Fixed messages only: never interpolate a token, URL, file path or response. */
export function refuse(): never { throw new Error("probe_contract_refused"); }

export function validateTarget(project: unknown, appOrigin: unknown, optIn: unknown) {
  if (project !== PREVIEW_PROJECT || appOrigin !== PREVIEW_APP || optIn !== CREATE_OPT_IN) refuse();
}

export const credentialsSchema = z.object({
  project: z.literal(PREVIEW_PROJECT), appOrigin: z.literal(PREVIEW_APP),
  accountId: z.literal(SYNTHETIC_ACCOUNT), sessionId: uuid,
  sessionCookie: z.string().min(1).max(16_384).refine(value => value.split(";").every(part => {
    const match = /^\s*([^=\s]+)=([^;\s]+)\s*$/.exec(part);
    return match !== null && new RegExp(`^sb-${PREVIEW_PROJECT}-auth-token(?:\\.[0-9]+)?$`).test(match[1])
      && /^[A-Za-z0-9_%.=-]+$/.test(match[2]);
  })),
  anonKey: z.string().min(1).max(8192),
  protectionBypass: z.string().regex(/^[A-Za-z0-9_-]{20,1024}$/),
}).strict();
export type ProbeCredentials = z.infer<typeof credentialsSchema>;

function jwtParts(token: string) {
  if (token.length > 8192) refuse();
  const parts = token.split(".");
  if (parts.length !== 3 || parts.some(part => !/^[A-Za-z0-9_-]+$/.test(part)
    || Buffer.from(part, "base64url").toString("base64url") !== part)) refuse();
  return { header: JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8")),
    claims: JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")),
    signatureBytes: Buffer.from(parts[2], "base64url").length };
}

/** Decode the current SSR cookie only to reject wrong/stale synthetic input.
 * The application still verifies its signature and live session authority. */
function validateSessionCookie(credentials: ProbeCredentials, now: number) {
  const name = `sb-${PREVIEW_PROJECT}-auth-token`;
  const entries = credentials.sessionCookie.split(";").map(part => {
    const separator = part.indexOf("=");
    return [part.slice(0, separator).trim(), part.slice(separator + 1).trim()] as const;
  });
  const cookies = new Map(entries);
  if (cookies.size !== entries.length) refuse();
  let encoded = cookies.get(name);
  if (encoded && cookies.size !== 1) refuse();
  if (!encoded) {
    encoded = "";
    for (let index = 0; index < cookies.size; index++) {
      const chunk = cookies.get(`${name}.${index}`);
      if (!chunk) refuse();
      encoded += chunk;
    }
  }
  encoded = decodeURIComponent(encoded);
  if (!encoded.startsWith("base64-")) refuse();
  const value = encoded.slice(7);
  if (!/^[A-Za-z0-9_-]+$/.test(value) || Buffer.from(value, "base64url").toString("base64url") !== value) refuse();
  const session = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
  if (typeof session.access_token !== "string") refuse();
  const { claims } = jwtParts(session.access_token);
  if (claims.iss !== `${PREVIEW_API}/auth/v1` || claims.aud !== "authenticated"
    || claims.role !== "authenticated" || claims.sub !== credentials.accountId
    || claims.session_id !== credentials.sessionId || claims.is_anonymous !== false
    || !Number.isSafeInteger(claims.exp) || claims.exp * 1000 - now < RUN_TIMEOUT_MS) refuse();
}

export function validateCredentials(input: unknown, now: number): ProbeCredentials {
  try {
    if (!Number.isSafeInteger(now) || now <= 0) refuse();
    const credentials = credentialsSchema.parse(input);
    const jwt = jwtParts(credentials.anonKey);
    if (!["HS256", "ES256"].includes(jwt.header.alg) || jwt.header.typ !== "JWT"
      || jwt.signatureBytes !== (jwt.header.alg === "HS256" ? 32 : 64)
      || jwt.claims.ref !== PREVIEW_PROJECT || jwt.claims.role !== "anon"
      || !Number.isSafeInteger(jwt.claims.exp) || jwt.claims.exp * 1000 <= now) refuse();
    validateSessionCookie(credentials, now);
    return credentials;
  } catch { return refuse(); }
}

const grantSchema = z.object({
  transport: z.literal("direct-storage"), uploadId: uuid, bucket: z.literal("genomes"), stagingKey: uuid,
  uploadToken: z.string().max(8192), authorizationHeader: z.literal("Bearer {uploadToken}"),
  maximumBytes: z.literal(DECLARED_BYTES), expiresAt: z.iso.datetime({ offset: true }),
}).strict();
export type ProbeGrant = z.infer<typeof grantSchema>;
const claimsSchema = z.object({
  iss: z.literal(`${PREVIEW_API}/auth/v1`), aud: z.literal("inherit-storage-upload"),
  role: z.literal("inherit_upload_only"), sub: z.literal(SYNTHETIC_ACCOUNT), session_id: uuid,
  account_auth_session_revision: integer, upload_session_id: uuid, jti: uuid,
  staging_key: uuid, maximum_bytes: z.literal(DECLARED_BYTES), iat: integer, nbf: integer, exp: integer,
}).strict();

/** Claims are sanity checks, not local signature verification. The real app
 * mints the token and Storage verifies it; no signer secret is loaded here. */
export function validateGrant(input: unknown, credentials: ProbeCredentials, now: number): ProbeGrant {
  try {
    if (!Number.isSafeInteger(now) || now <= 0) refuse();
    const grant = grantSchema.parse(input);
    const jwt = jwtParts(grant.uploadToken);
    z.object({ alg: z.literal("ES256"), typ: z.literal("JWT"), kid: uuid }).strict().parse(jwt.header);
    const claims = claimsSchema.parse(jwt.claims);
    if (jwt.signatureBytes !== 64 || claims.sub !== credentials.accountId
      || claims.session_id !== credentials.sessionId || claims.jti === claims.session_id
      || claims.upload_session_id !== grant.uploadId || claims.staging_key !== grant.stagingKey
      || claims.nbf !== claims.iat || claims.iat * 1000 > now || now - claims.iat * 1000 > 60_000
      || claims.exp <= claims.iat || claims.exp - claims.iat > 1800
      || claims.exp * 1000 - now < RUN_TIMEOUT_MS || Date.parse(grant.expiresAt) !== claims.exp * 1000) refuse();
    return grant;
  } catch { return refuse(); }
}

/** Pinned provider source encodes bucket/object/version into one base64url
 * segment. The version is minted by Storage, then kept fixed for this probe. */
export function validateLocation(raw: unknown, grant: ProbeGrant): string {
  try {
    if (typeof raw !== "string" || raw.length > 1024 || /[\s\\%?#]/.test(raw)) refuse();
    const url = new URL(raw, PREVIEW_STORAGE);
    if (![PREVIEW_API, PREVIEW_STORAGE].includes(url.origin) || url.username || url.password
      || url.search || url.hash || url.port || !url.pathname.startsWith(`${TUS_PATH}/`)) refuse();
    const encoded = url.pathname.slice(TUS_PATH.length + 1);
    if (!/^[A-Za-z0-9_-]+$/.test(encoded)) refuse();
    const decoded = Buffer.from(encoded, "base64url");
    if (decoded.toString("base64url") !== encoded) refuse();
    const pieces = decoded.toString("utf8").split("/");
    if (pieces.length !== 3 || pieces[0] !== grant.bucket || pieces[1] !== grant.stagingKey) refuse();
    uuid.parse(pieces[2]);
    // Reject normalized alternate spellings, dot paths and protocol-relative URLs.
    if (raw !== url.href && raw !== `${TUS_PATH}/${encoded}`) refuse();
    return url.href;
  } catch { return refuse(); }
}
