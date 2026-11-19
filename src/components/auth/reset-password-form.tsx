"use client";

import { route } from "@/lib/primary-routes";
import { useRouter } from "next/navigation";
import { AuthForm } from "@/components/auth/auth-form";
import { authRefusal, postAuthEndpoint } from "@/components/auth/auth-endpoint";

/**
 * The `/auth/reset-password` form. It posts `{ password }` to
 * `/api/auth/reset-password` (auth.reset-password-submit) with the CSRF value
 * bound to this browser's reset session; the browser makes no auth-service
 * call of its own. A reset ends every session (owner decision 2026-10-16), so
 * success goes to sign-in, which says the password changed.
 */
export function ResetPasswordForm({ csrf }: { csrf: string }) {
  const router = useRouter();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="display">Choose a new password</h1>
      </div>
      <AuthForm
        fields={[
          {
            name: "password",
            label: "New password",
            type: "password",
            autoComplete: "new-password",
            minLength: 12,
          },
        ]}
        submitLabel="Update password"
        onSubmit={async ({ password }) => {
          const answer = await postAuthEndpoint("/api/auth/reset-password", csrf, { password });
          if (answer.status === 204) {
            router.push(route("auth.sign-in", { query: { notice: "password_changed" } }));
            router.refresh();
            return null;
          }
          return authRefusal(answer, true);
        }}
      />
    </div>
  );
}
