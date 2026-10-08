/**
 * <LineageCard> — the mother’s-line and father’s-line cards (brief §2 §4.6,
 * §4 §7.5). Server component. The haplogroup name is text, not a figure (it
 * is not a number); the marker support renders as an observed `coverage`
 * figure in a small <ClaimBlock>; the stored support note is kept; the
 * mandated single-line sentence renders only when a line was read. A rendered
 * call also names the tree it was read against and its version, states that
 * no range is put on the name, and gives the tree's resolution limit in plain
 * words (G4.4, which covers every quantity read against a reference panel).
 * The card
 * with no Y data leads with the §2 sentence and keeps the XX gloss. The
 * term "haplogroup" is defined inline on its first occurrence per page
 * (`defineTerm`), never in a heading. A card with no row says why: nothing
 * has been processed yet, Ancestry is off, or Ancestry is on and no result
 * has been generated yet (the last two with a link to the Reports page,
 * where that step is taken) — unless the page's regions section already
 * says so (`absenceStated`), in which case the card is the "not yet"
 * surface with its heading alone, so one sentence is not read three times.
 */
import { ClaimBlock } from "@/components/figures/claim-block";
import { TermDefinition } from "@/components/figures/term-definition";
import {
  FATHER_LINE_HEADING,
  LINEAGE_NO_RANGE,
  UNKNOWN_REFERENCE_TREE,
  LINEAGE_RESOLUTION_LIMIT,
  MOTHER_LINE_HEADING,
  NOTHING_READ,
  NO_Y_LEAD,
  XX_GLOSS,
  lineageSentence,
  treeLine,
  storedModelLine,
} from "@/copy/ancestry";
import type { AncestryReportsStep } from "@/lib/ancestry/absence";
import { LINEAGE_TREES } from "@/lib/ancestry/panel";
import type { CoverageSpec } from "@/lib/figures/spec";
import { AncestryReportsNote } from "./ancestry-absent";

/** The stored `HaplogroupCall`, or the `{ haplogroup: null }` row the process route writes when the file has no such chromosome. */
export interface LineageCall {
  haplogroup: string | null;
  path?: string[];
  matched?: number;
  tested?: number;
  support?: string;
  note?: string;
}

interface LineageCardBaseProps {
  parent: "mother" | "father";
  subjectId: string;
  /** null when no ancestry result row exists for the subject yet. */
  call: LineageCall | null;
  supportNote: string | null;
  /** Render the inline definition of "haplogroup": true on the first card only. */
  defineTerm: boolean;
  knownTree?: boolean;
  modelRecord?: { id: string | null; version: string | null };
  /** The regions section above already states the absence; with no call, render the heading only. */
  absenceStated?: boolean;
}

/**
 * Why there is no row, read only when `call` is null. `permission-off` and
 * `not-generated` each name a step on the subject's own Reports page and
 * link there, so neither can be passed without that link; `nothing-read` is
 * the default.
 */
export type LineageCardProps = LineageCardBaseProps & (
  | { absence?: "nothing-read"; reportsHref?: string }
  | { absence: AncestryReportsStep; reportsHref: string }
);

const TEST_IDS = { mother: "mtdna", father: "ydna" } as const;
const HEADINGS = { mother: MOTHER_LINE_HEADING, father: FATHER_LINE_HEADING } as const;

/** The stored "XX genomes" note is the one the gloss explains. */
const XX_NOTE = "XX genomes";

export function LineageCard(props: LineageCardProps) {
  const { parent, subjectId, call, supportNote, defineTerm, knownTree = true, modelRecord, absenceStated = false } = props;
  const headingId = `${TEST_IDS[parent]}-heading`;
  // Nothing read yet and the regions section has said so: the card is the
  // quiet "not yet" surface, its heading with the sentence as a caption, so
  // each panel still states its own absence (the empty-state spec reads it
  // on all three) without three full-weight lines. The permission-off and
  // not-generated absences keep their full note and its Reports link.
  if (call === null && absenceStated && (props.absence === undefined || props.absence === "nothing-read")) {
    return (
      <section data-testid={TEST_IDS[parent]} aria-labelledby={headingId} className="surface-dashed surface-pad-sm space-y-1">
        <h2 id={headingId} className="title text-ink-muted">
          {HEADINGS[parent]}
        </h2>
        <p className="caption">{NOTHING_READ}</p>
      </section>
    );
  }
  const hasCall = call !== null && call.haplogroup !== null;
  // `classify()` always reports tested markers; the no-chromosome row has none.
  const noChromosome = call !== null && call.haplogroup === null && call.tested === undefined;
  const coverage: CoverageSpec | null =
    hasCall && typeof call.matched === "number" && typeof call.tested === "number"
      ? {
          kind: "coverage",
          class: "quality",
          basis: "observed",
          provenance: { kind: "computed", module: "src/lib/genome/haplogroups.ts" },
          read: call.matched,
          needed: call.tested,
        }
      : null;

  return (
    <section
      data-testid={TEST_IDS[parent]}
      aria-labelledby={headingId}
      className="surface surface-pad-sm space-y-3"
    >
      <h2 id={headingId} className="title text-ink">
        {HEADINGS[parent]}
      </h2>
      {defineTerm ? (
        <p className="text-sm">
          <TermDefinition term="haplogroup" text="Haplogroup" />
        </p>
      ) : null}
      {call === null && (props.absence === "permission-off" || props.absence === "not-generated") ? (
        <AncestryReportsNote step={props.absence} reportsHref={props.reportsHref} />
      ) : call === null ? (
        <p className="surface-inset surface-pad-sm text-base leading-relaxed text-ink">{supportNote ?? NOTHING_READ}</p>
      ) : hasCall ? (
        <>
          <p data-slot="haplogroup" className="display-figure text-forest">
            {call.haplogroup}
          </p>
          {call.path && call.path.length > 0 ? (
            <p data-slot="haplogroup-path" className="mono text-ink-muted">
              {call.path.join(" → ")}
            </p>
          ) : null}
          {coverage ? <ClaimBlock subject={{ subjectId }} figures={[coverage]} className="p-3" /> : null}
          <div data-slot="lineage-provenance" className="max-w-measure space-y-1 text-sm text-ink-muted">
            <p>{knownTree ? treeLine(LINEAGE_TREES[parent]) : UNKNOWN_REFERENCE_TREE}</p>
            {modelRecord ? <p>{storedModelLine(modelRecord.id, modelRecord.version)}</p> : null}
            <p>{LINEAGE_NO_RANGE}</p>
            {knownTree ? <p>{LINEAGE_RESOLUTION_LIMIT}</p> : null}
          </div>
          {supportNote ? <p className="text-sm text-ink-muted">{supportNote}</p> : null}
          <p className="text-sm text-ink">{lineageSentence(parent)}</p>
        </>
      ) : (
        <>
          {parent === "father" && noChromosome ? <p className="text-sm text-ink">{NO_Y_LEAD}</p> : null}
          {supportNote ? <p className="text-sm text-ink-muted">{supportNote}</p> : null}
          {supportNote?.includes(XX_NOTE) ? <p className="text-sm text-ink-muted">{XX_GLOSS}</p> : null}
        </>
      )}
    </section>
  );
}
