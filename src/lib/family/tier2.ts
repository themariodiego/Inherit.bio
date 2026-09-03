import "server-only";

import { cookies } from "next/headers";
import { hmacSecret } from "@/lib/crypto";
import { createClient } from "@/lib/supabase/server";

/**
 * The Tier-2 gate (design §1.5; brief §3 §7.2). One explicit acknowledgement
 * at the domain boundary stands for the whole session: any result about
 * another adult is withheld server-side until it is given.
 *
 * The memory is an httpOnly, Secure, SameSite=Lax session cookie with no
 * Max-Age, whose value is a keyed digest of the account id and the current
 * auth session id. It is never `localStorage` (the brief forbids it), it
 * cannot be forged from the browser, and it dies with the session: signing
 * out clears it, and a cookie carried into a new session no longer verifies
 * because the session id changed.
 */

export const TIER2_COOKIE_NAME = "inherit_family_gate";

/** Context separation for the keyed digest (src/lib/crypto.ts). */
const TIER2_DIGEST_CONTEXT = "family-tier2-gate-v1";

/** The cookie value for one account in one auth session. */
export function tier2Digest(accountId: string, authSessionId: string): string {
  return hmacSecret(`${accountId}:${authSessionId}`, TIER2_DIGEST_CONTEXT);
}

/** Constant-time-ish equality on two hex digests of equal length. */
export function tier2CookieMatches(
  cookieValue: string | undefined,
  accountId: string,
  authSessionId: string,
): boolean {
  if (!cookieValue) return false;
  const expected = tier2Digest(accountId, authSessionId);
  if (cookieValue.length !== expected.length) return false;
  let difference = 0;
  for (let index = 0; index < expected.length; index++) {
    difference |= cookieValue.charCodeAt(index) ^ expected.charCodeAt(index);
  }
  return difference === 0;
}

/** The session id the access token carries, or null when it carries none. */
export function authSessionIdFromAccessToken(accessToken: string): string | null {
  try {
    const payload = JSON.parse(
      Buffer.from(accessToken.split(".")[1] ?? "", "base64url").toString("utf8"),
    ) as { session_id?: unknown };
    return typeof payload.session_id === "string" ? payload.session_id : null;
  } catch {
    return null;
  }
}

/** The cookie attributes the acknowledgement is written with, in one place. */
export function tier2CookieAttributes() {
  return {
    httpOnly: true,
    secure: true,
    sameSite: "lax" as const,
    path: "/",
  };
}

/**
 * Whether this session has acknowledged the gate. Read on the server before
 * any derived fetch: while it is false the page renders the gate and fetches
 * nothing about the other adult.
 */
export async function acknowledged(user: { id: string }): Promise<boolean> {
  const supabase = await createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) return false;
  const sessionId = authSessionIdFromAccessToken(session.access_token);
  if (!sessionId) return false;
  const store = await cookies();
  return tier2CookieMatches(store.get(TIER2_COOKIE_NAME)?.value, user.id, sessionId);
}
