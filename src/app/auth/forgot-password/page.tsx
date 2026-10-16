import { headers } from "next/headers";
import { ForgotPasswordForm } from "@/components/auth/forgot-password-form";
import { AUTH_FORM_TOKEN_HEADER } from "@/lib/auth/auth-form";

/**
 * `/auth/forgot-password` (register auth.forgot-password). The proxy minted
 * this render's one-time form token and set the cookie it is bound to
 * (`src/lib/auth/auth-form.ts`); the form posts it to
 * `/api/auth/forgot-password`.
 */
export default async function ForgotPasswordPage() {
  const formToken = (await headers()).get(AUTH_FORM_TOKEN_HEADER) ?? "";
  return <ForgotPasswordForm formToken={formToken} />;
}
