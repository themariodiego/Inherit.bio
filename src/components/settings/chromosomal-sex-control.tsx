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

  async function declare(chromosomalSex: ChromosomalSexValue | null) {
    setBusy(true);
    setFailed(false);
    try {
      const response = await fetch("/api/chromosomal-sex", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subjectId, chromosomalSex }),
      });
      if (!response.ok) {
        setFailed(true);
        return;
      }
      router.refresh();
    } catch {
      setFailed(true);
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
              checked={declared === choice.value}
              onChange={() => void declare(choice.value)}
              className="size-4"
            />
            {choice.label}
          </label>
        ))}
      </fieldset>
      <p className="text-sm text-ink-muted">{CHROMOSOMAL_SEX_OTHER_NOTE}</p>
      {declared === null ? null : (
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
