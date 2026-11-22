import { NextResponse } from "next/server";
import { AUTH_FORM_COOKIE, PKCE_COOKIE, RESET_CSRF_COOKIE, RESET_SESSION_COOKIE, requestCookieNames } from "@/lib/auth/auth-cookies";
import { ingestCookieName, isIngestSessionId } from "@/lib/embryos/ingest-session";
import { RIGHTS_CANDIDATE_COOKIE } from "@/lib/embryos/rights-activation";
import { TIER2_EMBRYO_COOKIE_NAME } from "@/lib/embryos/tier2";
import { ACCOUNT_EXPORT_COOKIE } from "@/lib/exports/account-export-session";
import { TIER2_COOKIE_NAME, tier2CookieAttributes } from "@/lib/family/tier2";
import { CLAIM_FORM_COOKIE, CLAIM_SESSION_COOKIE } from "@/lib/future-person/claim-session";
import { EVIDENCE_COOKIE } from "@/lib/future-person/evidence-session";
import { DOWNLOAD_COOKIE } from "@/lib/future-person/review";

/** Every Tier-2 acknowledgement lasts exactly one signed-in session (brief §3 §7.2): both cookies end at sign-out. */
export const SESSION_SCOPED_COOKIES = [TIER2_COOKIE_NAME, TIER2_EMBRYO_COOKIE_NAME] as const;

/**
 * One cookie sign-out deletes, with the attributes it was set with. A browser
 * deletes a cookie only when the deletion names the same cookie (name, path,
 * no Domain on a host-only cookie), and it refuses a `__Host-` cookie, the
 * deletion included, that is not Secure on `/`. So each deletion repeats how
 * the cookie was set, never only its name.
 */
export type SignOutCookie = Readonly<{
  name: string;
  /** The register family of sign-out-v1.sessionEffect or auth.sign-out.policy.transaction it belongs to. */
  family: "auth" | "upload" | "evidence" | "claim" | "download" | "candidate" | "export" | "tier-2";
  secure: boolean;
  httpOnly: boolean;
  sameSite: "strict" | "lax";
}>;

/**
 * The cookies this deployment sets under its own helpers: `__Host-` and Secure
 * in production, neither outside it (`src/lib/auth/auth-cookies.ts` and each
 * module named below), so the prefix says whether it was set Secure.
 */
const hostOnly = (family: SignOutCookie["family"], name: string, sameSite: SignOutCookie["sameSite"]): SignOutCookie =>
  ({ name, family, secure: name.startsWith("__Host-"), httpOnly: true, sameSite });

/**
 * The export routes set the download session under this name, Secure, in
 * every environment (`src/lib/exports/account-export-http.ts`,
 * `subject-export-http.ts`, `claimant-export-http.ts`); the review and
 * original downloads use `DOWNLOAD_COOKIE`, which is the same name in
 * production and `inherit-download` outside it.
 */
export const EXPORT_DOWNLOAD_COOKIE = "__Host-inherit-download";

/**
 * sign-out-v1.sessionEffect: "clear every Inherit auth, upload, evidence,
 * claim, download and candidate cookie before the response; the rights cookie
 * is not cleared at sign-out", and auth.sign-out.policy.transaction: "clear
 * the host-only session, upload, evidence, export and download cookies"
 * (both as amended on 19 November 2026, G8.5). Each family maps to the cookie
 * the code sets for that purpose:
 *
 * - auth: the auth form, PKCE and reset cookies (`auth-cookies.ts`), and the
 *   Supabase session cookies, which are named per project and so are read
 *   from the request (`SUPABASE_AUTH_COOKIE`).
 * - upload: the embryo upload session, `inherit-ingest-<session>`
 *   (`ingest-session.ts`; upload-session-v1.embryoSetCookie), one per
 *   session, read from the request.
 * - evidence, claim (the claim session and its form pair), download,
 *   candidate (`RIGHTS_CANDIDATE_COOKIE`, token-candidate-api-v1) and export.
 * - the two Tier-2 gates, which end with the session.
 *
 * The rights cookie (`RIGHTS_COOKIE_NAME`) is kept, as the owner decided on
 * 19 November 2026 ("sign-out keeps an open rights session"): clearing it
 * would end a co-parent's, adult subject's or claimant's rights session whose
 * mailed link the activation has already consumed, so a person who signs
 * another account out of a shared browser to accept could not reopen it (the
 * flow e2e/co-parent-invitation.spec.ts and e2e/adult-subject-invitation.spec.ts
 * walk).
 */
export const SIGN_OUT_COOKIES: readonly SignOutCookie[] = Object.freeze([
  ...SESSION_SCOPED_COOKIES.map((name): SignOutCookie => {
    const set = tier2CookieAttributes();
    return { name, family: "tier-2", secure: set.secure, httpOnly: set.httpOnly, sameSite: set.sameSite };
  }),
  hostOnly("auth", AUTH_FORM_COOKIE, "strict"),
  hostOnly("auth", PKCE_COOKIE, "lax"),
  hostOnly("auth", RESET_SESSION_COOKIE, "strict"),
  hostOnly("auth", RESET_CSRF_COOKIE, "lax"),
  hostOnly("candidate", RIGHTS_CANDIDATE_COOKIE, "strict"),
  hostOnly("evidence", EVIDENCE_COOKIE, "strict"),
  hostOnly("claim", CLAIM_SESSION_COOKIE, "strict"),
  hostOnly("claim", CLAIM_FORM_COOKIE, "strict"),
  hostOnly("download", DOWNLOAD_COOKIE, "strict"),
  ...(DOWNLOAD_COOKIE === EXPORT_DOWNLOAD_COOKIE ? [] : [hostOnly("download", EXPORT_DOWNLOAD_COOKIE, "strict")]),
  hostOnly("export", ACCOUNT_EXPORT_COOKIE, "strict"),
]);

/**
 * The Supabase session cookies, their chunks and its code verifier, as
 * `@supabase/ssr` names them; set on `/`, host-only, not Secure, not HttpOnly
 * and SameSite=Lax (its default options, which neither client here changes).
 */
export const SUPABASE_AUTH_COOKIE = /^sb-[A-Za-z0-9_-]+-auth-token(?:-code-verifier)?(?:\.\d+)?$/u;
const INGEST_COOKIE = /^(?:__Host-)?inherit-ingest-(.+)$/u;

/** The cookies named per session or per project that this request carries. */
function requestedCookies(request: Request): SignOutCookie[] {
  const found: SignOutCookie[] = [];
  for (const name of requestCookieNames(request)) {
    if (SUPABASE_AUTH_COOKIE.test(name)) {
      found.push({ name, family: "auth", secure: false, httpOnly: false, sameSite: "lax" });
      continue;
    }
    const session = INGEST_COOKIE.exec(name)?.[1];
    if (session && isIngestSessionId(session) && ingestCookieName(session) === name) found.push(hostOnly("upload", name, "strict"));
  }
  return found;
}

/** Every cookie a sign-out of this request deletes. */
export function signOutCookies(request?: Request): SignOutCookie[] {
  return [...SIGN_OUT_COOKIES, ...(request ? requestedCookies(request) : [])];
}

/**
 * sign-out-v1: a 303 to auth.sign-in, no body, `Cache-Control: no-store` and
 * `Referrer-Policy: no-referrer`, with every cookie of `signOutCookies`
 * deleted. A deletion is an expiry in the past, not `Max-Age=0`: Next.js
 * re-reads a route's cookies when it merges the `cookies()` writes of the
 * Supabase client into the response, and that read drops a zero Max-Age.
 */
export function signOutResponse(origin: string, request?: Request): NextResponse {
  const response = NextResponse.redirect(new URL("/auth/sign-in", origin), { status: 303 });
  response.headers.set("Cache-Control", "no-store");
  response.headers.set("Referrer-Policy", "no-referrer");
  for (const cookie of signOutCookies(request)) {
    response.cookies.set({ name: cookie.name, value: "", path: "/", expires: new Date(0), secure: cookie.secure,
      httpOnly: cookie.httpOnly, sameSite: cookie.sameSite });
  }
  return response;
}
