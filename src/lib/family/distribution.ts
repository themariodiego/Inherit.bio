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
 * The sub-1-in-100 rule (line 360) keys on the share itself, never on the
 * dot count the apportionment happened to give (D-036): a category whose
 * share is below 1 in 100 gets exactly one outlined dot, never zero and
 * never a solid one, taken from the largest category where the
 * apportionment gave it none; its sentence names the estimate in 1,000 and
 * is returned as data for the page to render. This cannot arise for a
 * Mendelian cross, whose smallest share is a quarter; it is reached only by
 * banded inputs, which no registered trait produces yet.
 *
 * Every sentence states the figure contract's own rounding of the share
 * (`naturalFrequency`), the same number the block's figure prints, so a
 * category that lent a dot to an outlined one still reads as its figure
 * does and never as the dots it has left. One rounding rule decides both
 * whether 1,000 can show a share and which rung of the ladder can, so
 * `sentence` and `denominator` can never disagree.
 *
 * Nothing here renders. Every count is a plain number for the page to hand
 * to the figure contract; the sentences come from the copy registry.
 */
import { apportionShares } from "@/lib/ancestry/present";
import { belowOneInHundredSentence, outOfHundredSentence } from "@/copy/family/portrait";
import type { ForcedDenominator } from "@/lib/figures/claim-block";
import { NATURAL_FREQUENCY_DENOMINATORS } from "@/lib/figures/contract";
import { chooseDenominator, naturalFrequency } from "@/lib/figures/natural-frequency";

/** The dots are the block's forced denominator (claim-block.ts): typed against it so the two cannot drift. */
export const DOT_COUNT: ForcedDenominator = 100;

/** The ladder's second rung, which `apportionShares` apportions to and the sub-1% sentence names. */
const PER_THOUSAND = NATURAL_FREQUENCY_DENOMINATORS[1];

/** The share below which a category is outlined (line 360): one in the dots' own denominator. */
const ONE_IN_HUNDRED = 1 / DOT_COUNT;

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
   * about {n} would {outcome}." with the figure contract's rounding of the
   * share, or, when outlined, the sub-1% sentence with the same rounding in
   * 1,000. Null when even 1,000 rounds the share below 1; `denominator`
   * then names the rung of the ladder that can show it, for a block of its
   * own.
   */
  sentence: string | null;
  /** The X4.1 denominator the sentence uses, or the one that shows the share at ≥ 1 when the sentence is null. */
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

/** The largest category that is not outlined and can spare a dot, ties by input order. */
function largestLender(dots: readonly number[], outlined: readonly boolean[]): number {
  let largest = -1;
  for (let candidate = 0; candidate < dots.length; candidate++) {
    if (outlined[candidate]) continue;
    if (largest === -1 || dots[candidate] > dots[largest]) largest = candidate;
  }
  if (largest === -1 || dots[largest] <= 1) {
    throw new Error("distribute cannot outline a dot without a category to take it from");
  }
  return largest;
}

/**
 * Categories → 100 dots. `phrases[key]` is the outcome clause of the
 * mandated sentence ("have the condition"). Every share must be a finite,
 * non-negative number and the shares must sum to 1 (`apportionShares`
 * enforces the sum); a NaN, negative or missing share is refused, never
 * filtered away. A category with a share of exactly 0 does not occur and is
 * dropped, never rendered as zero; an absent key is simply absent.
 */
export function distribute<K extends string>(
  shares: Partial<Record<K, number>>,
  phrases: Record<K, string>,
): Distribution<K> {
  for (const key of Object.keys(shares) as K[]) {
    const share = shares[key];
    if (typeof share !== "number" || !Number.isFinite(share) || share < 0) {
      throw new Error(`distribute: the share for ${key} must be a finite number in [0, 1], got ${String(share)}`);
    }
  }
  const keys = (Object.keys(shares) as K[]).filter((key) => (shares[key] as number) > 0);
  if (keys.length === 0) throw new Error("distribute needs at least one category with a share above 0");
  const nonZero = {} as Record<K, number>;
  for (const key of keys) nonZero[key] = shares[key] as number;
  const units = apportionShares(nonZero);
  const perThousand = keys.map((key) => units[key]);
  const dots = dotsFromPerThousand(perThousand);

  // The sub-1-in-100 rule, on the share itself: exactly one outlined dot
  // for every category below it, borrowed from the largest category
  // wherever the apportionment left the outlined one with none, and given
  // back wherever it left one with more.
  const outlined = keys.map((key) => nonZero[key] < ONE_IN_HUNDRED);
  for (let index = 0; index < keys.length; index++) {
    if (!outlined[index]) continue;
    while (dots[index] < 1) {
      dots[largestLender(dots, outlined)] -= 1;
      dots[index] += 1;
    }
    while (dots[index] > 1) {
      dots[largestLender(dots, outlined)] += 1;
      dots[index] -= 1;
    }
  }

  const categories = keys.map((key, index): DotCategory<K> => {
    const share = nonZero[key];
    if (outlined[index]) {
      // One rounding rule for both the sentence and the rung: the figure
      // contract's own, which `chooseDenominator` also applies.
      const inThousand = naturalFrequency(share, PER_THOUSAND).count;
      const canShowInThousand = inThousand >= 1;
      return {
        key,
        share,
        dots: 1,
        outlined: true,
        perThousand: perThousand[index],
        sentence: canShowInThousand ? belowOneInHundredSentence(inThousand) : null,
        denominator: canShowInThousand ? PER_THOUSAND : chooseDenominator([share]),
      };
    }
    return {
      key,
      share,
      dots: dots[index],
      outlined: false,
      perThousand: perThousand[index],
      sentence: outOfHundredSentence(naturalFrequency(share, DOT_COUNT).count, phrases[key]),
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
