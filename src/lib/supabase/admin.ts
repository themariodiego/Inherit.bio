import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./types";

// Service-role client. Server only — bypasses RLS. Every route using this
// must derive the target user from the authenticated session, never from
// request parameters.
export function createAdminClient() {
  return createSupabaseClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}
