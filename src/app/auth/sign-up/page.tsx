import { headers } from "next/headers";
import { SignUpForm } from "@/components/auth/sign-up-form";
import { AUTH_FORM_TOKEN_HEADER } from "@/lib/auth/auth-form";

/**
 * `/auth/sign-up` (register auth.sign-up). The proxy minted this render's
 * one-time form token and set the cookie it is bound to
 * (`src/lib/auth/auth-form.ts`); the form posts it to `/api/auth/sign-up`.
 */
export default async function SignUpPage() {
  const formToken = (await headers()).get(AUTH_FORM_TOKEN_HEADER) ?? "";
  return <SignUpForm formToken={formToken} />;
}
