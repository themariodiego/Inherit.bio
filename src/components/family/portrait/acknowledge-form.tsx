"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  ACKNOWLEDGE_BUTTON,
  ACKNOWLEDGE_CHECKBOX_LABEL,
  ACKNOWLEDGE_ERROR_STATUS,
  ACKNOWLEDGE_LEAD,
  OPEN_CONSENTS_BUTTON,
} from "@/copy/family/portrait";

/**
 * <AcknowledgeForm> — the Portrait acknowledgement (design §2.5; brief line
 * 352: "portrait_acknowledged_at set independently on each subject").
 *
 * One checkbox, one primary action. The answer is recorded by
 * POST /api/family/acknowledge with the `portrait` body, which calls
 * `acknowledge_portrait_v1` for the acting account: the routine stamps only
 * a subject bound to that account, so this form can never acknowledge for
 * the other person, whatever id it were given. Nothing is pre-ticked and
 * nothing is remembered on the device.
 */
export function AcknowledgeForm({
  subjectId,
  consentsHref,
}: {
  /** The viewer's own subject in the pair, server-derived. */
  subjectId: string;
  consentsHref: string;
}) {
  const router = useRouter();
  const [read, setRead] = useState(false);
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);

  return (
    <section
      data-slot="portrait-acknowledge"
      aria-label={ACKNOWLEDGE_CHECKBOX_LABEL}
      className="surface surface-pad max-w-measure space-y-4"
    >
      <p className="body-lg text-ink">{ACKNOWLEDGE_LEAD}</p>
      <label className="flex min-h-11 items-start gap-3 text-base leading-relaxed text-ink">
        <input
          type="checkbox"
          name="portrait-acknowledged"
          className="mt-1.5 size-4 shrink-0 accent-forest"
          checked={read}
          onChange={(event) => setRead(event.currentTarget.checked)}
        />
        <span>{ACKNOWLEDGE_CHECKBOX_LABEL}</span>
      </label>
      {failed ? (
        <p role="alert" className="text-sm text-danger">
          {ACKNOWLEDGE_ERROR_STATUS}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="button"
          disabled={!read || pending}
          onClick={async () => {
            setPending(true);
            setFailed(false);
            const response = await fetch("/api/family/acknowledge", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ acknowledgement: "portrait", subjectId, affirmed: true }),
            });
            setPending(false);
            if (!response.ok) {
              setFailed(true);
              return;
            }
            router.refresh();
          }}
        >
          {ACKNOWLEDGE_BUTTON}
        </Button>
        <Button asChild variant="outline">
          <Link href={consentsHref}>{OPEN_CONSENTS_BUTTON}</Link>
        </Button>
      </div>
    </section>
  );
}
