import { NextResponse } from "next/server";
import type { SignInErrorCode, SignInStatusCode } from "@/copy/sign-in";
import { localAuthDestination } from "@/lib/auth/local-destination";
import { markIndependentLogin } from "@/lib/family/independent-login";
import { createClient } from "@/lib/supabase/server";
import type { EmailOtpType } from "@supabase/supabase-js";

// The sign-up page marks its confirmation link with `flow=signup`, so its
// failures can be told apart from GitHub sign-in and password reset.
const SIGN_UP_FLOW = "signup";

// Exchange failures that only mean this browser no longer holds its half of
// the PKCE flow: the flow state expired, or the link was opened in another
// browser or on another device, so the verifier is missing or belongs to a
// newer flow. Supabase Auth's `/token` returns the first three; auth-js
// raises the last itself, before any request, when no verifier is stored.
const LOST_FLOW_STATE = new Set([
  "flow_state_expired",
  "flow_state_not_found",
  "bad_code_verifier",
  "pkce_code_verifier_not_found",
]);

// Only a fixed code goes into the query; the sign-in page looks its sentence
// up in `src/copy/sign-in.ts`. Supabase's error text is never passed on.
function toSignIn(
  origin: string,
  query: { error: SignInErrorCode } | { notice: SignInStatusCode; next: string },
) {
  const target = new URL("/auth/sign-in", origin);
  for (const [name, value] of Object.entries(query)) target.searchParams.set(name, value);
  return NextResponse.redirect(target);
}

// Handles both PKCE code exchange (OAuth, magic links) and token_hash
// verification (email confirmation / recovery links).
export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type") as EmailOtpType | null;
  const safeNext = localAuthDestination(url.searchParams.get("next"));
  const signUp = url.searchParams.get("flow") === SIGN_UP_FLOW;

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

  let failure: SignInErrorCode = "verification_failed";
  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return completed();
    // Supabase sends a sign-up link here with a code only after `/verify`
    // has confirmed the address, so a lost flow state costs the session, not
    // the confirmation. A password sign-in works, and the page says so.
    if (signUp && error.code && LOST_FLOW_STATE.has(error.code)) {
      return toSignIn(url.origin, { notice: "email_confirmed", next: safeNext });
    }
  } else if (tokenHash && type) {
    const { error } = await supabase.auth.verifyOtp({
      type,
      token_hash: tokenHash,
    });
    if (!error) return completed();
  } else if (url.searchParams.get("error_code") === "otp_expired") {
    // `/verify` refused a used or expired email link and redirected here
    // with error parameters in place of a code.
    failure = "link_expired";
  }

  return toSignIn(url.origin, { error: failure });
}
