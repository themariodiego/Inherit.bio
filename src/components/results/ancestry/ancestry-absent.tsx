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
 */
import Link from "next/link";
import { ANCESTRY_NOT_GENERATED, ANCESTRY_OFF, ANCESTRY_REPORTS_LINK, NOTHING_READ } from "@/copy/ancestry";
import { REGIONAL_MAP_CAPTION, REGIONAL_MAP_LABEL } from "@/copy/regional-ancestry";
import type { AncestryAbsence, AncestryReportsStep } from "@/lib/ancestry/absence";
import type { MapShapes } from "@/lib/ancestry/geometry";
import { AncestryMap } from "./ancestry-map";

const STEP_NOTES: Readonly<Record<AncestryReportsStep, { slot: string; sentence: string }>> = {
  "permission-off": { slot: "ancestry-off", sentence: ANCESTRY_OFF },
  "not-generated": { slot: "ancestry-not-generated", sentence: ANCESTRY_NOT_GENERATED },
};

export function AncestryReportsNote({ step, reportsHref }: { step: AncestryReportsStep; reportsHref: string }) {
  const { slot, sentence } = STEP_NOTES[step];
  return (
    <div data-slot={slot} className="space-y-1 text-sm">
      <p className="text-ink">{sentence}</p>
      <p>
        <Link href={reportsHref} className="inline-flex min-h-11 items-center underline underline-offset-2">
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
  return (
    <div data-slot="ancestry-absent" data-absence={absence} className="space-y-4">
      <AncestryMap shapes={shapes} rows={[]} mode="grey" label={REGIONAL_MAP_LABEL} caption={REGIONAL_MAP_CAPTION} />
      {absence === "nothing-read" ? (
        <p data-slot="nothing-read" className="text-sm text-ink-muted">
          {NOTHING_READ}
        </p>
      ) : (
        <AncestryReportsNote step={absence} reportsHref={reportsHref} />
      )}
    </div>
  );
}
