import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { currentAuthSessionId } from "./tier2";

/**
 * The independent-login marker (docs/route-register.json auth.callback
 * `independentLoginMarker`; docs/schema-requirements.md). The grant routine
 * refuses `family.heritability` and `family.portrait` while the data
 * subject's `independent_login_at` is null: a Portrait grant must come from
 * a session the invitee opened on their own, never from the session the
 * invitation was accepted in, so an inviter who set up the account through
 * the invitation link cannot sign both columns.
 *
 * The proof lives in the routine, not here. `mark_independent_login_v1`
 * stamps this account's subjects only from a server-verified session that
 * post-dates every adult-subject invitation this account accepted, once, and
 * every later call is a no-op. This helper therefore runs wherever a signed-in
 * request reaches the server — the callback exchange, and the permissions
 * page before it decides whether the Portrait row is settable — because a
 * password sign-in completes in the browser and passes through no server
 * route of its own.
 *
 * Returns how many subjects were stamped: 0 when nothing changed, including
 * when the database does not know the session (42501), which no page
 * surfaces as an error.
 */
export async function markIndependentLogin(accountId: string): Promise<number> {
  const sessionId = await currentAuthSessionId();
  if (!sessionId) return 0;
  const { data, error } = await createAdminClient().rpc("mark_independent_login_v1", {
    p_account_id: accountId,
    p_auth_session_id: sessionId,
  });
  if (error || typeof data !== "number") return 0;
  return data;
}
