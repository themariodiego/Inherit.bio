"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  GATE_BODY,
  GATE_BUTTON,
  GATE_CHECKBOX_LABEL,
  GATE_ERROR_STATUS,
  GATE_HEADING,
  GATE_SESSION_NOTE,
} from "@/copy/family/person";

/**
 * <ResultGate> — the one Tier-2 gate of the Family domain (brief line 968).
 *
 * It stands at the domain boundary, not on a row: one checkbox, one
 * sentence about its scope, one primary action, as a labelled plate. The
 * answer is recorded by POST /api/family/acknowledge as an httpOnly session
 * cookie — never in device storage, and never in this component's state —
 * so the page that renders this gate has fetched nothing about the other
 * adult.
 */
export function ResultGate() {
  const router = useRouter();
  const [understood, setUnderstood] = useState(false);
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);

  return (
    <section data-slot="result-gate" aria-labelledby="result-gate-heading" className="plate">
      <div className="plate-head">
        <h2 id="result-gate-heading" className="title text-ink">
          {GATE_HEADING}
        </h2>
      </div>
      <div className="plate-body space-y-4">
        <p className="body-lg max-w-measure text-ink">{GATE_BODY}</p>
        <label className="flex min-h-11 max-w-measure items-start gap-3 text-base leading-relaxed text-ink">
          <input
            type="checkbox"
            name="tier2"
            className="mt-1.5 size-4 shrink-0 accent-forest"
            checked={understood}
            onChange={(event) => setUnderstood(event.currentTarget.checked)}
          />
          <span>{GATE_CHECKBOX_LABEL}</span>
        </label>
        <p className="caption max-w-measure">{GATE_SESSION_NOTE}</p>
        {failed ? (
          <p role="alert" className="text-sm text-danger">
            {GATE_ERROR_STATUS}
          </p>
        ) : null}
        <div>
          <Button
            type="button"
            size="lg"
            disabled={!understood || pending}
            onClick={async () => {
              setPending(true);
              setFailed(false);
              const response = await fetch("/api/family/acknowledge", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ acknowledgement: "tier2-result-gate", affirmed: true }),
              });
              setPending(false);
              if (!response.ok) {
                setFailed(true);
                return;
              }
              router.refresh();
            }}
          >
            {GATE_BUTTON}
          </Button>
        </div>
      </div>
    </section>
  );
}
