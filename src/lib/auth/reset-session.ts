import "server-only";

import crypto from "node:crypto";
import { hmacSecret } from "@/lib/crypto";
import { RESET_CSRF_COOKIE, RESET_SESSION_COOKIE, SECRET_SHAPE, readSingleCookie, setCookie } from "./auth-cookies";

/**
 * The reset session (authContracts.reset-session-api-v1): the only
 * credential `POST /api/auth/reset-password` accepts.
 *
 * The callback issues it after it has verified the PKCE state and exchanged
 * a recovery code (`src/app/auth/callback/route.ts`). It is a 256-bit secret
 * in a host-only, HttpOnly, SameSite=Strict cookie; the database keeps only
 * its SHA-256, for 15 minutes, for one use
 * (`private.auth_recovery_sessions`). It can change one password and nothing
 * else: it is not a Supabase session and no page or endpoint reads data with
 * it.
 *
 * Its CSRF value (`X-Inherit-CSRF-header-bound-to-the-reset-session`) is a
 * keyed digest of the session hash. The callback hands it to the page in a
 * Lax cookie, because the first render arrives by a redirect chain that a
 * Strict cookie is withheld from; the POST is same-origin and carries both.
 * Spending the session spends the value with it.
 */

export const RESET_SESSION_SECONDS = 15 * 60;
const CSRF_CONTEXT = "auth-reset-csrf-v1";
const CSRF_SHAPE = /^[0-9a-f]{64}$/u;

function sha256Hex(value: string): string {
  return crypto.createHash("sha256").update(value, "utf8").digest("hex");
}

export function resetCsrf(sessionHash: string): string {
  return hmacSecret(sessionHash, CSRF_CONTEXT);
}

/** A new reset session: the hash for the database and both cookies. */
export function newResetSession(): { sessionHash: string; setCookies: string[] } {
  const secret = crypto.randomBytes(32).toString("base64url");
  const sessionHash = sha256Hex(secret);
  return {
    sessionHash,
    setCookies: [
      setCookie(RESET_SESSION_COOKIE, secret, RESET_SESSION_SECONDS, "Strict"),
      setCookie(RESET_CSRF_COOKIE, resetCsrf(sessionHash), RESET_SESSION_SECONDS, "Lax"),
    ],
  };
}

/** Both reset cookies, deleted. */
export function clearResetSessionCookies(): string[] {
  return [setCookie(RESET_SESSION_COOKIE, "", 0, "Strict"), setCookie(RESET_CSRF_COOKIE, "", 0, "Lax")];
}

/** The CSRF value the page renders into its form, when the browser holds a well-formed one. */
export function presentedResetCsrf(value: string | undefined): string {
  return value !== undefined && CSRF_SHAPE.test(value) ? value : "";
}

/**
 * The session hash of a request that carries exactly one well-formed reset
 * cookie and the CSRF value derived from it; null otherwise. Whether the
 * session is live is the database's question.
 */
export function readResetSession(request: Request, csrfHeader: string | null): { sessionHash: string } | null {
  const secret = readSingleCookie(request, RESET_SESSION_COOKIE, SECRET_SHAPE);
  if (!secret || csrfHeader === null || !CSRF_SHAPE.test(csrfHeader)) return null;
  const sessionHash = sha256Hex(secret);
  const expected = resetCsrf(sessionHash);
  return crypto.timingSafeEqual(Buffer.from(csrfHeader), Buffer.from(expected)) ? { sessionHash } : null;
}
