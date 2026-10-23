import crypto from "node:crypto";
// Relative, so a browser test helper can load this module without the app's path aliases.
import { hmacSecret, hmacSecretWithKey } from "../crypto";

/**
 * The one-time, session-bound `X-Inherit-CSRF` token
 * (`mutationSecurityBindings.csrfTransport`, `authContracts.authenticated-mutation-v1.csrf`,
 * `token-api-v1.stateChangingRequest`; owner decision 2026-10-23, "CSRF: build
 * the token everywhere").
 *
 * It is the future-person flows' CSRF value made one-time. Those flows send a
 * keyed digest of the session they are bound to and the operation in
 * `X-Inherit-CSRF` (`claimMutationCsrf`, `publicAppealCsrf`, `reviewCsrf`,
 * `claimantCsrf`), rendered by the page that offers the operation, and rely
 * on a session rotation or the paired one-time nonce for replay. An
 * authenticated Supabase session never rotates per request, and many of the
 * routes bound here carry no operation nonce, while the register says a
 * nonce is not CSRF (`operationNonceIsNotCsrf`). So the same digest gains a
 * random part and an expiry, in the shape of the person operation nonce
 * (`<expiresAt>.<random>.<mac>`), and the database spends each value once by
 * its hash (`public.consume_session_csrf_v1`). The response that spends one
 * issues its successor in the same header, as the evidence session already
 * does with its own value.
 *
 * The MAC binds the session kind, the session (the account and its auth
 * session, or the hash of a purpose-session cookie), the registered route
 * and the expiry. None of them travels in the token: the verifier recomputes
 * the MAC from the live request, so a token minted for another session,
 * another purpose session or another route never verifies.
 *
 * This module is the pure mint and verify, with no request, cookie or
 * database access, so a browser test helper can mint under the local
 * server's own test key, passed explicitly. Routes use
 * `@/lib/security/session-csrf`; the browser uses `session-csrf-client`.
 */

export const SESSION_CSRF_HEADER = "x-inherit-csrf";
/** As long as a signed-in page is reasonably left open; each value is still spent once. */
export const SESSION_CSRF_LIFETIME_MS = 12 * 60 * 60 * 1000;
export const SESSION_CSRF_MAX_LENGTH = 128;

const MAC_CONTEXT = "session-csrf-v1";
const SHAPE = /^(\d{13})\.([A-Za-z0-9_-]{43})\.([0-9a-f]{64})$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const HASH = /^[0-9a-f]{64}$/;

/**
 * Every route whose state-changing requests this token guards, with the
 * register `auth` its session belongs to. The routes the register binds that
 * keep a session-bound value of their own design are listed in
 * `docs/register-contract-divergence.json#csrfTransportNote`.
 * `api.embryo-withdraw` is `policy.aliasOf` `api.cohort-restrict`: the same
 * handler, so the same token.
 */
export const SESSION_CSRF_ROUTES = Object.freeze({
  "auth.sign-out": "authenticated",
  "api.account-delete": "authenticated",
  "api.account-delete-cancel": "authenticated",
  "api.chat": "authenticated",
  "api.browse-region": "authenticated",
  "api.file-process": "authenticated",
  "api.file-upload-session": "authenticated",
  "api.subject-upload-issue": "authenticated",
  "api.subject-upload-complete": "authenticated",
  "api.file-delete": "authenticated",
  "api.file-finalize": "authenticated",
  "api.llm-settings": "authenticated",
  "api.subject-drafts": "authenticated",
  "api.subject-transfer": "authenticated",
  "api.subject-delete": "authenticated",
  "api.subject-sharing": "authenticated",
  "api.chromosomal-sex": "authenticated",
  "api.family-acknowledge": "authenticated",
  "api.embryo-acknowledge": "authenticated",
  "api.family-sharing": "authenticated",
  "api.consents": "authenticated",
  "api.consent-reaffirm": "authenticated",
  "api.consent-revoke": "authenticated",
  "api.consents-revoke-all": "authenticated",
  "api.invitation-accept": "authenticated",
  "api.adult-subject-bind": "authenticated",
  "api.embryo-cohorts": "authenticated",
  "api.embryo-record-key-cards": "authenticated",
  "api.embryo-disposition": "authenticated",
  "api.cohort-restrict": "authenticated",
  "api.claimed-subject-correction": "authenticated",
  "api.claimed-subject-analysis-stop": "authenticated",
  "api.jurisdiction": "authenticated",
  "api.withdraw": "token",
  "api.consent-reaffirm-rights": "token",
  "api.consent-grant-rights": "token",
  "api.consent-revoke-rights": "token",
  "api.rights-activate": "token-candidate",
} as const);

export type CsrfRoute = keyof typeof SESSION_CSRF_ROUTES;
export type CsrfSessionKind = (typeof SESSION_CSRF_ROUTES)[CsrfRoute];

/** The session a token is bound to: the live account session, or one purpose-session cookie's hash. */
export type CsrfSession =
  | Readonly<{ kind: "authenticated"; accountId: string; sessionId: string }>
  | Readonly<{ kind: "token" | "token-candidate"; sessionHash: string }>;

export type VerifiedSessionCsrf = Readonly<{
  /** SHA-256 of the whole token, the only form the database records. */
  tokenHash: string;
  expiresAt: number;
}>;

export function isCsrfRoute(value: string): value is CsrfRoute {
  return Object.hasOwn(SESSION_CSRF_ROUTES, value);
}

function validSession(session: CsrfSession): boolean {
  return session.kind === "authenticated"
    ? UUID.test(session.accountId) && UUID.test(session.sessionId)
    : (session.kind === "token" || session.kind === "token-candidate") && HASH.test(session.sessionHash);
}

function bindingFor(session: CsrfSession): string {
  return session.kind === "authenticated"
    ? [session.kind, session.accountId, session.sessionId].join("|")
    : [session.kind, session.sessionHash].join("|");
}

function mac(session: CsrfSession, route: CsrfRoute, expiresAt: number, random: string, encodedKey?: string): string {
  const value = [bindingFor(session), route, String(expiresAt), random].join("|");
  return encodedKey === undefined ? hmacSecret(value, MAC_CONTEXT) : hmacSecretWithKey(value, MAC_CONTEXT, encodedKey);
}

function usable(session: CsrfSession, route: CsrfRoute): boolean {
  return isCsrfRoute(route) && validSession(session) && SESSION_CSRF_ROUTES[route] === session.kind;
}

/**
 * Pure: mints and returns a token. It writes nothing anywhere. `encodedKey`
 * is for a local browser test helper only, which passes the local server's
 * own test key instead of setting it in its environment.
 */
export function mintSessionCsrf(session: CsrfSession, route: CsrfRoute, now = Date.now(), encodedKey?: string): string {
  if (!usable(session, route) || !Number.isSafeInteger(now) || now < 0) throw new Error("session_csrf_context_invalid");
  const expiresAt = now + SESSION_CSRF_LIFETIME_MS;
  const random = crypto.randomBytes(32).toString("base64url");
  return `${expiresAt}.${random}.${mac(session, route, expiresAt, random, encodedKey)}`;
}

/**
 * The token's hash and expiry when it was minted for exactly this session and
 * route and is still fresh; null otherwise. `session` must come from the live
 * request (the authenticated account and auth session, or the purpose cookie),
 * never from the request body. Whether it was already spent is the database's
 * answer, not this function's.
 */
export function verifySessionCsrf(token: unknown, session: CsrfSession, route: CsrfRoute,
  now = Date.now()): VerifiedSessionCsrf | null {
  if (!usable(session, route) || typeof token !== "string" || token.length > SESSION_CSRF_MAX_LENGTH) return null;
  const match = SHAPE.exec(token);
  if (!match) return null;
  const expiresAt = Number(match[1]);
  if (!Number.isSafeInteger(expiresAt) || expiresAt <= now || expiresAt > now + SESSION_CSRF_LIFETIME_MS) return null;
  const bytes = Buffer.from(match[2], "base64url");
  if (bytes.length !== 32 || bytes.toString("base64url") !== match[2]) return null;
  const expected = mac(session, route, expiresAt, match[2]);
  if (!crypto.timingSafeEqual(Buffer.from(match[3]), Buffer.from(expected))) return null;
  return { tokenHash: crypto.createHash("sha256").update(token, "utf8").digest("hex"), expiresAt };
}
