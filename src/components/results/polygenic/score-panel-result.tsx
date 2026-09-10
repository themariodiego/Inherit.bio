/**
 * <ScorePanelResult> — one polygenic score on the expert data page
 * (`/genome/[subject]/data`, brief §7.6, §4 §2.5). Server component.
 *
 * G4.4 asks every quantity read against a reference panel to name the panel and
 * its version, the informative markers used of those required, an interval or
 * an explicit statement that none is available, and the resolution limit in
 * plain words; a polygenic result adds the coverage fraction and the
 * ancestry-portability statement. The `coverage` figure ("read X of the Y
 * positions this needs") is the markers used of those required and the coverage
 * fraction in one, and the seeded `ancestry_note` is the portability statement;
 * both were already here. This component adds the three the surface lacked, in
 * the shape `src/components/results/ancestry/lineage-card.tsx` established for
 * a haplogroup call: the panel-and-version line, the explicit absence of a
 * range, and the resolution limit.
 *
 * No version is invented. `public.prs_scores` carries no version column, so
 * `panelVersionLine` renders the explicit "no version is recorded" form
 * (`src/lib/genome/prs-panel.ts`), exactly as `NO_RANGE_YET` states the absent
 * interval rather than implying one. No percentile or score number renders
 * anywhere: no shipped score is checked in people like the reader, so the
 * coverage counts are the only quantity on the surface.
 *
 * The component renders the claim block itself rather than wrapping it, so the
 * block stays the list item's direct child — the contract
 * `e2e/genome-data.spec.ts` asserts — and the three sentences sit inside the
 * one attributed container as the figure they qualify.
 */
import { ClaimBlock } from "@/components/figures/claim-block";
import { NO_RANGE_YET, RESOLUTION_LIMIT, panelVersionLine } from "@/copy/genome/polygenic";
import type { CoverageSpec } from "@/lib/figures/spec";
import type { ScorePanelFacts } from "@/lib/genome/prs-panel";

export interface ScorePanelResultProps {
  subjectId: string;
  /** The panel this score was read against: its id, its name and its version or the absence of one. */
  panel: ScorePanelFacts;
  /** The trait the score was built for, as the catalogue names it. */
  trait: string;
  /** The score's seeded ancestry-portability statement, rendered as stored. */
  ancestryNote: string;
  /** Positions of the panel this subject's file supplied. */
  read: number;
  /** Positions the panel needs. */
  needed: number;
}

export function ScorePanelResult({
  subjectId,
  panel,
  trait,
  ancestryNote,
  read,
  needed,
}: ScorePanelResultProps) {
  const coverage: CoverageSpec = {
    kind: "coverage",
    class: "estimate",
    basis: "observed",
    provenance: { kind: "computed", module: "genome/prs" },
    read,
    needed,
  };

  return (
    <ClaimBlock subject={{ subjectId }} figures={[coverage]}>
      <p className="mt-2 max-w-prose text-sm text-ink">
        <span className="font-medium">{panel.name}</span>{" "}
        <span className="font-mono text-sm text-ink-muted">{panel.id}</span>
        {" · "}
        <span className="text-ink-muted">{trait}</span>
      </p>
      {/* inherit-figure-exempt: the score's seeded ancestry-portability
          statement names the composition of its source cohort (provenance
          from the score catalogue), not a result about the subject */}
      <p data-slot="ancestry-note" className="mt-1 max-w-prose text-sm text-ink-muted">
        {ancestryNote}
      </p>
      <div
        data-slot="score-panel-provenance"
        className="mt-2 max-w-prose space-y-1 text-sm text-ink-muted"
      >
        <p>{panelVersionLine(panel)}</p>
        <p>{NO_RANGE_YET}</p>
        <p>{RESOLUTION_LIMIT}</p>
      </div>
    </ClaimBlock>
  );
}
