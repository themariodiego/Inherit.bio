import { afterFloor, authInvalidRequest, authJson } from "@/lib/auth/auth-response";
import { signUpWithAuthService } from "@/lib/auth/gotrue";
import { newPkceFlow, PKCE_DESTINATIONS } from "@/lib/auth/pkce-state";
import { admitPublicAuthRequest } from "@/lib/auth/public-auth-request";

/**
 * `POST /api/auth/sign-up` (register auth.sign-up-submit), the one way an
 * account is created.
 *
 * The body is `{ email, password }`, nothing else (owner decision
 * 2026-10-16: where a person lives is declared at first sign-in and the date
 * of birth at account completion, as before). The auth service creates the
 * user; its insert trigger (`public.handle_new_user`) creates the profile and
 * the one self subject in the same transaction, so there is nothing to
 * compensate here and nothing is written for an address that already has an
 * account.
 *
 * Every answer after validation is signup-v1, 202 `{"status":"check_your_email"}`
 * with the same cookie and no sooner than the same floor: a new address, an
 * existing confirmed or unconfirmed one, a limited request (5 an hour per
 * email, 20 per network) and an auth-service outage look alike. Only a
 * password or address the auth service refuses on its own terms, which no
 * identity changes, is invalid-request-v1.
 *
 * The confirmation link returns through `/auth/callback` with a PKCE state
 * this browser's cookie holds the hash of. `flow=signup` stays in that link so
 * a link opened in another browser can still say the email is confirmed.
 */

const SIGN_UP_RECEIVED = { status: "check_your_email" } as const;

export async function POST(request: Request) {
  const startedAt = performance.now();
  const admission = await admitPublicAuthRequest(request, "auth-sign-up", "auth.sign-up-submit", ["email", "password"] as const);
  if (admission.kind === "refused") return admission.response;

  const flow = newPkceFlow("signup");
  if (admission.kind === "admitted") {
    // The same return address as before, plus the state (base64url, no escaping needed).
    const redirectTo = `${new URL(request.url).origin}/auth/callback?next=${PKCE_DESTINATIONS.signup}&flow=signup&state=${flow.state}`;
    const outcome = await signUpWithAuthService({
      email: admission.value.email,
      password: admission.value.password,
      redirectTo,
      codeChallenge: flow.codeChallenge,
    });
    if (outcome === "weak_password") return authInvalidRequest(["password"]);
    if (outcome === "email_invalid") return authInvalidRequest(["email"]);
  }
  await afterFloor(startedAt);
  return authJson(SIGN_UP_RECEIVED, 202, [flow.setCookie]);
}
