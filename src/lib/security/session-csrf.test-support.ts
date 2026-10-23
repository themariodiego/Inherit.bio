import type * as SessionCsrf from "./session-csrf";

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
    admitAccountCsrf: (async () => ({ kind: "unbound" })) as typeof actual.admitAccountCsrf,
    requireAccountCsrf: (async () => ({ kind: "admitted", next: "", rotate: (response: Response) => response })) as typeof actual.requireAccountCsrf,
  };
}
