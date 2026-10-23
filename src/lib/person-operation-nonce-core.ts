import crypto from "node:crypto";
// Relative, so a browser test helper can load this module without the app's path aliases.
import { hmacSecret, hmacSecretWithKey } from "./crypto";

/**
 * The one-time operation nonce of the person-caused writers that used to
 * record none (G5.6, owner decision of 23 October 2026; the attribution
 * design of 28 September 2026, option A; brief X1.5). Their events could
 * never name the person who acted, because nothing in their transaction
 * proved who that was.
 *
 * The page that offers the operation renders the nonce, nothing stores it,
 * and only the state-changing request consumes it: its route verifies the
 * MAC here, and the database door records the nonce's hash in
 * `public.account_operation_nonces` in the same transaction as the writer
 * (20261023120000_legal_audit_attribution_completeness.sql), which is what
 * makes it one-time and what names the account on the writer's audit event.
 *
 * The nonce is `<expiresAt>.<random>.<mac>`, the shape of the account and
 * subject operation nonces, under its own MAC context. The MAC binds the
 * account, its originating auth session, the operation, the registered route
 * the operation belongs to and the exact target the page showed (the account
 * itself, a record, a counterpart account or a grant). None of them travels
 * in the nonce: the verifier recomputes the MAC from the live request.
 *
 * This module is the pure mint and verify, with no request or session
 * access, so a browser test helper can mint under the local server's
 * own test key, passed explicitly. Server code imports
 * `@/lib/person-operation-nonce`, which adds the route and page helpers.
 */

export type PersonOperation =
  | "jurisdiction_declare"
  | "chromosomal_sex_declare"
  | "family_sharing_pause"
  | "family_sharing_resume"
  | "consent_revoke"
  | "portrait_acknowledge"
  | "adult_invitation_create"
  // 20261023130000: the Path B draft (both bodies) and the original download.
  | "path_b_draft_create"
  | "subject_download_open"
  // 20261024110000 (G8.5): the DELETE of the Copilot provider and its key.
  | "provider_setting_delete";

/** Each operation belongs to exactly one registered route. */
export const PERSON_OPERATION_ROUTES: Readonly<Record<PersonOperation, string>> = Object.freeze({
  jurisdiction_declare: "api.jurisdiction",
  chromosomal_sex_declare: "api.chromosomal-sex",
  family_sharing_pause: "api.family-sharing",
  family_sharing_resume: "api.family-sharing",
  consent_revoke: "api.consent-revoke",
  portrait_acknowledge: "api.family-acknowledge",
  adult_invitation_create: "api.subject-drafts",
  path_b_draft_create: "api.subject-drafts",
  subject_download_open: "api.subject-download",
  provider_setting_delete: "api.llm-settings",
});

/** The request header that carries the page's nonce to a route whose body is closed without it. */
export const PERSON_OPERATION_NONCE_HEADER = "x-inherit-operation-nonce";
export const PERSON_OPERATION_NONCE_LIFETIME_MS = 10 * 60 * 1000;
export const PERSON_OPERATION_NONCE_MAX_LENGTH = 128;

const MAC_CONTEXT = "person-operation-nonce-v1";
const SHAPE = /^(\d{13})\.([A-Za-z0-9_-]{43})\.([0-9a-f]{64})$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export type PersonOperationContext = Readonly<{
  accountId: string;
  sessionId: string;
  operation: PersonOperation;
  /** The account itself, the record, the counterpart account, the grant or the file the request names. */
  targetId: string;
}>;

export type VerifiedPersonOperationNonce = Readonly<{
  /** SHA-256 of the whole nonce, the form the database records. */
  nonceHash: string;
  expiresAt: number;
}>;

function validContext(context: PersonOperationContext): boolean {
  return UUID.test(context.accountId) && UUID.test(context.sessionId) && UUID.test(context.targetId)
    && Object.hasOwn(PERSON_OPERATION_ROUTES, context.operation);
}

function mac(context: PersonOperationContext, expiresAt: number, random: string, encodedKey?: string): string {
  const value = [context.accountId, context.sessionId, context.operation,
    PERSON_OPERATION_ROUTES[context.operation], context.targetId, String(expiresAt), random].join("|");
  return encodedKey === undefined ? hmacSecret(value, MAC_CONTEXT) : hmacSecretWithKey(value, MAC_CONTEXT, encodedKey);
}

/**
 * Pure: mints and returns a nonce. It writes nothing anywhere. `encodedKey`
 * is for a local browser test helper only, which passes the local server's
 * own test key instead of setting it in its environment; the server always
 * mints and verifies under its own deployment key.
 */
export function mintPersonOperationNonce(context: PersonOperationContext, now = Date.now(), encodedKey?: string): string {
  if (!validContext(context) || !Number.isSafeInteger(now) || now < 0) throw new Error("person_operation_context_invalid");
  const expiresAt = now + PERSON_OPERATION_NONCE_LIFETIME_MS;
  const random = crypto.randomBytes(32).toString("base64url");
  return `${expiresAt}.${random}.${mac(context, expiresAt, random, encodedKey)}`;
}

/**
 * `expected` must come from the live request (its authenticated account and
 * session, the route's own operation and the server-resolved target), never
 * from the request body.
 */
export function verifyPersonOperationNonce(
  nonce: unknown,
  expected: PersonOperationContext,
  now = Date.now(),
): VerifiedPersonOperationNonce | null {
  if (!validContext(expected) || typeof nonce !== "string" || nonce.length > PERSON_OPERATION_NONCE_MAX_LENGTH) return null;
  const match = SHAPE.exec(nonce);
  if (!match) return null;
  const expiresAt = Number(match[1]);
  if (!Number.isSafeInteger(expiresAt) || expiresAt <= now || expiresAt > now + PERSON_OPERATION_NONCE_LIFETIME_MS) return null;
  const bytes = Buffer.from(match[2], "base64url");
  if (bytes.length !== 32 || bytes.toString("base64url") !== match[2]) return null;
  const expectedMac = Buffer.from(mac(expected, expiresAt, match[2]), "hex");
  if (!crypto.timingSafeEqual(expectedMac, Buffer.from(match[3], "hex"))) return null;
  return Object.freeze({ nonceHash: crypto.createHash("sha256").update(nonce, "utf8").digest("hex"), expiresAt });
}
