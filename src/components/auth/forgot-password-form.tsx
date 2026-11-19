"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { AuthForm } from "@/components/auth/auth-form";
import { authRefusal, postAuthEndpoint } from "@/components/auth/auth-endpoint";

/**
 * The `/auth/forgot-password` form. It posts `{ email }` to
 * `/api/auth/forgot-password` (auth.forgot-password-submit) with the form
 * token this render was served; the browser makes no auth-service call of its
 * own. The answer never says whether the address has an account, and neither
 * does this page.
 */
export function ForgotPasswordForm({ formToken }: { formToken: string }) {
  const router = useRouter();
  const [sent, setSent] = useState(false);

  if (sent) {
    return (
      <div className="space-y-4">
        <h1 className="display">Check your email</h1>
        <p className="max-w-measure text-ink">
          If that address has an account, a password-reset link is on its way.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="display">Reset your password</h1>
        <p className="mt-3 text-sm text-ink-muted">
          We&apos;ll email you a reset link.
        </p>
      </div>
      <AuthForm
        fields={[
          { name: "email", label: "Email", type: "email", autoComplete: "email" },
        ]}
        submitLabel="Send reset link"
        onSubmit={async ({ email }) => {
          const answer = await postAuthEndpoint("/api/auth/forgot-password", formToken, { email });
          if (answer.status === 202) {
            setSent(true);
            return null;
          }
          router.refresh();
          return authRefusal(answer);
        }}
      />
    </div>
  );
}
