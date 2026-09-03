import { describe, expect, it } from "vitest";
import { derivationLine, xLinkedSentence } from "@/copy/family/portrait";
import { claimBlock } from "@/lib/figures/claim-block";
import { figureText } from "@/lib/figures/figure-text";
import { formatPercent, naturalFrequency, percentNumeral } from "@/lib/figures/natural-frequency";
import type { FigureSpec } from "@/lib/figures/spec";
import {
  AUTOSOMAL_OUTCOMES,
  CANONICAL_CROSSES,
  X_LINKED_OUTCOMES,
  autosomalCross,
  canonicalCross,
  crossShares,
  outcomeShare,
  xLinkedCross,
  type AutosomalCopies,
  type FatherCopies,
  type MendelCross,
  type MotherCopies,
} from "./mendel";

/**
 * The brief's `mendel.test.ts` (lines 2238, 2304): the six canonical crosses
 * as exact fractions, every split summing to 100, and no outcome that
 * renders zero — proved by rendering every outcome through the figure
 * contract the page will use.
 */

const provenance = { kind: "computed", module: "family/mendel" } as const;

function specsOf(cross: MendelCross): FigureSpec[] {
  return cross.outcomes.map((outcome) => ({
    kind: "natural-frequency",
    class: "variant-call",
    basis: "exact",
    provenance,
    value: outcomeShare(outcome),
  }));
}

/** Every cross the generic functions can produce, canonical or not. */
function everyCross(): MendelCross[] {
  const crosses: MendelCross[] = [];
  const copies: AutosomalCopies[] = [0, 1, 2];
  for (const a of copies) {
    for (const b of copies) {
      crosses.push(autosomalCross("autosomal_recessive", a, b));
      crosses.push(autosomalCross("autosomal_dominant", a, b));
    }
  }
  const mothers: MotherCopies[] = [0, 1, 2];
  const fathers: FatherCopies[] = [0, 1];
  for (const mother of mothers) for (const father of fathers) crosses.push(xLinkedCross(mother, father));
  return crosses;
}

describe("the six canonical crosses", () => {
  it("recessive, both one copy: 25 affected, 50 carriers, 25 neither, with the mandated derivation", () => {
    const cross = canonicalCross("recessive_both_one_copy");
    expect(cross.pattern).toBe("autosomal_recessive");
    expect(cross.basis).toBe("exact");
    expect(cross.outcomes).toEqual([
      { outcome: "affected", fraction: { numerator: 1, denominator: 4 }, inHundred: 25 },
      { outcome: "carrier", fraction: { numerator: 2, denominator: 4 }, inHundred: 50 },
      { outcome: "neither", fraction: { numerator: 1, denominator: 4 }, inHundred: 25 },
    ]);
    expect(cross.absentOutcomes).toEqual([]);
    expect(derivationLine(cross.outcomes)).toBe(
      "1 in 4 (25%) affected · 2 in 4 (50%) carriers · 1 in 4 (25%) neither",
    );
    expect(cross.sexes).toBe("not_split");
  });

  it("recessive, one copy and none found: 50 carriers, 50 neither; the affected outcome is absent, not zero", () => {
    const cross = canonicalCross("recessive_one_copy_none_found");
    expect(cross.outcomes).toEqual([
      { outcome: "carrier", fraction: { numerator: 1, denominator: 2 }, inHundred: 50 },
      { outcome: "neither", fraction: { numerator: 1, denominator: 2 }, inHundred: 50 },
    ]);
    expect(cross.absentOutcomes).toEqual(["affected"]);
  });

  it("dominant, one copy: 50 affected, 50 neither", () => {
    const cross = canonicalCross("dominant_one_copy");
    expect(cross.pattern).toBe("autosomal_dominant");
    expect(cross.outcomes).toEqual([
      { outcome: "affected", fraction: { numerator: 1, denominator: 2 }, inHundred: 50 },
      { outcome: "neither", fraction: { numerator: 1, denominator: 2 }, inHundred: 50 },
    ]);
    expect(cross.absentOutcomes).toEqual([]);
  });

  it("X-linked, mother one copy: four outcomes of 25 over 100 pregnancies, both sexes shown", () => {
    const cross = canonicalCross("x_linked_mother_one_copy");
    expect(cross.pattern).toBe("x_linked");
    expect(cross.outcomes).toEqual([
      { outcome: "boy_affected", fraction: { numerator: 1, denominator: 4 }, inHundred: 25 },
      { outcome: "boy_neither", fraction: { numerator: 1, denominator: 4 }, inHundred: 25 },
      { outcome: "girl_carrier", fraction: { numerator: 1, denominator: 4 }, inHundred: 25 },
      { outcome: "girl_neither", fraction: { numerator: 1, denominator: 4 }, inHundred: 25 },
    ]);
    expect(cross.absentOutcomes).toEqual(["girl_affected"]);
    expect(xLinkedSentence(25, 25)).toBe(
      "Out of 100 possible pregnancies, about 25 would be boys with the condition and about 25 girls who carry it.",
    );
  });

  it("X-linked, father affected: every girl carries, no boy is affected, nothing reads zero", () => {
    const cross = canonicalCross("x_linked_father_affected");
    expect(cross.outcomes).toEqual([
      { outcome: "boy_neither", fraction: { numerator: 1, denominator: 2 }, inHundred: 50 },
      { outcome: "girl_carrier", fraction: { numerator: 1, denominator: 2 }, inHundred: 50 },
    ]);
    expect(cross.absentOutcomes).toEqual(["boy_affected", "girl_affected", "girl_neither"]);
  });

  it("X-linked, mother one copy and father affected: four outcomes of 25 including affected girls", () => {
    const cross = canonicalCross("x_linked_mother_one_copy_father_affected");
    expect(cross.outcomes.map((outcome) => [outcome.outcome, outcome.inHundred])).toEqual([
      ["boy_affected", 25],
      ["boy_neither", 25],
      ["girl_affected", 25],
      ["girl_carrier", 25],
    ]);
    expect(cross.absentOutcomes).toEqual(["girl_neither"]);
  });

  it("names exactly six", () => {
    expect(CANONICAL_CROSSES).toHaveLength(6);
    for (const id of CANONICAL_CROSSES) expect(canonicalCross(id).outcomes.length).toBeGreaterThan(0);
  });
});

describe("exactness", () => {
  it("every outcome is an exact rational whose share equals its hundredths and every split sums to 100", () => {
    for (const cross of everyCross()) {
      const total = cross.outcomes.reduce((sum, outcome) => sum + outcome.inHundred, 0);
      expect(total, JSON.stringify(cross.parents)).toBe(100);
      for (const outcome of cross.outcomes) {
        expect(Number.isInteger(outcome.fraction.numerator)).toBe(true);
        expect(Number.isInteger(outcome.fraction.denominator)).toBe(true);
        expect(outcome.fraction.numerator).toBeGreaterThan(0);
        expect(outcome.inHundred).toBe((outcome.fraction.numerator * 100) / outcome.fraction.denominator);
        expect(Number.isInteger(outcome.inHundred)).toBe(true);
      }
      const shares = Object.values(crossShares(cross)).reduce((sum, share) => sum + share, 0);
      expect(shares).toBeCloseTo(1, 12);
    }
  });

  it("states the equal X/Y split as an assumption on X-linked crosses only, never on autosomal ones", () => {
    for (const cross of everyCross()) {
      const hasEqualSplit = cross.assumptions.includes("equal_x_y_transmission");
      expect(hasEqualSplit).toBe(cross.pattern === "x_linked");
      expect(cross.sexes).toBe(cross.pattern === "x_linked" ? "both_by_assumption" : "not_split");
      for (const required of ["independent_assortment", "no_new_mutation", "no_imprinting", "runs_below_threshold"]) {
        expect(cross.assumptions).toContain(required);
      }
    }
  });

  it("only names outcomes its pattern can name", () => {
    for (const cross of everyCross()) {
      const allowed: readonly string[] =
        cross.pattern === "x_linked"
          ? X_LINKED_OUTCOMES
          : cross.pattern === "autosomal_recessive"
            ? AUTOSOMAL_OUTCOMES
            : ["affected", "neither"];
      for (const outcome of cross.outcomes) expect(allowed).toContain(outcome.outcome);
      for (const outcome of cross.absentOutcomes) expect(allowed).toContain(outcome);
      const named = [...cross.outcomes.map((outcome) => outcome.outcome), ...cross.absentOutcomes];
      expect([...named].sort()).toEqual([...allowed].sort());
    }
  });
});

describe("no outcome renders zero", () => {
  it("never produces the string 0% or a count of 0 in 100 for any monogenic outcome (brief line 2238)", () => {
    for (const cross of everyCross()) {
      for (const outcome of cross.outcomes) {
        const share = outcomeShare(outcome);
        expect(share).toBeGreaterThanOrEqual(0.25);
        expect(formatPercent(share)).not.toBe("0%");
        expect(percentNumeral(share)).not.toMatch(/^0(\.0+)?$/);
        expect(naturalFrequency(share, 100).count).toBeGreaterThanOrEqual(1);
        expect(`${outcome.inHundred}%`).not.toBe("0%");
      }
      // The forced-denominator block the page renders these in accepts every
      // outcome at 100, which it would refuse for anything rounding below 1.
      const summary = claimBlock(specsOf(cross), { denominator: 100 });
      expect(summary).toEqual({ hasModelled: false, hasExact: true, needsDenominator: true, denominator: 100 });
      for (const spec of specsOf(cross)) {
        const text = figureText(spec as Parameters<typeof figureText>[0], 100);
        expect(text.value).toMatch(/^about \d+ in 100$/);
        expect(text.value).not.toMatch(/about 0 in/);
      }
      if (cross.pattern !== "x_linked") {
        // "0%" as a value; "100%" is fine and is the only way a 0 precedes the sign.
        expect(derivationLine(cross.outcomes)).not.toMatch(/(^|\D)0%|\b0 in\b/);
      }
    }
  });

  it("drops an impossible outcome instead of listing it, so a page must render the no-second-copy sentence rather than 0%", () => {
    const cross = autosomalCross("autosomal_recessive", 1, 0);
    expect(cross.outcomes.map((outcome) => outcome.outcome)).not.toContain("affected");
    expect(cross.absentOutcomes).toContain("affected");
    const none = autosomalCross("autosomal_recessive", 0, 0);
    expect(none.outcomes).toEqual([
      { outcome: "neither", fraction: { numerator: 1, denominator: 1 }, inHundred: 100 },
    ]);
  });
});
