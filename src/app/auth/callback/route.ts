import { NextResponse } from "next/server";
import type { SignInErrorCode, SignInStatusCode } from "@/copy/sign-in";
import { exchangePkceCode, type ExchangedSession } from "@/lib/auth/gotrue";
import { localAuthDestination } from "@/lib/auth/local-destination";
import { clearPkceCookie, readPkceFlow } from "@/lib/auth/pkce-state";
import { newResetSession } from "@/lib/auth/reset-session";
import { markIndependentLogin } from "@/lib/family/independent-login";
import { createAdminClient } from "@/lib/supabase/admin";
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
  // An empty fragment, on purpose. `/verify` puts its error text in the
  // fragment of the URL it redirects here, and a browser carries a fragment
  // over a redirect whose Location has none (RFC 9110, section 10.2.2), so
  // Supabase's wording would stay in the address bar of the sign-in page.
  target.hash = "#";
  return NextResponse.redirect(target);
}

/**
 * The flows this server starts itself (`/api/auth/sign-up` and
 * `/api/auth/forgot-password`) return with a `state` whose hash, PKCE
 * verifier, flow and destination only this browser's state cookie holds
 * (register auth.callback `policy.PKCE`, `src/lib/auth/pkce-state.ts`). The
 * code is exchanged once, with that exact verifier, only when the state
 * matches; the cookie is deleted on every answer.
 *
 * A sign-up confirmation becomes a signed-in session, as before. A recovery
 * code never does: it becomes a reset session that can change the password
 * and nothing else (authContracts.reset-session-api-v1), and the auth
 * session the exchange created is revoked by the database at once.
 */
async function completeStateFlow(request: Request, url: URL, code: string, state: string, signUp: boolean) {
  const flow = readPkceFlow(request, state);
  // No cookie, or another browser's: a confirmation link still confirmed the
  // address at `/verify` before it came here, so a sign-up says so.
  if (!flow) {
    return signUp
      ? toSignIn(url.origin, { notice: "email_confirmed", next: "/overview" })
      : toSignIn(url.origin, { error: "verification_failed" });
  }
  const exchanged = await exchangePkceCode(code, flow.verifier);
  if (!exchanged.ok) {
    if (flow.flow === "signup" && exchanged.code && LOST_FLOW_STATE.has(exchanged.code)) {
      return toSignIn(url.origin, { notice: "email_confirmed", next: flow.next });
    }
    return toSignIn(url.origin, { error: "verification_failed" });
  }
  return flow.flow === "signup"
    ? signedIn(url, exchanged.session, flow.next)
    : resetSession(url, exchanged.session, flow.next);
}

async function signedIn(url: URL, session: ExchangedSession, next: string) {
  const supabase = await createClient();
  const { error } = await supabase.auth.setSession({
    access_token: session.accessToken,
    refresh_token: session.refreshToken,
  });
  if (error) return toSignIn(url.origin, { error: "verification_failed" });
  await markIndependentLogin(session.userId);
  return NextResponse.redirect(new URL(next, url.origin));
}

async function resetSession(url: URL, session: ExchangedSession, next: string) {
  const reset = newResetSession();
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("issue_auth_recovery_session_v1", {
    p_session_hash: reset.sessionHash,
    p_account_id: session.userId,
    p_origin_session_id: session.sessionId,
  });
  if (error || data !== "issued") {
    // Nothing was issued; the exchanged session must not outlive this answer.
    await admin.auth.admin.signOut(session.accessToken, "local").catch(() => undefined);
    return toSignIn(url.origin, { error: "verification_failed" });
  }
  const response = NextResponse.redirect(new URL(next, url.origin));
  for (const value of reset.setCookies) response.headers.append("Set-Cookie", value);
  return response;
}

// Handles both PKCE code exchange (OAuth, magic links) and token_hash
// verification (email confirmation / recovery links).
export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (code && state !== null) {
    const response = await completeStateFlow(request, url, code, state, url.searchParams.get("flow") === SIGN_UP_FLOW);
    response.headers.append("Set-Cookie", clearPkceCookie());
    return response;
  }
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
