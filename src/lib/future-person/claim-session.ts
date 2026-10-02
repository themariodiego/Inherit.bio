import "server-only";

import crypto from "node:crypto";
import { mintPublicFormToken, readPublicFormToken } from "@/lib/embryos/operation-token";
import { hmacSecret } from "@/lib/crypto";

/**
 * The two browser credentials of a Future Person claim.
 *
 * 1. The form pair (api.future-person-claim.requestContract.requiredSignals).
 *    `GET /future-person/claim` receives a ten-minute HttpOnly form cookie and
 *    a sealed one-time form token bound to it; the POST sends the token in
 *    `X-Inherit-CSRF` and must present the same cookie. The pair authorizes
 *    nothing and reads nothing: it only proves the POST came from the page
 *    this deployment served to this browser.
 *
 * 2. The claim session (authContracts.claim-session-api-v1). A received start
 *    sets a 256-bit secret in a host-only, HttpOnly, SameSite=Strict cookie
 *    whose SHA-256 is all the database keeps. It names one intake and nothing
 *    else, and it is the only credential the later document and completion
 *    steps will accept.
 *
 * Outside production the `__Host-` prefix is dropped, because browsers refuse
 * it without HTTPS; every other attribute is the same.
 */

const PRODUCTION = process.env.NODE_ENV === "production";
export const CLAIM_FORM_COOKIE = PRODUCTION ? "__Host-inherit-claim-form" : "inherit-claim-form";
export const CLAIM_SESSION_COOKIE = PRODUCTION ? "__Host-inherit-claim" : "inherit-claim";
export const CLAIM_CSRF_HEADER = "x-inherit-csrf";
/** Carries the page's form token from the proxy to the server render only. */
export const CLAIM_FORM_TOKEN_HEADER = "x-inherit-claim-form-token";

const FORM_SECONDS = 600;
const SESSION_SECONDS = 24 * 60 * 60;
const SECRET_SHAPE = /^[A-Za-z0-9_-]{43}$/u;

export function sha256Hex(value: string): string {
  return crypto.createHash("sha256").update(value, "utf8").digest("hex");
}

function cookie(name: string, value: string, maxAge: number): string {
  const attributes = [`${name}=${value}`, "Path=/", `Max-Age=${maxAge}`, "HttpOnly", "SameSite=Strict"];
  if (PRODUCTION) attributes.push("Secure");
  return attributes.join("; ");
}

/** The single value of a cookie; null when absent, repeated or malformed. */
function readCookie(request: Request, name: string): string | null {
  const values = (request.headers.get("cookie") ?? "")
    .split(";")
    .map((part) => part.trim())
    .filter((part) => part.slice(0, part.indexOf("=")) === name)
    .map((part) => part.slice(part.indexOf("=") + 1));
  return values.length === 1 && SECRET_SHAPE.test(values[0]!) ? values[0]! : null;
}

/** The form-cookie secret this browser holds, when it holds exactly one well-formed one. */
export function claimFormSecret(request: Request): string | null {
  return readCookie(request, CLAIM_FORM_COOKIE);
}

/**
 * A non-authorizing form pair for one render of the page.
 *
 * A browser that already holds a form cookie keeps it. Next.js prefetches
 * and refetches the page it is showing, and each of those passes through the
 * proxy; a new cookie on every one would strand the token the browser already
 * shows, and the claim would fail as an expired page. Every render still gets
 * its own one-time token and nonce, bound to that one cookie, and the
 * cookie's ten minutes start again.
 */
export function mintClaimForm(now = Date.now(), existingSecret: string | null = null): { formToken: string; setCookie: string } {
  const secret = existingSecret !== null && SECRET_SHAPE.test(existingSecret)
    ? existingSecret
    : crypto.randomBytes(32).toString("base64url");
  return {
    formToken: mintPublicFormToken("future-person-claim", now, sha256Hex(secret)),
    setCookie: cookie(CLAIM_FORM_COOKIE, secret, FORM_SECONDS),
  };
}

/**
 * The form nonce of a POST that carries every required signal: the exact
 * origin, same-origin fetch metadata, JSON, one form cookie and a fresh
 * token sealed for that cookie. Null on anything else.
 */
export function readClaimForm(request: Request, now = Date.now()): { nonce: string } | null {
  if (
    request.method !== "POST" ||
    new URL(request.url).search !== "" ||
    request.headers.get("origin") !== new URL(request.url).origin ||
    request.headers.get("sec-fetch-site") !== "same-origin" ||
    request.headers.get("content-type")?.split(";")[0]!.trim().toLowerCase() !== "application/json"
  ) {
    return null;
  }
  const token = request.headers.get(CLAIM_CSRF_HEADER);
  const secret = readCookie(request, CLAIM_FORM_COOKIE);
  if (!token || token.length > 2048 || !secret) return null;
  return readPublicFormToken(token, "future-person-claim", now, sha256Hex(secret));
}

/** A new claim-session secret, its hash for the database and its cookies. */
export function newClaimSession(): { sessionHash: string; setCookies: string[] } {
  const secret = crypto.randomBytes(32).toString("base64url");
  return {
    sessionHash: sha256Hex(secret),
    setCookies: [
      cookie(CLAIM_SESSION_COOKIE, secret, SESSION_SECONDS),
      // The form pair is spent; the browser drops it.
      cookie(CLAIM_FORM_COOKIE, "", 0),
    ],
  };
}

/** A successor cookie keeps the original server-owned absolute expiry. */
export function newClaimSessionRotation() {
  const secret = crypto.randomBytes(32).toString("base64url");
  return {
    sessionHash: sha256Hex(secret),
    setCookie: (expiresAt: Date, now = Date.now()) => cookie(CLAIM_SESSION_COOKIE, secret,
      Math.max(0, Math.min(SESSION_SECONDS, Math.floor((expiresAt.getTime() - now) / 1000)))),
  };
}

type ClaimMutation = "documents" | "complete";
/** A distinct CSRF value bound to the claim and the one-use operation token.
 * Rotation invalidates this value together with the old cookie and nonce. */
export function claimMutationCsrf(claimHash: string, operation: ClaimMutation, token: string): string {
  return hmacSecret(`${claimHash}|${operation}|${token}`, "claim-mutation-csrf-v1");
}

export function claimMutationCsrfMatches(presented: string | null, claimHash: string,
  operation: ClaimMutation, token: string): boolean {
  return Boolean(presented && /^[0-9a-f]{64}$/u.test(presented)
    && crypto.timingSafeEqual(Buffer.from(presented), Buffer.from(claimMutationCsrf(claimHash, operation, token))));
}
