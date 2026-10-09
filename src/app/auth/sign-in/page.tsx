"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { AuthForm } from "@/components/auth/auth-form";
import { Button } from "@/components/ui/button";
import { signInMessage } from "@/copy/sign-in";
import { createClient } from "@/lib/supabase/client";
import { localAuthDestination } from "@/lib/auth/local-destination";

function SignInInner() {
  const router = useRouter();
  const params = useSearchParams();
  const next = localAuthDestination(params.get("next"));
  // A fixed code set by the auth callback; unknown values show nothing.
  const message = signInMessage(params);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="display">Welcome back</h1>
      </div>
      {message ? (
        <p
          role={message.role}
          className={`auth-note ${
            message.role === "alert" ? "text-danger" : "text-ink"
          }`}
        >
          {message.text}
        </p>
      ) : null}
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
      <div className="flex flex-col items-center gap-1 border-t border-line pt-4 text-center text-sm text-ink-muted">
        <p>
          <Link href="/auth/forgot-password" className="link-target quiet-link">
            Forgot your password?
          </Link>
        </p>
        <p className="py-2">
          New here?{" "}
          <Link href="/auth/sign-up" className="quiet-link">
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
