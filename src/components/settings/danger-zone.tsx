"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface ActiveState {
  status: "active";
  operationNonce: string;
}

interface NoticeState {
  status: "notice_period";
  noticeEndsAt: string;
  operationNonce: string;
}

type DeletionState = ActiveState | NoticeState;

interface LoadedState {
  state: DeletionState | null;
  error: string | null;
}

const errorCopy: Record<string, string> = {
  recent_reauthentication_required:
    "For security, sign out and sign in again before changing deletion status.",
  mfa_required: "Complete multi-factor authentication before continuing.",
  invalid_operation_nonce: "This confirmation expired. Please try again.",
  deletion_request_exists: "A deletion request is already active.",
  deletion_request_not_cancellable:
    "The notice period has ended and deletion can no longer be cancelled.",
};

async function fetchDeletionState(): Promise<LoadedState> {
  const response = await fetch("/api/account/delete", {
    cache: "no-store",
    headers: { Accept: "application/json" },
  });
  const body = (await response.json().catch(() => null)) as
    | (DeletionState & { error?: string })
    | null;
  if (!response.ok || !body) {
    const code = body?.error ?? "account_deletion_failed";
    return {
      state: null,
      error: errorCopy[code] ?? "Account deletion controls are unavailable.",
    };
  }
  return { state: body, error: null };
}

export function DangerZone() {
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [state, setState] = useState<DeletionState | null>(null);

  useEffect(() => {
    let ignore = false;
    void fetchDeletionState().then((loaded) => {
      if (ignore) return;
      setState(loaded.state);
      setError(loaded.error);
    });
    return () => {
      ignore = true;
    };
  }, []);

  async function refresh() {
    const loaded = await fetchDeletionState();
    setState(loaded.state);
    setError(loaded.error);
  }

  async function requestDeletion() {
    if (!state || state.status !== "active") return;
    setBusy(true);
    setError(null);
    const response = await fetch("/api/account/delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        confirmation: "account.delete.confirmation",
        nonce: state.operationNonce,
      }),
    });
    const body = (await response.json().catch(() => null)) as
      | { status?: string; noticeEndsAt?: string; error?: string }
      | null;
    if (!response.ok || body?.status !== "notice_period" || !body.noticeEndsAt) {
      const code = body?.error ?? "account_deletion_failed";
      setError(errorCopy[code] ?? "The deletion request could not be scheduled.");
      setBusy(false);
      await refresh();
      return;
    }
    setConfirm("");
    setBusy(false);
    await refresh();
  }

  async function cancelDeletion() {
    if (!state || state.status !== "notice_period") return;
    setBusy(true);
    setError(null);
    const response = await fetch("/api/account/delete/cancel", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        confirmation: "account.delete.cancel-confirmation",
        nonce: state.operationNonce,
      }),
    });
    const body = (await response.json().catch(() => null)) as
      | { status?: string; error?: string }
      | null;
    if (!response.ok || body?.status !== "active") {
      const code = body?.error ?? "account_deletion_failed";
      setError(errorCopy[code] ?? "The deletion request could not be cancelled.");
      setBusy(false);
      await refresh();
      return;
    }
    setBusy(false);
    await refresh();
  }

  if (state?.status === "notice_period") {
    const deadline = new Intl.DateTimeFormat(undefined, {
      dateStyle: "long",
      timeStyle: "short",
    }).format(new Date(state.noticeEndsAt));
    return (
      <div className="space-y-3 rounded-2xl border border-danger/40 p-5">
        <h3 className="font-medium">Account deletion scheduled</h3>
        <p className="text-sm leading-relaxed text-ink-muted">
          Your account is scheduled for deletion on {deadline}. No physical
          deletion begins before then. You can still export your data, revoke
          consent, transfer eligible ownership, or cancel this request.
        </p>
        {error ? <p role="alert" className="text-sm text-danger">{error}</p> : null}
        <Button
          variant="outline"
          disabled={busy}
          data-testid="cancel-account-deletion"
          onClick={cancelDeletion}
        >
          {busy ? "Cancelling…" : "Cancel deletion request"}
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-3 rounded-2xl border border-danger/40 p-5">
      <h3 className="font-medium">Delete account</h3>
      <p className="text-sm leading-relaxed text-ink-muted">
        Your account, files, results, and chats will be deleted after seven
        days. You may export your data or cancel before then. Records required
        by law stay only without your name or account link, for their required
        time.
      </p>
      <div className="space-y-1.5">
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
      <Button
        variant="destructive"
        disabled={confirm !== "delete my genome" || busy || !state}
        data-testid="delete-account"
        onClick={requestDeletion}
      >
        {busy ? "Scheduling…" : "Schedule account deletion"}
      </Button>
    </div>
  );
}
