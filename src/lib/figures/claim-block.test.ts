import { describe, expect, it } from "vitest";
import { claimBlock } from "./claim-block";
import { figureText } from "./figure-text";
import type { FigureSpec, StandaloneFigureSpec } from "./spec";

const provenance = { kind: "computed", module: "genome/prs" } as const;

describe("claimBlock summary", () => {
  it("flags modelled when any figure is modelled", () => {
    const observed: FigureSpec = {
      kind: "genotype", class: "variant-call", basis: "observed", provenance, genotype: "A/C", label: "x",
    };
    const modelled: FigureSpec = {
      kind: "interval", class: "estimate", basis: "modelled", provenance, point: 0.12, low: 0.08, high: 0.17,
    };
    expect(claimBlock([observed]).hasModelled).toBe(false);
    expect(claimBlock([observed, modelled]).hasModelled).toBe(true);
  });

  it("refuses a percentile that has no absolute risk beside it (X4.2)", () => {
    const percentile: FigureSpec = {
      kind: "percentile", class: "estimate", basis: "modelled", provenance, value: 80,
    };
    const absolute: FigureSpec = {
      kind: "absolute", class: "estimate", basis: "modelled", provenance, value: 0.12, group: "people like you",
    };
    expect(() => claimBlock([percentile])).toThrow(/absolute risk/);
    expect(() => claimBlock([percentile, { kind: "coverage", class: "quality", basis: "observed", provenance, read: 1, needed: 2 }])).toThrow(/absolute risk/);
    expect(claimBlock([absolute, percentile]).hasModelled).toBe(true);
  });

  it("chooses one denominator over every natural-frequency value in the block", () => {
    const figures: FigureSpec[] = [
      { kind: "absolute", class: "estimate", basis: "modelled", provenance, value: 0.12, group: "people like you" },
      {
        kind: "natural-frequency", class: "estimate", basis: "modelled", provenance,
        subject: 0.12, comparator: 0.004, subjectGroup: "a", comparatorGroup: "b",
      },
    ];
    expect(claimBlock(figures)).toEqual({ hasModelled: true, hasExact: false, needsDenominator: true, denominator: 1000 });
    expect(claimBlock([{ kind: "coverage", class: "quality", basis: "observed", provenance, read: 1, needed: 2 }]))
      .toEqual({ hasModelled: false, hasExact: false, needsDenominator: false, denominator: null });
  });

  describe("exact basis (W9 §3.1)", () => {
    const exact = { class: "variant-call", basis: "exact", provenance } as const;
    const quarter: FigureSpec = { ...exact, kind: "natural-frequency", value: 0.25 };
    const half: FigureSpec = { ...exact, kind: "natural-frequency", value: 0.5 };
    const observed: FigureSpec = {
      kind: "carrier-status", class: "variant-call", basis: "observed", provenance, status: "one copy",
    };
    const modelled: FigureSpec = {
      kind: "interval", class: "variant-call", basis: "modelled", provenance, point: 0.12, low: 0.08, high: 0.17,
    };

    it("flags exact when any figure is exact, and never modelled at the same time", () => {
      expect(claimBlock([quarter, half, quarter])).toEqual({
        hasModelled: false, hasExact: true, needsDenominator: true, denominator: 100,
      });
      expect(claimBlock([quarter, observed]).hasExact).toBe(true);
      expect(claimBlock([observed]).hasExact).toBe(false);
    });

    it("refuses a block that mixes exact and modelled figures", () => {
      expect(() => claimBlock([quarter, modelled])).toThrow(/mix exact and modelled/);
      expect(() => claimBlock([modelled, observed, quarter])).toThrow(/mix exact and modelled/);
      expect(claimBlock([modelled, observed]).hasModelled).toBe(true);
    });
  });

  describe("forced denominator", () => {
    const exact = { class: "variant-call", basis: "exact", provenance } as const;

    it("forces 100 where the ladder would otherwise climb", () => {
      const close: FigureSpec[] = [
        { ...exact, kind: "natural-frequency", value: 0.1251 },
        { ...exact, kind: "natural-frequency", value: 0.1302 },
      ];
      expect(claimBlock(close).denominator).toBe(1000);
      expect(claimBlock(close, { denominator: 100 })).toEqual({
        hasModelled: false, hasExact: true, needsDenominator: true, denominator: 100,
      });
    });

    it("keeps 100 on a block with no natural frequency", () => {
      const observed: FigureSpec = {
        kind: "carrier-status", class: "variant-call", basis: "observed", provenance, status: "one copy",
      };
      expect(claimBlock([observed], { denominator: 100 })).toEqual({
        hasModelled: false, hasExact: false, needsDenominator: false, denominator: 100,
      });
    });

    it("throws when any value rounds below 1 in 100", () => {
      const tiny: FigureSpec[] = [
        { ...exact, kind: "natural-frequency", value: 0.25 },
        { ...exact, kind: "natural-frequency", value: 0.004 },
      ];
      expect(() => claimBlock(tiny, { denominator: 100 })).toThrow(/rounds below 1 in 100/);
      expect(() => claimBlock([{ ...exact, kind: "absolute", value: 0.0049, group: "children" }], { denominator: 100 }))
        .toThrow(/rounds below 1 in 100/);
      // 0.005 rounds to 1 in 100 and is allowed.
      expect(claimBlock([{ ...exact, kind: "natural-frequency", value: 0.005 }], { denominator: 100 }).denominator).toBe(100);
    });

    it("accepts only 100", () => {
      expect(() => claimBlock([], { denominator: 1000 as unknown as 100 })).toThrow(/only the denominator 100/);
    });
  });
});

describe("figureText", () => {
  const base = { class: "estimate", basis: "modelled", provenance } as const;

  it("renders each kind in plain words", () => {
    const cases: Array<[StandaloneFigureSpec, string, string | null]> = [
      [{ ...base, kind: "absolute", value: 0.12, group: "people like you" }, "12%", "about 12 in 100 people like you"],
      [{ ...base, kind: "natural-frequency", value: 0.004 }, "about 4 in 1,000", null],
      [{ ...base, kind: "percentile", value: 80 }, "higher than about 80 of every 100 people like you", null],
      [{ ...base, kind: "coverage", read: 1180, needed: 1200 }, "read 1,180 of the 1,200 positions this needs", null],
      [{ ...base, kind: "interval", point: 0.12, low: 0.08, high: 0.17 }, "It could reasonably be 8.0% to 17%.", null],
      [{ ...base, kind: "genotype", genotype: "A/C", label: "x" }, "A/C", null],
      [{ ...base, kind: "carrier-status", status: "carrier" }, "carrier", null],
      [{ ...base, kind: "ancestry-share", share: 0.432, range: { low: 0.38, high: 0.48 } }, "43.2%", "(38.0–48.0%)"],
      [{ ...base, kind: "ancestry-share", share: 0.05, range: { unavailable: true } }, "5.0%", "no range yet"],
      [{ ...base, kind: "ancestry-share", share: 0, range: { unavailable: true } }, "0.0%", "no range yet"],
      [{ ...base, kind: "difference-pp", after: 0.12, before: 0.09 }, "3.0 percentage points higher", "(percentage points, not percent)"],
    ];
    for (const [spec, value, unit] of cases) {
      expect(figureText(spec), spec.kind).toEqual({ value, unit });
    }
  });

  it("uses the block denominator when given, and the floor when the block has none", () => {
    const absolute: StandaloneFigureSpec = { ...base, kind: "absolute", value: 0.12, group: "people like you" };
    expect(figureText(absolute, 1000).unit).toBe("about 120 in 1,000 people like you");
    expect(figureText(absolute, null).unit).toBe("Fewer than 1 in a million, both for you and for the comparison group.");
  });
});
