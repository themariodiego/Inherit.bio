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
 */
export const POST = withAccountCsrf("auth.sign-out", async (request: Request) => {
  const supabase = await createClient();
  await supabase.auth.signOut();
  // The Tier-2 acknowledgements (Family and Embryos) last exactly one
  // signed-in session (brief §3 §7.2): signing out ends both here, not on
  // the device.
  return signOutResponse(new URL(request.url).origin);
}, { rotate: false, exactOrigin: true });
