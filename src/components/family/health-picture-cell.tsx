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
 * A cell that has no letters says which of the four reasons applies and
 * carries no figure at all: a missing result is never rendered as a value,
 * and a result the viewer has not been granted is never rendered at all.
 */
import Link from "next/link";
import { InputProvenance } from "@/components/reports/input-provenance";
import type { InputSourceView } from "@/lib/genome/input-sources";
import { ClaimBlock } from "@/components/figures/claim-block";
import {
  CELL_FILES_DISAGREE,
  CELL_NO_PREPARED_FILE, CELL_NOT_GENERATED, CELL_CATALOG_UNAVAILABLE, CELL_VERSION_UNAVAILABLE,
  CELL_NO_CALL, CELL_UNRECOGNIZED, CELL_SAVED, CELL_LEGACY, SAVED_SOURCE_LINK, CELL_NO_REPORT, CELL_CONFLICTING_CALLS,
  CELL_NOT_SHARED,
  CELL_NO_FILE,
  LAYER_CHIP_LABELS,
  OPEN_LINK,
  cellNotCovered,
  genotypeLabel,
  openReportLabel,
} from "@/copy/family/health-picture";
import type { StandaloneFigureSpec } from "@/lib/figures/spec";
import type { FindingLayer } from "@/lib/genome/taxonomy";

/**
 * What one file had to say about one report's positions — or, for another
 * adult whose layer grant the viewer does not hold, nothing at all: the
 * joint grant opens the column, and only the layer's own grant opens the
 * cell (register `multiSubjectLayer`, D-038).
 */
export type HealthPictureSimpleState =
  | { kind: "letters"; genotypes: readonly string[] }
  | { kind: "not-covered" }
  | { kind: "no-file" }
  | { kind: "disagree" }
  | { kind: "not-shared" }
  | { kind: "no-prepared-file" | "not-generated" | "catalog-unavailable" | "version-unavailable" | "no-call" | "unrecognized" | "saved" | "legacy" | "no-report" | "conflicting-calls" };
export type HealthPictureCellState = HealthPictureSimpleState | { kind: "sources"; entries: readonly {
  fileId: string; sourceLabel: string; conflictingCalls?: boolean; state: HealthPictureSimpleState; href: string; source: InputSourceView;
  coverage: { read: number; needed: number };
}[] };

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

function absenceWord(state: HealthPictureSimpleState, personName: string): string | null {
  switch (state.kind) {
    case "not-covered":
      return cellNotCovered(personName);
    case "no-file":
      return CELL_NO_FILE;
    case "disagree":
      return CELL_FILES_DISAGREE;
    case "not-shared":
      return CELL_NOT_SHARED;
    case "no-report": return CELL_NO_REPORT;
    case "conflicting-calls": return CELL_CONFLICTING_CALLS;
    case "no-prepared-file": return CELL_NO_PREPARED_FILE;
    case "not-generated": return CELL_NOT_GENERATED;
    case "catalog-unavailable": return CELL_CATALOG_UNAVAILABLE;
    case "version-unavailable": return CELL_VERSION_UNAVAILABLE;
    case "no-call": return CELL_NO_CALL;
    case "unrecognized": return CELL_UNRECOGNIZED;
    case "saved": return CELL_SAVED;
    case "legacy": return CELL_LEGACY;
    case "letters": return null;
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
  if (state.kind === "sources") return <td data-slot="health-picture-cell" className="align-top p-2">
    {state.entries.map(entry => <div key={entry.fileId} data-source-file-id={entry.fileId} className="space-y-2 py-2">
      <ClaimBlock subject={{ subjectId: dataSubjectId }} figures={figuresFor(entry.state, layer, personName)} className="space-y-2 p-3">
        {absenceWord(entry.state, personName) ? <p data-slot="cell-absence">{absenceWord(entry.state, personName)}</p> : null}
        {entry.conflictingCalls && entry.state.kind !== "conflicting-calls" ? <p>{CELL_CONFLICTING_CALLS}</p> : null}
        {entry.state.kind === "letters" ? <p data-chip="layer" aria-describedby={captionId} className="text-sm text-ink-muted">{LAYER_CHIP_LABELS[layer]}</p> : null}
        <Link href={entry.href} aria-label={`${openReportLabel(reportTitle, personName)} · ${entry.sourceLabel}`} className="inline-flex min-h-11 items-center text-sm underline">{SAVED_SOURCE_LINK}</Link>
      </ClaimBlock>
      <InputProvenance nested sources={[entry.source]} sourceLabels={{ [entry.fileId]: entry.sourceLabel }} subject={{ subjectId: dataSubjectId }} coverage={entry.coverage}
        state={entry.conflictingCalls ? "conflict" : entry.state.kind === "no-call" ? "noCall" : entry.state.kind === "not-covered" ? "absent" : "recorded"} />
    </div>)}
  </td>;
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
