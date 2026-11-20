import {
  isAuthApiError,
  isAuthRetryableFetchError,
  type AuthError,
  type User,
} from "@supabase/supabase-js";

/**
 * One reading of "who is signed in", shared by the proxy, the app layout and
 * the page-level resolvers (owner decision 2026-11-19, "A brief failure of the
 * sign-in service is not treated as signed out"; D-142).
 *
 * `auth.getUser()` in @supabase/auth-js 2.112.4 answers every `AuthError` as
 * `{ data: { user: null }, error }` (`GoTrueClient._getUser`), so "no user"
 * alone cannot tell a signed-out person from an auth service that failed for a
 * moment. The error decides, by the library's own classes (`lib/fetch.js`,
 * `lib/errors.js`):
 *
 * - **temporarily unavailable**: `AuthRetryableFetchError`, which the library
 *   raises for a request that never got an answer (a network failure, reset,
 *   timeout or abort, status 0), for 500–504 and 520–530, and for a success
 *   whose body could not be read; and `AuthApiError` with status 429 (rate
 *   limited) or any other 5xx. None of these says anything about the session.
 * - **no session**: no error and no user; `AuthSessionMissingError` (no
 *   session cookie, no access token, or the service's `session_not_found`);
 *   `AuthApiError` with any other status (the service refused the token or
 *   the user). This is exactly what signed out meant before.
 * - anything else the library can return here (`AuthUnknownError`, a non-JSON
 *   answer with a status outside the lists above, including a 429 from a
 *   gateway; `AuthRefreshDiscardedError`) cannot be classified positively, so
 *   it is read as it always was: no session. An exception `getUser()` throws is
 *   not caught.
 *
 * A temporary answer is asked once more after `AUTH_RECHECK_PAUSE_MS`, and the
 * second answer decides. A temporary answer never yields a user.
 */

/**
 * The pause before the one second question. The failures this exists for were
 * single refused calls among many that succeeded in the same journey, and the
 * library's own refresh retry starts at 200 ms (`_refreshAccessToken`). A
 * quarter of a second gives a reset connection or a busy pool a moment while
 * adding no wait a person would notice to a request that then succeeds.
 */
export const AUTH_RECHECK_PAUSE_MS = 250;

/** What the auth service's answer means for this request. */
export type AuthCheck =
  | { kind: "user"; user: User }
  | { kind: "no-session" }
  | { kind: "unavailable" };

/** The one call this module makes: `auth.getUser()` with no token argument. */
export interface UserReader {
  getUser(): Promise<{ data: { user: User | null }; error?: AuthError | null }>;
}

/** The temporary class: the service did not answer the question, so the answer says nothing about the session. */
export function isTemporaryAuthFailure(error: unknown): boolean {
  if (isAuthRetryableFetchError(error)) return true;
  return isAuthApiError(error) && (error.status === 429 || error.status >= 500);
}

/** One answer of `getUser()`, classified. A user is returned only with no error at all. */
export function classifyUserAnswer(answer: Awaited<ReturnType<UserReader["getUser"]>>): AuthCheck {
  if (answer.error) return isTemporaryAuthFailure(answer.error) ? { kind: "unavailable" } : { kind: "no-session" };
  return answer.data.user ? { kind: "user", user: answer.data.user } : { kind: "no-session" };
}

/** Resolves true after `ms`, or false at once when `signal` aborts (or has aborted). */
function pause(ms: number, signal?: AbortSignal): Promise<boolean> {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve(false);
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      resolve(false);
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve(true);
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export interface CheckUserOptions {
  /** The request's own signal: once it aborts, nothing more is waited for or asked. */
  signal?: AbortSignal;
  pauseMs?: number;
}

/**
 * Ask who is signed in; on a temporary answer, wait briefly and ask exactly
 * once more, and return the second answer. An aborted request stops the wait
 * and returns the first answer without asking again.
 *
 * In a server component the second question reaches the auth service only
 * because the client's fetch is `userAnswerFetch` (`createClient` in
 * `./server.ts`): Next.js would otherwise answer it from the render's memo with
 * the first answer.
 */
export async function checkUser(reader: UserReader, options: CheckUserOptions = {}): Promise<AuthCheck> {
  const first = classifyUserAnswer(await reader.getUser());
  if (first.kind !== "unavailable") return first;
  if (!(await pause(options.pauseMs ?? AUTH_RECHECK_PAUSE_MS, options.signal))) return first;
  return classifyUserAnswer(await reader.getUser());
}

/** One answer of `GET /auth/v1/user`, read once and handed to every reader of a render. */
export interface UserAnswer {
  status: number;
  statusText: string;
  headers: [string, string][];
  body: ArrayBuffer;
}

/** The questions one render has asked, by request, with the answer each got or is getting. */
export type UserAnswers = Map<string, Promise<UserAnswer>>;

/** Headers Next.js leaves out of its own memo key: tracing, not the question. */
const NOT_THE_QUESTION = new Set(["traceparent", "tracestate"]);

/**
 * Whether an answer says something about the session, so that a later reader
 * of the same render may be handed it. Everything `classifyUserAnswer` can
 * read as temporary is not: no answer, 429, any 5xx, and a success whose body
 * is not JSON.
 */
function isVerdict(answer: UserAnswer): boolean {
  if (answer.status === 429 || answer.status >= 500) return false;
  if (answer.status < 200 || answer.status >= 300) return true;
  try {
    JSON.parse(new TextDecoder().decode(answer.body));
    return true;
  } catch {
    return false;
  }
}

/**
 * The fetch of the server client pages, layouts and their resolvers use.
 *
 * Next.js memoizes every `GET` a server component sends for the whole render,
 * keyed by URL and headers, and keeps a failed answer as well as a good one
 * (`next/dist/server/lib/dedupe-fetch.js`; "Memoization" in
 * `node_modules/next/dist/docs/01-app/03-api-reference/04-functions/fetch.md`).
 * `auth.getUser()` sends the same `GET /auth/v1/user` every time, so in a
 * render the second question of `checkUser` was answered from that memo with
 * the first failure without reaching the service, and the page threw the error
 * surface after one failure (D-142, hosted runs 44607979037 and 44614403733,
 * reproduced against `next start`). A reader that
 * asked after a second question succeeded would still have been handed the
 * first failure: the CSRF tokens would have read it as no session, and the
 * Family report loaders as not found.
 *
 * This fetch replaces that memo for `GET /auth/v1/user` alone, with the one
 * difference that matters: readers of one render still share one question to
 * the service while it is pending, and share its answer when it is a verdict;
 * an answer that is not (see `isVerdict`) is handed to those already waiting
 * for it and then forgotten, so the next question goes to the service and its
 * answer is what every later reader of the render reads. Each question it
 * sends carries an `AbortSignal`, Next's documented opt-out from its memo.
 * Every other request goes to `ask` untouched. `answersOfThisRender` returns
 * the map of the current render; outside a render (a route handler, a server
 * action) it returns a fresh map, and every question goes to the service as
 * before.
 */
export function userAnswerFetch(
  answersOfThisRender: () => UserAnswers,
  ask: typeof fetch = (input, init) => fetch(input, init),
): typeof fetch {
  return async (input, init) => {
    const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (method !== "GET" || !new URL(url).pathname.endsWith("/auth/v1/user")) return ask(input, init);
    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
    const key = JSON.stringify([url, [...headers].filter(([name]) => !NOT_THE_QUESTION.has(name)).sort()]);
    const answers = answersOfThisRender();
    let pending = answers.get(key);
    if (!pending) {
      const question = (async (): Promise<UserAnswer> => {
        const response = await ask(input, { ...init, signal: init?.signal ?? new AbortController().signal });
        return { status: response.status, statusText: response.statusText, headers: [...response.headers],
          body: await response.arrayBuffer() };
      })();
      pending = question;
      answers.set(key, question);
      const forget = () => { if (answers.get(key) === question) answers.delete(key); };
      question.then(answer => { if (!isVerdict(answer)) forget(); }, forget);
    }
    const answer = await pending;
    const empty = answer.status === 204 || answer.status === 205 || answer.status === 304;
    return new Response(empty ? null : answer.body.slice(0),
      { status: answer.status, statusText: answer.statusText, headers: answer.headers });
  };
}

/**
 * Thrown by a page, layout or page-level resolver when the auth service could
 * neither confirm nor refuse the session twice. Nothing catches it on purpose:
 * the nearest `error.tsx` renders the existing error surface, whose "Try again"
 * asks the server again. Its message names no user, session or request.
 */
export class AuthServiceUnavailableError extends Error {
  constructor() {
    super("The sign-in check could not be completed");
    this.name = "AuthServiceUnavailableError";
  }
}

/**
 * For a server component: the signed-in user, or null for no session (which
 * the caller answers exactly as before, with sign-in or not-found), and a
 * thrown `AuthServiceUnavailableError` when the service failed twice. Server
 * components have no request signal, so the pause is never cut short here.
 */
export async function userForPage(reader: UserReader): Promise<User | null> {
  const check = await checkUser(reader);
  if (check.kind === "unavailable") throw new AuthServiceUnavailableError();
  return check.kind === "user" ? check.user : null;
}

/**
 * The same auth client, except that `getUser()` answers through
 * `userForPage`: a page hands it to a shared resolver it does not own (one
 * that reads only `data.user`), so the resolver's "no user" still means no
 * session and a temporary failure throws instead. Every other member is the
 * client's own, bound to it.
 */
export function pageAuth<A extends UserReader>(auth: A): A {
  return new Proxy(auth, {
    get(target, key) {
      if (key === "getUser") return async () => ({ data: { user: await userForPage(target) }, error: null });
      const value: unknown = Reflect.get(target, key, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

/**
 * Where the proxy rewrites a page navigation whose check came back temporary
 * twice: the page there throws `AuthServiceUnavailableError`, so the root
 * `error.tsx` renders the existing error surface at the URL the person asked
 * for. It renders only for a request the proxy marked with
 * `AUTH_UNAVAILABLE_HEADER`; a direct visit is answered not-found, and the
 * proxy strips the header from any request that names the path itself.
 */
export const AUTH_UNAVAILABLE_PATH = "/session-check-unavailable";
export const AUTH_UNAVAILABLE_HEADER = "x-inherit-session-check-unavailable";
