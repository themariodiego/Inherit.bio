import type * as SessionCsrf from "./session-csrf";
import { SESSION_CSRF_HEADER, verifySessionCsrf } from "./session-csrf-core";

/**
 * The one-time X-Inherit-CSRF gate as a pass-through, for a route suite that
 * tests what its handler does once a request is admitted:
 *
 *   vi.mock("@/lib/security/session-csrf", async (importOriginal) =>
 *     (await import("@/lib/security/session-csrf.test-support")).admitEverySessionCsrf(await importOriginal()));
 *
 * The gate itself is tested on every bound route, through the same handlers,
 * in `src/lib/security/session-csrf-routes.test.ts`.
 */
export function admitEverySessionCsrf(actual: typeof SessionCsrf): typeof SessionCsrf {
  return {
    ...actual,
    withAccountCsrf: ((_route, handler) => handler) as typeof actual.withAccountCsrf,
    withPurposeCsrf: ((_route, _read, handler) => handler) as typeof actual.withPurposeCsrf,
    withReviewerCsrf: ((_route, handler) => handler) as typeof actual.withReviewerCsrf,
    // The one route that takes either kind: the session it would bind, rights
    // first, is handed to the handler as the real gate does after the spend.
    withRightsOrAccountCsrf: ((_route, handler) => async (request: Request) =>
      handler(request, actual.readRightsCsrfSession(request) ?? await actual.currentAccountCsrfSession())) as typeof actual.withRightsOrAccountCsrf,
    // 2026-11-22 (owner decision "G8.5: the reviewer chunk-acknowledgement address
    // accepts either kind of session"): the session the real gate admits is handed
    // to the handler: the account's when the request carries an account token of
    // the route, and otherwise the first kind, the reviewer's, as the rights
    // session is above. Nothing is spent.
    withReviewerOrAccountCsrf: ((route, handler) => async (request: Request, ...args: unknown[]) => {
      const account = await actual.currentAccountCsrfSession();
      const session = account && verifySessionCsrf(request.headers.get(SESSION_CSRF_HEADER), account, route)
        ? account : await actual.currentReviewerCsrfSession();
      return (handler as (request: Request, admitted: typeof session, ...rest: unknown[]) => Promise<Response> | Response)(request, session, ...args);
    }) as typeof actual.withReviewerOrAccountCsrf,
    admitAccountCsrf: (async () => ({ kind: "unbound" })) as typeof actual.admitAccountCsrf,
    requireAccountCsrf: (async () => ({ kind: "admitted", next: "", rotate: (response: Response) => response })) as typeof actual.requireAccountCsrf,
  };
}
