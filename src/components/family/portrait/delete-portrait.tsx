"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  DELETE_BUTTON,
  DELETE_CANCEL_BUTTON,
  DELETE_CONFIRM_BUTTON,
  DELETE_DIALOG_BODY,
  DELETE_DIALOG_HEADING,
  DELETE_ERROR_STATUS,
  DELETE_LEAD,
} from "@/copy/family/portrait";

/**
 * <DeletePortrait> — "either of you can delete it" (brief line 364), made
 * real by the one routine that deletes from one side: revoking the viewer's
 * own `family.portrait` grant (`revoke_directional_purpose_v1` through
 * POST /api/consents/[id]/revoke) deletes every `portrait_results` row of
 * the pair inline, returns the pair to pending so this page closes for both
 * people on the next request, and enqueues the purpose.derived-60s purge.
 *
 * Tier 2 of brief line 936: one destructive action behind a dialog that
 * names what is deleted and what it takes to undo. Nothing is typed, because
 * the action is scoped to one pair and reversible by two grants.
 */
export function DeletePortrait({ grantId }: { grantId: string }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);

  return (
    <section data-slot="portrait-delete" aria-label={DELETE_BUTTON} className="max-w-prose space-y-3">
      <p className="text-sm leading-relaxed text-ink-muted">{DELETE_LEAD}</p>
      {failed ? (
        <p role="alert" className="text-sm text-danger">
          {DELETE_ERROR_STATUS}
        </p>
      ) : null}
      {confirming ? (
        <div
          role="alertdialog"
          aria-labelledby="portrait-delete-heading"
          aria-describedby="portrait-delete-body"
          data-slot="portrait-delete-dialog"
          className="space-y-3 rounded-2xl border border-danger bg-card p-6"
        >
          <p id="portrait-delete-heading" className="font-medium text-ink">
            {DELETE_DIALOG_HEADING}
          </p>
          <p id="portrait-delete-body" className="text-sm leading-relaxed text-ink">
            {DELETE_DIALOG_BODY}
          </p>
          <div className="flex flex-wrap gap-3">
            <Button
              type="button"
              variant="destructive"
              disabled={pending}
              onClick={async () => {
                setPending(true);
                setFailed(false);
                const response = await fetch(`/api/consents/${grantId}/revoke`, { method: "POST" });
                setPending(false);
                if (!response.ok) {
                  setFailed(true);
                  return;
                }
                setConfirming(false);
                router.refresh();
              }}
            >
              {DELETE_CONFIRM_BUTTON}
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={pending}
              onClick={() => setConfirming(false)}
            >
              {DELETE_CANCEL_BUTTON}
            </Button>
          </div>
        </div>
      ) : (
        <Button type="button" variant="destructive" onClick={() => setConfirming(true)}>
          {DELETE_BUTTON}
        </Button>
      )}
    </section>
  );
}
