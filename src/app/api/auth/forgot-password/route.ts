import { afterFloor, authJson } from "@/lib/auth/auth-response";
import { sendRecoveryLink } from "@/lib/auth/gotrue";
import { newPkceFlow } from "@/lib/auth/pkce-state";
import { admitPublicAuthRequest } from "@/lib/auth/public-auth-request";

/**
 * `POST /api/auth/forgot-password` (register auth.forgot-password-submit).
 *
 * The body is `{ email }`. After the form and body checks, every request gets
 * auth-opaque-request-v1, 202 `{"status":"check_your_email"}`, with the same
 * cookie and no sooner than the same floor, whether the address has an
 * account, has none, is disabled, or is limited (3 an hour per email, 10 per
 * network): the recovery call's own answer is never read
 * (`policy.enumeration`).
 *
 * The link returns through `/auth/callback` with a PKCE state whose hash and
 * verifier only this browser's cookie holds. There the callback turns a
 * recovery code into a reset session, never into a signed-in session, and no
 * token is ever put in an Inherit URL (`policy.delivery`).
 */

const RECOVERY_REQUESTED = { status: "check_your_email" } as const;

export async function POST(request: Request) {
  const startedAt = performance.now();
  const admission = await admitPublicAuthRequest(request, "auth-forgot-password", "auth.forgot-password-submit", ["email"] as const);
  if (admission.kind === "refused") return admission.response;

  const flow = newPkceFlow("recovery");
  if (admission.kind === "admitted") {
    await sendRecoveryLink({
      email: admission.value.email,
      redirectTo: `${new URL(request.url).origin}/auth/callback?state=${flow.state}`,
      codeChallenge: flow.codeChallenge,
    });
  }
  await afterFloor(startedAt);
  return authJson(RECOVERY_REQUESTED, 202, [flow.setCookie]);
}
