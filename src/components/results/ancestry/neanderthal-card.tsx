/**
 * <NeanderthalCard> — `#neanderthal` (brief §4.6, acceptance 32; G4.4; owner
 * decision 2026-10-16, G7.4). Server component.
 *
 * The estimate is the share of covered panel sites at which the reader carries
 * a Neanderthal-derived allele (`src/lib/genome/neanderthal.ts`), with the
 * number of covered sites and a bootstrap range — not a whole-genome ancestry
 * proportion, and the copy says so. It is a TEST-LOCAL capability: production
 * keeps the capability OFF and renders the production sentence, exactly as
 * before this shipped, except that the sentence no longer claims the marker
 * list is unbuilt (it is built and licence-checked now).
 *
 * The comparison figure stays hidden until the owner's source review is
 * recorded (`NEANDERTHAL_COMPARISON_REVIEWED`, `docs/neanderthal-source-review.md`);
 * no comparator sentence is shipped, so none can render.
 *
 * The eyebrow is a paragraph because "ancestry" is a term of art and may not
 * head a section; the mandated Denisovan sentence follows the body verbatim.
 */
import type { ReactNode } from "react";
import { ClaimBlock } from "@/components/figures/claim-block";
import type { AncestryShareSpec, CoverageSpec } from "@/lib/figures/spec";
import { NEANDERTHAL_COMPARISON_REVIEWED } from "@/lib/genome/neanderthal-availability";
import type { AncestryAbsence } from "@/lib/ancestry/absence";
import { AncestryReportsNote } from "./ancestry-absent";
import {
  DENISOVAN,
  NEANDERTHAL_BODY,
  NEANDERTHAL_EYEBROW,
  NEANDERTHAL_HEADING,
  NEANDERTHAL_NO_RANGE,
  NEANDERTHAL_NOT_COVERED,
  NEANDERTHAL_RESOLUTION_LIMIT,
  NEANDERTHAL_WHAT_IT_IS,
  NOTHING_READ,
  neanderthalPanelLine,
} from "@/copy/ancestry";

export const NEANDERTHAL_SECTION_ID = "neanderthal";

export interface NeanderthalEstimateView {
  subjectId: string;
  /** archaicSites / coveredSites, in [0, 1]. */
  share: number;
  /** The 90% bootstrap interval, or null when it has no width (G4.4's disjunction). */
  interval: { low: number; high: number } | null;
  coveredSites: number;
  panelSites: number;
  panelVersion: string;
}

interface NeanderthalCardProps {
  /** TEST-LOCAL only; false in production, where the capability is OFF. */
  built: boolean;
  /** The confirmed estimate for the shown file, or null when none is stored. */
  estimate?: NeanderthalEstimateView | null;
  /** Why there is no result yet, when `built` and no estimate exists. */
  absence?: AncestryAbsence;
  reportsHref?: string;
}

const PROVENANCE = { kind: "computed", module: "src/lib/genome/neanderthal.ts" } as const;

export function NeanderthalCard({ built, estimate = null, absence = "nothing-read", reportsHref }: NeanderthalCardProps) {
  let body: ReactNode;
  if (!built) {
    body = <p className="max-w-measure text-base leading-relaxed text-ink">{NEANDERTHAL_BODY}</p>;
  } else if (estimate && estimate.coveredSites > 0) {
    const share: AncestryShareSpec = {
      kind: "ancestry-share", class: "ancestry", basis: "modelled", provenance: PROVENANCE,
      share: estimate.share,
      range: estimate.interval ? { low: estimate.interval.low, high: estimate.interval.high } : { unavailable: true },
    };
    const coverage: CoverageSpec = {
      kind: "coverage", class: "quality", basis: "observed", provenance: PROVENANCE,
      read: estimate.coveredSites, needed: estimate.panelSites,
    };
    body = (
      <div className="max-w-measure space-y-3">
        <ClaimBlock subject={{ subjectId: estimate.subjectId }} figures={[share]} />
        <ClaimBlock subject={{ subjectId: estimate.subjectId }} figures={[coverage]} className="p-3" />
        <div data-slot="neanderthal-provenance" className="space-y-1 text-sm text-ink-muted">
          <p>{neanderthalPanelLine(estimate.panelSites, estimate.panelVersion)}</p>
          {estimate.interval ? null : <p>{NEANDERTHAL_NO_RANGE}</p>}
          <p>{NEANDERTHAL_RESOLUTION_LIMIT}</p>
        </div>
        <p className="text-sm text-ink">{NEANDERTHAL_WHAT_IT_IS}</p>
        {/* The comparison figure stays hidden until the owner's source review
            is recorded. No comparator sentence is shipped, so this branch
            renders nothing today. */}
        {NEANDERTHAL_COMPARISON_REVIEWED ? <p data-slot="neanderthal-comparator" /> : null}
      </div>
    );
  } else if (estimate) {
    // No number is shown, so the 0%-from-array caveat (which is about a shown
    // result) does not belong here; this states the file limit plainly.
    body = <p className="max-w-measure text-base leading-relaxed text-ink">{NEANDERTHAL_NOT_COVERED}</p>;
  } else if ((absence === "permission-off" || absence === "not-generated") && reportsHref) {
    body = <AncestryReportsNote step={absence} reportsHref={reportsHref} />;
  } else {
    body = <p className="text-base leading-relaxed text-ink">{NOTHING_READ}</p>;
  }

  return (
    <section
      id={NEANDERTHAL_SECTION_ID}
      aria-labelledby="neanderthal-heading"
      className="surface surface-pad-sm space-y-3"
    >
      <p className="eyebrow">{NEANDERTHAL_EYEBROW}</p>
      <h2 id="neanderthal-heading" className="title text-ink">
        {NEANDERTHAL_HEADING}
      </h2>
      {body}
      <p className="caption max-w-measure">{DENISOVAN}</p>
    </section>
  );
}
