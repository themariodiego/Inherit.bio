import "server-only";

import { cookies } from "next/headers";
import { hmacSecret } from "@/lib/crypto";
import { currentAuthSessionId } from "@/lib/family/tier2";

/**
 * The Tier-2 gate of the Embryo domain (design §1.5; brief line 968-970).
 * "Any embryo comparison" sits behind one explicit, session-scoped
 * acknowledgement at the domain boundary: a reader passes exactly one gate
 * per session across compare → detail → compare.
 *
 * The memory is the same mechanism Family uses — an httpOnly, Secure,
 * SameSite=Lax session cookie with no Max-Age whose value is a keyed digest
 * of the account id and the current auth session id — under its own cookie
 * and its own digest context, so an acknowledgement on one boundary never
 * silently opens the other (decisions.md, W10). It is never `localStorage`,
 * cannot be forged from the browser, and dies with the session: a cookie
 * carried into a new session no longer verifies because the session id
 * changed, whether or not sign-out cleared it.
 */

export const TIER2_EMBRYO_COOKIE_NAME = "inherit_embryo_gate";

/** Context separation for the keyed digest (src/lib/crypto.ts); distinct from Family's. */
const TIER2_EMBRYO_DIGEST_CONTEXT = "embryo-tier2-gate-v1";

export { currentAuthSessionId, tier2CookieAttributes } from "@/lib/family/tier2";

/** The cookie value for one account in one auth session. */
export function tier2Digest(accountId: string, authSessionId: string): string {
  return hmacSecret(`${accountId}:${authSessionId}`, TIER2_EMBRYO_DIGEST_CONTEXT);
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

/**
 * Whether this session has acknowledged the embryo gate. Read on the server
 * before any derived fetch: while it is false the page renders the gate and
 * fetches nothing derived about any embryo.
 */
export async function acknowledged(user: { id: string }): Promise<boolean> {
  const sessionId = await currentAuthSessionId();
  if (!sessionId) return false;
  const store = await cookies();
  return tier2CookieMatches(store.get(TIER2_EMBRYO_COOKIE_NAME)?.value, user.id, sessionId);
}
