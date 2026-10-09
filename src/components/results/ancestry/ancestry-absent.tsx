/**
 * <AncestryAbsent> — the regions section when the page has no admixture
 * result to show, and <AncestryReportsNote>, the sentence every ancestry
 * panel says when the reason is a step the reader takes on the Reports page.
 *
 * Three reasons, kept apart because they owe the reader different sentences:
 * nothing has been processed yet (NOTHING_READ); a file has been processed
 * and Ancestry is off (ANCESTRY_OFF); or a file has been processed, Ancestry
 * is on, and no result has been generated from it (ANCESTRY_NOT_GENERATED).
 * The last two carry a link to the subject's Reports page, where the step is
 * taken. Which one applies is decided on the server
 * (`src/lib/ancestry/absence.ts`); this only renders it.
 *
 * The grey map is the seven-region one, with its own count-free words. A new
 * result is always a seven-region result, and the historical five-region map
 * and caption belong only to the historical results that still carry them.
 *
 * The section is the product's one <EmptyState>: the sentence first, the
 * grey map under it as the quiet ground at its natural aspect (no plate
 * chrome, capped in height, never forced to 4:5) with its caption, and the
 * Reports link as the one action where a step exists. Each parent line
 * below then says its own state in one ruled row (<LineageCard>).
 */
import Link from "next/link";
import { EmptyState } from "@/components/site/empty-state";
import { Button } from "@/components/ui/button";
import { ANCESTRY_NOT_GENERATED, ANCESTRY_OFF, ANCESTRY_REPORTS_LINK, NOTHING_READ } from "@/copy/ancestry";
import { REGIONAL_MAP_CAPTION, REGIONAL_MAP_LABEL } from "@/copy/regional-ancestry";
import type { AncestryAbsence, AncestryReportsStep } from "@/lib/ancestry/absence";
import type { MapShapes } from "@/lib/ancestry/geometry";
import { AncestryMap } from "./ancestry-map";

const STEP_NOTES: Readonly<Record<AncestryReportsStep, { slot: string; sentence: string }>> = {
  "permission-off": { slot: "ancestry-off", sentence: ANCESTRY_OFF },
  "not-generated": { slot: "ancestry-not-generated", sentence: ANCESTRY_NOT_GENERATED },
};

/** `quiet`: the same note as a row's state text, with no inset of its own. */
export function AncestryReportsNote({ step, reportsHref, quiet = false }: { step: AncestryReportsStep; reportsHref: string; quiet?: boolean }) {
  const { slot, sentence } = STEP_NOTES[step];
  return (
    <div data-slot={slot} className={quiet ? "max-w-measure space-y-1 text-sm" : "surface-inset surface-pad-sm max-w-measure space-y-1 text-sm"}>
      <p className={quiet ? "text-sm leading-relaxed text-ink" : "text-base leading-relaxed text-ink"}>{sentence}</p>
      <p>
        <Link href={reportsHref} className="link-target quiet-link">
          {ANCESTRY_REPORTS_LINK}
        </Link>
      </p>
    </div>
  );
}

export interface AncestryAbsentProps {
  /** The seven-region locator shapes. */
  shapes: MapShapes;
  absence: AncestryAbsence;
  /** The subject's own Reports page. */
  reportsHref: string;
}

export function AncestryAbsent({ shapes, absence, reportsHref }: AncestryAbsentProps) {
  const step = absence === "nothing-read" ? null : STEP_NOTES[absence];
  // The sentence leads; the grey map is the quiet ground under it, capped
  // at its own aspect (family.css), with its caption 8px beneath.
  const empty = (
    <EmptyState
      action={
        step ? (
          <Button asChild variant="outline" size="lg">
            <Link href={reportsHref}>{ANCESTRY_REPORTS_LINK}</Link>
          </Button>
        ) : undefined
      }
    >
      <div className="space-y-4">
        {step ? (
          <p>{step.sentence}</p>
        ) : (
          <p data-slot="nothing-read">{NOTHING_READ}</p>
        )}
        <AncestryMap shapes={shapes} rows={[]} mode="grey" label={REGIONAL_MAP_LABEL} caption={REGIONAL_MAP_CAPTION} quiet />
      </div>
    </EmptyState>
  );
  return (
    <div data-slot="ancestry-absent" data-absence={absence}>
      {/* The step's slot holds its sentence and its Reports link together, as every panel's does. */}
      {step ? <div data-slot={step.slot}>{empty}</div> : empty}
    </div>
  );
}
