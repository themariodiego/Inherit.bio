import "server-only";

import { sensitiveJson } from "@/lib/embryos/api";

/**
 * The route register's `policy.sameOriginRequired`, strictly (owner decision
 * of 22 November 2026, "Change requests are refused without the browser's
 * same-origin marker, before the account is read"): a request to a bound
 * route whose `Sec-Fetch-Site` is not exactly `same-origin`, or whose
 * `Origin`, when it is sent, is not the site's own origin, is refused with
 * the route's registered refusal before any session, account or body is
 * read. Both the proxy (which reads the session for every other `/api/`
 * request) and the route's CSRF wrapper apply it, from this one list.
 *
 * `isSameOrigin` (`@/lib/account-deletion`) is the looser check the other
 * routes keep: a matching `Origin` alone, or `Sec-Fetch-Site: same-origin`
 * when `Origin` is absent. The decision covers the bound routes only.
 *
 * The site's own origin is the origin of the request's own URL, as Next.js
 * builds it, and never a configured address or a forwarded header:
 *
 *   - Under `next start` (locally, in the browser suite, self-hosted) Next.js
 *     builds the URL from the host and port the server itself listens on
 *     (`http://localhost:<port>`), whatever `Host` or `X-Forwarded-Host` the
 *     client sends, so a client cannot choose it.
 *   - On Vercel it is the host the platform routed the request by, which is
 *     the address the browser asked for. The register's `originAliases` are
 *     answered with a 308 to `canonicalOrigin` by `next.config.ts` before the
 *     proxy runs (only `/api/cron/` and `/api/jobs/` are exempt, and neither
 *     is bound), so on the production host it is `https://inherit.bio`; a
 *     preview deployment is its own origin. `isSameOrigin`, which many change
 *     routes use, has compared a browser's `Origin` with this same value from
 *     the start, so it is the value hosted browsers are already seen to send.
 *   - `NEXT_PUBLIC_SITE_URL` and `NEXT_PUBLIC_APP_URL` are not it. They build
 *     links in mail; a `NEXT_PUBLIC_` reference is fixed into the bundle at
 *     build time, and one build is served on four ports by the browser suite;
 *     and `applicationOrigin()` falls back to the hosted address on any
 *     Vercel deployment where the variable is unset, which would refuse every
 *     change request from a preview deployment's own pages.
 */

/** A bound route: the methods the register lists for it, and its path as the route matches it. */
export interface SameOriginBinding {
  readonly methods: readonly string[];
  readonly path: RegExp;
}

/**
 * The routes the register binds to `policy.sameOriginRequired`, by register
 * id. `src/lib/security/same-origin.test.ts` derives the same set from the
 * register. Each path matches one segment per dynamic segment, and not the
 * static routes beside it (`/api/files/upload-session` is api.file-upload-session).
 */
export const SAME_ORIGIN_REQUIRED_ROUTES: Readonly<Record<string, SameOriginBinding>> = {
  "api.subject-upload-issue": { methods: ["POST"], path: /^\/api\/uploads$/u },
  "api.file-delete": { methods: ["DELETE"], path: /^\/api\/files\/(?!upload-session$)[^/]+$/u },
};

/** True when `route` is bound to `policy.sameOriginRequired`. */
export function requiresSameOrigin(route: string): boolean {
  return Object.hasOwn(SAME_ORIGIN_REQUIRED_ROUTES, route);
}

/** The bound route a request of `method` on `pathname` reaches, or null. */
export function sameOriginRequiredRoute(method: string, pathname: string): string | null {
  for (const [route, binding] of Object.entries(SAME_ORIGIN_REQUIRED_ROUTES)) {
    if (binding.methods.includes(method) && binding.path.test(pathname)) return route;
  }
  return null;
}

/**
 * The strict rule: `Sec-Fetch-Site` is exactly `same-origin` (a browser sets
 * it and no page script can), and `Origin`, when sent, is exactly the
 * request's own origin. A repeated header reads as one joined value and is
 * refused.
 */
export function isStrictSameOrigin(request: Request): boolean {
  if (request.headers.get("sec-fetch-site") !== "same-origin") return false;
  const origin = request.headers.get("origin");
  return origin === null || origin === new URL(request.url).origin;
}

/**
 * The registered refusal of both bound routes: `authenticated-mutation-v1`'s
 * 403 `{"error":"request_forbidden"}`, with the sensitive headers, the same
 * answer the CSRF wrapper gives an account route.
 */
export function sameOriginRefusal(): Response {
  return sensitiveJson({ error: "request_forbidden" }, 403);
}
