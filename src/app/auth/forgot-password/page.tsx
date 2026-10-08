"use client";

import { useState } from "react";
import { AuthForm } from "@/components/auth/auth-form";
import { createClient } from "@/lib/supabase/client";

export default function ForgotPasswordPage() {
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
          const supabase = createClient();
          const { error } = await supabase.auth.resetPasswordForEmail(email, {
            redirectTo: `${window.location.origin}/auth/callback?next=/auth/reset-password`,
          });
          if (error) return error.message;
          setSent(true);
          return null;
        }}
      />
    </div>
  );
}
