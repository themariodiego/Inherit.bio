import { describe, expect, it } from "vitest";
import {
  BOTH_CHANGED_COPIES_PROBABILITY,
  CARRIER_REASONS,
  copiesShown,
  countCarrierMatches,
  countPositionsBothCover,
  evaluateCarrierPairs,
  isHarmlessClassification,
  isPathogenicClassification,
  type CarrierCondition,
  type CarrierPerson,
  type CarrierRefVariant,
} from "./carrier-pair";
import { measureRunsOfHomozygosity, type RohMeasure } from "./roh";
import { CARRIER_REASON_PHRASES, carrierNoProbabilitySentence } from "@/copy/family/health-picture";

/**
 * The trigger rule and its closed reason table (design §2.3, §6.1). One
 * probability exists and it is 1 in 4; every other case is a named reason
 * and no number. Nothing here reads a relatedness quantity: each person's
 * runs measure is their own file's.
 */

const SELF_A = "11111111-1111-4111-8111-111111111111";
const SELF_B = "22222222-2222-4222-8222-222222222222";

/** A file whose runs sit below both thresholds the brief states. */
const RUNS_BELOW: RohMeasure = measureRunsOfHomozygosity([
  { chrom: 1, pos: 1_000, genotype: "A/A" },
  { chrom: 1, pos: 2_000, genotype: "A/A" },
  { chrom: 1, pos: 60_000_000, genotype: "A/G" },
  { chrom: 2, pos: 1_000, genotype: "C/T" },
  { chrom: 2, pos: 90_000_000, genotype: "C/T" },
]);

/** A file with one run longer than the total the brief allows. */
const RUNS_ABOVE: RohMeasure = measureRunsOfHomozygosity(
  Array.from({ length: 121 }, (_, index) => ({
    chrom: 1,
    pos: 1_000_000 + index * 1_000_000,
    genotype: "A/A",
  })),
);

const RUNS_UNMEASURABLE: RohMeasure = measureRunsOfHomozygosity([
  { chrom: 1, pos: 1_000, genotype: "A/G" },
  { chrom: 1, pos: 90_000_000, genotype: "C/T" },
]);

function person(
  overrides: Partial<CarrierPerson> & { dataSubjectId: string; displayLabel: string },
): CarrierPerson {
  return {
    genotypes: new Map([[900_001, "A/G"]]),
    runs: RUNS_BELOW,
    ...overrides,
  };
}

function refVariant(overrides: Partial<CarrierRefVariant> = {}): CarrierRefVariant {
  return {
    rsid: 900_001,
    geneSymbol: "TESTGENE",
    alt: "G",
    clinvarSignificance: "Pathogenic",
    ...overrides,
  };
}

function condition(overrides: Partial<CarrierCondition> = {}): CarrierCondition {
  return {
    conditionId: "test-recessive",
    conditionName: "A test condition",
    geneSymbols: ["TESTGENE"],
    inheritanceMode: "autosomal_recessive",
    ...overrides,
  };
}

function evaluate(
  overrides: {
    variant?: Partial<CarrierRefVariant>;
    condition?: Partial<CarrierCondition> | null;
    a?: Partial<CarrierPerson>;
    b?: Partial<CarrierPerson>;
  } = {},
) {
  return evaluateCarrierPairs({
    a: person({ dataSubjectId: SELF_A, displayLabel: "Ana", ...overrides.a }),
    b: person({ dataSubjectId: SELF_B, displayLabel: "Bo", ...overrides.b }),
    refVariants: [refVariant(overrides.variant)],
    conditions: overrides.condition === null ? [] : [condition(overrides.condition ?? {})],
  });
}

describe("classification words", () => {
  it("reads pathogenic and likely pathogenic case-insensitively and nothing else", () => {
    expect(isPathogenicClassification("Pathogenic")).toBe(true);
    expect(isPathogenicClassification("likely PATHOGENIC")).toBe(true);
    expect(isPathogenicClassification("Uncertain significance")).toBe(false);
    expect(isPathogenicClassification("Benign")).toBe(false);
    expect(isHarmlessClassification("Likely benign")).toBe(true);
    expect(isHarmlessClassification("Pathogenic")).toBe(false);
  });
});

describe("how many changed copies one file shows", () => {
  it("names one copy, two copies and a file that cannot say", () => {
    expect(copiesShown("A/G", "G")).toBe("one copy");
    expect(copiesShown("G/G", "G")).toBe("two copies");
    expect(copiesShown("--", "G")).toBe("copies not shown");
    expect(copiesShown("G", "G")).toBe("copies not shown");
    // No changed copy at all, and a change Inherit cannot name in one letter.
    expect(copiesShown("A/A", "G")).toBeNull();
    expect(copiesShown("A", "G")).toBeNull();
    expect(copiesShown("A/G", null)).toBeNull();
    expect(copiesShown("A/G", "GAT")).toBeNull();
  });
});

describe("the one probability", () => {
  it("gives 1 in 4 when both files read one changed copy of a recessive change", () => {
    const matches = evaluate();
    expect(matches).toHaveLength(1);
    expect(matches[0].kind).toBe("probability");
    if (matches[0].kind !== "probability") return;
    expect(matches[0].probability).toBe(BOTH_CHANGED_COPIES_PROBABILITY);
    expect(matches[0].probability).toBe(0.25);
    expect(matches[0].gene).toBe("TESTGENE");
    expect(matches[0].a.copies).toBe("one copy");
    expect(matches[0].b.copies).toBe("one copy");
    expect(countCarrierMatches(matches)).toBe(1);
  });

  it("accepts a likely pathogenic classification in any case", () => {
    const matches = evaluate({ variant: { clinvarSignificance: "likely pathogenic" } });
    expect(countCarrierMatches(matches)).toBe(1);
  });
});

describe("every other case: no probability and a named reason", () => {
  const cases: ReadonlyArray<{
    name: string;
    overrides: Parameters<typeof evaluate>[0];
    reason: (typeof CARRIER_REASONS)[number];
  }> = [
    {
      name: "a dominant pattern",
      overrides: { condition: { inheritanceMode: "autosomal_dominant" } },
      reason: "dominant",
    },
    {
      name: "a classification of benign",
      overrides: { variant: { clinvarSignificance: "Benign" } },
      reason: "harmless",
    },
    {
      name: "a classification of uncertain significance",
      overrides: { variant: { clinvarSignificance: "Uncertain significance" } },
      reason: "unknown-meaning",
    },
    {
      name: "a conflicting classification nobody has settled",
      overrides: { variant: { clinvarSignificance: "Conflicting interpretations" } },
      reason: "unknown-meaning",
    },
    {
      name: "a file that cannot say how many copies it read",
      overrides: { b: { genotypes: new Map([[900_001, "--"]]) } },
      reason: "copies-unknown",
    },
    {
      name: "a haploid call",
      overrides: { b: { genotypes: new Map([[900_001, "G"]]) } },
      reason: "copies-unknown",
    },
    {
      name: "no recorded pattern for the gene",
      overrides: { condition: { inheritanceMode: null } },
      reason: "no-pattern",
    },
    {
      name: "a pattern recorded as other",
      overrides: { condition: { inheritanceMode: "other" } },
      reason: "no-pattern",
    },
    {
      name: "no registry row for the gene at all",
      overrides: { condition: null },
      reason: "no-pattern",
    },
    {
      name: "a pattern that depends on a person's sex",
      overrides: { condition: { inheritanceMode: "x_linked" } },
      reason: "sex-unknown",
    },
    {
      name: "one file above the runs threshold",
      overrides: { a: { runs: RUNS_ABOVE } },
      reason: "runs-unchecked",
    },
    {
      name: "one file whose runs could not be measured",
      overrides: { b: { runs: RUNS_UNMEASURABLE } },
      reason: "runs-unchecked",
    },
  ];

  for (const testCase of cases) {
    it(`refuses on ${testCase.name}`, () => {
      const matches = evaluate(testCase.overrides);
      expect(matches).toHaveLength(1);
      expect(matches[0].kind).toBe("no-probability");
      if (matches[0].kind !== "no-probability") return;
      expect(matches[0].reason).toBe(testCase.reason);
      expect(countCarrierMatches(matches)).toBe(0);
      // The rendered sentence names the reason and carries no number.
      const sentence = carrierNoProbabilitySentence("TESTGENE", matches[0].reason);
      expect(sentence).toContain(CARRIER_REASON_PHRASES[testCase.reason]);
      expect(sentence).not.toMatch(/\d/);
    });
  }

  it("covers every reason the closed table names", () => {
    expect(new Set(cases.map((testCase) => testCase.reason))).toEqual(new Set(CARRIER_REASONS));
  });

  it("never renders a percentage, and the X-linked branch never returns 1 in 4", () => {
    for (const testCase of cases) {
      const matches = evaluate(testCase.overrides);
      for (const match of matches) {
        expect(match.kind).toBe("no-probability");
        expect(JSON.stringify(match)).not.toContain("0%");
        expect(JSON.stringify(match)).not.toContain("0.25");
      }
    }
  });
});

describe("what is not a candidate at all", () => {
  it("skips a position with no clinical classification", () => {
    expect(evaluate({ variant: { clinvarSignificance: null } })).toEqual([]);
    expect(evaluate({ variant: { clinvarSignificance: "  " } })).toEqual([]);
  });

  it("skips a position only one file reports", () => {
    expect(evaluate({ b: { genotypes: new Map() } })).toEqual([]);
  });

  it("skips a position where one file shows no changed copy", () => {
    expect(evaluate({ b: { genotypes: new Map([[900_001, "A/A"]]) } })).toEqual([]);
  });

  it("skips a person who has two changed copies: that is their own finding", () => {
    expect(evaluate({ a: { genotypes: new Map([[900_001, "G/G"]]) } })).toEqual([]);
  });

  it("skips a position neither file could read", () => {
    expect(
      evaluate({
        a: { genotypes: new Map([[900_001, "--"]]) },
        b: { genotypes: new Map([[900_001, "--"]]) },
      }),
    ).toEqual([]);
  });

  it("skips a reference row with no gene name to print", () => {
    expect(evaluate({ variant: { geneSymbol: null } })).toEqual([]);
  });
});

describe("counting", () => {
  it("counts only the matches that carry a probability", () => {
    const both = new Map([
      [900_001, "A/G"],
      [900_002, "A/G"],
    ]);
    const matches = evaluateCarrierPairs({
      a: person({ dataSubjectId: SELF_A, displayLabel: "Ana", genotypes: both }),
      b: person({ dataSubjectId: SELF_B, displayLabel: "Bo", genotypes: both }),
      refVariants: [refVariant(), refVariant({ rsid: 900_002, clinvarSignificance: "Benign" })],
      conditions: [condition()],
    });
    expect(matches).toHaveLength(2);
    expect(countCarrierMatches(matches)).toBe(1);
  });

  it("counts the positions both files cover and nothing else", () => {
    const a = new Map([
      [1, "A/G"],
      [2, "A/A"],
      [3, "C/T"],
    ]);
    const b = new Map([
      [2, "A/G"],
      [3, "C/C"],
      [4, "G/G"],
    ]);
    expect(countPositionsBothCover(a, b)).toBe(2);
  });

  it("orders matches by position alone, never by anything that reads as a rank", () => {
    const matches = evaluateCarrierPairs({
      a: person({
        dataSubjectId: SELF_A,
        displayLabel: "Ana",
        genotypes: new Map([
          [900_003, "A/G"],
          [900_001, "A/G"],
        ]),
      }),
      b: person({
        dataSubjectId: SELF_B,
        displayLabel: "Bo",
        genotypes: new Map([
          [900_003, "A/G"],
          [900_001, "A/G"],
        ]),
      }),
      refVariants: [refVariant({ rsid: 900_003 }), refVariant({ rsid: 900_001 })],
      conditions: [condition()],
    });
    expect(matches.map((match) => match.rsid)).toEqual([900_001, 900_003]);
  });
});
