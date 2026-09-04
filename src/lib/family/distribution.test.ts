import { describe, expect, it } from "vitest";
import { OUTCOME_PHRASES } from "@/copy/family/portrait";
import { apportionShares } from "@/lib/ancestry/present";
import { claimBlock } from "@/lib/figures/claim-block";
import { chooseDenominator, naturalFrequency } from "@/lib/figures/natural-frequency";
import {
  DOT_COUNT,
  belowOneInHundredSentence,
  distribute,
  outOfHundredSentence,
} from "./distribution";
import { CANONICAL_CROSSES, autosomalCross, canonicalCross, crossShares } from "./mendel";

/** A tiny deterministic generator so the sum-to-100 property is checked over many inputs. */
function* pseudoRandom(seed: number): Generator<number> {
  let state = seed >>> 0;
  for (;;) {
    state = (state * 1_664_525 + 1_013_904_223) >>> 0;
    yield state / 2 ** 32;
  }
}

describe("distribute", () => {
  it("turns every canonical cross into whole dots that sum to exactly 100 and match the exact hundredths", () => {
    for (const id of CANONICAL_CROSSES) {
      const cross = canonicalCross(id);
      const distribution = distribute(crossShares(cross), OUTCOME_PHRASES);
      expect(distribution.dots).toBe(100);
      expect(distribution.categories.reduce((sum, category) => sum + category.dots, 0)).toBe(100);
      for (const category of distribution.categories) {
        const outcome = cross.outcomes.find((item) => item.outcome === category.key)!;
        expect(category.dots).toBe(outcome.inHundred);
        expect(category.outlined).toBe(false);
        expect(category.perThousand).toBe(outcome.inHundred * 10);
        expect(category.denominator).toBe(100);
        expect(category.sentence).toBe(
          `Out of 100 possible children, about ${outcome.inHundred} would ${OUTCOME_PHRASES[outcome.outcome]}.`,
        );
      }
    }
  });

  it("renders the mandated sentence pattern (brief line 360, the §2 form)", () => {
    expect(outOfHundredSentence(25, "have the condition")).toBe(
      "Out of 100 possible children, about 25 would have the condition.",
    );
    expect(distribute({ a: 0.25, b: 0.75 }, { a: "have the condition", b: "have no copy of the change" }).categories[0].sentence).toBe(
      "Out of 100 possible children, about 25 would have the condition.",
    );
  });

  it("is unreachable below 1 in 100 for exact Mendelian fractions", () => {
    for (const id of CANONICAL_CROSSES) {
      const distribution = distribute(crossShares(canonicalCross(id)), OUTCOME_PHRASES);
      expect(distribution.belowOne).toEqual([]);
      expect(distribution.categories.some((category) => category.outlined)).toBe(false);
      expect(distribution.categories.every((category) => category.dots >= 25)).toBe(true);
    }
  });

  it("gives a banded input below 1 in 100 one outlined dot, never zero, and the sentence in 1,000 as data", () => {
    const distribution = distribute(
      { common: 0.996, rare: 0.004 },
      { common: "have one form", rare: "have the other form" },
    );
    expect(distribution.categories.map((category) => [category.key, category.dots, category.outlined])).toEqual([
      ["common", 99, false],
      ["rare", 1, true],
    ]);
    expect(distribution.categories.reduce((sum, category) => sum + category.dots, 0)).toBe(100);
    expect(distribution.belowOne).toHaveLength(1);
    const rare = distribution.belowOne[0];
    expect(rare.perThousand).toBe(4);
    expect(rare.denominator).toBe(1000);
    expect(rare.sentence).toBe("Fewer than 1 in 100 — but not zero. Inherit’s estimate is about 4 in 1,000.");
    expect(belowOneInHundredSentence(4)).toBe(rare.sentence);
    // The 100-denominator block refuses the rare share; it belongs in its own
    // block (open decision 6b), which is why the sentence is data, not markup.
    const provenance = { kind: "computed", module: "family/distribution" } as const;
    const spec = { kind: "natural-frequency", class: "variant-call", basis: "modelled", provenance, value: 0.004 } as const;
    expect(() => claimBlock([spec], { denominator: 100 })).toThrow(/rounds below 1 in 100/);
    expect(chooseDenominator([0.004])).toBe(1000);
  });

  it("(R8a) keys the below-1-in-100 rule on the share, even when largest remainder would have given it a dot", () => {
    // 6 in 1,000 has the largest remainder (6 units over 0 dots) and would
    // win the leftover dot; it is still fewer than 1 in 100.
    const distribution = distribute({ a: 0.5, b: 0.494, c: 0.006 }, { a: "x", b: "y", c: "z" });
    const c = distribution.categories.find((category) => category.key === "c")!;
    expect(c.outlined).toBe(true);
    expect(c.dots).toBe(1);
    expect(c.sentence).toBe("Fewer than 1 in 100 — but not zero. Inherit’s estimate is about 6 in 1,000.");
    expect(c.denominator).toBe(1000);
    expect(distribution.belowOne.map((category) => category.key)).toEqual(["c"]);
    expect(distribution.categories.map((category) => category.dots)).toEqual([50, 49, 1]);
    // And no outlined category ever renders the "about n would" sentence.
    for (const category of distribution.belowOne) expect(category.sentence).not.toMatch(/^Out of 100/);
  });

  it("(R8b) states the figure contract's own rounding in the sentence of a category that lent a dot", () => {
    const distribution = distribute({ common: 0.996, rare: 0.004 }, { common: "have one form", rare: "y" });
    const common = distribution.categories.find((category) => category.key === "common")!;
    // The grid shows 99 solid dots (one was lent), but the figure the block
    // renders is naturalFrequency(0.996, 100) = about 100 in 100.
    expect(common.dots).toBe(99);
    expect(naturalFrequency(0.996, 100).count).toBe(100);
    expect(common.sentence).toBe("Out of 100 possible children, about 100 would have one form.");
    expect(common.sentence).not.toContain("about 99 ");
    // Every non-outlined sentence states that rounding, so a lender and a
    // non-lender read alike.
    const thirds = distribute({ a: 0.333, b: 0.333, c: 0.334 }, { a: "x", b: "y", c: "z" });
    for (const category of thirds.categories) {
      expect(category.sentence).toBe(
        outOfHundredSentence(naturalFrequency(category.share, 100).count, { a: "x", b: "y", c: "z" }[category.key]),
      );
    }
  });

  it("(R8c) refuses a NaN, negative, infinite or missing share rather than filtering it away", () => {
    expect(() => distribute({ a: 1, b: Number.NaN }, { a: "x", b: "y" })).toThrow(/finite number/);
    expect(() => distribute({ a: 1.2, b: -0.2 }, { a: "x", b: "y" })).toThrow(/finite number/);
    expect(() => distribute({ a: 1, b: Number.POSITIVE_INFINITY }, { a: "x", b: "y" })).toThrow(/finite number/);
    expect(() => distribute({ a: 1, b: undefined }, { a: "x", b: "y" })).toThrow(/finite number/);
  });

  it("(R8d) takes a cross whose absent outcomes are absent keys, never zero", () => {
    const cross = autosomalCross("autosomal_recessive", 1, 0);
    const shares = crossShares(cross);
    expect(Object.keys(shares).sort()).toEqual(["carrier", "neither"]);
    expect("affected" in shares).toBe(false);
    expect(shares.affected).toBeUndefined();
    const distribution = distribute(shares, OUTCOME_PHRASES);
    expect(distribution.categories.map((category) => category.key)).toEqual(["carrier", "neither"]);
    expect(distribution.categories.map((category) => category.dots)).toEqual([50, 50]);
    for (const category of distribution.categories) expect(category.sentence).not.toMatch(/about 0 would/);
  });

  it("(R8e) decides the sentence and the rung by one rounding, so null never pairs with 1,000", () => {
    // 0.0006 and 0.0005 both round to 1 in 1,000 under the contract's own
    // rounding, whatever the apportionment gave them (1 unit and 0 units).
    const distribution = distribute({ a: 0.9989, b: 0.0006, c: 0.0005 }, { a: "x", b: "y", c: "z" });
    const [a, b, c] = distribution.categories;
    expect(distribution.categories.reduce((sum, category) => sum + category.dots, 0)).toBe(100);
    expect([a.dots, b.dots, c.dots]).toEqual([98, 1, 1]);
    expect(a.sentence).toBe("Out of 100 possible children, about 100 would x.");
    expect(b.perThousand).toBe(1);
    expect(c.perThousand).toBe(0);
    for (const category of [b, c]) {
      expect(category.outlined).toBe(true);
      expect(category.denominator).toBe(1000);
      expect(category.sentence).toBe("Fewer than 1 in 100 — but not zero. Inherit’s estimate is about 1 in 1,000.");
    }
    // The general property: a null sentence never sits beside a denominator of 1,000.
    for (const category of distribution.categories) {
      expect(category.sentence === null && category.denominator === 1000).toBe(false);
    }
  });

  it("returns no sentence when even 1,000 cannot show the share, and names the rung that can", () => {
    const distribution = distribute({ common: 0.9997, rare: 0.0003 }, { common: "x", rare: "y" });
    const rare = distribution.categories.find((category) => category.key === "rare")!;
    expect(rare.outlined).toBe(true);
    expect(rare.dots).toBe(1);
    expect(rare.perThousand).toBe(0);
    expect(rare.sentence).toBeNull();
    expect(rare.denominator).toBe(10_000);
    expect(distribution.categories.reduce((sum, category) => sum + category.dots, 0)).toBe(100);
  });

  it("drops a category whose share is exactly 0 rather than rendering it as zero", () => {
    const distribution = distribute({ a: 1, b: 0 }, { a: "x", b: "y" });
    expect(distribution.categories.map((category) => category.key)).toEqual(["a"]);
    expect(distribution.categories[0].dots).toBe(100);
  });

  it("reuses apportionShares and carries its units into 100 dots by largest remainder", () => {
    const shares = { a: 0.333, b: 0.333, c: 0.334 };
    const units = apportionShares(shares);
    const distribution = distribute(shares, { a: "x", b: "y", c: "z" });
    expect(distribution.categories.map((category) => category.perThousand)).toEqual([units.a, units.b, units.c]);
    expect(distribution.categories.map((category) => category.dots)).toEqual([33, 33, 34]);
    // Ties in the remainder go to the earlier category, as apportionShares does.
    const tied = distribute({ a: 0.335, b: 0.335, c: 0.33 }, { a: "x", b: "y", c: "z" });
    expect(tied.categories.map((category) => category.dots)).toEqual([34, 33, 33]);
  });

  it("sums to exactly 100 for many arbitrary share vectors, and outlines exactly the shares below 1 in 100", () => {
    const random = pseudoRandom(9);
    for (let trial = 0; trial < 300; trial++) {
      const size = 2 + Math.floor(random.next().value * 6);
      const raw = Array.from({ length: size }, () => random.next().value);
      const total = raw.reduce((sum, value) => sum + value, 0);
      const shares: Record<string, number> = {};
      const phrases: Record<string, string> = {};
      raw.forEach((value, index) => {
        shares[`k${index}`] = value / total;
        phrases[`k${index}`] = `outcome ${index}`;
      });
      const distribution = distribute(shares, phrases);
      expect(distribution.categories.reduce((sum, category) => sum + category.dots, 0)).toBe(DOT_COUNT);
      for (const category of distribution.categories) {
        expect(category.dots).toBeGreaterThanOrEqual(1);
        expect(category.outlined).toBe(category.share < 0.01);
        if (category.outlined) expect(category.dots).toBe(1);
      }
    }
  });

  it("refuses shares that do not sum to 1 and an input with no category", () => {
    expect(() => distribute({ a: 0.5, b: 0.4 }, { a: "x", b: "y" })).toThrow(/sum to 1/);
    expect(() => distribute({} as Record<string, number>, {})).toThrow(/at least one category/);
  });
});
