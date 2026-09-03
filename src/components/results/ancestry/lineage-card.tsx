/**
 * <LineageCard> — the mother’s-line and father’s-line cards (brief §2 §4.6,
 * §4 §7.5). Server component. The haplogroup name is text, not a figure (it
 * is not a number); the marker support renders as an observed `coverage`
 * figure in a small <ClaimBlock>; the stored support note is kept; the
 * mandated single-line sentence renders only when a line was read. The card
 * with no Y data leads with the §2 sentence and keeps the XX gloss. The
 * term "haplogroup" is defined inline on its first occurrence per page
 * (`defineTerm`), never in a heading.
 */
import { ClaimBlock } from "@/components/figures/claim-block";
import { TermDefinition } from "@/components/figures/term-definition";
import {
  FATHER_LINE_HEADING,
  MOTHER_LINE_HEADING,
  NOTHING_READ,
  NO_Y_LEAD,
  XX_GLOSS,
  lineageSentence,
} from "@/copy/ancestry";
import type { CoverageSpec } from "@/lib/figures/spec";

/** The stored `HaplogroupCall`, or the `{ haplogroup: null }` row the process route writes when the file has no such chromosome. */
export interface LineageCall {
  haplogroup: string | null;
  path?: string[];
  matched?: number;
  tested?: number;
  support?: string;
  note?: string;
}

export interface LineageCardProps {
  parent: "mother" | "father";
  subjectId: string;
  /** null when no ancestry result row exists for the subject yet. */
  call: LineageCall | null;
  supportNote: string | null;
  /** Render the inline definition of "haplogroup": true on the first card only. */
  defineTerm: boolean;
}

const TEST_IDS = { mother: "mtdna", father: "ydna" } as const;
const HEADINGS = { mother: MOTHER_LINE_HEADING, father: FATHER_LINE_HEADING } as const;

/** The stored "XX genomes" note is the one the gloss explains. */
const XX_NOTE = "XX genomes";

export function LineageCard({ parent, subjectId, call, supportNote, defineTerm }: LineageCardProps) {
  const headingId = `${TEST_IDS[parent]}-heading`;
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
      className="space-y-3 rounded-2xl border border-line bg-card p-5"
    >
      <h2 id={headingId} className="text-lg font-semibold text-ink">
        {HEADINGS[parent]}
      </h2>
      {defineTerm ? (
        <p className="text-sm">
          <TermDefinition term="haplogroup" text="Haplogroup" />
        </p>
      ) : null}
      {call === null ? (
        <p className="text-sm text-ink-muted">{NOTHING_READ}</p>
      ) : hasCall ? (
        <>
          <p data-slot="haplogroup" className="font-display text-3xl text-forest">
            {call.haplogroup}
          </p>
          {call.path && call.path.length > 0 ? (
            <p data-slot="haplogroup-path" className="font-mono text-sm text-ink-muted">
              {call.path.join(" → ")}
            </p>
          ) : null}
          {coverage ? <ClaimBlock subject={{ subjectId }} figures={[coverage]} className="p-3" /> : null}
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
