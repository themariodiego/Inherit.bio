"use client";

import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  ATTESTATION_LABEL,
  BLOCKED_HERE_STATUS,
  EMAIL_LABEL,
  INVITE_THEM_BODY,
  INVITE_THEM_HEADING,
  NOTE_HINT,
  NOTE_LABEL,
  REQUESTED_BODY,
  REQUESTED_HEADING,
  REQUEST_FAILED_STATUS,
  SENDING_BUTTON,
  SEND_BUTTON,
} from "@/copy/family/invite";

/**
 * Path A, the only path that exists (brief §5 §5.2): an address, an optional
 * note and one attestation. The invited person accepts in their own account,
 * adds their own file and grants from their side; nothing here touches their
 * data. The secondary Path B link is not rendered, because Path B has no
 * screen to link to.
 */
export function InviteAdultForm() {
  const requestId = useRef(crypto.randomUUID());
  const [pending, setPending] = useState(false);
  const [complete, setComplete] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (complete) {
    return (
      <div role="status" className="rounded-2xl border border-line bg-card p-6">
        <h2 className="font-medium">{REQUESTED_HEADING}</h2>
        <p className="mt-3 text-sm leading-relaxed text-ink-muted">{REQUESTED_BODY}</p>
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
        const note = String(data.get("note") ?? "").trim();
        const response = await fetch("/api/subject-drafts", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            kind: "other_adult",
            adultFlow: "path-a-own-account",
            email: String(data.get("email") ?? ""),
            adultAttestation: data.get("adultAttestation") === "on",
            requestId: requestId.current,
            ...(note.length > 0 ? { note } : {}),
          }),
        });
        setPending(false);
        if (!response.ok) {
          setError(response.status === 409 ? BLOCKED_HERE_STATUS : REQUEST_FAILED_STATUS);
          return;
        }
        setComplete(true);
      }}
    >
      <div className="space-y-2">
        <h2 className="font-medium">{INVITE_THEM_HEADING}</h2>
        <p className="text-sm leading-relaxed text-ink-muted">{INVITE_THEM_BODY}</p>
      </div>
      <div className="space-y-2">
        <Label htmlFor="adult-email">{EMAIL_LABEL}</Label>
        <Input id="adult-email" name="email" type="email" autoComplete="email" required />
      </div>
      <div className="space-y-2">
        <Label htmlFor="adult-note">{NOTE_LABEL}</Label>
        <Textarea id="adult-note" name="note" rows={3} maxLength={500} />
        <p className="text-sm text-ink-muted">{NOTE_HINT}</p>
      </div>
      <label className="flex items-start gap-3 text-sm leading-relaxed">
        <input type="checkbox" name="adultAttestation" required className="mt-1 size-4" />
        <span>{ATTESTATION_LABEL}</span>
      </label>
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
      <Button type="submit" disabled={pending}>
        {pending ? SENDING_BUTTON : SEND_BUTTON}
      </Button>
    </form>
  );
}
