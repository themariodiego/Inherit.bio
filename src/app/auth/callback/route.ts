import { NextResponse } from "next/server";
import { markIndependentLogin } from "@/lib/family/independent-login";
import { createClient } from "@/lib/supabase/server";
import type { EmailOtpType } from "@supabase/supabase-js";

// Handles both PKCE code exchange (OAuth, magic links) and token_hash
// verification (email confirmation / recovery links).
export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type") as EmailOtpType | null;
  const next = url.searchParams.get("next") ?? "/overview";
  const safeNext = next.startsWith("/") ? next : "/overview";

  const supabase = await createClient();

  // After a successful exchange and before the redirect, the ordinary
  // sign-in stamps the independent-login marker (register auth.callback
  // `independentLoginMarker`). The routine itself proves the session is not
  // the one an invitation was accepted in, and is a no-op thereafter.
  const completed = async () => {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (user) await markIndependentLogin(user.id);
    return NextResponse.redirect(new URL(safeNext, url.origin));
  };

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return completed();
  } else if (tokenHash && type) {
    const { error } = await supabase.auth.verifyOtp({
      type,
      token_hash: tokenHash,
    });
    if (!error) return completed();
  }

  return NextResponse.redirect(
    new URL("/auth/sign-in?error=verification_failed", url.origin),
  );
}
