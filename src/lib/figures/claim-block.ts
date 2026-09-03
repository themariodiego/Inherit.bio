/**
 * Block-level facts a <ClaimBlock> derives from its figure specs, so the
 * component itself stays a plain server component with no introspection of
 * children: whether the modelled or the exact marker is due, and the single
 * natural-frequency denominator every figure in the block must share (§X4.1).
 */
import { chooseDenominator } from "./natural-frequency";
import { frequencyValues, type FigureSpec } from "./spec";

/**
 * The one denominator a block may force (W9 §3.1): the 100-dot distribution
 * renderers are the denominator, so the block states it rather than choosing.
 */
export type ForcedDenominator = 100;

export interface ClaimBlockOptions {
  /**
   * Force every natural frequency in the block onto 100. Every value must
   * round to at least 1 in 100; a value that would round below 1 throws, and
   * belongs in its own block at a denominator X4.1 can show it at.
   */
  denominator?: ForcedDenominator;
}

export interface ClaimBlockSummary {
  hasModelled: boolean;
  /** True when at least one figure is exact arithmetic (basis "exact"). */
  hasExact: boolean;
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

/**
 * W9 §3.1: a Mendelian fraction and a modelled band never share a block,
 * because the block would then have to carry both markers and contradict
 * itself. Enforced here so no page can mix them by mistake.
 */
export function assertBasesDoNotMix(figures: FigureSpec[]): void {
  const hasModelled = figures.some((figure) => figure.basis === "modelled");
  const hasExact = figures.some((figure) => figure.basis === "exact");
  if (hasModelled && hasExact) {
    throw new Error(
      "A claim block cannot mix exact and modelled figures: render the exact arithmetic and the modelled estimate in separate blocks (W9 §3.1).",
    );
  }
}

export function claimBlock(figures: FigureSpec[], options: ClaimBlockOptions = {}): ClaimBlockSummary {
  assertPercentileHasAbsolute(figures);
  assertBasesDoNotMix(figures);
  const values = figures.flatMap(frequencyValues);
  const hasModelled = figures.some((figure) => figure.basis === "modelled");
  const hasExact = figures.some((figure) => figure.basis === "exact");

  if (options.denominator !== undefined) {
    if (options.denominator !== 100) {
      throw new Error(`A claim block can force only the denominator 100, not ${String(options.denominator)}.`);
    }
    const belowOne = values.filter((value) => Math.round(value * 100) < 1);
    if (belowOne.length > 0) {
      throw new Error(
        `A forced denominator of 100 cannot show ${belowOne.map(String).join(", ")}: the value rounds below 1 in 100 (X4.1). Render it in its own block.`,
      );
    }
    return { hasModelled, hasExact, needsDenominator: values.length > 0, denominator: 100 };
  }

  return {
    hasModelled,
    hasExact,
    needsDenominator: values.length > 0,
    denominator: values.length > 0 ? chooseDenominator(values) : null,
  };
}
