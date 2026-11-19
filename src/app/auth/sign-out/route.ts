import { withAccountCsrf } from "@/lib/security/session-csrf";
import { createClient } from "@/lib/supabase/server";
import { signOutResponse } from "./response";

/**
 * `POST /auth/sign-out` (register auth.sign-out). The body is forbidden; the
 * request must come from this origin exactly and carry the one-time
 * `X-Inherit-CSRF` token the signed-in shell rendered for this session
 * (`requestContract.requiredHeader`). The scripted form in
 * `src/components/site/sign-out-form.tsx` sends both; anything else is the
 * 403 of authenticated-mutation-v1 and signs nobody out. The session ends
 * here, so no successor token is issued.
 *
 * `policy.scope` is `current-session-only`: the auth client's `local` scope
 * revokes this auth session and its refresh token and leaves the account's
 * other sessions alone. Its default, `global`, would end every one of them.
 */
export const POST = withAccountCsrf("auth.sign-out", async (request: Request) => {
  const supabase = await createClient();
  await supabase.auth.signOut({ scope: "local" });
  // sign-out-v1.sessionEffect: the session's cookies end here, the Tier-2
  // acknowledgements (Family and Embryos, brief §3 §7.2) among them, not on
  // the device (`signOutCookies` lists each one and why).
  return signOutResponse(new URL(request.url).origin, request);
}, { rotate: false, exactOrigin: true });
