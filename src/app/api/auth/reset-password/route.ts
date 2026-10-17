import crypto from "node:crypto";
import { bcrypt } from "hash-wasm";
import { SESSION_SCOPED_COOKIES } from "@/app/auth/sign-out/response";
import { AUTH_FORM_COOKIE, PKCE_COOKIE, requestCookieNames, setCookie } from "@/lib/auth/auth-cookies";
import { AUTH_CSRF_HEADER, hasSameOriginSignals } from "@/lib/auth/auth-form";
import { parseAuthBody, readBoundedJson } from "@/lib/auth/auth-request";
import { authInvalidRequest, authNoContent, authNotFound } from "@/lib/auth/auth-response";
import { clearResetSessionCookies, readResetSession } from "@/lib/auth/reset-session";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * `POST /api/auth/reset-password` (register auth.reset-password-submit),
 * under the reset session only (authContracts.reset-session-api-v1).
 *
 * The order is the register's: exact origin, same-origin fetch metadata,
 * JSON, one reset cookie and the CSRF value bound to it, then the closed
 * body `{ password }`. Anything missing, invalid, expired, used or for
 * another purpose is the opaque resource-not-found-v1, decided before the
 * body is read. A password outside 12 to 72 characters or over 72 bytes is
 * invalid-request-v1 `password` (owner decision 2026-10-16), and only once
 * the session has authorized the request.
 *
 * The new password is hashed here with bcrypt at the auth service's own cost
 * of 10; the database receives only the hash. One transaction stores it,
 * revokes every session of the account, raises the account's auth session
 * revision (so no capability minted from an older session survives its next
 * check) and spends the reset session
 * (`private.reset_password_with_recovery_v1`). The answer is password-reset-v1,
 * 204 with no body, clearing every auth cookie this browser holds: the person
 * signs in again with the new password. No identity, account id or session
 * is ever returned.
 */

/** The Supabase session cookies, their chunks and the PKCE verifier cookie. */
const SUPABASE_AUTH_COOKIE = /^sb-[A-Za-z0-9_-]+-auth-token(?:-code-verifier)?(?:\.\d+)?$/u;
const BCRYPT_COST = 10;

function everyAuthCookieDeletion(request: Request): string[] {
  const deletions = clearResetSessionCookies();
  for (const name of [PKCE_COOKIE, AUTH_FORM_COOKIE]) deletions.push(setCookie(name, "", 0, "Lax"));
  for (const name of requestCookieNames(request)) {
    if (SUPABASE_AUTH_COOKIE.test(name) || (SESSION_SCOPED_COOKIES as readonly string[]).includes(name)) {
      deletions.push(`${name}=; Path=/; Max-Age=0`);
    }
  }
  return deletions;
}

export async function POST(request: Request) {
  if (!hasSameOriginSignals(request)) return authNotFound();
  const session = readResetSession(request, request.headers.get(AUTH_CSRF_HEADER));
  if (!session) return authNotFound();

  const json = await readBoundedJson(request);
  const parsed = parseAuthBody(json, ["password"] as const);
  if (!parsed.ok) {
    // Only a string of the wrong length is the password's own issue; any
    // other shape is an invalid body, which this contract answers opaquely.
    const typed = parsed.issues.includes("password") && typeof (json as { password?: unknown }).password === "string";
    return typed ? authInvalidRequest(["password"]) : authNotFound();
  }

  let passwordHash: string;
  try {
    passwordHash = await bcrypt({
      password: parsed.value.password, salt: crypto.randomBytes(16), costFactor: BCRYPT_COST, outputType: "encoded",
    });
  } catch {
    return authNotFound();
  }
  try {
    const { data, error } = await createAdminClient().rpc("reset_password_with_recovery_v1", {
      p_session_hash: session.sessionHash,
      p_password_hash: passwordHash,
    });
    if (error || data !== "reset") return authNotFound();
  } catch {
    return authNotFound();
  }
  return authNoContent(everyAuthCookieDeletion(request));
}
