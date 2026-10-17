import "server-only";

/**
 * The cookies the three auth endpoints and the callback read and write.
 *
 * Every one is host-only (no Domain), `Path=/` and HttpOnly. In production
 * each name carries the `__Host-` prefix, which makes a browser refuse it
 * unless it is also Secure, host-only and on `/`. Outside production the
 * prefix is dropped because browsers refuse it without HTTPS; every other
 * attribute is the same. This is the same rule the claim cookies follow
 * (`src/lib/future-person/claim-session.ts`).
 */

const PRODUCTION = process.env.NODE_ENV === "production";

function hostName(name: string): string {
  return PRODUCTION ? `__Host-${name}` : name;
}

/** The non-authorizing form cookie of `/auth/sign-up` and `/auth/forgot-password`. */
export const AUTH_FORM_COOKIE = hostName("inherit-auth-form");
/** auth.callback.policy.PKCE: the sealed state hash, verifier, flow and destination. */
export const PKCE_COOKIE = hostName("inherit-pkce-verifier");
/** authContracts.reset-session-api-v1.credential: SameSite=Strict, hash-only at rest. */
export const RESET_SESSION_COOKIE = hostName("inherit-reset");
/**
 * The CSRF value bound to the reset session. It is Lax, not Strict, because
 * the browser arrives at `/auth/reset-password` through a redirect chain that
 * began at the mail link and the auth service, and a Strict cookie is withheld
 * from such a chain. Alone it authorizes nothing: the POST must also carry
 * the Strict session cookie it was derived from.
 */
export const RESET_CSRF_COOKIE = hostName("inherit-reset-csrf");

export type SameSite = "Strict" | "Lax";

/** One `Set-Cookie` value. A zero `maxAge` deletes the cookie. */
export function setCookie(name: string, value: string, maxAge: number, sameSite: SameSite): string {
  const attributes = [`${name}=${value}`, "Path=/", `Max-Age=${Math.max(0, Math.floor(maxAge))}`, "HttpOnly", `SameSite=${sameSite}`];
  if (PRODUCTION) attributes.push("Secure");
  return attributes.join("; ");
}

/** Every cookie name the request carries, once each. */
export function requestCookieNames(request: Request): string[] {
  const names = (request.headers.get("cookie") ?? "")
    .split(";")
    .map((part) => part.trim())
    .filter((part) => part.includes("="))
    .map((part) => part.slice(0, part.indexOf("=")));
  return [...new Set(names)];
}

/** The single value of a cookie that matches `shape`; null when absent, repeated or malformed. */
export function readSingleCookie(request: Request, name: string, shape: RegExp): string | null {
  const values = (request.headers.get("cookie") ?? "")
    .split(";")
    .map((part) => part.trim())
    .filter((part) => part.slice(0, part.indexOf("=")) === name)
    .map((part) => part.slice(part.indexOf("=") + 1));
  return values.length === 1 && shape.test(values[0]!) ? values[0]! : null;
}

/** 256 bits of base64url: the shape of every random secret these cookies carry. */
export const SECRET_SHAPE = /^[A-Za-z0-9_-]{43}$/u;
