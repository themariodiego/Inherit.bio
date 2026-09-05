import "server-only";

import crypto from "node:crypto";

/**
 * The rights session of a co-parent invitation (contract §5.2, §6.4). The
 * invited parent has no account when they open the mail link; the
 * activation route trades the invitation token for a browser session whose
 * secret lives only in a host-only cookie, and the database stores only
 * sha256(secret). Every later request presents the cookie, the route
 * hashes it again, and the RPC looks the hash up: the raw secret is never
 * stored, logged or returned in a body.
 *
 * The cookie is `__Host-` prefixed in production, which a browser accepts
 * only over https with Secure, Path=/ and no Domain (K.2). Local
 * development runs over http://localhost, where no browser would keep a
 * `__Host-` cookie, so the same cookie takes a plain name there.
 */

const PRODUCTION = process.env.NODE_ENV === "production";

export const RIGHTS_COOKIE_NAME: string = PRODUCTION ? "__Host-inherit-rights" : "inherit-rights";

/** 32 random bytes as base64url: 43 characters. */
const COOKIE_VALUE_PATTERN = /^[A-Za-z0-9_-]{43}$/;

/** A mailed invitation token: 32 random bytes as base64url, exactly as the mail job renders it. */
const INVITATION_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

function sha256Hex(value: string): string {
  return crypto.createHash("sha256").update(value, "utf8").digest("hex");
}

/** A fresh 256-bit session secret, base64url. */
export function newRightsSessionSecret(): string {
  return crypto.randomBytes(32).toString("base64url");
}

/** The only form of the secret the database ever sees. */
export function rightsSessionHash(secret: string): string {
  return sha256Hex(secret);
}

/**
 * The Set-Cookie value that carries the secret to the browser: host-only,
 * HttpOnly, SameSite=Strict, never with a Domain, Secure in production,
 * and gone from the browser when the session row would have expired.
 */
export function rightsCookie(secret: string, expiresAt: Date, now = Date.now()): string {
  const maxAge = Math.max(0, Math.floor((expiresAt.getTime() - now) / 1000));
  const attributes = [`${RIGHTS_COOKIE_NAME}=${secret}`, "Path=/", `Max-Age=${maxAge}`, "HttpOnly", "SameSite=Strict"];
  if (PRODUCTION) attributes.push("Secure");
  return attributes.join("; ");
}

/**
 * sha256 of the rights cookie on the request, or null when the cookie is
 * absent or not shaped like a secret this deployment issued. The first
 * cookie of the exact name wins; a cookie whose name merely starts with it
 * is another cookie.
 */
export function readRightsSessionHash(request: Request): string | null {
  const header = request.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0) continue;
    const name = part.slice(0, separator).trim();
    if (name !== RIGHTS_COOKIE_NAME) continue;
    const value = part.slice(separator + 1).trim();
    return COOKIE_VALUE_PATTERN.test(value) ? sha256Hex(value) : null;
  }
  return null;
}

/** sha256 of a well-formed invitation token, or null: the database stores only the hash. */
export function invitationTokenHash(token: string): string | null {
  if (!INVITATION_TOKEN_PATTERN.test(token)) return null;
  return sha256Hex(token);
}
