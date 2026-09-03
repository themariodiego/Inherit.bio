/**
 * <HealthPictureCell> — one person's answer for one row of the side-by-side
 * table (design §2.3, cell contract). Server component.
 *
 * Exactly one claim block per cell, attributed to the subject the letters
 * were read from — the counterpart's own record, never the handle the route
 * names (X4). Inside it: the letters this person's file shows, as observed
 * `genotype` figures, one short layer chip, and a link to that person's own
 * report where the interpretation lives. Nothing is compared with the cell
 * beside it, nothing is added up, and no cell carries a word that ranks it.
 *
 * A cell that has no letters says which of the three reasons applies and
 * carries no figure at all: a missing result is never rendered as a value.
 */
import Link from "next/link";
import { ClaimBlock } from "@/components/figures/claim-block";
import {
  CELL_FILES_DISAGREE,
  CELL_NO_FILE,
  LAYER_CHIP_LABELS,
  OPEN_LINK,
  cellNotCovered,
  genotypeLabel,
  openReportLabel,
} from "@/copy/family/health-picture";
import type { StandaloneFigureSpec } from "@/lib/figures/spec";
import type { FindingLayer } from "@/lib/genome/taxonomy";

/** What one file had to say about one report's positions. */
export type HealthPictureCellState =
  | { kind: "letters"; genotypes: readonly string[] }
  | { kind: "not-covered" }
  | { kind: "no-file" }
  | { kind: "disagree" };

export interface HealthPictureCellProps {
  /** The subject the letters were read from. */
  dataSubjectId: string;
  personName: string;
  reportTitle: string;
  layer: FindingLayer;
  state: HealthPictureCellState;
  /**
   * The person's own report page. Null when this viewer holds no live
   * permission for that layer, in which case no link is rendered at all —
   * a control without a destination is never shipped.
   */
  href: string | null;
  /** The table caption, which carries the layer definition once. */
  captionId: string;
}

function figuresFor(
  state: HealthPictureCellState,
  layer: FindingLayer,
  personName: string,
): StandaloneFigureSpec[] {
  if (state.kind !== "letters") return [];
  return state.genotypes.map((genotype) => ({
    kind: "genotype",
    class: layer === "variant_call" ? "variant-call" : "estimate",
    basis: "observed",
    provenance: { kind: "computed", module: "genome/reports" },
    genotype,
    label: genotypeLabel(personName),
  }));
}

function absenceWord(state: HealthPictureCellState, personName: string): string | null {
  switch (state.kind) {
    case "not-covered":
      return cellNotCovered(personName);
    case "no-file":
      return CELL_NO_FILE;
    case "disagree":
      return CELL_FILES_DISAGREE;
    case "letters":
      return null;
  }
}

export function HealthPictureCell({
  dataSubjectId,
  personName,
  reportTitle,
  layer,
  state,
  href,
  captionId,
}: HealthPictureCellProps) {
  const figures = figuresFor(state, layer, personName);
  const absent = absenceWord(state, personName);
  return (
    <td data-slot="health-picture-cell" className="align-top p-2">
      <ClaimBlock subject={{ subjectId: dataSubjectId }} figures={figures} className="space-y-2 p-3">
        {absent ? (
          <p data-slot="cell-absence" className="text-sm leading-relaxed text-ink">
            {absent}
          </p>
        ) : null}
        {state.kind === "letters" ? (
          <p
            data-chip="layer"
            aria-describedby={captionId}
            className="text-sm text-ink-muted"
          >
            {LAYER_CHIP_LABELS[layer]}
          </p>
        ) : null}
        {href ? (
          <Link
            href={href}
            aria-label={openReportLabel(reportTitle, personName)}
            className="inline-flex min-h-11 items-center text-sm text-ink underline decoration-forest decoration-2 underline-offset-4 hover:text-forest"
          >
            {OPEN_LINK}
          </Link>
        ) : null}
      </ClaimBlock>
    </td>
  );
}
