"use client";

import { useRouter } from "next/navigation";
import { AuthForm } from "@/components/auth/auth-form";
import { createClient } from "@/lib/supabase/client";

export default function ResetPasswordPage() {
  const router = useRouter();

  return (
    <div className="space-y-5">
      <div>
        <h1 className="display text-2xl">Choose a new password</h1>
      </div>
      <AuthForm
        fields={[
          {
            name: "password",
            label: "New password",
            type: "password",
            autoComplete: "new-password",
            minLength: 8,
          },
        ]}
        submitLabel="Update password"
        onSubmit={async ({ password }) => {
          const supabase = createClient();
          const { error } = await supabase.auth.updateUser({ password });
          if (error) return error.message;
          router.push("/dashboard");
          router.refresh();
          return null;
        }}
      />
    </div>
  );
}
