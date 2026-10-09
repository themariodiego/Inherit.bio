"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  COUNSELLOR_NO_ROUTE,
  GATE_BODY,
  GATE_BUTTON,
  GATE_CHECKBOX_LABEL,
  GATE_ERROR_STATUS,
  GATE_HEADING,
  GATE_SESSION_NOTE,
} from "@/copy/embryos/gate";

/**
 * <EmbryoResultGate> — the one Tier-2 gate of the Embryo domain (design
 * §1.5; brief lines 968-972). One checkbox, one sentence about its scope,
 * one primary action, and the counsellor line in its no-route state.
 *
 * The answer is recorded by the page's server action as an httpOnly session
 * cookie — never in device storage, never in this component's state — so
 * the page that renders this gate has fetched nothing derived about any
 * embryo. The action is passed in so the component never names a route.
 */
export function EmbryoResultGate({
  action,
}: {
  action: () => Promise<{ ok: boolean }>;
}) {
  const router = useRouter();
  const [understood, setUnderstood] = useState(false);
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);

  return (
    <section data-slot="result-gate" aria-labelledby="embryo-gate-heading" className="plate">
      <div className="plate-head">
        <h2 id="embryo-gate-heading" className="title text-ink">
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
      <p data-slot="counsellor-route" className="caption max-w-measure">
        {COUNSELLOR_NO_ROUTE}
      </p>
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
          let ok = false;
          try {
            ok = (await action()).ok;
          } catch {
            ok = false;
          }
          setPending(false);
          if (!ok) {
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
