import { createClient } from "@/lib/supabase/server";
import { signOutResponse } from "./response";

export async function POST(request: Request) {
  const supabase = await createClient();
  await supabase.auth.signOut();
  // The Tier-2 acknowledgements (Family and Embryos) last exactly one
  // signed-in session (brief §3 §7.2): signing out ends both here, not on
  // the device.
  return signOutResponse(new URL(request.url).origin);
}
