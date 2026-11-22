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
 * session, or the hash of a purpose-session cookie, with the session id the
 * route's path names where one cookie belongs to one upload or evidence
 * session), the registered route and the expiry. None of them travels in the
 * token: the verifier recomputes the MAC from the live request, so a token
 * minted for another session, another purpose session, another kind of
 * session or another route never verifies.
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
  "api.subjects": "authenticated",
  "api.future-person-claimant-bind": "authenticated",
  "api.account-completion": "authenticated",
  "api.invitations": "authenticated",
  "api.embryo-cohort-drafts": "authenticated",
  "api.legal-evidence-upload-session": "authenticated",
  "api.export": "authenticated",
  "api.subject-export": "authenticated",
  "api.future-person-identity-profile": "authenticated",
  "api.withdraw": "token",
  "api.consent-reaffirm-rights": "token",
  "api.consent-grant-rights": "token",
  "api.consent-revoke-rights": "token",
  "api.future-person-correction": "token",
  "api.appeal-complete": "token",
  "api.embryo-record-key-cards-rights": "token",
  "api.future-person-export": "token",
  "api.future-person-recovery-key": "token",
  "api.future-person-analysis-stop": "token",
  "api.future-person-delete": "token",
  "api.appeal-document-session": "token",
  "api.third-party-subject-export": "token",
  "api.rights-activate": "token-candidate",
  // 2026-11-19 (G8.5, the migration stage): the five session kinds that
  // public.consume_session_csrf_v2 accepts beside these three.
  "api.legal-evidence-review": "reviewer",
  "api.appeal-review": "reviewer",
  "api.future-person-documentary-verification": "reviewer",
  "api.future-person-claim-review": "reviewer",
  "api.future-person-claim-release": "reviewer",
  "api.future-person-claim-objection-review": "reviewer",
  "api.future-person-correction-review": "reviewer",
  "api.claim-review-receipt": "reviewer",
  // Its TEST account archive branch's token is the second kind SESSION_CSRF_SECOND_KINDS declares.
  "api.claim-review-chunk-acknowledgement": "reviewer",
  "api.embryo-ingest-configure": "upload-session",
  "api.embryo-ingest-mapping": "upload-session",
  "api.embryo-ingest-complete": "upload-session",
  "api.future-person-claim-document-session": "claim-session",
  "api.future-person-claim-complete": "claim-session",
  "api.evidence-chunk": "evidence-session",
  "api.evidence-complete": "evidence-session",
  "auth.reset-password-submit": "reset-session",
  // Its account branch's token is the second kind SESSION_CSRF_SECOND_KINDS declares.
  "api.future-person-claim-objection": "token",
} as const);

export type CsrfRoute = keyof typeof SESSION_CSRF_ROUTES;
export type CsrfSessionKind = (typeof SESSION_CSRF_ROUTES)[CsrfRoute];

/**
 * The two routes whose token may be bound to either of two kinds of session.
 * Each checks its first kind, its register `auth` (`SESSION_CSRF_ROUTES`),
 * and then the second declared here, and spends a one-time token of whichever
 * it finds; the second kind is declared here and nowhere else, so every other
 * route accepts its own kind only.
 * - api.future-person-claim-objection (owner decision of 19 November 2026,
 *   "G8.5: the claim-objection address accepts either kind of session"): the
 *   emailed link's rights session first, the signed-in account second.
 * - api.claim-review-chunk-acknowledgement (owner decision of 22 November
 *   2026, "G8.5: the reviewer chunk-acknowledgement address accepts either
 *   kind of session"): the signed-in reviewer first, the signed-in account
 *   second, for the TEST account archive's acknowledgement on the same path.
 */
export const SESSION_CSRF_SECOND_KINDS: Readonly<Partial<Record<CsrfRoute, CsrfSessionKind>>> = Object.freeze({
  "api.future-person-claim-objection": "authenticated",
  "api.claim-review-chunk-acknowledgement": "authenticated",
});

/** Whether a token of `kind` may be minted for and verified on `route`. */
export function acceptsSessionKind(route: CsrfRoute, kind: CsrfSessionKind): boolean {
  return isCsrfRoute(route) && (SESSION_CSRF_ROUTES[route] === kind
    || (Object.hasOwn(SESSION_CSRF_SECOND_KINDS, route) && SESSION_CSRF_SECOND_KINDS[route] === kind));
}

/**
 * The routes of a chunk stream (owner decision of 19 November 2026, "G8.5:
 * principles for the CSRF register amendments", principle 3): the browser
 * keeps one session-bound value for the whole stream instead of a new token
 * per chunk. The value is verified on every chunk exactly as a token is
 * (kind, session, route, expiry) but never spent and never rotated; the
 * route's own one-time reservation of each chunk is the replay guard
 * (api.evidence-chunk `requestContract.chunkAuthority`: each session and
 * sequence is reserved once). api.embryo-ingest-chunk carries no token at
 * all (`csrfTransport.requiredFor`). api.claim-review-chunk-acknowledgement
 * is not a stream, for either of its two kinds: principle 3 names uploads,
 * and the acknowledgements of one download (a review document's, or a TEST
 * account archive's) go one after another, so each spends a one-time token
 * and carries the previous answer's successor.
 */
export const SESSION_CSRF_STREAM_ROUTES: ReadonlySet<CsrfRoute> = new Set<CsrfRoute>(["api.evidence-chunk"]);

/** The kinds bound to the account and its auth session. */
type AccountKind = "authenticated" | "reviewer";
/** The purpose sessions with one cookie per session, whose id the route's path names. */
type IdentifiedKind = "upload-session" | "evidence-session";
type CookieKind = Exclude<CsrfSessionKind, AccountKind | IdentifiedKind>;

/**
 * The session a token is bound to: the live account session (an account
 * route's, or a reviewer's under its own kind, so neither token verifies on
 * the other's routes), one purpose-session cookie's hash, or for an upload
 * or evidence session that cookie's hash with the session's id.
 */
export type CsrfSession =
  | Readonly<{ kind: AccountKind; accountId: string; sessionId: string }>
  | Readonly<{ kind: CookieKind; sessionHash: string }>
  | Readonly<{ kind: IdentifiedKind; sessionHash: string; sessionId: string }>;

export function isAccountSession(session: CsrfSession): session is Extract<CsrfSession, { kind: AccountKind }> {
  return session.kind === "authenticated" || session.kind === "reviewer";
}

export function isIdentifiedSession(session: CsrfSession): session is Extract<CsrfSession, { kind: IdentifiedKind }> {
  return session.kind === "upload-session" || session.kind === "evidence-session";
}

export type VerifiedSessionCsrf = Readonly<{
  /** SHA-256 of the whole token, the only form the database records. */
  tokenHash: string;
  expiresAt: number;
}>;

export function isCsrfRoute(value: string): value is CsrfRoute {
  return Object.hasOwn(SESSION_CSRF_ROUTES, value);
}

const COOKIE_KINDS: ReadonlySet<string> = new Set<CookieKind>(["token", "token-candidate", "claim-session", "reset-session"]);

function validSession(session: CsrfSession): boolean {
  if (isAccountSession(session)) return UUID.test(session.accountId) && UUID.test(session.sessionId);
  if (isIdentifiedSession(session)) return HASH.test(session.sessionHash) && UUID.test(session.sessionId);
  return COOKIE_KINDS.has(session.kind) && HASH.test(session.sessionHash);
}

function bindingFor(session: CsrfSession): string {
  if (isAccountSession(session)) return [session.kind, session.accountId, session.sessionId].join("|");
  if (isIdentifiedSession(session)) return [session.kind, session.sessionId, session.sessionHash].join("|");
  return [session.kind, session.sessionHash].join("|");
}

function mac(session: CsrfSession, route: CsrfRoute, expiresAt: number, random: string, encodedKey?: string): string {
  const value = [bindingFor(session), route, String(expiresAt), random].join("|");
  return encodedKey === undefined ? hmacSecret(value, MAC_CONTEXT) : hmacSecretWithKey(value, MAC_CONTEXT, encodedKey);
}

function usable(session: CsrfSession, route: CsrfRoute): boolean {
  return isCsrfRoute(route) && validSession(session) && acceptsSessionKind(route, session.kind);
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
