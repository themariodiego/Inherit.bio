"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { DeletionControlState } from "@/lib/account-deletion-state";

const errorCopy: Record<string, string> = {
  recent_reauthentication_required:
    "For security, sign out and sign in again before changing deletion status.",
  mfa_required: "Complete multi-factor authentication before continuing.",
  invalid_operation_nonce: "This confirmation expired. Please try again.",
  deletion_request_exists: "A deletion request is already active.",
  deletion_request_not_cancellable:
    "The notice period has ended and deletion can no longer be cancelled.",
};

/**
 * The page renders the deletion state and the one-time operation nonce
 * (brief X1.5), so this component fetches nothing to start. After each POST
 * it asks the page to render again, which brings the new state and a fresh
 * nonce; nothing here stores or rotates one.
 */
export function DangerZone({ deletion }: { deletion: DeletionControlState | null }) {
  const router = useRouter();
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(
    deletion ? null : "Account deletion controls are unavailable.",
  );

  async function submit(
    path: string,
    confirmation: string,
    succeeded: (body: { status?: string; noticeEndsAt?: string } | null) => boolean,
    failure: string,
  ) {
    if (!deletion) return;
    setBusy(true);
    setError(null);
    const response = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ confirmation, nonce: deletion.operationNonce }),
    });
    const body = (await response.json().catch(() => null)) as
      | { status?: string; noticeEndsAt?: string; error?: string }
      | null;
    if (!response.ok || !succeeded(body)) {
      const code = body?.error ?? "account_deletion_failed";
      setError(errorCopy[code] ?? failure);
    } else {
      setConfirm("");
    }
    setBusy(false);
    router.refresh();
  }

  function requestDeletion() {
    if (deletion?.status !== "active") return;
    void submit(
      "/api/account/delete",
      "account.delete.confirmation",
      (body) => body?.status === "notice_period" && Boolean(body.noticeEndsAt),
      "The deletion request could not be scheduled.",
    );
  }

  function cancelDeletion() {
    if (deletion?.status !== "notice_period") return;
    void submit(
      "/api/account/delete/cancel",
      "account.delete.cancel-confirmation",
      (body) => body?.status === "active",
      "The deletion request could not be cancelled.",
    );
  }

  if (deletion?.status === "notice_period") {
    const deadline = new Intl.DateTimeFormat(undefined, {
      dateStyle: "long",
      timeStyle: "short",
    }).format(new Date(deletion.noticeEndsAt));
    return (
      <div className="surface rec-danger surface-pad rec-stack">
        <h3 className="title">Account deletion scheduled</h3>
        <p className="max-w-measure text-sm leading-relaxed text-ink-muted">
          Your account is scheduled for deletion on {deadline}. No physical
          deletion begins before then. You can still export your data, revoke
          consent, transfer eligible ownership, or cancel this request.
        </p>
        {error ? <p role="alert" className="text-sm text-danger">{error}</p> : null}
        <div>
          <Button
            variant="outline"
            disabled={busy}
            data-testid="cancel-account-deletion"
            onClick={cancelDeletion}
          >
            {busy ? "Cancelling…" : "Cancel deletion request"}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="surface rec-danger surface-pad rec-stack">
      <h3 className="title">Delete account</h3>
      <p className="max-w-measure text-sm leading-relaxed text-ink-muted">
        Your account, files, results, and chats will be deleted after seven
        days. You may export your data or cancel before then. Records required
        by law stay only without your name or account link, for their required
        time.
      </p>
      <div className="rec-field">
        <Label htmlFor="delete-confirm">
          Type <strong>delete my genome</strong> to confirm
        </Label>
        <Input
          id="delete-confirm"
          value={confirm}
          onChange={(event) => setConfirm(event.target.value)}
          autoComplete="off"
        />
      </div>
      {error ? <p role="alert" className="text-sm text-danger">{error}</p> : null}
      <div>
        <Button
          variant="destructive"
          disabled={confirm !== "delete my genome" || busy || !deletion}
          data-testid="delete-account"
          onClick={requestDeletion}
        >
          {busy ? "Scheduling…" : "Schedule account deletion"}
        </Button>
      </div>
    </div>
  );
}
