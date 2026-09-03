/**
 * Block-level facts a <ClaimBlock> derives from its figure specs, so the
 * component itself stays a plain server component with no introspection of
 * children: whether the modelled marker is due, and the single natural-
 * frequency denominator every figure in the block must share (§X4.1).
 */
import { chooseDenominator } from "./natural-frequency";
import { frequencyValues, type FigureSpec } from "./spec";

export interface ClaimBlockSummary {
  hasModelled: boolean;
  /** True when at least one figure renders a natural frequency. */
  needsDenominator: boolean;
  /** The shared block denominator, or null when the floor string applies (or no figure needs one). */
  denominator: number | null;
}

/**
 * §X4.2 / §4 §2.5: a percentile renders only beside an absolute risk in the
 * same block. It is never the only quantity, and never stands against a
 * comparison group that has no absolute figure. Enforced here so no page can
 * emit a lone percentile by mistake.
 */
export function assertPercentileHasAbsolute(figures: FigureSpec[]): void {
  const hasPercentile = figures.some((figure) => figure.kind === "percentile");
  const hasAbsolute = figures.some((figure) => figure.kind === "absolute");
  if (hasPercentile && !hasAbsolute) {
    throw new Error(
      "A percentile cannot render without an absolute risk in the same claim block (X4.2).",
    );
  }
}

export function claimBlock(figures: FigureSpec[]): ClaimBlockSummary {
  assertPercentileHasAbsolute(figures);
  const values = figures.flatMap(frequencyValues);
  return {
    hasModelled: figures.some((figure) => figure.basis === "modelled"),
    needsDenominator: values.length > 0,
    denominator: values.length > 0 ? chooseDenominator(values) : null,
  };
}
