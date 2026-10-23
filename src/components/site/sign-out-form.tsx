"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useCsrf } from "@/components/security/csrf-provider";
import { Button } from "@/components/ui/button";
import { route } from "@/lib/primary-routes";

/**
 * Sign-out (register auth.sign-out). A native form cannot send the one-time
 * `X-Inherit-CSRF` token the route requires, so this one is submitted by
 * script: an empty POST from this origin with the token the shell rendered.
 * The 303 of sign-out-v1 is not followed; the browser goes to sign-in itself.
 * A refused request signs nobody out, so the page fetches fresh tokens and
 * the button can be pressed again.
 */
export function SignOutForm() {
  const router = useRouter();
  const csrf = useCsrf("auth.sign-out");
  const [pending, setPending] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    try {
      const response = await fetch("/auth/sign-out", {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
        redirect: "manual",
        headers: { "X-Inherit-CSRF": csrf.value() },
      });
      if (response.type === "opaqueredirect" || response.status === 303) {
        window.location.assign(route("auth.sign-in"));
        return;
      }
      router.refresh();
    } catch {
      // Nothing was confirmed; the session may still be live.
    }
    setPending(false);
  }

  return (
    <form onSubmit={submit}>
      <Button variant="outline" size="sm" type="submit" disabled={pending}>
        Sign out
      </Button>
    </form>
  );
}
