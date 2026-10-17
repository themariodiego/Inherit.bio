import "server-only";

import crypto from "node:crypto";
import { mintPublicFormToken, readPublicFormToken } from "@/lib/embryos/operation-token";
import { AUTH_FORM_COOKIE, SECRET_SHAPE, readSingleCookie, setCookie } from "./auth-cookies";

/**
 * The form pair of `/auth/sign-up` and `/auth/forgot-password`
 * (auth.sign-up-submit and auth.forgot-password-submit
 * `requestContract.requiredSignals`): the exact origin, same-origin fetch
 * metadata, and `X-Inherit-CSRF` carrying a one-time public form token bound
 * to a host-only cookie.
 *
 * `GET` of either page passes through the proxy, which keeps the browser's
 * form cookie (or sets a new one) and hands this render a sealed token bound
 * to it, in a request header no client value can supply. The pair authorizes
 * nothing and reads nothing: it proves only that the POST came from the page
 * this deployment served to this browser. The database spends the token's
 * nonce once (`private.auth_form_nonces`).
 */

export type AuthForm = "auth-sign-up" | "auth-forgot-password";

/** Carries the page's form token from the proxy to the server render only. */
export const AUTH_FORM_TOKEN_HEADER = "x-inherit-auth-form-token";
export const AUTH_CSRF_HEADER = "x-inherit-csrf";
/** The pages whose GET the proxy gives a form pair. */
export const AUTH_FORM_PAGES: Readonly<Record<string, AuthForm>> = {
  "/auth/sign-up": "auth-sign-up",
  "/auth/forgot-password": "auth-forgot-password",
};

/** Ten minutes, the token's own lifetime: the cookie outlives no token. */
const FORM_SECONDS = 600;
const TOKEN_LIMIT = 2048;

export function sha256Hex(value: string): string {
  return crypto.createHash("sha256").update(value, "utf8").digest("hex");
}

/** The form-cookie secret this browser holds, when it holds exactly one well-formed one. */
export function authFormSecret(request: Request): string | null {
  return readSingleCookie(request, AUTH_FORM_COOKIE, SECRET_SHAPE);
}

/**
 * A form pair for one render. A browser that already holds a form cookie
 * keeps it, because Next.js prefetches and refreshes the page it shows and a
 * new cookie on each would strand the token already on screen; every render
 * still gets its own one-time token, and the cookie's ten minutes restart.
 */
export function mintAuthForm(form: AuthForm, now = Date.now(), existingSecret: string | null = null): {
  formToken: string;
  setCookie: string;
} {
  const secret = existingSecret !== null && SECRET_SHAPE.test(existingSecret)
    ? existingSecret
    : crypto.randomBytes(32).toString("base64url");
  return {
    formToken: mintPublicFormToken(form, now, sha256Hex(secret)),
    setCookie: setCookie(AUTH_FORM_COOKIE, secret, FORM_SECONDS, "Strict"),
  };
}

function isJson(request: Request): boolean {
  return request.headers.get("content-type")?.split(";")[0]!.trim().toLowerCase() === "application/json";
}

/** The exact origin, same-origin fetch metadata, JSON, no query string. */
export function hasSameOriginSignals(request: Request): boolean {
  const url = new URL(request.url);
  return request.method === "POST"
    && url.search === ""
    && request.headers.get("origin") === url.origin
    && request.headers.get("sec-fetch-site") === "same-origin"
    && isJson(request);
}

/**
 * The hash of the form nonce of a POST that carries every required signal:
 * the exact origin, same-origin fetch metadata, JSON, one form cookie and a
 * fresh token sealed for this form and that cookie. Null on anything else.
 */
export function readAuthForm(request: Request, form: AuthForm, now = Date.now()): { nonceHash: string } | null {
  if (!hasSameOriginSignals(request)) return null;
  const token = request.headers.get(AUTH_CSRF_HEADER);
  const secret = authFormSecret(request);
  if (!token || token.length > TOKEN_LIMIT || !secret) return null;
  const claims = readPublicFormToken(token, form, now, sha256Hex(secret));
  return claims ? { nonceHash: sha256Hex(claims.nonce) } : null;
}
