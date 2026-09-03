/**
 * The 100-dot distribution (design §2.5 "Distribution renderer"; brief §2
 * §5.6 line 360, X4.1). Categories with shares summing to 1 become dot
 * counts summing to exactly 100 by largest remainder, so the grid always
 * shows 100 dots and every dot belongs to one category.
 *
 * The apportionment is `apportionShares` from the ancestry surface (the one
 * home of largest-remainder apportionment in this repository): it apportions
 * to 1,000 units, and the second step below carries those units into 100
 * dots by the same rule. For exact Mendelian fractions the two steps are
 * lossless: a quarter is 250 units and 25 dots.
 *
 * The sub-1-in-100 rule (line 360): a category that exists but would round
 * to no dot gets one outlined dot, never zero, taken from the largest
 * category so the grid still holds 100; its sentence names the estimate in
 * 1,000 and is returned as data for the page to render. This cannot arise
 * for a Mendelian cross, whose smallest share is a quarter; it is reached
 * only by banded inputs, which no registered trait produces yet.
 *
 * Nothing here renders. Every count is a plain number for the page to hand
 * to the figure contract; the sentences come from the copy registry.
 */
import { apportionShares } from "@/lib/ancestry/present";
import { belowOneInHundredSentence, outOfHundredSentence } from "@/copy/family/portrait";
import type { ForcedDenominator } from "@/lib/figures/claim-block";
import { NATURAL_FREQUENCY_DENOMINATORS } from "@/lib/figures/contract";
import { chooseDenominator } from "@/lib/figures/natural-frequency";

/** The dots are the block's forced denominator (claim-block.ts): typed against it so the two cannot drift. */
export const DOT_COUNT: ForcedDenominator = 100;

/** The ladder's second rung, which `apportionShares` apportions to and the sub-1% sentence names. */
const PER_THOUSAND = NATURAL_FREQUENCY_DENOMINATORS[1];

export interface DotCategory<K extends string> {
  key: K;
  /** The share the caller gave, in [0, 1]. */
  share: number;
  /** Whole dots of the 100. */
  dots: number;
  /** One outlined dot standing for fewer than 1 in 100 (line 360). */
  outlined: boolean;
  /** The apportioned units in 1,000, from `apportionShares`. */
  perThousand: number;
  /**
   * The mandated sentence for this category: "Out of 100 possible children,
   * about {n} would {outcome}." or, when outlined, the sub-1% sentence. Null
   * when even 1,000 cannot show the share as a whole number; `denominator`
   * then names the rung of the ladder that can, for a block of its own.
   */
  sentence: string | null;
  /** The X4.1 denominator that shows the share at ≥ 1, when the sentence is null. */
  denominator: number | null;
}

export interface Distribution<K extends string> {
  dots: ForcedDenominator;
  categories: DotCategory<K>[];
  /** The categories that fell below 1 in 100, in order; empty for every Mendelian cross. */
  belowOne: DotCategory<K>[];
}

/**
 * Largest remainder from units in 1,000 to dots in 100: floor each, then
 * hand the leftover dots to the largest remainders, ties by input order.
 */
function dotsFromPerThousand(perThousand: readonly number[]): number[] {
  const unitsPerDot = PER_THOUSAND / DOT_COUNT;
  const dots = perThousand.map((units) => Math.floor(units / unitsPerDot));
  let leftover = DOT_COUNT - dots.reduce((sum, value) => sum + value, 0);
  const order = perThousand
    .map((units, index) => ({ index, remainder: units % unitsPerDot }))
    .sort((a, b) => b.remainder - a.remainder || a.index - b.index);
  for (let cursor = 0; leftover > 0 && order.length > 0; cursor = (cursor + 1) % order.length) {
    dots[order[cursor].index] += 1;
    leftover -= 1;
  }
  return dots;
}

/**
 * Categories → 100 dots. `phrases[key]` is the outcome clause of the
 * mandated sentence ("have the condition"). Shares must be finite,
 * non-negative and sum to 1 (`apportionShares` enforces it). A category
 * with a share of exactly 0 does not occur and is dropped, never rendered
 * as zero.
 */
export function distribute<K extends string>(
  shares: Record<K, number>,
  phrases: Record<K, string>,
): Distribution<K> {
  const keys = (Object.keys(shares) as K[]).filter((key) => shares[key] > 0);
  if (keys.length === 0) throw new Error("distribute needs at least one category with a share above 0");
  const nonZero = {} as Record<K, number>;
  for (const key of keys) nonZero[key] = shares[key];
  const units = apportionShares(nonZero);
  const perThousand = keys.map((key) => units[key]);
  const dots = dotsFromPerThousand(perThousand);

  // The sub-1-in-100 rule: an outlined dot for a category that would
  // otherwise vanish, borrowed from the largest category.
  const outlined = keys.map((_, index) => dots[index] === 0);
  for (let index = 0; index < keys.length; index++) {
    if (!outlined[index]) continue;
    let largest = -1;
    for (let candidate = 0; candidate < keys.length; candidate++) {
      if (outlined[candidate]) continue;
      if (largest === -1 || dots[candidate] > dots[largest]) largest = candidate;
    }
    if (largest === -1 || dots[largest] <= 1) {
      throw new Error("distribute cannot outline a dot without a category to take it from");
    }
    dots[largest] -= 1;
    dots[index] = 1;
  }

  const categories = keys.map((key, index): DotCategory<K> => {
    const share = shares[key];
    if (outlined[index]) {
      const canShowInThousand = perThousand[index] >= 1;
      return {
        key,
        share,
        dots: 1,
        outlined: true,
        perThousand: perThousand[index],
        sentence: canShowInThousand ? belowOneInHundredSentence(perThousand[index]) : null,
        denominator: canShowInThousand ? PER_THOUSAND : chooseDenominator([share]),
      };
    }
    return {
      key,
      share,
      dots: dots[index],
      outlined: false,
      perThousand: perThousand[index],
      sentence: outOfHundredSentence(dots[index], phrases[key]),
      denominator: DOT_COUNT,
    };
  });

  return {
    dots: DOT_COUNT,
    categories,
    belowOne: categories.filter((category) => category.outlined),
  };
}

/** The mandated sentence pattern (line 360; open decision 6), from its home in the copy registry. */
export { outOfHundredSentence, belowOneInHundredSentence };
