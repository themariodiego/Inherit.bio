import "server-only";

import crypto from "node:crypto";
import { mintSessionCsrf } from "@/lib/security/session-csrf-core";
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
 * Its CSRF value (`X-Inherit-CSRF-header-bound-to-the-reset-session`) is the
 * reset session's one-time token for auth.reset-password-submit (G8.5, the
 * migration stage; `src/lib/security/session-csrf.ts`), which the route's
 * wrapper spends before the handler runs, against the live reset session.
 * It was a keyed digest of the session hash. The callback mints the first
 * one and hands it to the page in a Lax cookie, because the first render
 * arrives by a redirect chain that a Strict cookie is withheld from; the
 * POST is same-origin and carries both. An answer that does not spend the
 * session (a password outside the limits) carries the next token, so the
 * form can be sent again; the answer that spends it carries none.
 */

export const RESET_SESSION_SECONDS = 15 * 60;
const TOKEN_SHAPE = /^\d{13}\.[A-Za-z0-9_-]{43}\.[0-9a-f]{64}$/u;

function sha256Hex(value: string): string {
  return crypto.createHash("sha256").update(value, "utf8").digest("hex");
}

/** A new reset session: the hash for the database and both cookies, the second holding its first token. */
export function newResetSession(): { sessionHash: string; setCookies: string[] } {
  const secret = crypto.randomBytes(32).toString("base64url");
  const sessionHash = sha256Hex(secret);
  return {
    sessionHash,
    setCookies: [
      setCookie(RESET_SESSION_COOKIE, secret, RESET_SESSION_SECONDS, "Strict"),
      setCookie(RESET_CSRF_COOKIE, mintSessionCsrf({ kind: "reset-session", sessionHash }, "auth.reset-password-submit"),
        RESET_SESSION_SECONDS, "Lax"),
    ],
  };
}

/** Both reset cookies, deleted. */
export function clearResetSessionCookies(): string[] {
  return [setCookie(RESET_SESSION_COOKIE, "", 0, "Strict"), setCookie(RESET_CSRF_COOKIE, "", 0, "Lax")];
}

/** The token the page renders into its form, when the browser holds a well-formed one. */
export function presentedResetCsrf(value: string | undefined): string {
  return value !== undefined && TOKEN_SHAPE.test(value) ? value : "";
}

/**
 * The session hash of a request that carries exactly one well-formed reset
 * cookie; null otherwise. Its token was spent for this session before the
 * handler ran. Whether the session is live is the database's question.
 */
export function readResetSessionHash(request: Request): string | null {
  const secret = readSingleCookie(request, RESET_SESSION_COOKIE, SECRET_SHAPE);
  return secret ? sha256Hex(secret) : null;
}
