import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./types";

// Service-role client. Server only — bypasses RLS. Every route using this
// must derive the target user from the authenticated session, never from
// request parameters.
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      "Server is missing SUPABASE_SERVICE_ROLE_KEY / NEXT_PUBLIC_SUPABASE_URL — set them in the hosting environment and redeploy (docs/deployment.md).",
    );
  }
  return createSupabaseClient<Database>(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
