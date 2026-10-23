import "server-only";

import { getSensitiveAccountContext } from "@/lib/account-deletion";
import { notFound } from "@/lib/embryos/api";
import { requestForbidden } from "@/lib/embryos/guards";
import { readRightsCandidateHash } from "@/lib/embryos/rights-activation";
import { readRightsSessionHash } from "@/lib/embryos/rights-session";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  SESSION_CSRF_HEADER,
  SESSION_CSRF_ROUTES,
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
 * and a purpose-session route names the cookie its session lives in:
 *
 *   export const POST = withPurposeCsrf("api.withdraw", readRightsCsrfSession, handler);
 *
 * The wrapper reads the session from the request itself. A request with no
 * session for the route to bind reaches the handler unchanged, so every
 * route keeps its own unauthenticated answer. Otherwise the token must verify
 * for that session and route, and the database must spend it now
 * (`public.consume_session_csrf_v1`, which also requires the account's auth
 * session to be live). Anything else is refused with the register's answer
 * before the handler runs: `authenticated-mutation-v1`'s 403
 * `request_forbidden`, or the 404 `not_found` of a purpose session's contract.
 * An admitted response carries the next token in the same header, so the page
 * can make its next request without a reload. Operation nonces are untouched:
 * each handler goes on checking its own.
 */

export { SESSION_CSRF_HEADER, type CsrfRoute, type CsrfSession } from "./session-csrf-core";

/** The route a wrapped handler guards, for the suite that checks every bound route is wrapped. */
export const SESSION_CSRF_GUARD = Symbol.for("inherit.session-csrf-guard");

export type CsrfAdmission =
  | { kind: "unbound" }
  | { kind: "refused"; response: Response }
  | { kind: "admitted"; next: string; rotate(response: Response): Response };

function refusal(route: CsrfRoute): Response {
  return SESSION_CSRF_ROUTES[route] === "authenticated" ? requestForbidden() : notFound();
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
 * Spends the request's token for `session` and `route`. Null when the header
 * is missing, repeated, malformed, stale, minted for another session or
 * route, already spent, or when the account's auth session is no longer live.
 */
async function spend(request: Request, session: CsrfSession, route: CsrfRoute): Promise<boolean> {
  const verified = verifySessionCsrf(request.headers.get(SESSION_CSRF_HEADER), session, route);
  if (!verified) return false;
  try {
    const { data, error } = await createAdminClient().rpc("consume_session_csrf_v1", {
      p_route_id: route,
      p_session_kind: session.kind,
      p_token_hash: verified.tokenHash,
      p_expires_at: new Date(verified.expiresAt).toISOString(),
      p_account_id: session.kind === "authenticated" ? session.accountId : null,
      p_session_id: session.kind === "authenticated" ? session.sessionId : null,
    });
    return !error && data === true;
  } catch {
    return false;
  }
}

export interface CsrfOptions {
  /** False where the request ends the session, so no successor could be used. */
  rotate?: boolean;
  /** Also require the request's Origin to be this origin exactly, before any token is spent. */
  exactOrigin?: boolean;
}

function exactOrigin(request: Request): boolean {
  return request.headers.get("origin") === new URL(request.url).origin;
}

/** One request's admission for one session: refused, or admitted with the successor. */
export async function admitSessionCsrf(request: Request, session: CsrfSession, route: CsrfRoute,
  options: CsrfOptions = {}): Promise<Exclude<CsrfAdmission, { kind: "unbound" }>> {
  if (SESSION_CSRF_ROUTES[route] !== session.kind || (options.exactOrigin && !exactOrigin(request))
    || !(await spend(request, session, route))) {
    return { kind: "refused", response: refusal(route) };
  }
  const next = mintSessionCsrf(session, route);
  return { kind: "admitted", next, rotate: (response) => options.rotate === false ? response : rotateSessionCsrf(response, next) };
}

/** The current account session as the token binds it, or null when the request is not signed in. */
export async function currentAccountCsrfSession(): Promise<CsrfSession | null> {
  const context = await getSensitiveAccountContext();
  return context ? { kind: "authenticated", accountId: context.user.id, sessionId: context.sessionId } : null;
}

/** The admission of an authenticated route's request; `unbound` when nobody is signed in. */
export async function admitAccountCsrf(request: Request, route: CsrfRoute,
  options: CsrfOptions = {}): Promise<CsrfAdmission> {
  if (options.exactOrigin && !exactOrigin(request)) return { kind: "refused", response: refusal(route) };
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

type Handler<Args extends unknown[]> = (request: Request, ...args: Args) => Promise<Response> | Response;

function guarded<Args extends unknown[]>(route: CsrfRoute, admit: (request: Request) => Promise<CsrfAdmission>,
  handler: Handler<Args>): (request: Request, ...args: Args) => Promise<Response> {
  const wrapped = async (request: Request, ...args: Args): Promise<Response> => {
    const admission = await admit(request);
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

/** A purpose-session route handler that requires and spends the token of the session `read` finds. */
export function withPurposeCsrf<Args extends unknown[]>(route: CsrfRoute, read: (request: Request) => CsrfSession | null,
  handler: Handler<Args>, options: CsrfOptions = {}) {
  if (SESSION_CSRF_ROUTES[route] === "authenticated") throw new Error(`${route} is not a purpose-session route`);
  return guarded(route, async (request) => {
    const session = read(request);
    return session ? admitSessionCsrf(request, session, route, options) : { kind: "unbound" as const };
  }, handler);
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
  "api.subject-drafts", "api.subject-sharing", "api.chromosomal-sex", "api.family-acknowledge", "api.consents",
  "api.consent-revoke", "api.consents-revoke-all", "api.embryo-cohorts", "api.embryo-record-key-cards",
  "api.embryo-disposition", "api.jurisdiction",
] as const satisfies readonly CsrfRoute[];

export type CsrfTokens = Partial<Record<CsrfRoute, string>>;

/** Tokens for the current account session, minted and never stored; empty when nobody is signed in. */
export async function accountCsrfTokens(routes: readonly CsrfRoute[] = SHELL_CSRF_ROUTES): Promise<CsrfTokens> {
  const session = await currentAccountCsrfSession();
  if (!session) return {};
  return Object.fromEntries(routes.map((route) => [route, mintSessionCsrf(session, route)]));
}
