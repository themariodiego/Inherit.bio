"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  PAUSE_BODY,
  PAUSE_BUTTON,
  PAUSE_OR_STOP_HEADING,
  RESUME_BODY,
  RESUME_BUTTON,
  SHARING_ERROR_STATUS,
  STOP_BUTTON,
  STOP_CANCEL_BUTTON,
  STOP_CONFIRM_BUTTON,
  STOP_DELETES,
  stopDialogBody,
  stopDialogHeading,
} from "@/copy/family/permissions";

/**
 * <SharingActions> — pause, resume and stop (brief §5 §5.4).
 *
 * Pause is secondary and reversible from either side; it deletes nothing.
 * Stop is the one destructive action and sits behind a confirmation that
 * names the person and lists by name what will be deleted — never a count
 * alone. Both bypass the jurisdiction gate: they are rights, not features
 * (register family.permissions.rightActions). Both triggers are outline
 * buttons; only the confirmation inside the dialog is destructive.
 */
export function SharingActions({
  personName,
  personSegment,
  paused,
  stopNonce,
}: {
  personName: string;
  /** The `s-{uuid}` segment the sharing endpoint resolves to one counterpart. */
  personSegment: string;
  paused: boolean;
  /** The one-time operation nonce this page minted for the stop. */
  stopNonce: string;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);

  async function send(operation: "pause" | "resume" | "stop") {
    setPending(true);
    setFailed(false);
    const response = await fetch(`/api/family/${personSegment}/sharing`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(
        operation === "stop" ? { operation, nonce: stopNonce } : { operation },
      ),
    });
    setPending(false);
    if (!response.ok) {
      setFailed(true);
      return;
    }
    setConfirming(false);
    router.refresh();
  }

  return (
    <section
      data-slot="sharing-actions"
      aria-labelledby="sharing-actions-heading"
      className="space-y-4"
    >
      <h2 id="sharing-actions-heading" className="title text-ink">
        {PAUSE_OR_STOP_HEADING}
      </h2>
      <p className="max-w-measure text-base leading-relaxed text-ink-muted">
        {paused ? RESUME_BODY : PAUSE_BODY}
      </p>
      {failed ? (
        <p role="alert" className="text-sm text-danger">
          {SHARING_ERROR_STATUS}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-3">
        <Button
          type="button"
          variant="outline"
          disabled={pending}
          onClick={() => send(paused ? "resume" : "pause")}
        >
          {paused ? RESUME_BUTTON : PAUSE_BUTTON}
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={pending}
          onClick={() => setConfirming(true)}
        >
          {STOP_BUTTON}
        </Button>
      </div>
      {confirming ? (
        <div
          role="alertdialog"
          aria-labelledby="stop-dialog-heading"
          aria-describedby="stop-dialog-body"
          data-slot="stop-dialog"
          className="surface surface-pad max-w-measure space-y-3 border-danger"
        >
          <h3 id="stop-dialog-heading" className="title text-ink">
            {stopDialogHeading(personName)}
          </h3>
          <p id="stop-dialog-body" className="text-base leading-relaxed text-ink">
            {stopDialogBody(personName)}
          </p>
          <ul className="list-disc space-y-1 pl-5 text-sm leading-relaxed text-ink-muted">
            {STOP_DELETES.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
          <div className="flex flex-wrap gap-3">
            <Button
              type="button"
              variant="destructive"
              disabled={pending}
              onClick={() => send("stop")}
            >
              {STOP_CONFIRM_BUTTON}
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={pending}
              onClick={() => setConfirming(false)}
            >
              {STOP_CANCEL_BUTTON}
            </Button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
