import "server-only";

import { getSensitiveAccountContextFromClient, type SensitiveAccountContext } from "@/lib/account-deletion";
import { pageAuth } from "@/lib/supabase/auth-check";
import { createClient } from "@/lib/supabase/server";

/**
 * `getSensitiveAccountContext()` for a page: the same account and auth
 * session, read by the same shared resolver, except that a sign-in check that
 * failed for a moment twice throws `AuthServiceUnavailableError` (the page's
 * error boundary renders the error surface) instead of reading as no account
 * (owner decision 2026-11-19, D-142). Route handlers and the CSRF gate keep
 * `getSensitiveAccountContext()` unchanged.
 */
export async function getPageAccountContext(): Promise<SensitiveAccountContext | null> {
  const supabase = await createClient();
  return getSensitiveAccountContextFromClient({ auth: pageAuth(supabase.auth) });
}
