/**
 * <AncestryAbsent> — the regions section when the page has no admixture
 * result to show, and <AncestryOffNote>, the sentence every ancestry panel
 * says when the reason is that the Ancestry choice is off.
 *
 * Two reasons, kept apart because they owe the reader different sentences:
 * nothing has been processed yet (NOTHING_READ), or a file has been processed
 * and Ancestry is off (ANCESTRY_OFF, with a link to the subject's Reports
 * page, where the choice is turned back on). Which one applies is decided on
 * the server (`src/lib/ancestry/absence.ts`); this only renders it.
 *
 * The grey map is the seven-region one, with its own count-free words. A new
 * result is always a seven-region result, and the historical five-region map
 * and caption belong only to the historical results that still carry them.
 */
import Link from "next/link";
import { ANCESTRY_OFF, ANCESTRY_OFF_LINK, NOTHING_READ } from "@/copy/ancestry";
import { REGIONAL_MAP_CAPTION, REGIONAL_MAP_LABEL } from "@/copy/regional-ancestry";
import type { AncestryAbsence } from "@/lib/ancestry/absence";
import type { MapShapes } from "@/lib/ancestry/geometry";
import { AncestryMap } from "./ancestry-map";

export function AncestryOffNote({ reportsHref }: { reportsHref: string }) {
  return (
    <div data-slot="ancestry-off" className="space-y-1 text-sm">
      <p className="text-ink">{ANCESTRY_OFF}</p>
      <p>
        <Link href={reportsHref} className="inline-flex min-h-11 items-center underline underline-offset-2">
          {ANCESTRY_OFF_LINK}
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
      {absence === "permission-off" ? (
        <AncestryOffNote reportsHref={reportsHref} />
      ) : (
        <p data-slot="nothing-read" className="text-sm text-ink-muted">
          {NOTHING_READ}
        </p>
      )}
    </div>
  );
}
