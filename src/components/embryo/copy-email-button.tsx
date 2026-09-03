"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { COPIED_STATUS, COPY_EMAIL_BUTTON, COPY_FAILED_STATUS } from "@/copy/embryos/request-data";

/**
 * The one primary action of `/embryos/request-data`: copy the letter to the
 * clipboard. A failure is the route's error state and says what to do
 * instead; nothing is sent anywhere.
 */
export function CopyEmailButton({ text }: { text: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  return (
    <div className="space-y-2">
      <Button
        type="button"
        size="lg"
        className="min-h-11"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(text);
            setState("copied");
          } catch {
            setState("failed");
          }
        }}
      >
        {COPY_EMAIL_BUTTON}
      </Button>
      {state === "idle" ? null : (
        <p role="status" data-slot="copy-status" data-copy-state={state} className="text-sm text-ink">
          {state === "copied" ? COPIED_STATUS : COPY_FAILED_STATUS}
        </p>
      )}
    </div>
  );
}
