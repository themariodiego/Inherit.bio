import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { LOCATION_UNAVAILABLE_BODY, LOCATION_UNAVAILABLE_TITLE } from "@/copy/availability";
import { isEmbargoedCountry, isEmbargoedLocation } from "@/lib/legal/service-restrictions";
import { futurePersonClaimsOpen } from "@/lib/future-person/claims-open";
import { CLAIM_FORM_TOKEN_HEADER, claimFormSecret, mintClaimForm } from "@/lib/future-person/claim-session";
import {APPEAL_FORM_TOKEN_HEADER,appealFormSecret,mintAppealForm} from "@/lib/future-person/appeal-form";
import {testAppealIntakeOpen} from "@/lib/future-person/appeals-open";
import {applyAppealIntakeHeaders} from "@/lib/future-person/appeal-intake-response";
import { AUTH_FORM_PAGES, AUTH_FORM_TOKEN_HEADER, authFormSecret, mintAuthForm } from "@/lib/auth/auth-form";
import { unavailable } from "@/lib/embryos/api";
import { isStrictSameOrigin, sameOriginRefusal, sameOriginRequiredRoute } from "@/lib/security/same-origin";
import { AUTH_UNAVAILABLE_HEADER, AUTH_UNAVAILABLE_PATH, checkUser } from "@/lib/supabase/auth-check";

/**
 * The three public auth endpoints (auth.sign-up-submit,
 * auth.forgot-password-submit, auth.reset-password-submit). They answer for
 * no signed-in account, so none is looked up or refreshed on their way, and
 * every answer, the proxy's included, carries the authOrRecovery profile.
 */
const AUTH_ENDPOINTS: ReadonlySet<string> = new Set([
  "/api/auth/sign-up",
  "/api/auth/forgot-password",
  "/api/auth/reset-password",
]);

/**
 * Response headers every page or endpoint that can read or write user,
 * subject, consent, chat, file or derived data must carry (route register
 * `sensitiveResponseHeaders.authenticatedUserData`): nothing user-derived may
 * be cached by the browser, a CDN or a shared cache, and no such response may
 * be framed. Redirects on those paths carry the same set.
 */
export const SENSITIVE_RESPONSE_HEADERS: Readonly<Record<string, string>> = {
  "Cache-Control": "private, no-store",
  "CDN-Cache-Control": "no-store",
  "Vercel-CDN-Cache-Control": "no-store",
  Pragma: "no-cache",
  "Referrer-Policy": "same-origin",
  "X-Content-Type-Options": "nosniff",
  "Content-Security-Policy": "frame-ancestors 'none'",
  "X-Frame-Options": "DENY",
};

/**
 * Endpoints the route register binds, for every response, to a profile whose
 * Referrer-Policy is no-referrer (`sensitiveResponseHeaderBindings`
 * tokenPageOrEndpoint, downloadOrExport or authOrRecovery). Each is named by
 * its register id. The proxy's value is the one the browser receives on these
 * paths, whatever the handler sets: the first eleven handlers set no-referrer
 * themselves, and the last nine (with api.file-download below) answer through
 * helpers that set same-origin (D-138 (a)).
 */
const NO_REFERRER_ENDPOINTS: ReadonlySet<string> = new Set([
  "/api/future-person/claim", // api.future-person-claim
  "/api/future-person/claim/session", // api.future-person-delete
  "/api/future-person/claim/session/account", // api.future-person-claimant-bind
  "/api/future-person/claim/session/analysis", // api.future-person-analysis-stop
  "/api/future-person/claim/session/export", // api.future-person-export
  "/api/future-person/claim/session/objection", // api.future-person-claim-objection
  "/api/future-person/claim/session/recovery-key", // api.future-person-recovery-key
  "/api/withdraw/session/export", // api.third-party-subject-export
  "/api/appeals/session/complete", // api.appeal-complete
  "/api/appeals/session/documents", // api.appeal-document-session
  "/api/rights/reissue", // api.rights-reissue
  "/api/export", // api.export
  "/api/consents/grant/session", // api.consent-grant-rights
  "/api/consents/reaffirm/session", // api.consent-reaffirm-rights
  "/api/consents/revoke/session", // api.consent-revoke-rights
  "/api/invitations/accept", // api.invitation-accept
  "/api/rights/activate", // api.rights-activate
  "/api/rights/embryo-record-key-cards", // api.embryo-record-key-cards-rights
  "/api/subjects/bind/session", // api.adult-subject-bind
  "/api/withdraw/session", // api.withdraw (its one registered token value)
]);

/** api.file-download, `/api/files/[id]/download`: one segment, as the route matches it. */
const FILE_DOWNLOAD_ENDPOINT = /^\/api\/files\/[^/]+\/download$/;

/**
 * Endpoints the register names no-referrer for on some of their answers only:
 * a response contract bound to the route (`responseContractBindings.routes`)
 * says `private-no-store-no-referrer`. The policy can be set only per path, so
 * by the owner's decision of 19 November 2026 ("the strictest referrer setting
 * applies to the whole route", D-138 (b) and (c)) every answer of the route
 * gets it, the proxy's own refusals included. Each is named by its register id
 * and the contract that names it; `src/proxy.test.ts` derives the same set
 * from the register. Endpoints whose handlers send no-referrer while the
 * register names it for none of their answers are not here.
 */
const WHOLE_ROUTE_NO_REFERRER_ENDPOINTS: ReadonlySet<string> = new Set([
  "/api/chat", // api.chat: copilot-transport-unavailable-v1 and three more
  "/api/chromosomal-sex", // api.chromosomal-sex: chromosomal-sex-declared-v1
  "/api/family/acknowledge", // api.family-acknowledge: family-acknowledged-v1
  "/api/embryos/acknowledge", // api.embryo-acknowledge: embryo-acknowledged-v1
  "/api/files/upload-session", // api.file-upload-session: upload-session-v1, canonical-uploads-paused-v1
  "/api/uploads", // api.subject-upload-issue: upload-session-v1, canonical-uploads-paused-v1
  "/api/embryo-cohorts", // api.embryo-cohorts: cohort-created-v1, embryo-closed-schema-v1 (D-138 (b))
  "/api/future-person/claim/session/documents", // api.future-person-claim-document-session: public-capacity-limited-v1
  "/api/appeals/session/decision", // api.appeal-decision-notice: appeal-decision-notice-v1
  "/api/jobs/annotation-refresh", // jobs.annotation-refresh: machine-job-result-v1
  "/api/jobs/mail", // jobs.mail: machine-job-result-v1
  "/api/jobs/research-publish", // jobs.research-publish: machine-job-result-v1
  "/api/jobs/research-refresh", // jobs.research-refresh: machine-job-result-v1
  "/api/jobs/retention", // jobs.retention: machine-job-result-v1
  "/api/cron/retention", // jobs.retention-cron: machine-job-result-v1
]);

/** The same rule for routes with dynamic segments: one segment each, as the route matches it. */
const WHOLE_ROUTE_NO_REFERRER_SHAPES: readonly RegExp[] = [
  /^\/api\/chats\/[^/]+$/, // api.chat-history: copilot-transport-unavailable-v1, embryo-closed-schema-v1
  /^\/api\/files\/[^/]+\/process$/, // api.file-process: preparation-capacity-v1, preparation-too-large-v1
  /^\/api\/embryo-ingest\/[^/]+\/configure$/, // api.embryo-ingest-configure: embryo-vcf-transport-v1, embryo-table-configuration-v1
  /^\/api\/embryo-ingest\/[^/]+\/mapping$/, // api.embryo-ingest-mapping: pgt-mapping-challenge-v1, embryo-ingest-decision-v1
  /^\/api\/embryo-cohorts\/[^/]+\/record-key-cards$/, // api.embryo-record-key-cards: record-key-card-delivery-v1 (D-138 (b))
  /^\/api\/embryos\/[^/]+\/disposition$/, // api.embryo-disposition: embryo-disposition-v1 (D-138 (b))
  /^\/api\/future-person\/claim\/session\/corrections\/[^/]+\/statement$/, // api.future-person-own-correction-statement
  /^\/api\/reviews\/future-person\/claim-objections\/[^/]+$/, // api.future-person-claim-objection-review: its review-case contract
  /^\/api\/reviews\/future-person\/corrections\/[^/]+$/, // api.future-person-correction-review: its review-case contract
];

/**
 * The same rule for pages and the three endpoints outside `/api/`: every route
 * whose register statements name no-referrer for some or all of its answers,
 * through a no-referrer profile in `sensitiveResponseHeaderBindings` or a
 * response contract bound to it in `responseContractBindings.routes`. The
 * proxy cannot know which answer a page will give (its 200, a 404 or 500, a
 * redirect it gives itself, or the proxy's own redirects, rewrite and
 * refusals), so by the same decision every answer of the route gets it.
 * `src/proxy.test.ts` derives the same set from the register. The sign-in
 * redirect every signed-in page carries is not here: the proxy builds that
 * answer itself and gives it no-referrer exactly (`signInRedirect`).
 */
const WHOLE_ROUTE_NO_REFERRER_PAGES: ReadonlySet<string> = new Set([
  "/auth/sign-in", // auth.sign-in: authOrRecovery
  "/auth/sign-up", // auth.sign-up: authOrRecovery
  "/auth/forgot-password", // auth.forgot-password: authOrRecovery
  "/auth/reset-password", // auth.reset-password: authOrRecovery
  "/auth/callback", // auth.callback (endpoint): authCallback, auth-callback-v1
  "/auth/sign-out", // auth.sign-out (endpoint): sign-out-v1
  "/family", // family.index: portrait-grant-denial-v1
  "/embryos", // embryos.index: embryo-closed-schema-v1
  "/embryos/compare", // embryos.compare: resource-not-found-page-v1, embryo-closed-schema-v1
]);

/** Pages with dynamic segments: one segment each, as the route matches it. */
const WHOLE_ROUTE_NO_REFERRER_PAGE_SHAPES: readonly RegExp[] = [
  // rights.withdraw (`/withdraw/[token]`): tokenPageOrEndpoint, authOrRecovery, resource-not-found-page-v1,
  // embryo-closed-schema-v1; and rights.withdraw-request (`/withdraw/request`, endpoint): tokenPageOrEndpoint.
  /^\/withdraw\/[^/]+$/,
  /^\/genome\/[^/]+\/reports$/, // genome.reports: owned-file-redirect-response-v1, resource-not-found-page-v1
  /^\/family\/portrait\/[^/]+$/, // family.portrait: portrait-grant-denial-v1
  // embryos.detail (`/embryos/[embryoId]`): resource-not-found-page-v1, embryo-closed-schema-v1. Its static
  // siblings embryos.upload and embryos.request-data are their own routes and name it for no answer.
  /^\/embryos\/(?!upload$|request-data$)[^/]+$/,
  /^\/copilot\/[^/]+$/, // copilot.scope: resource-not-found-page-v1, embryo-closed-schema-v1
];

/** True on every path the register names no-referrer for, on every answer or (by the decision above) on some. */
function registerNoReferrer(path: string): boolean {
  return NO_REFERRER_ENDPOINTS.has(path) || FILE_DOWNLOAD_ENDPOINT.test(path)
    || WHOLE_ROUTE_NO_REFERRER_ENDPOINTS.has(path) || WHOLE_ROUTE_NO_REFERRER_SHAPES.some(shape => shape.test(path))
    || WHOLE_ROUTE_NO_REFERRER_PAGES.has(path) || WHOLE_ROUTE_NO_REFERRER_PAGE_SHAPES.some(shape => shape.test(path));
}

/**
 * The four auth pages the register binds to `authOrRecovery` (auth.sign-in,
 * auth.sign-up, auth.forgot-password, auth.reset-password). Every answer
 * carries the sensitive set with no-referrer, as the two form pages' answers
 * already did. The profile's nonce script policy is not applied to a page
 * here; `frame-ancestors 'none'` stands, as on every other page.
 */
const AUTH_RECOVERY_PAGES: ReadonlySet<string> = new Set([
  "/auth/sign-in",
  "/auth/sign-up",
  "/auth/forgot-password",
  "/auth/reset-password",
]);

/**
 * auth.callback's `sensitiveResponseHeaders.authCallback` profile, exactly as
 * the register names it (`src/proxy.test.ts` compares the two). Its answers
 * are redirects with no body, so its closed policy shows nothing.
 */
export const AUTH_CALLBACK_HEADERS: Readonly<Record<string, string>> = {
  "Cache-Control": "no-store",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "Content-Security-Policy": "default-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  "X-Frame-Options": "DENY",
};
const AUTH_CALLBACK_PATH = "/auth/callback";

/**
 * Endpoints the register binds to `authOrRecovery` whose answers the proxy
 * gives that profile, its per-response nonce policy included: the public
 * appeal intake (api.subject-access-request), the claimant's correction
 * intake, the three auth endpoints, and api.rights-reissue, whose handler
 * builds the same policy and which the proxy's `frame-ancestors 'none'`
 * replaced until 19 November 2026 (D-138 (e)).
 */
function authOrRecoveryEndpoint(path: string): boolean {
  return path === "/api/appeals" || path === "/api/future-person/claim/session/corrections"
    || path === "/api/rights/reissue" || AUTH_ENDPOINTS.has(path);
}

function withSensitiveHeaders<T extends NextResponse>(response: T, path?: string): T {
  if (path === AUTH_CALLBACK_PATH) {
    for (const [name, value] of Object.entries(AUTH_CALLBACK_HEADERS)) response.headers.set(name, value);
    return response;
  }
  for (const [name, value] of Object.entries(SENSITIVE_RESPONSE_HEADERS)) {
    response.headers.set(name, value);
  }
  if (path !== undefined && authOrRecoveryEndpoint(path)) return applyAppealIntakeHeaders(response);
  // The proxy's response headers also reach route-handler responses. Review
  // IDs, documentary decisions and document download sessions require the
  // stricter policy, including refusals produced by the proxy itself. Next's
  // response sender retains an already-present proxy header, so the download
  // handler's no-referrer policy must also be set here, and so must the
  // register-bound endpoints' (NO_REFERRER_ENDPOINTS and the whole-route set).
  if ((path !== undefined && registerNoReferrer(path)) ||
      path?.startsWith("/reviews/future-person/claims/") ||
      path?.startsWith("/api/reviews/future-person/claims/") ||
      path?.startsWith("/reviews/appeals/") ||
      path?.startsWith("/api/reviews/appeals/") ||
      (path !== undefined && /^\/api\/legal-evidence\/[^/]+\/review-download$/.test(path)) ||
      // sensitiveResponseHeaderBindings.downloadOrExport: the subject download
      // and export entries and the shared chunk route they hand off to.
      (path !== undefined && /^\/api\/subjects\/[^/]+\/(?:download|export)$/.test(path)) ||
      path?.startsWith("/api/downloads/")) {
    response.headers.set("Referrer-Policy", "no-referrer");
  }
  return response;
}

/**
 * authenticated-page-signin-redirect-v1 (`pageAuthContract.authenticatedSignedOut`),
 * whose headers are `private-no-store-no-referrer`. The proxy builds this
 * answer itself, so it carries no-referrer exactly, from every page it
 * answers, and a page's other answers keep the policy their own register
 * statements give them.
 */
function signInRedirect(url: URL, path: string): NextResponse {
  const response = withSensitiveHeaders(NextResponse.redirect(url), path);
  response.headers.set("Referrer-Policy", "no-referrer");
  return response;
}

/**
 * The rights an account keeps whatever else blocks it: export, deletion and
 * its cancellation, consent withdrawal, and handing a record on.
 */
function isRightsEndpoint(path: string): boolean {
  return path === "/api/export" ||
    /^\/api\/subjects\/[^/]+\/export$/.test(path) ||
    path === "/api/account/delete" ||
    path === "/api/account/delete/cancel" ||
    (path.startsWith("/api/consents/") && path.endsWith("/revoke")) ||
    path.startsWith("/api/subjects/transfer");
}

/**
 * The answer to a connection the hosting provider locates in a place under a
 * comprehensive US embargo (`service-restrictions.ts`): 451, with nothing
 * that needs a further request, and never cached.
 */
function locationUnavailable(path: string): NextResponse {
  const response = path.startsWith("/api/")
    ? NextResponse.json({ error: "not_available_in_location" }, { status: 451 })
    : new NextResponse(
        `<!doctype html><html lang="en"><head><meta charset="utf-8">` +
          `<meta name="viewport" content="width=device-width, initial-scale=1">` +
          `<title>${LOCATION_UNAVAILABLE_TITLE}</title></head><body><main>` +
          `<h1>${LOCATION_UNAVAILABLE_TITLE}</h1><p>${LOCATION_UNAVAILABLE_BODY}</p>` +
          `</main></body></html>`,
        { status: 451, headers: { "Content-Type": "text/html; charset=utf-8" } },
      );
  return withSensitiveHeaders(response, path);
}

/**
 * The answer when the auth service failed to confirm or refuse the session
 * twice (owner decision 2026-11-19, D-142). An endpoint gets the shared
 * `{"error":"unavailable"}` 503, which says nothing about the session. A page
 * is rewritten, at the URL the person asked for, to the route that throws into
 * the root `error.tsx`: the existing "This page did not load" surface, whose
 * "Try again" asks for that URL again. Next.js applies no status from a proxy
 * rewrite, so that document answers 500, as any thrown page does.
 *
 * `written` holds what the auth client wrote through `setAll`. Only cookies
 * carrying a value go on: a refresh that rotated the tokens before the user
 * read failed must reach the browser, but a removal never does, so a person
 * whose sign-in check merely failed keeps their session cookies.
 */
function authCheckUnavailable(request: NextRequest, path: string, written: NextResponse): NextResponse {
  let answer: NextResponse;
  if (path.startsWith("/api/")) {
    const refusal = unavailable();
    answer = new NextResponse(refusal.body, { status: refusal.status, headers: refusal.headers });
  } else {
    const headers = new Headers(request.headers);
    headers.set(AUTH_UNAVAILABLE_HEADER, "1");
    answer = NextResponse.rewrite(new URL(AUTH_UNAVAILABLE_PATH, request.url), { request: { headers } });
  }
  for (const cookie of written.cookies.getAll()) {
    if (cookie.value) answer.cookies.set(cookie);
  }
  return withSensitiveHeaders(answer, path);
}

// Next.js 16 proxy (successor to middleware): keeps the Supabase auth session
// fresh and gates the authenticated app shell.
export async function proxy(request: NextRequest) {
  // Sanctions come before everything else, sign-in included. Vercel sets
  // these headers from the connection's address and overwrites any a client
  // sends; nothing here stores them. Without them (a local run) nothing is
  // refused.
  if (isEmbargoedLocation(
    request.headers.get("x-vercel-ip-country"),
    request.headers.get("x-vercel-ip-country-region"),
  )) {
    return locationUnavailable(request.nextUrl.pathname);
  }

  // policy.sameOriginRequired (owner decision of 22 November 2026, "Change
  // requests are refused without the browser's same-origin marker, before the
  // account is read"): a request to a bound route and method whose
  // Sec-Fetch-Site is not same-origin, or whose Origin is another site's, gets
  // the route's registered refusal here, before the session check below reads
  // the account. The route's CSRF wrapper applies the same rule from the same
  // list (`@/lib/security/same-origin`).
  if (sameOriginRequiredRoute(request.method, request.nextUrl.pathname) !== null && !isStrictSameOrigin(request)) {
    const refusal = sameOriginRefusal();
    return withSensitiveHeaders(new NextResponse(refusal.body, { status: refusal.status, headers: refusal.headers }),
      request.nextUrl.pathname);
  }

  // The error surface a failed sign-in check is rewritten to renders only for
  // the proxy's own rewrite, which never comes back through here. A request
  // that names the path itself loses the marker and is answered not-found.
  if (request.nextUrl.pathname === AUTH_UNAVAILABLE_PATH) {
    const headers = new Headers(request.headers);
    headers.delete(AUTH_UNAVAILABLE_HEADER);
    return withSensitiveHeaders(NextResponse.next({ request: { headers } }));
  }

  if(request.nextUrl.pathname==="/legal/appeals")return appealPage(request);
  // Public intake is account-free. A suspension POST performs its separate
  // native own-JWT account/current-session check inside its exact branch.
  if(request.nextUrl.pathname==="/api/appeals")return withSensitiveHeaders(NextResponse.next({request}),request.nextUrl.pathname);
  // This generic document must not look up an account or an invitation.
  // Its handler sets its own nonce CSP and non-authorizing candidate cookie.
  // Its no-referrer (tokenPageOrEndpoint) is set here as well, the handler's
  // own value, so an answer the handler does not build (a 405, a 500) has it.
  if (request.nextUrl.pathname === "/withdraw/request") {
    const response = NextResponse.next({ request });
    response.headers.set("Referrer-Policy", "no-referrer");
    return response;
  }
  // These rights operations use their own browser-bound credentials, not the
  // signed-in account. An unrelated account's deletion notice must not block
  // the recipient from declining an invitation.
  if (request.nextUrl.pathname === "/api/rights/activate"
    || request.nextUrl.pathname === "/api/withdraw/session"
    || request.nextUrl.pathname === "/api/withdraw/session/export"
    || request.nextUrl.pathname === "/api/future-person/claim"
    || request.nextUrl.pathname.startsWith("/api/future-person/claim/session/")
    || request.nextUrl.pathname.startsWith("/api/evidence/")) {
    return withSensitiveHeaders(NextResponse.next({ request }),request.nextUrl.pathname);
  }
  // The public claim page reads only what the claimant types: no account,
  // no record, no prior claim (rights.future-person-claim.policy.dataScope).
  if (request.nextUrl.pathname === "/future-person/claim") {
    return claimPage(request);
  }
  if (AUTH_ENDPOINTS.has(request.nextUrl.pathname)) {
    return withSensitiveHeaders(NextResponse.next({ request }), request.nextUrl.pathname);
  }
  if (Object.hasOwn(AUTH_FORM_PAGES, request.nextUrl.pathname)) {
    return authFormPage(request, AUTH_FORM_PAGES[request.nextUrl.pathname]!);
  }
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // Do not run code between createServerClient and getUser: a stale session
  // could be committed to cookies. A temporary failure of the auth service is
  // asked once more after a short pause (owner decision 2026-11-19, D-142).
  const check = await checkUser(supabase.auth, { signal: request.signal });
  const user = check.kind === "user" ? check.user : null;

  const path = request.nextUrl.pathname;
  const isProtected =
    path.startsWith("/overview") ||
    path.startsWith("/genome") ||
    path.startsWith("/family/") ||
    path.startsWith("/embryos") ||
    path.startsWith("/copilot") ||
    path.startsWith("/files") ||
    path.startsWith("/dashboard") ||
    path.startsWith("/uploads") ||
    path.startsWith("/reports") ||
    path.startsWith("/browse") ||
    path.startsWith("/ancestry") ||
    path.startsWith("/chat") ||
    path.startsWith("/settings");

  const isReviewPage=path.startsWith("/reviews/future-person/claims/") || path.startsWith("/reviews/appeals/");
  // `/family` (family.index, public-or-authenticated) is not protected: a
  // signed-out visitor gets its public page. A signed-in one gets the app
  // shell with their account and the page reads their people, so every answer
  // carries the sensitive set; the public page may be stored, never must be
  // (`pageAuthContract.publicOrAuthenticated.cache`). The auth pages and the
  // callback carry the profiles the register binds them to.
  const sensitive = isProtected || path === "/family" || path.startsWith("/api/") || path.startsWith("/withdraw/") || isReviewPage
    || AUTH_RECOVERY_PAGES.has(path) || path === AUTH_CALLBACK_PATH;

  // Neither signed in nor signed out: the account's own checks below cannot
  // run, so a protected page or an endpoint is answered here, never with
  // sign-in and never as if signed in. Elsewhere nothing depends on the answer.
  if (check.kind === "unavailable" && (isProtected || path.startsWith("/api/"))) {
    return authCheckUnavailable(request, path, response);
  }

  if (!user && isProtected) {
    const url = request.nextUrl.clone();
    url.pathname = "/auth/sign-in";
    url.searchParams.set("next", path);
    return signInRedirect(url, path);
  }

  if (user && (isProtected || path.startsWith("/api/"))) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("deletion_requested_at, jurisdiction_code")
      .eq("id", user.id)
      .maybeSingle();

    if (profile?.deletion_requested_at) {
      if (path.startsWith("/api/") && !isRightsEndpoint(path)) {
        return withSensitiveHeaders(
          NextResponse.json(
            { error: "account_deletion_notice_period" },
            { status: 423 },
          ), path,
        );
      }
      if (isProtected && path !== "/settings/data") {
        const url = request.nextUrl.clone();
        url.pathname = "/settings/data";
        url.search = "";
        return withSensitiveHeaders(NextResponse.redirect(url), path);
      }
    }

    // An account that declared a country under a comprehensive US embargo
    // keeps its rights and may correct its answer; nothing else is served.
    // Settings says why and holds both.
    if (profile && isEmbargoedCountry(profile.jurisdiction_code)) {
      if (path.startsWith("/api/") && !isRightsEndpoint(path) && path !== "/api/settings/jurisdiction") {
        return withSensitiveHeaders(
          NextResponse.json({ error: "not_available_in_jurisdiction" }, { status: 451 }), path,
        );
      }
      if (isProtected && !path.startsWith("/settings")) {
        return withSensitiveHeaders(NextResponse.redirect(new URL("/settings", request.url)), path);
      }
    }

    // G5.1a: where a person lives is declared once, at first sign-in, before
    // any product page. Settings stay open: the declaration is made there, and
    // export, deletion and consent withdrawal are rights nothing may block.
    // Endpoints are not redirected; each one already resolves an undeclared
    // account's restricted capabilities as unreviewed on the server.
    if (isProtected && profile && profile.jurisdiction_code === null && !path.startsWith("/settings")) {
      // A fresh URL, not a clone: a clone of `/family/` keeps its trailing slash.
      const url = new URL("/settings", request.url);
      url.searchParams.set("next", `${path}${request.nextUrl.search}`);
      return withSensitiveHeaders(NextResponse.redirect(url), path);
    }
  }

  if (sensitive) withSensitiveHeaders(response, path);
  // auth.sign-out: the 303 of sign-out-v1 and the CSRF gate's refusals are the
  // handler's; the register names no-referrer for the 303, so every answer gets it.
  else if (registerNoReferrer(path)) response.headers.set("Referrer-Policy", "no-referrer");
  return response;
}

/**
 * `GET /future-person/claim` while claims are open: a non-authorizing form
 * pair. The cookie goes to the browser, and a browser that already holds one
 * keeps it, because Next.js prefetches this page while it is showing it. The
 * sealed token goes only to this render, in a request header no client value
 * can supply, and the page writes it into the form. Nothing is looked up.
 */
function claimPage(request: NextRequest): NextResponse {
  const headers = new Headers(request.headers);
  headers.delete(CLAIM_FORM_TOKEN_HEADER);
  if (request.method !== "GET" || !futurePersonClaimsOpen()) {
    return withSensitiveHeaders(NextResponse.next({ request: { headers } }));
  }
  let form: ReturnType<typeof mintClaimForm>;
  try {
    form = mintClaimForm(Date.now(), claimFormSecret(request));
  } catch {
    // No sealing key: the page renders closed rather than a form that cannot post.
    return withSensitiveHeaders(NextResponse.next({ request: { headers } }));
  }
  headers.set(CLAIM_FORM_TOKEN_HEADER, form.formToken);
  const response = withSensitiveHeaders(NextResponse.next({ request: { headers } }));
  response.headers.append("Set-Cookie", form.setCookie);
  response.headers.set("Referrer-Policy", "no-referrer");
  return response;
}

/**
 * `GET /auth/sign-up` and `GET /auth/forgot-password`: a non-authorizing
 * form pair (`src/lib/auth/auth-form.ts`). The cookie goes to the browser,
 * kept when it already holds one; the sealed token goes only to this render,
 * in a request header this function always strips from the incoming request,
 * so no client can supply it. The page carries a per-request token, so it is
 * never cached.
 */
function authFormPage(request: NextRequest, form: (typeof AUTH_FORM_PAGES)[string]): NextResponse {
  const headers = new Headers(request.headers);
  headers.delete(AUTH_FORM_TOKEN_HEADER);
  // Every answer carries no-referrer (authOrRecovery, WHOLE_ROUTE_NO_REFERRER_PAGES),
  // not only the one that hands out a form pair.
  const path = request.nextUrl.pathname;
  if (request.method !== "GET") return withSensitiveHeaders(NextResponse.next({ request: { headers } }), path);
  // A prefetch from another page (the header's sign-up link) must not hand
  // that page's visitor an auth form cookie they never asked for. A browser
  // already holding one, prefetching the form it shows, keeps it as before.
  const prefetch = request.headers.has("next-router-prefetch") || request.headers.has("next-router-segment-prefetch");
  if (prefetch && authFormSecret(request) === null) {
    return withSensitiveHeaders(NextResponse.next({ request: { headers } }), path);
  }
  let pair: ReturnType<typeof mintAuthForm>;
  try {
    pair = mintAuthForm(form, Date.now(), authFormSecret(request));
  } catch {
    // No sealing key: the page renders, and its POST is refused as stale.
    return withSensitiveHeaders(NextResponse.next({ request: { headers } }), path);
  }
  headers.set(AUTH_FORM_TOKEN_HEADER, pair.formToken);
  const response = withSensitiveHeaders(NextResponse.next({ request: { headers } }), path);
  response.headers.append("Set-Cookie", pair.setCookie);
  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|txt|xml)$).*)",
  ],
};

function appealPage(request:NextRequest):NextResponse{
 const headers=new Headers(request.headers);headers.delete(APPEAL_FORM_TOKEN_HEADER);
 if(request.method!=="GET"||!testAppealIntakeOpen())return withSensitiveHeaders(NextResponse.next({request:{headers}}));
 try{const form=mintAppealForm(Date.now(),appealFormSecret(request));headers.set(APPEAL_FORM_TOKEN_HEADER,form.formToken);
  const response=withSensitiveHeaders(NextResponse.next({request:{headers}}));response.headers.append("Set-Cookie",form.setCookie);
  response.headers.set("Referrer-Policy","no-referrer");return response;}
 catch{return withSensitiveHeaders(NextResponse.next({request:{headers}}));}
}
