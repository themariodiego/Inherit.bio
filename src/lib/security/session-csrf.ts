import "server-only";

import { getSensitiveAccountContext, isSameOrigin } from "@/lib/account-deletion";
import { authNotFound } from "@/lib/auth/auth-response";
import { readResetSessionHash } from "@/lib/auth/reset-session";
import { notFound } from "@/lib/embryos/api";
import { requestForbidden } from "@/lib/embryos/guards";
import { readIngestCookieHash } from "@/lib/embryos/ingest-session";
import { readRightsCandidateHash } from "@/lib/embryos/rights-activation";
import { readRightsSessionHash } from "@/lib/embryos/rights-session";
import { claimSessionHash, readEvidenceCookieHash } from "@/lib/future-person/evidence-session";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  SESSION_CSRF_HEADER,
  SESSION_CSRF_ROUTES,
  SESSION_CSRF_SECOND_KINDS,
  SESSION_CSRF_STREAM_ROUTES,
  acceptsSessionKind,
  isAccountSession,
  isIdentifiedSession,
  mintSessionCsrf,
  verifySessionCsrf,
  type CsrfRoute,
  type CsrfSession,
} from "./session-csrf-core";

/**
 * The server side of the one-time `X-Inherit-CSRF` token
 * (`session-csrf-core.ts` holds the format and the MAC): what a route calls
 * before it does anything, and what a page renders.
 *
 * A route needs one call. An authenticated route wraps its handler:
 *
 *   export const POST = withAccountCsrf("api.jurisdiction", async (request) => { ... });
 *
 * a reviewer route wraps it the same way under the reviewer's own kind:
 *
 *   export const POST = withReviewerCsrf("api.appeal-review", async (request, context) => { ... });
 *
 * and a purpose-session route names the cookie its session lives in (the
 * reader is given the handler's own arguments, so it can read the session id
 * the path names):
 *
 *   export const POST = withPurposeCsrf("api.withdraw", readRightsCsrfSession, handler);
 *
 * The wrapper reads the session from the request itself. A request with no
 * session for the route to bind reaches the handler unchanged, so every
 * route keeps its own unauthenticated answer. Otherwise the token must verify
 * for that session and route, and the database must spend it now
 * (`public.consume_session_csrf_v1` for the three kinds of 20261024220000,
 * `public.consume_session_csrf_v2` for the five the migration stage added,
 * which also requires the session to be live). Anything else is refused with
 * the register's answer before the handler runs: `authenticated-mutation-v1`'s
 * 403 `request_forbidden`, or the 404 `not_found` of the session's own
 * contract. An admitted response carries the next token in the same header,
 * so the page can make its next request without a reload. Operation nonces
 * are untouched: each handler goes on checking its own.
 *
 * A chunk stream (`SESSION_CSRF_STREAM_ROUTES`, principle 3) is verified on
 * every chunk and never spent or rotated.
 */

export { SESSION_CSRF_HEADER, type CsrfRoute, type CsrfSession } from "./session-csrf-core";

/** The route a wrapped handler guards, for the suite that checks every bound route is wrapped. */
export const SESSION_CSRF_GUARD = Symbol.for("inherit.session-csrf-guard");

export type CsrfAdmission =
  | { kind: "unbound" }
  | { kind: "refused"; response: Response }
  | { kind: "admitted"; next: string; rotate(response: Response): Response };

/** The register's refusal for the route's session: 403 for an account route, its contract's 404 otherwise. */
function refusal(route: CsrfRoute): Response {
  const kind = SESSION_CSRF_ROUTES[route];
  if (kind === "authenticated") return requestForbidden();
  return kind === "reset-session" ? authNotFound() : notFound();
}

/** The response with the next token set; a response whose headers are immutable is copied first. */
export function rotateSessionCsrf(response: Response, next: string): Response {
  try {
    response.headers.set(SESSION_CSRF_HEADER, next);
    return response;
  } catch {
    const copy = new Response(response.body, response);
    copy.headers.set(SESSION_CSRF_HEADER, next);
    return copy;
  }
}

/**
 * The answers whose request replaced the session the token was bound to
 * (the claim session rotates its cookie on every document session and on
 * the completion, `claim-session-api-v1.rotation`): the handler names the
 * new session, and the successor is minted for it, so the next request of
 * the same page carries a token its new cookie verifies.
 */
const rotatedSessions = new WeakMap<Response, CsrfSession>();

/** Marks `response` as the answer of a request that replaced its session with `successor`. */
export function answerForRotatedSession(response: Response, successor: CsrfSession): Response {
  rotatedSessions.set(response, successor);
  return response;
}

/** The kinds of 20261024220000's door. */
const V1_KINDS: ReadonlySet<string> = new Set(["authenticated", "token", "token-candidate"]);
/** PostgREST's answer for a function the schema does not have, and Postgres's. */
const FUNCTION_ABSENT: ReadonlySet<string> = new Set(["PGRST202", "42883"]);

/**
 * Spends one verified token in the database. A token of the three kinds of
 * 20261024220000 goes to public.consume_session_csrf_v1, unchanged. One of
 * the five later kinds goes to public.consume_session_csrf_v2, which also
 * holds the session to its live row. Until that migration is applied (code
 * may be deployed first), v2 is absent and the token is spent once by v1
 * instead, under the kind whose rule it shares: a reviewer's as an
 * authenticated token (the same live auth-session check), a purpose cookie's
 * as a rights token (one spend by hash, as the rights session has). Only the
 * function's absence falls back; any other error refuses.
 */
async function consume(route: CsrfRoute, session: CsrfSession, tokenHash: string, expiresAt: number): Promise<boolean> {
  const admin = createAdminClient();
  const base = { p_route_id: route, p_token_hash: tokenHash, p_expires_at: new Date(expiresAt).toISOString() };
  const v1 = async (kind: "authenticated" | "token" | "token-candidate") => {
    const { data, error } = await admin.rpc("consume_session_csrf_v1", {
      ...base,
      p_session_kind: kind,
      p_account_id: isAccountSession(session) ? session.accountId : null,
      p_session_id: isAccountSession(session) ? session.sessionId : null,
    });
    return !error && data === true;
  };
  if (V1_KINDS.has(session.kind)) return v1(session.kind as "authenticated" | "token" | "token-candidate");
  const { data, error } = await admin.rpc("consume_session_csrf_v2", {
    ...base,
    p_session_kind: session.kind,
    p_account_id: isAccountSession(session) ? session.accountId : null,
    p_session_id: isAccountSession(session) ? session.sessionId : null,
    p_cookie_hash: isAccountSession(session) ? null : session.sessionHash,
    p_purpose_session_id: isIdentifiedSession(session) ? session.sessionId : null,
  });
  if (error && FUNCTION_ABSENT.has(error.code ?? "")) return v1(isAccountSession(session) ? "authenticated" : "token");
  return !error && data === true;
}

/**
 * Spends the request's token for `session` and `route`. Null when the header
 * is missing, repeated, malformed, stale, minted for another session or
 * route, already spent, or when the session is no longer live. A chunk
 * stream's value is verified and not spent.
 */
async function spend(request: Request, session: CsrfSession, route: CsrfRoute): Promise<boolean> {
  const verified = verifySessionCsrf(request.headers.get(SESSION_CSRF_HEADER), session, route);
  if (!verified) return false;
  if (SESSION_CSRF_STREAM_ROUTES.has(route)) return true;
  try {
    return await consume(route, session, verified.tokenHash, verified.expiresAt);
  } catch {
    return false;
  }
}

export interface CsrfOptions {
  /**
   * False where the request ends the session, so no successor could be used;
   * a function where only some answers end it (true issues a successor).
   */
  rotate?: boolean | ((response: Response) => boolean);
  /** Also require the request's Origin to be this origin exactly, before any token is spent. */
  exactOrigin?: boolean;
  /**
   * Refuse a request the route's own same-origin check (`isSameOrigin`)
   * refuses, with the register's answer, before the session is read or any
   * token is spent: for a route whose register policy puts that refusal
   * before the account context is read (`api.file-delete`,
   * `policy.sameOriginRequired`; G8.5, 20 November 2026). The check itself
   * is the route's, unchanged; only its place moves.
   */
  originFirst?: boolean;
}

function exactOrigin(request: Request): boolean {
  return request.headers.get("origin") === new URL(request.url).origin;
}

/** One request's admission for one session: refused, or admitted with the successor. */
export async function admitSessionCsrf(request: Request, session: CsrfSession, route: CsrfRoute,
  options: CsrfOptions = {}): Promise<Exclude<CsrfAdmission, { kind: "unbound" }>> {
  if (!acceptsSessionKind(route, session.kind) || (options.exactOrigin && !exactOrigin(request))
    || (options.originFirst && !isSameOrigin(request)) || !(await spend(request, session, route))) {
    return { kind: "refused", response: refusal(route) };
  }
  // A chunk stream keeps the value it presented; nothing is issued.
  if (SESSION_CSRF_STREAM_ROUTES.has(route)) {
    return { kind: "admitted", next: request.headers.get(SESSION_CSRF_HEADER) ?? "", rotate: (response) => response };
  }
  const next = mintSessionCsrf(session, route);
  return {
    kind: "admitted",
    next,
    rotate: (response) => {
      if (options.rotate === false || (typeof options.rotate === "function" && !options.rotate(response))) return response;
      const rotated = rotatedSessions.get(response);
      return rotateSessionCsrf(response, rotated && rotated.kind === session.kind ? mintSessionCsrf(rotated, route) : next);
    },
  };
}

/** The current account session as the token binds it, or null when the request is not signed in. */
export async function currentAccountCsrfSession(): Promise<CsrfSession | null> {
  const context = await getSensitiveAccountContext();
  return context ? { kind: "authenticated", accountId: context.user.id, sessionId: context.sessionId } : null;
}

/**
 * The signed-in session as a reviewer token binds it (`reviewer-api-v1`), or
 * null. Whether this account may review anything is each route's own
 * question, asked of the database after the token is spent, as before.
 */
export async function currentReviewerCsrfSession(): Promise<CsrfSession | null> {
  const context = await getSensitiveAccountContext();
  return context ? { kind: "reviewer", accountId: context.user.id, sessionId: context.sessionId } : null;
}

/** The admission of an authenticated route's request; `unbound` when nobody is signed in. */
export async function admitAccountCsrf(request: Request, route: CsrfRoute,
  options: CsrfOptions = {}): Promise<CsrfAdmission> {
  if ((options.exactOrigin && !exactOrigin(request)) || (options.originFirst && !isSameOrigin(request))) {
    return { kind: "refused", response: refusal(route) };
  }
  const session = await currentAccountCsrfSession();
  return session ? admitSessionCsrf(request, session, route, options) : { kind: "unbound" };
}

/**
 * For a branch that has already established the request is signed in, inside
 * a route whose other branches keep their own token: the admission, or the
 * refusal to answer with.
 */
export async function requireAccountCsrf(request: Request, route: CsrfRoute,
  options: CsrfOptions = {}): Promise<Response | Extract<CsrfAdmission, { kind: "admitted" }>> {
  const admission = await admitAccountCsrf(request, route, options);
  if (admission.kind === "admitted") return admission;
  return admission.kind === "refused" ? admission.response : refusal(route);
}

/**
 * The same for a reviewer route's branch: api.claim-review-chunk-acknowledgement
 * answers a TEST account archive's acknowledgement first, with that branch's
 * own value, and checks the reviewer's token in the branch it answers itself.
 * A request with nobody signed in is refused with the same 404 its handler
 * gives.
 */
export async function requireReviewerCsrf(request: Request, route: CsrfRoute,
  options: CsrfOptions = {}): Promise<Response | Extract<CsrfAdmission, { kind: "admitted" }>> {
  const session = await currentReviewerCsrfSession();
  if (!session) return refusal(route);
  const admission = await admitSessionCsrf(request, session, route, options);
  return admission.kind === "admitted" ? admission : admission.response;
}

type Handler<Args extends unknown[]> = (request: Request, ...args: Args) => Promise<Response> | Response;

function guarded<Args extends unknown[]>(route: CsrfRoute, admit: (request: Request, args: Args) => Promise<CsrfAdmission>,
  handler: Handler<Args>): (request: Request, ...args: Args) => Promise<Response> {
  const wrapped = async (request: Request, ...args: Args): Promise<Response> => {
    const admission = await admit(request, args);
    if (admission.kind === "refused") return admission.response;
    const response = await handler(request, ...args);
    return admission.kind === "admitted" ? admission.rotate(response) : response;
  };
  Object.defineProperty(wrapped, SESSION_CSRF_GUARD, { value: route });
  return wrapped;
}

/** An authenticated route handler that requires and spends the account session's token for `route`. */
export function withAccountCsrf<Args extends unknown[]>(route: CsrfRoute, handler: Handler<Args>,
  options: CsrfOptions = {}) {
  if (SESSION_CSRF_ROUTES[route] !== "authenticated") throw new Error(`${route} is not an authenticated route`);
  return guarded(route, (request) => admitAccountCsrf(request, route, options), handler);
}

/** A reviewer route handler that requires and spends the reviewer session's token for `route`. */
export function withReviewerCsrf<Args extends unknown[]>(route: CsrfRoute, handler: Handler<Args>,
  options: CsrfOptions = {}) {
  if (SESSION_CSRF_ROUTES[route] !== "reviewer") throw new Error(`${route} is not a reviewer route`);
  return guarded(route, async (request: Request) => {
    const session = await currentReviewerCsrfSession();
    return session ? admitSessionCsrf(request, session, route, options) : { kind: "unbound" as const };
  }, handler);
}

/** A purpose-session route handler that requires and spends the token of the session `read` finds. */
export function withPurposeCsrf<Args extends unknown[]>(route: CsrfRoute,
  read: (request: Request, ...args: Args) => CsrfSession | null | Promise<CsrfSession | null>,
  handler: Handler<Args>, options: CsrfOptions = {}) {
  const kind = SESSION_CSRF_ROUTES[route];
  if (kind === "authenticated" || kind === "reviewer") throw new Error(`${route} is not a purpose-session route`);
  return guarded(route, async (request: Request, args: Args) => {
    const session = await read(request, ...args);
    return session ? admitSessionCsrf(request, session, route, options) : { kind: "unbound" as const };
  }, handler);
}

/**
 * The route that takes either kind of session (`SESSION_CSRF_SECOND_KINDS`;
 * owner decision of 19 November 2026, "G8.5: the claim-objection address
 * accepts either kind of session"): the rights session of the request's
 * rights cookie is checked first, and the signed-in account second. The
 * token is spent for the rights session when it was minted for it; otherwise
 * for the signed-in account, when there is one; otherwise it is refused for
 * the rights session. A request with neither reaches the handler unchanged.
 * The handler is told which session was admitted, so each branch runs only
 * under its own kind's token, as each ran under its own value before.
 */
export function withRightsOrAccountCsrf(route: CsrfRoute,
  handler: (request: Request, session: CsrfSession | null) => Promise<Response> | Response) {
  if (SESSION_CSRF_ROUTES[route] !== "token" || SESSION_CSRF_SECOND_KINDS[route] !== "authenticated") {
    throw new Error(`${route} does not take a rights or an account session`);
  }
  const wrapped = async (request: Request): Promise<Response> => {
    const rights = readRightsCsrfSession(request);
    const presented = request.headers.get(SESSION_CSRF_HEADER);
    const session = rights && verifySessionCsrf(presented, rights, route) ? rights
      : (await currentAccountCsrfSession()) ?? rights;
    if (!session) return handler(request, null);
    const admission = await admitSessionCsrf(request, session, route);
    if (admission.kind === "refused") return admission.response;
    return admission.rotate(await handler(request, session));
  };
  Object.defineProperty(wrapped, SESSION_CSRF_GUARD, { value: route });
  return wrapped;
}

/** The rights session (`token-api-v1`) of the request's rights cookie. */
export function readRightsCsrfSession(request: Request): CsrfSession | null {
  const sessionHash = readRightsSessionHash(request);
  return sessionHash ? { kind: "token", sessionHash } : null;
}

/** The activation candidate (`token-candidate-api-v1`) of the request's candidate cookie. */
export function readCandidateCsrfSession(request: Request): CsrfSession | null {
  const sessionHash = readRightsCandidateHash(request);
  return sessionHash ? { kind: "token-candidate", sessionHash } : null;
}

type SessionPath = { params: Promise<{ session: string }> };

/** The embryo upload session (`upload-session-api-v1`) the path names, by its own `inherit-ingest-<session>` cookie. */
export async function readUploadCsrfSession(request: Request, context: SessionPath): Promise<CsrfSession | null> {
  const { session } = await context.params;
  const sessionHash = readIngestCookieHash(request, session);
  return sessionHash ? { kind: "upload-session", sessionHash, sessionId: session } : null;
}

/** The evidence session (`evidence-session-api-v1`) the path names, by the evidence cookie. */
export async function readEvidenceCsrfSession(request: Request, context: SessionPath): Promise<CsrfSession | null> {
  const { session } = await context.params;
  const sessionHash = readEvidenceCookieHash(request, session);
  return sessionHash ? { kind: "evidence-session", sessionHash, sessionId: session } : null;
}

/** The claim session (`claim-session-api-v1`) of the request's claim cookie. */
export function readClaimCsrfSession(request: Request): CsrfSession | null {
  const sessionHash = claimSessionHash(request);
  return sessionHash ? { kind: "claim-session", sessionHash } : null;
}

/** The reset session (`reset-session-api-v1`) of the request's reset cookie. */
export function readResetCsrfSession(request: Request): CsrfSession | null {
  const sessionHash = readResetSessionHash(request);
  return sessionHash ? { kind: "reset-session", sessionHash } : null;
}

/** A token for a page to render for one route of a session it already holds. */
export function sessionCsrfToken(session: CsrfSession, route: CsrfRoute): string {
  return mintSessionCsrf(session, route);
}

/**
 * The authenticated routes the signed-in shell's pages send to, each with a
 * token the layout renders once and the browser rotates from then on.
 */
export const SHELL_CSRF_ROUTES = [
  "auth.sign-out", "api.account-delete", "api.account-delete-cancel", "api.chat", "api.browse-region",
  "api.file-process", "api.file-upload-session", "api.file-finalize", "api.file-delete", "api.llm-settings",
  "api.subject-drafts", "api.subject-delete", "api.subject-sharing", "api.chromosomal-sex", "api.family-acknowledge", "api.embryo-acknowledge", "api.consents",
  "api.consent-revoke", "api.consents-revoke-all", "api.embryo-cohorts", "api.embryo-record-key-cards",
  "api.embryo-disposition", "api.jurisdiction", "api.subjects",
  "api.account-completion", "api.invitations", "api.embryo-cohort-drafts", "api.legal-evidence-upload-session",
  "api.export", "api.subject-export", "api.future-person-identity-profile",
  // The account branch of the one route that takes either kind (Settings → Data, "Review a claim").
  "api.future-person-claim-objection",
] as const satisfies readonly CsrfRoute[];

/**
 * The reviewer routes the two review pages send to (`/reviews/appeals/[id]`
 * and `/reviews/future-person/claims/[id]`), each with a token the page
 * renders once for the reviewer's own session. api.future-person-correction-review
 * has no page yet; it is listed so the page that comes has its token.
 */
export const REVIEW_CSRF_ROUTES = [
  "api.legal-evidence-review", "api.appeal-review", "api.future-person-documentary-verification",
  "api.future-person-claim-review", "api.future-person-claim-release", "api.future-person-claim-objection-review",
  "api.future-person-correction-review", "api.claim-review-receipt", "api.claim-review-chunk-acknowledgement",
] as const satisfies readonly CsrfRoute[];

export type CsrfTokens = Partial<Record<CsrfRoute, string>>;

/** Tokens for the current account session, minted and never stored; empty when nobody is signed in. */
export async function accountCsrfTokens(routes: readonly CsrfRoute[] = SHELL_CSRF_ROUTES): Promise<CsrfTokens> {
  const session = await currentAccountCsrfSession();
  if (!session) return {};
  return Object.fromEntries(routes.map((route) => [route, mintSessionCsrf(session, route)]));
}

/**
 * Tokens for the signed-in reviewer's session, minted and never stored. A
 * review page passes the account context it has already read for its own
 * authority check (`getPageAccountContext`), so rendering asks the auth
 * service nothing more.
 */
export function reviewerCsrfTokens(account: { user: { id: string }; sessionId: string },
  routes: readonly CsrfRoute[] = REVIEW_CSRF_ROUTES): CsrfTokens {
  const session: CsrfSession = { kind: "reviewer", accountId: account.user.id, sessionId: account.sessionId };
  return Object.fromEntries(routes.map((route) => [route, mintSessionCsrf(session, route)]));
}
