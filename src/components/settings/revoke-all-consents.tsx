"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  REVOKE_ALL_CONFIRMATION,
  REVOKE_ALL_CONTROL,
  REVOKE_ALL_FAILED,
  REVOKE_ALL_WORKING,
} from "@/copy/settings/consents";

/**
 * The revoke-all control (api.consents-revoke-all). The page renders the
 * one-time operation nonce; this posts it once with the resolved confirmation
 * id and asks the page to render again, which brings the new state and a
 * fresh nonce. Nothing here stores or rotates a nonce.
 */
export function RevokeAllConsents({ nonce }: { nonce: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  async function revokeAll() {
    setBusy(true);
    setFailed(false);
    try {
      const response = await fetch("/api/consents/revoke-all", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmation: REVOKE_ALL_CONFIRMATION, nonce }),
      });
      const body = (await response.json().catch(() => null)) as { status?: string } | null;
      if (response.status !== 202 || body?.status !== "accepted") setFailed(true);
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
      router.refresh();
    }
  }

  return (
    <div className="rec-stack">
      <div>
        <Button variant="outline" disabled={busy} data-testid="revoke-all-consents" onClick={() => void revokeAll()}
          className="h-auto whitespace-normal text-left">
          {busy ? REVOKE_ALL_WORKING : REVOKE_ALL_CONTROL}
        </Button>
      </div>
      {failed ? <p role="alert" className="text-sm text-danger">{REVOKE_ALL_FAILED}</p> : null}
    </div>
  );
}
