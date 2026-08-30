"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { AuthForm } from "@/components/auth/auth-form";
import { createClient } from "@/lib/supabase/client";

export default function SignUpPage() {
  const router = useRouter();
  const [sent, setSent] = useState<string | null>(null);

  if (sent) {
    return (
      <div className="space-y-3 text-sm">
        <h1 className="display text-2xl">Check your email</h1>
        <p className="text-ink-muted">
          We sent a verification link to <strong>{sent}</strong>. Open it to
          activate your account.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="display text-2xl">Create your account</h1>
        <p className="mt-1 text-sm text-ink-muted">
          Inherit is for adults (18+), and only for your own DNA — you
          can&rsquo;t upload a child&rsquo;s or relative&rsquo;s file (
          <Link
            href="/terms#eligibility"
            className="underline underline-offset-2"
          >
            why?
          </Link>
          ). Your data stays yours.
        </p>
      </div>
      <AuthForm
        fields={[
          { name: "email", label: "Email", type: "email", autoComplete: "email" },
          {
            name: "password",
            label: "Password",
            type: "password",
            autoComplete: "new-password",
            minLength: 8,
          },
        ]}
        submitLabel="Sign up"
        onSubmit={async ({ email, password }) => {
          const supabase = createClient();
          const { data, error } = await supabase.auth.signUp({
            email,
            password,
            options: {
              emailRedirectTo: `${window.location.origin}/auth/callback?next=/dashboard`,
            },
          });
          if (error) return error.message;
          if (data.session) {
            router.push("/dashboard");
            router.refresh();
            return null;
          }
          setSent(email);
          return null;
        }}
      />
      <p className="text-center text-xs text-ink-muted">
        By creating an account you agree to the{" "}
        <Link href="/terms" className="underline underline-offset-2">
          Terms
        </Link>{" "}
        and{" "}
        <Link href="/privacy" className="underline underline-offset-2">
          Privacy Policy
        </Link>
        .
      </p>
      <p className="text-center text-sm text-ink-muted">
        Already have an account?{" "}
        <Link href="/auth/sign-in" className="text-forest underline underline-offset-2">
          Sign in
        </Link>
      </p>
    </div>
  );
}
