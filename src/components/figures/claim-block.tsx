/**
 * <ClaimBlock> — the one container every "in the same container" rule
 * resolves to (`[data-claim-block]`). Server component.
 *
 * API: a page passes an array of FigureSpec objects and gets a compliant
 * block back:
 *
 *   <ClaimBlock subject={{ subjectId }} figures={[absolute, interval, …]}>
 *     {optional prose after the figures}
 *   </ClaimBlock>
 *
 * `renderFigures` lets a page lay the rendered <Figure> nodes out itself
 * (one node per spec, in order — a table of region rows, say) while the
 * block still owns the denominator, the attribution and the marker. Without
 * it the figures render in one flex row.
 *
 * The block computes from the specs (src/lib/figures/claim-block.ts):
 *   - the single natural-frequency denominator shared by every figure, or
 *     the one the page forces (`denominator={100}`, the 100-dot renderers);
 *   - whether any figure is modelled, in which case MODELLED_MARKER renders
 *     exactly once, at the end of the block, in `<p data-modelled-marker>`;
 *   - whether any figure is exact arithmetic and none is modelled, in which
 *     case EXACT_MARKER renders exactly once in `<p data-exact-marker>`. A
 *     block that mixes the two bases throws (W9 §3.1).
 *
 * Attribution (`data-subject-id` or `data-subject-pair`) is emitted on this
 * container only; the figures it renders carry none, so each figure has
 * exactly one attributed ancestor.
 */
import type { ReactNode } from "react";
import { claimBlock, type ForcedDenominator } from "@/lib/figures/claim-block";
import {
  EXACT_MARKER,
  MODELLED_MARKER,
  subjectAttributes,
  type SubjectAttribution,
} from "@/lib/figures/contract";
import type { StandaloneFigureSpec } from "@/lib/figures/spec";
import { cn } from "@/lib/utils";
import { Figure } from "./figure";

export interface ClaimBlockProps {
  subject: SubjectAttribution;
  figures: StandaloneFigureSpec[];
  "aria-label"?: string;
  /**
   * Emits `data-density-primary-claim` on the container: the one block a
   * page's density measurement treats as its primary claim
   * (docs/density-baseline.json measurementSelectors). At most one per page.
   */
  densityPrimaryClaim?: boolean;
  /** Receives one <Figure> node per spec, in spec order; returns the layout to render in their place. */
  renderFigures?: (figures: ReactNode[]) => ReactNode;
  /**
   * Forces the block's natural-frequency denominator onto 100 (the 100-dot
   * distribution renderers). Throws when any value rounds below 1 in 100.
   */
  denominator?: ForcedDenominator;
  children?: ReactNode;
  className?: string;
}

export function ClaimBlock({
  subject,
  figures,
  "aria-label": ariaLabel,
  densityPrimaryClaim,
  renderFigures,
  denominator,
  children,
  className,
}: ClaimBlockProps) {
  const summary = claimBlock(figures, denominator === undefined ? {} : { denominator });
  const nodes = figures.map((spec, index) => (
    <Figure key={index} spec={spec} denominator={summary.denominator} />
  ));

  return (
    <section
      data-slot="claim-block"
      data-claim-block="true"
      {...subjectAttributes(subject)}
      data-density-primary-claim={densityPrimaryClaim ? "true" : undefined}
      aria-label={ariaLabel}
      className={cn("rounded-2xl border border-line bg-card p-4 text-ink", className)}
    >
      {renderFigures ? (
        renderFigures(nodes)
      ) : (
        <div className="flex flex-wrap items-baseline gap-x-6 gap-y-3">{nodes}</div>
      )}
      {children}
      {summary.hasModelled ? (
        <p data-modelled-marker="true" className="mt-3 text-sm text-ink-muted">
          {MODELLED_MARKER}
        </p>
      ) : null}
      {summary.hasExact ? (
        <p data-exact-marker="true" className="mt-3 text-sm text-ink-muted">
          {EXACT_MARKER}
        </p>
      ) : null}
    </section>
  );
}
