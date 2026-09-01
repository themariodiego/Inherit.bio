"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { AuthForm } from "@/components/auth/auth-form";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";

function SignInInner() {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get("next") ?? "/overview";

  return (
    <div className="space-y-5">
      <div>
        <h1 className="display text-2xl">Welcome back</h1>
      </div>
      <AuthForm
        fields={[
          { name: "email", label: "Email", type: "email", autoComplete: "email" },
          {
            name: "password",
            label: "Password",
            type: "password",
            autoComplete: "current-password",
          },
        ]}
        submitLabel="Sign in"
        onSubmit={async ({ email, password }) => {
          const supabase = createClient();
          const { error } = await supabase.auth.signInWithPassword({
            email,
            password,
          });
          if (error) return error.message;
          router.push(next);
          router.refresh();
          return null;
        }}
      />
      <Button
        variant="outline"
        className="w-full"
        onClick={async () => {
          const supabase = createClient();
          await supabase.auth.signInWithOAuth({
            provider: "github",
            options: {
              redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`,
            },
          });
        }}
      >
        Continue with GitHub
      </Button>
      <div className="space-y-2 text-center text-sm text-ink-muted">
        <p>
          <Link
            href="/auth/forgot-password"
            className="underline underline-offset-2"
          >
            Forgot your password?
          </Link>
        </p>
        <p>
          New here?{" "}
          <Link
            href="/auth/sign-up"
            className="text-forest underline underline-offset-2"
          >
            Create an account
          </Link>
        </p>
      </div>
    </div>
  );
}

export default function SignInPage() {
  return (
    <Suspense>
      <SignInInner />
    </Suspense>
  );
}
