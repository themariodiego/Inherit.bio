"use client";

import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function InviteAdultForm() {
  const requestId = useRef(crypto.randomUUID());
  const [pending, setPending] = useState(false);
  const [complete, setComplete] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (complete) {
    return (
      <div role="status" className="rounded-2xl border border-line bg-card p-6">
        <h2 className="font-medium">Invitation requested</h2>
        <p className="mt-3 text-sm leading-relaxed text-ink-muted">
          If the address can receive an invitation, Inherit will send one. We
          do not reveal whether an address has refused invitations.
        </p>
      </div>
    );
  }

  return (
    <form
      className="space-y-5 rounded-2xl border border-line bg-card p-6"
      onSubmit={async (event) => {
        event.preventDefault();
        setPending(true);
        setError(null);
        const data = new FormData(event.currentTarget);
        const response = await fetch("/api/subject-drafts", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            kind: "other_adult",
            adultFlow: "path-a-own-account",
            email: String(data.get("email") ?? ""),
            adultAttestation: data.get("adultAttestation") === "on",
            requestId: requestId.current,
          }),
        });
        setPending(false);
        if (!response.ok) {
          setError(
            response.status === 409
              ? "This invitation is not available in your jurisdiction."
              : "The invitation could not be requested.",
          );
          return;
        }
        setComplete(true);
      }}
    >
      <div className="space-y-2">
        <Label htmlFor="adult-email">Their email address</Label>
        <Input id="adult-email" name="email" type="email" autoComplete="email" required />
      </div>
      <label className="flex items-start gap-3 text-sm leading-relaxed">
        <input type="checkbox" name="adultAttestation" required className="mt-1 size-4" />
        <span>
          I am at least 18. I know this invitation gives me no right to upload,
          analyse, or read the other person&apos;s genetic data.
        </span>
      </label>
      {error ? <p role="alert" className="text-sm text-danger">{error}</p> : null}
      <Button type="submit" disabled={pending}>
        {pending ? "Requesting…" : "Send invitation"}
      </Button>
    </form>
  );
}
