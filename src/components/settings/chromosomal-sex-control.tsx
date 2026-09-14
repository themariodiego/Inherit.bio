"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  CHROMOSOMAL_SEX_BODY,
  CHROMOSOMAL_SEX_CHOICES,
  CHROMOSOMAL_SEX_HEADING,
  CHROMOSOMAL_SEX_LEGEND,
  CHROMOSOMAL_SEX_NOT_DERIVED,
  CHROMOSOMAL_SEX_OTHER_NOTE,
  CHROMOSOMAL_SEX_REMOVE,
  CHROMOSOMAL_SEX_SAVE_FAILED,
  CHROMOSOMAL_SEX_SHARING,
} from "@/copy/settings/chromosomal-sex";
// Type-only: `@/lib/family/chromosomal-sex` is server-only, and the import is
// erased. The four values reach this client component as data, through the
// copy registry's choice list.
import type { ChromosomalSexValue } from "@/lib/family/chromosomal-sex";

/**
 * The declaration control for `subject_demographics.chromosomal_sex` (D-031),
 * on `/settings` because the only subject in scope there is the reader's own.
 * Another adult declares from their own account or their value stays blank:
 * `declare_chromosomal_sex_v1` accepts only a subject the acting account IS.
 *
 * Withdrawal is the same control, not a buried one. "Remove this" posts null
 * through the same route, so the way back is exactly as short as the way in.
 */
export function ChromosomalSexControl({
  subjectId,
  declared,
}: {
  subjectId: string;
  declared: ChromosomalSexValue | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  // The control shows the choice as soon as it is made and puts it back if the
  // write fails. Without this the radios are pinned to the server's value
  // until a refresh lands, so a reader's own click appears to do nothing —
  // which is also what made this untestable: a click that never changes the
  // control's state is indistinguishable from a click that was ignored.
  const [chosen, setChosen] = useState<ChromosomalSexValue | null>(declared);
  const [recorded, setRecorded] = useState<ChromosomalSexValue | null>(declared);
  if (declared !== recorded) {
    setRecorded(declared);
    setChosen(declared);
  }

  async function declare(chromosomalSex: ChromosomalSexValue | null) {
    setBusy(true);
    setFailed(false);
    setChosen(chromosomalSex);
    try {
      const response = await fetch("/api/chromosomal-sex", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subjectId, chromosomalSex }),
      });
      if (!response.ok) {
        setFailed(true);
        setChosen(recorded);
        return;
      }
      // The route answers with the value the row now holds, so the control
      // shows what was recorded rather than what was asked for. Reading the
      // body also releases it: a response nothing reads stays an open stream.
      const body: unknown = await response.json().catch(() => null);
      const value =
        body && typeof body === "object"
          ? (body as { chromosomalSex?: unknown }).chromosomalSex
          : null;
      setChosen(CHROMOSOMAL_SEX_CHOICES.find((choice) => choice.value === value)?.value ?? null);
      router.refresh();
    } catch {
      setFailed(true);
      setChosen(recorded);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section data-slot="chromosomal-sex" className="space-y-4">
      <h2 className="eyebrow">{CHROMOSOMAL_SEX_HEADING}</h2>
      <p className="text-sm text-ink-muted">{CHROMOSOMAL_SEX_BODY}</p>
      <p className="text-sm text-ink-muted">{CHROMOSOMAL_SEX_NOT_DERIVED}</p>
      <p className="text-sm text-ink-muted">{CHROMOSOMAL_SEX_SHARING}</p>
      <fieldset className="space-y-2" disabled={busy}>
        <legend className="sr-only">{CHROMOSOMAL_SEX_LEGEND}</legend>
        {CHROMOSOMAL_SEX_CHOICES.map((choice) => (
          <label
            key={choice.value}
            data-slot="chromosomal-sex-choice"
            className="flex min-h-[var(--size-control)] items-center gap-3 text-sm text-ink"
          >
            <input
              type="radio"
              name="chromosomal-sex"
              value={choice.value}
              checked={chosen === choice.value}
              onChange={() => void declare(choice.value)}
              className="size-4"
            />
            {choice.label}
          </label>
        ))}
      </fieldset>
      <p className="text-sm text-ink-muted">{CHROMOSOMAL_SEX_OTHER_NOTE}</p>
      {chosen === null ? null : (
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={busy}
          data-slot="chromosomal-sex-remove"
          onClick={() => void declare(null)}
        >
          {CHROMOSOMAL_SEX_REMOVE}
        </Button>
      )}
      {failed ? (
        <p role="status" data-slot="chromosomal-sex-error" className="text-sm text-ink">
          {CHROMOSOMAL_SEX_SAVE_FAILED}
        </p>
      ) : null}
    </section>
  );
}
