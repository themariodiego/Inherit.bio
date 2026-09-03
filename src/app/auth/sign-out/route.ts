import { NextResponse } from "next/server";
import { TIER2_COOKIE_NAME } from "@/lib/family/tier2";
import { createClient } from "@/lib/supabase/server";

export async function POST(request: Request) {
  const supabase = await createClient();
  await supabase.auth.signOut();
  const response = NextResponse.redirect(new URL("/", new URL(request.url).origin), {
    status: 303,
  });
  // The Tier-2 acknowledgement lasts exactly one signed-in session
  // (brief §3 §7.2): signing out ends it here, not on the device.
  response.cookies.delete(TIER2_COOKIE_NAME);
  return response;
}
