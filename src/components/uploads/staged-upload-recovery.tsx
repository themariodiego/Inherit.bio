"use client";

import { Button } from "@/components/ui/button";

/** An upload whose bytes already reached private storage, and whose last step
 * did not reach an answer. The route keeps durable progress for one
 * finalization (ADR-0026), so finishing costs only what the interrupted
 * attempt left undone and never another transfer of the file.
 *
 * The refusal keeps its own wording and its own alert. This adds the way to
 * act on it, outside that alert, because the alert is what a screen reader
 * announces and the button is what a person presses. */
export function StagedUploadRecovery({ message, disabled, onFinish }: {
  message: string;
  disabled: boolean;
  onFinish: () => void;
}) {
  return <div>
    <p role="alert" className="text-danger">{message}</p>
    <p className="mt-2 text-ink-muted">Your file already reached private storage. Finishing it does not send the file again.</p>
    <Button className="mt-3" disabled={disabled} onClick={onFinish}>Try this upload again</Button>
  </div>;
}
