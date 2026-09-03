/**
 * <RelativeFigure> — the only way a relative figure reaches the page
 * (§2.4, §X4.3, G4.1). Every prop is required and non-nullable, so a
 * relative figure can never appear without its absolute counterparts.
 *
 * It renders, inside one <ClaimBlock>, in this order:
 *   1. the absolute figure before (data-abs-before)
 *   2. the absolute figure after (data-abs-after)
 *   3. the difference in percentage points, with its gloss
 *   4. the natural-frequency pair on the block denominator
 *   5. LAST, the relative text, as `<p data-figure-kind="relative">`
 * followed by the modelled marker (relative measures are always modelled).
 *
 * Prominence: absolute nodes use `text-2xl font-semibold` in full ink; the
 * relative node uses `text-sm` in muted ink. Unit tests assert this by class
 * presence; the E2E check reads computed style (font-size, font-weight and
 * contrast of each absolute ≥ the relative's).
 *
 * Odds ratios: there is deliberately no prop for one. `relative.value` must
 * be the ratio of the two absolutes (after / before), and it is checked
 * against them at render time, so a number that is not that ratio — an odds
 * ratio, a hazard ratio, a figure copied from a paper — cannot be smuggled
 * in as the "relative" figure.
 */
import type { ReactNode } from "react";
import { provenanceAttribute, type FigureProvenance, type SubjectAttribution } from "@/lib/figures/contract";
import type { StandaloneFigureSpec } from "@/lib/figures/spec";
import { ClaimBlock } from "./claim-block";

export interface RelativeFigureProps {
  /** `text` is the sentence shown last; `value` is after / before. */
  relative: { text: string; value: number };
  /** Probability in [0, 1] for the baseline leg. */
  absoluteBefore: number;
  /** Probability in [0, 1] for the subject leg. */
  absoluteAfter: number;
  /** Group names for each leg, e.g. { before: "men aged 40 to 49", after: "people like you" }. */
  groups: { before: string; after: string };
  subject: SubjectAttribution;
  provenance: FigureProvenance;
  "aria-label"?: string;
  /** Prose that belongs in the same block, e.g. the within-family accuracy sentence. */
  children?: ReactNode;
}

/** Tolerance on `relative.value` against after / before (rounding in the source). */
const RATIO_TOLERANCE = 0.05;

export function RelativeFigure({
  relative,
  absoluteBefore,
  absoluteAfter,
  groups,
  subject,
  provenance,
  "aria-label": ariaLabel,
  children,
}: RelativeFigureProps) {
  const ratio = absoluteAfter / absoluteBefore;
  if (!(absoluteBefore > 0) || Math.abs(relative.value - ratio) > RATIO_TOLERANCE * ratio) {
    throw new Error(
      "relative.value must be absoluteAfter / absoluteBefore. Odds ratios and other relative measures cannot render.",
    );
  }

  const common = { class: "estimate", basis: "modelled", provenance } as const;
  const figures: StandaloneFigureSpec[] = [
    { ...common, kind: "absolute", value: absoluteBefore, group: groups.before, comparisonLeg: "before" },
    { ...common, kind: "absolute", value: absoluteAfter, group: groups.after, comparisonLeg: "after" },
    { ...common, kind: "difference-pp", after: absoluteAfter, before: absoluteBefore },
    {
      ...common,
      kind: "natural-frequency",
      subject: absoluteAfter,
      comparator: absoluteBefore,
      subjectGroup: groups.after,
      comparatorGroup: groups.before,
    },
  ];

  return (
    <ClaimBlock subject={subject} figures={figures} aria-label={ariaLabel}>
      <p
        data-slot="figure"
        data-figure-kind="relative"
        data-figure-class="estimate"
        data-figure-basis="modelled"
        data-provenance={provenanceAttribute(provenance)}
        data-relative-figure="true"
        data-relative-value={relative.value}
        className="mt-3 text-sm text-ink-muted"
      >
        {relative.text}
      </p>
      {children}
    </ClaimBlock>
  );
}
