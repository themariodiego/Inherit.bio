/**
 * Mendelian crosses as exact fractions (design §5; brief §3 §8.4 line 1016,
 * §4 §5.3 line 1349, A.7 line 2238, X10.1 line 2480).
 *
 * Every number here follows from counting equally likely gametes; nothing is
 * modelled, sampled, weighted or read from a table. A parent contributes one
 * of two copies of a position at random, so a cross is the four equally
 * likely combinations of two parents' two copies, and each outcome is the
 * count of combinations that produce it over four. The fraction is then
 * reduced only by a factor common to the whole cross, so "2 in 4" stays
 * "2 in 4" beside "1 in 4" (the derivation the brief mandates) and "2 in 4"
 * alone becomes "1 in 2".
 *
 * Outcomes that cannot occur in a cross are absent from it, never present
 * with a zero: the string "0%" is prohibited for every monogenic Portrait
 * outcome (line 2238), and the honest sentence for the missing outcome is
 * the copy registry's, keyed by `absentOutcomes`.
 *
 * X-linked crosses show both sexes. Their equal split is the assumption
 * `equal_x_y_transmission`, carried in `assumptions` as an assumption; it is
 * never stated as an observed birth ratio, and nothing here predicts or
 * selects a child's sex (line 2238, G5.9).
 *
 * Pure functions over plain values; no I/O, no React, no database.
 */

export const MENDEL_PATTERNS = ["autosomal_recessive", "autosomal_dominant", "x_linked"] as const;
export type MendelPattern = (typeof MENDEL_PATTERNS)[number];

export const MENDEL_OUTCOMES = [
  "affected",
  "carrier",
  "neither",
  "boy_affected",
  "boy_neither",
  "girl_affected",
  "girl_carrier",
  "girl_neither",
] as const;
export type MendelOutcome = (typeof MENDEL_OUTCOMES)[number];

/** The outcomes an autosomal pattern can name (the derivation's three words). */
export const AUTOSOMAL_OUTCOMES = ["affected", "carrier", "neither"] as const;
export type AutosomalOutcome = (typeof AUTOSOMAL_OUTCOMES)[number];

export const X_LINKED_OUTCOMES = [
  "boy_affected",
  "boy_neither",
  "girl_affected",
  "girl_carrier",
  "girl_neither",
] as const;
export type XLinkedOutcome = (typeof X_LINKED_OUTCOMES)[number];

/**
 * What the arithmetic rests on (line 1349): stated as assumptions in the
 * returned structure so the "How sure we are" block can name each one in
 * words, and so no assumption is ever presented as a measurement.
 */
export const MENDEL_ASSUMPTIONS = [
  "independent_assortment",
  "no_new_mutation",
  "no_imprinting",
  "runs_below_threshold",
  "equal_x_y_transmission",
] as const;
export type MendelAssumption = (typeof MENDEL_ASSUMPTIONS)[number];

/** How many changed copies a file shows at the position. */
export type AutosomalCopies = 0 | 1 | 2;
/** A mother's two X copies; a father's one X copy (his other chromosome is the Y). */
export type MotherCopies = 0 | 1 | 2;
export type FatherCopies = 0 | 1;

export interface ExactFraction {
  numerator: number;
  denominator: number;
}

export interface CrossOutcome {
  outcome: MendelOutcome;
  fraction: ExactFraction;
  /** The same fraction over 100, always a whole number for these crosses. */
  inHundred: number;
}

export type CrossParents =
  | { kind: "autosomal"; a: AutosomalCopies; b: AutosomalCopies }
  | { kind: "x_linked"; mother: MotherCopies; father: FatherCopies };

export interface MendelCross {
  pattern: MendelPattern;
  parents: CrossParents;
  /** Always exact: the figure contract's basis for arithmetic with no model in between. */
  basis: "exact";
  /** The outcomes that occur, each with a non-zero fraction; they sum to 1. */
  outcomes: readonly CrossOutcome[];
  /** Outcomes the pattern can name that this cross cannot produce. Rendered as words, never as 0%. */
  absentOutcomes: readonly MendelOutcome[];
  assumptions: readonly MendelAssumption[];
  /** X-linked crosses show both sexes; their equal split is an assumption above, not an observation. */
  sexes: "not_split" | "both_by_assumption";
}

/** The six canonical crosses (line 2238; design §5). */
export const CANONICAL_CROSSES = [
  "recessive_both_one_copy",
  "recessive_one_copy_none_found",
  "dominant_one_copy",
  "x_linked_mother_one_copy",
  "x_linked_father_affected",
  "x_linked_mother_one_copy_father_affected",
] as const;
export type CanonicalCross = (typeof CANONICAL_CROSSES)[number];

const AUTOSOMAL_ASSUMPTIONS: readonly MendelAssumption[] = [
  "independent_assortment",
  "no_new_mutation",
  "no_imprinting",
  "runs_below_threshold",
];

const X_LINKED_ASSUMPTIONS: readonly MendelAssumption[] = [
  ...AUTOSOMAL_ASSUMPTIONS,
  "equal_x_y_transmission",
];

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}

/** Two copies of a position, each either changed (1) or not (0). */
function copies(changed: 0 | 1 | 2): readonly (0 | 1)[] {
  return changed === 0 ? [0, 0] : changed === 1 ? [0, 1] : [1, 1];
}

/**
 * Counts per outcome over `total` equally likely combinations, reduced by
 * the factor common to the whole cross, with zero-count outcomes absent.
 */
function outcomesFromCounts(
  counts: Partial<Record<MendelOutcome, number>>,
  total: number,
  order: readonly MendelOutcome[],
): { outcomes: CrossOutcome[]; absentOutcomes: MendelOutcome[] } {
  const present = order.filter((outcome) => (counts[outcome] ?? 0) > 0);
  const absent = order.filter((outcome) => (counts[outcome] ?? 0) === 0);
  const common = present.reduce((acc, outcome) => gcd(acc, counts[outcome] ?? 0), total);
  const outcomes = present.map((outcome) => {
    const count = counts[outcome] ?? 0;
    const numerator = count / common;
    const denominator = total / common;
    const inHundred = (count * 100) / total;
    if (!Number.isInteger(inHundred)) {
      throw new Error(`mendel: ${outcome} is ${count}/${total}, which is not a whole number in 100`);
    }
    return { outcome, fraction: { numerator, denominator }, inHundred };
  });
  return { outcomes, absentOutcomes: absent };
}

/**
 * An autosomal cross from the number of changed copies each parent's file
 * shows. Recessive: two changed copies in the child is `affected`, one is
 * `carrier`, none is `neither`. Dominant: one or two is `affected`.
 */
export function autosomalCross(
  pattern: Exclude<MendelPattern, "x_linked">,
  a: AutosomalCopies,
  b: AutosomalCopies,
): MendelCross {
  const counts: Partial<Record<MendelOutcome, number>> = {};
  let total = 0;
  for (const fromA of copies(a)) {
    for (const fromB of copies(b)) {
      const inChild = fromA + fromB;
      const outcome: MendelOutcome =
        pattern === "autosomal_recessive"
          ? inChild === 2
            ? "affected"
            : inChild === 1
              ? "carrier"
              : "neither"
          : inChild >= 1
            ? "affected"
            : "neither";
      counts[outcome] = (counts[outcome] ?? 0) + 1;
      total += 1;
    }
  }
  const { outcomes, absentOutcomes } = outcomesFromCounts(
    counts,
    total,
    pattern === "autosomal_recessive" ? AUTOSOMAL_OUTCOMES : ["affected", "neither"],
  );
  return {
    pattern,
    parents: { kind: "autosomal", a, b },
    basis: "exact",
    outcomes,
    absentOutcomes,
    assumptions: AUTOSOMAL_ASSUMPTIONS,
    sexes: "not_split",
  };
}

/**
 * An X-linked cross over 100 pregnancies including both sexes. The father
 * passes either his X or his Y, taken as equally likely (the assumption
 * `equal_x_y_transmission`); the mother passes one of her two X copies. A
 * boy's one X decides his outcome; a girl has two.
 */
export function xLinkedCross(mother: MotherCopies, father: FatherCopies): MendelCross {
  const counts: Partial<Record<MendelOutcome, number>> = {};
  let total = 0;
  for (const fromMother of copies(mother)) {
    for (const fromFather of [{ sex: "girl", x: father }, { sex: "boy", x: null }] as const) {
      let outcome: MendelOutcome;
      if (fromFather.sex === "boy") {
        outcome = fromMother === 1 ? "boy_affected" : "boy_neither";
      } else {
        const inChild = fromMother + fromFather.x;
        outcome = inChild === 2 ? "girl_affected" : inChild === 1 ? "girl_carrier" : "girl_neither";
      }
      counts[outcome] = (counts[outcome] ?? 0) + 1;
      total += 1;
    }
  }
  const { outcomes, absentOutcomes } = outcomesFromCounts(counts, total, X_LINKED_OUTCOMES);
  return {
    pattern: "x_linked",
    parents: { kind: "x_linked", mother, father },
    basis: "exact",
    outcomes,
    absentOutcomes,
    assumptions: X_LINKED_ASSUMPTIONS,
    sexes: "both_by_assumption",
  };
}

/** One of the six canonical crosses, by name. */
export function canonicalCross(id: CanonicalCross): MendelCross {
  switch (id) {
    case "recessive_both_one_copy":
      return autosomalCross("autosomal_recessive", 1, 1);
    case "recessive_one_copy_none_found":
      return autosomalCross("autosomal_recessive", 1, 0);
    case "dominant_one_copy":
      return autosomalCross("autosomal_dominant", 1, 0);
    case "x_linked_mother_one_copy":
      return xLinkedCross(1, 0);
    case "x_linked_father_affected":
      return xLinkedCross(0, 1);
    case "x_linked_mother_one_copy_father_affected":
      return xLinkedCross(1, 1);
  }
}

/** The outcomes as shares summing to 1, in cross order: the input the 100-dot distribution takes. */
export function crossShares(cross: MendelCross): Record<MendelOutcome, number> {
  const shares = {} as Record<MendelOutcome, number>;
  for (const { outcome, fraction } of cross.outcomes) {
    shares[outcome] = fraction.numerator / fraction.denominator;
  }
  return shares;
}

/** The outcome's share of the cross, in [0, 1]. */
export function outcomeShare(outcome: CrossOutcome): number {
  return outcome.fraction.numerator / outcome.fraction.denominator;
}
