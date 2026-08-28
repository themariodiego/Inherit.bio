"use client";

import { useState } from "react";
import { AuthForm } from "@/components/auth/auth-form";
import { createClient } from "@/lib/supabase/client";

export default function ForgotPasswordPage() {
  const [sent, setSent] = useState(false);

  if (sent) {
    return (
      <div className="space-y-3 text-sm">
        <h1 className="display text-2xl">Check your email</h1>
        <p className="text-ink-muted">
          If that address has an account, a password-reset link is on its way.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="display text-2xl">Reset your password</h1>
        <p className="mt-1 text-sm text-ink-muted">
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
