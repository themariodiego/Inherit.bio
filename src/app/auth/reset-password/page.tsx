import { cookies } from "next/headers";
import { ResetPasswordForm } from "@/components/auth/reset-password-form";
import { RESET_CSRF_COOKIE } from "@/lib/auth/auth-cookies";
import { presentedResetCsrf } from "@/lib/auth/reset-session";

/**
 * `/auth/reset-password` (register auth.reset-password). A recovery link
 * reaches it through the callback, which set this browser's reset session
 * and the CSRF value bound to it (`src/lib/auth/reset-session.ts`). The page
 * reads only that value; without a reset session the form still renders and
 * its POST is refused as a spent link.
 */
export default async function ResetPasswordPage() {
  const csrf = presentedResetCsrf((await cookies()).get(RESET_CSRF_COOKIE)?.value);
  return <ResetPasswordForm csrf={csrf} />;
}
