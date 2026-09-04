import { describe, expect, it } from "vitest";
import {
  BOTH_CHANGED_COPIES_PROBABILITY,
  CARRIER_REASONS,
  classificationTokens,
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
import { measureRunsOfHomozygosity, rohColumns, storedRohMeasure, type StoredRohMeasure } from "./roh";
import { CARRIER_REASON_PHRASES, carrierNoProbabilitySentence } from "@/copy/family/health-picture";

/**
 * The trigger rule and its closed reason table (design §2.3, §6.1; ADR 0017
 * §5). One probability exists and it is 1 in 4; every other case is a named
 * reason and no number. Nothing here reads a relatedness quantity: each
 * person's runs measures are their own files', stored as the processing
 * route stores them.
 */

const SELF_A = "11111111-1111-4111-8111-111111111111";
const SELF_B = "22222222-2222-4222-8222-222222222222";
const MEASURED_AT = "2026-09-03T12:00:00.000Z";

/** A stored measure as the route writes it and the reader reads it back. */
function stored(calls: Parameters<typeof measureRunsOfHomozygosity>[0]): StoredRohMeasure {
  return storedRohMeasure(rohColumns(measureRunsOfHomozygosity(calls), MEASURED_AT));
}

/** A file whose runs sit below both thresholds the brief states. */
const RUNS_BELOW: StoredRohMeasure = stored([
  { chrom: 1, pos: 1_000, genotype: "A/A" },
  { chrom: 1, pos: 2_000, genotype: "A/A" },
  { chrom: 1, pos: 60_000_000, genotype: "A/G" },
  { chrom: 2, pos: 1_000, genotype: "C/T" },
  { chrom: 2, pos: 90_000_000, genotype: "C/T" },
]);

/** A file with one run longer than the total the brief allows. */
const RUNS_ABOVE: StoredRohMeasure = stored(
  Array.from({ length: 121 }, (_, index) => ({
    chrom: 1,
    pos: 1_000_000 + index * 1_000_000,
    genotype: "A/A",
  })),
);

const RUNS_UNMEASURABLE: StoredRohMeasure = stored([
  { chrom: 1, pos: 1_000, genotype: "A/G" },
  { chrom: 1, pos: 90_000_000, genotype: "C/T" },
]);

/** A file processed before the measure existed: every column null. */
const RUNS_UNMEASURED: StoredRohMeasure = storedRohMeasure({
  roh_status: null,
  roh_reason: null,
  roh_total_bases: null,
  roh_covered_bases: null,
  roh_fraction: null,
});

function person(
  overrides: Partial<CarrierPerson> & { dataSubjectId: string; displayLabel: string },
): CarrierPerson {
  return {
    genotypes: new Map([[900_001, "A/G"]]),
    runs: [RUNS_BELOW],
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
    refVariants?: CarrierRefVariant[];
    condition?: Partial<CarrierCondition> | null;
    a?: Partial<CarrierPerson>;
    b?: Partial<CarrierPerson>;
  } = {},
) {
  return evaluateCarrierPairs({
    a: person({ dataSubjectId: SELF_A, displayLabel: "Ana", ...overrides.a }),
    b: person({ dataSubjectId: SELF_B, displayLabel: "Bo", ...overrides.b }),
    refVariants: overrides.refVariants ?? [refVariant(overrides.variant)],
    conditions: overrides.condition === null ? [] : [condition(overrides.condition ?? {})],
  });
}

describe("classification words (D-033)", () => {
  it("splits a label on the four separators, trimmed and lower-cased", () => {
    expect(classificationTokens("Pathogenic/Likely pathogenic")).toEqual(["pathogenic", "likely pathogenic"]);
    expect(classificationTokens(" Pathogenic , Likely  pathogenic ")).toEqual(["pathogenic", "likely pathogenic"]);
    expect(classificationTokens("Benign;Likely benign|Benign")).toEqual(["benign", "likely benign", "benign"]);
    expect(classificationTokens("")).toEqual([]);
  });

  it("reads a label of pathogenic words only as pathogenic, in either of ClinVar's shapes", () => {
    // ClinVar's own "/" form and the writer's ", " form (annotation-refresh).
    expect(isPathogenicClassification("Pathogenic/Likely pathogenic")).toBe(true);
    expect(isPathogenicClassification("Pathogenic, Likely pathogenic")).toBe(true);
    expect(isPathogenicClassification("Pathogenic")).toBe(true);
    expect(isPathogenicClassification("likely PATHOGENIC")).toBe(true);
    expect(isHarmlessClassification("Pathogenic/Likely pathogenic")).toBe(false);
  });

  it("reads a label of benign words only as harmless", () => {
    expect(isHarmlessClassification("Benign/Likely benign")).toBe(true);
    expect(isHarmlessClassification("Benign, Likely benign")).toBe(true);
    expect(isHarmlessClassification("Likely benign")).toBe(true);
    expect(isPathogenicClassification("Benign/Likely benign")).toBe(false);
  });

  it("reads a mixed label as neither", () => {
    for (const label of [
      "Pathogenic/Benign",
      "Benign, Uncertain significance",
      "Conflicting interpretations of pathogenicity",
      "Uncertain significance",
    ]) {
      expect(isPathogenicClassification(label), label).toBe(false);
      expect(isHarmlessClassification(label), label).toBe(false);
    }
  });

  it("reads a qualified label, or an empty one, as neither", () => {
    for (const label of ["Pathogenic, low penetrance", "Likely pathogenic, low penetrance", "", "  "]) {
      expect(isPathogenicClassification(label), label).toBe(false);
      expect(isHarmlessClassification(label), label).toBe(false);
    }
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
    expect(copiesShown("A/T", "G")).toBeNull();
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
    expect(matches[0].a.variant).toEqual({
      rsid: 900_001,
      classification: "Pathogenic",
      genotype: "A/G",
      copies: "one copy",
    });
    expect(matches[0].b.variant.copies).toBe("one copy");
    expect(countCarrierMatches(matches)).toBe(1);
  });

  it("accepts a likely pathogenic classification in any case, and ClinVar's joined labels", () => {
    expect(countCarrierMatches(evaluate({ variant: { clinvarSignificance: "likely pathogenic" } }))).toBe(1);
    expect(
      countCarrierMatches(evaluate({ variant: { clinvarSignificance: "Pathogenic/Likely pathogenic" } })),
    ).toBe(1);
    expect(
      countCarrierMatches(evaluate({ variant: { clinvarSignificance: "Pathogenic, Likely pathogenic" } })),
    ).toBe(1);
  });

  it("triggers on the gene, not the position: two different changes in one gene, each file covering the other's position (D-032)", () => {
    const twoPositions = [
      refVariant({ rsid: 900_001, clinvarSignificance: "Pathogenic" }),
      refVariant({ rsid: 900_002, alt: "T", clinvarSignificance: "Likely pathogenic" }),
    ];
    const matches = evaluateCarrierPairs({
      a: person({ dataSubjectId: SELF_A, displayLabel: "Ana", genotypes: new Map([[900_001, "A/G"], [900_002, "C/C"]]) }),
      b: person({ dataSubjectId: SELF_B, displayLabel: "Bo", genotypes: new Map([[900_001, "A/A"], [900_002, "C/T"]]) }),
      refVariants: twoPositions,
      conditions: [condition()],
    });
    expect(matches).toHaveLength(1);
    expect(matches[0].kind).toBe("probability");
    expect(matches[0].positionsBothCovered).toBe(true);
    // Each person's own variant and classification are carried, not one shared row.
    expect(matches[0].a.variant).toMatchObject({ rsid: 900_001, classification: "Pathogenic", copies: "one copy" });
    expect(matches[0].b.variant).toMatchObject({ rsid: 900_002, classification: "Likely pathogenic", copies: "one copy" });
  });

  it("never imputes: two changes at different positions, each file lacking the other's position, is refused and the gap named (line 1349)", () => {
    const twoPositions = [
      refVariant({ rsid: 900_001, clinvarSignificance: "Pathogenic" }),
      refVariant({ rsid: 900_002, alt: "T", clinvarSignificance: "Likely pathogenic" }),
    ];
    const matches = evaluateCarrierPairs({
      a: person({ dataSubjectId: SELF_A, displayLabel: "Ana", genotypes: new Map([[900_001, "A/G"]]) }),
      b: person({ dataSubjectId: SELF_B, displayLabel: "Bo", genotypes: new Map([[900_002, "C/T"]]) }),
      refVariants: twoPositions,
      conditions: [condition()],
    });
    expect(matches).toHaveLength(1);
    expect(matches[0]).toMatchObject({
      kind: "no-probability",
      reason: "not-covered",
      positionsBothCovered: false,
      uncovered: { dataSubjectId: SELF_B, rsid: 900_001 },
    });
    expect(countCarrierMatches(matches)).toBe(0);
    // Only the second person's gap: A covers B's position.
    const oneGap = evaluateCarrierPairs({
      a: person({ dataSubjectId: SELF_A, displayLabel: "Ana", genotypes: new Map([[900_001, "A/G"], [900_002, "C/C"]]) }),
      b: person({ dataSubjectId: SELF_B, displayLabel: "Bo", genotypes: new Map([[900_002, "C/T"]]) }),
      refVariants: twoPositions,
      conditions: [condition()],
    });
    expect(oneGap[0]).toMatchObject({ reason: "not-covered", uncovered: { dataSubjectId: SELF_B, rsid: 900_001 } });
  });

  it("carries every file of a person being below threshold, each file asked on its own", () => {
    expect(countCarrierMatches(evaluate({ a: { runs: [RUNS_BELOW, RUNS_BELOW] } }))).toBe(1);
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
      name: "a classification of benign and likely benign joined",
      overrides: { variant: { clinvarSignificance: "Benign/Likely benign" } },
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
      name: "a mixed classification",
      overrides: { variant: { clinvarSignificance: "Pathogenic/Benign" } },
      reason: "unknown-meaning",
    },
    {
      name: "a qualified classification",
      overrides: { variant: { clinvarSignificance: "Pathogenic, low penetrance" } },
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
      name: "a pattern that depends on which parent carries the change on the X",
      overrides: { condition: { inheritanceMode: "x_linked" } },
      reason: "sex-unknown",
    },
    {
      name: "two changed copies in one file (D-035)",
      overrides: { a: { genotypes: new Map([[900_001, "G/G"]]) } },
      reason: "two-copies",
    },
    {
      name: "a file that does not cover the other person's position",
      overrides: {
        a: { genotypes: new Map([[900_001, "A/G"]]) },
        b: { genotypes: new Map([[900_002, "C/T"]]) },
        refVariants: [
          refVariant({ rsid: 900_001, clinvarSignificance: "Pathogenic" }),
          refVariant({ rsid: 900_002, alt: "T", clinvarSignificance: "Pathogenic" }),
        ],
      },
      reason: "not-covered",
    },
    {
      name: "two changed copies in the other file",
      overrides: { b: { genotypes: new Map([[900_001, "G/G"]]) } },
      reason: "two-copies",
    },
    {
      name: "one file above the runs threshold",
      overrides: { a: { runs: [RUNS_ABOVE] } },
      reason: "runs-above-threshold",
    },
    {
      name: "one file above the runs threshold beside one that could not be measured: the measured answer wins",
      overrides: { a: { runs: [RUNS_ABOVE, RUNS_UNMEASURABLE] } },
      reason: "runs-above-threshold",
    },
    {
      name: "one file above the runs threshold in one person and none for the other: the measured answer wins",
      overrides: { a: { runs: [RUNS_ABOVE] }, b: { runs: [] } },
      reason: "runs-above-threshold",
    },
    {
      name: "one file whose runs could not be measured",
      overrides: { b: { runs: [RUNS_UNMEASURABLE] } },
      reason: "runs-unchecked",
    },
    {
      name: "one person with a second file whose runs could not be measured",
      overrides: { b: { runs: [RUNS_BELOW, RUNS_UNMEASURABLE] } },
      reason: "runs-unchecked",
    },
    {
      name: "one file processed before the runs measure existed",
      overrides: { a: { runs: [RUNS_UNMEASURED] } },
      reason: "runs-unchecked",
    },
    {
      name: "a person with no annotated file",
      overrides: { a: { runs: [] } },
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

  it("covers every reason the closed table names, and the table has ten", () => {
    expect(CARRIER_REASONS).toHaveLength(10);
    expect(new Set(cases.map((testCase) => testCase.reason))).toEqual(new Set(CARRIER_REASONS));
  });

  it("names the two-copies reading in the copies chip of the file that shows it", () => {
    const matches = evaluate({ a: { genotypes: new Map([[900_001, "G/G"]]) } });
    expect(matches[0].a.variant.copies).toBe("two copies");
    expect(matches[0].b.variant.copies).toBe("one copy");
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

describe("which of a person's changes in one gene the block names", () => {
  const both = new Map([
    [900_001, "A/G"],
    [900_002, "C/T"],
  ]);

  it("names a pathogenic change before one of unknown meaning, whatever the rsid order", () => {
    const matches = evaluateCarrierPairs({
      a: person({ dataSubjectId: SELF_A, displayLabel: "Ana", genotypes: both }),
      b: person({ dataSubjectId: SELF_B, displayLabel: "Bo", genotypes: new Map([[900_002, "C/T"]]) }),
      refVariants: [
        refVariant({ rsid: 900_001, clinvarSignificance: "Uncertain significance" }),
        refVariant({ rsid: 900_002, alt: "T", clinvarSignificance: "Pathogenic" }),
      ],
      conditions: [condition()],
    });
    expect(matches).toHaveLength(1);
    expect(matches[0].kind).toBe("probability");
    expect(matches[0].a.variant.rsid).toBe(900_002);
  });

  it("names two changed copies of a pathogenic change before one copy of another, so 1 in 4 is never printed over it", () => {
    const matches = evaluateCarrierPairs({
      a: person({
        dataSubjectId: SELF_A,
        displayLabel: "Ana",
        genotypes: new Map([
          [900_001, "A/G"],
          [900_002, "T/T"],
        ]),
      }),
      b: person({ dataSubjectId: SELF_B, displayLabel: "Bo", genotypes: new Map([[900_001, "A/G"]]) }),
      refVariants: [refVariant({ rsid: 900_001 }), refVariant({ rsid: 900_002, alt: "T" })],
      conditions: [condition()],
    });
    expect(matches).toHaveLength(1);
    expect(matches[0].kind).toBe("no-probability");
    if (matches[0].kind !== "no-probability") return;
    expect(matches[0].reason).toBe("two-copies");
    expect(matches[0].a.variant).toMatchObject({ rsid: 900_002, copies: "two copies" });
  });

  it("breaks a tie by the lower rsid", () => {
    const matches = evaluateCarrierPairs({
      a: person({ dataSubjectId: SELF_A, displayLabel: "Ana", genotypes: both }),
      b: person({ dataSubjectId: SELF_B, displayLabel: "Bo", genotypes: both }),
      refVariants: [refVariant({ rsid: 900_002, alt: "T" }), refVariant({ rsid: 900_001 })],
      conditions: [condition()],
    });
    expect(matches).toHaveLength(1);
    expect(matches[0].a.variant.rsid).toBe(900_001);
    expect(matches[0].b.variant.rsid).toBe(900_001);
  });
});

describe("what is not a candidate at all", () => {
  it("skips a position with no clinical classification", () => {
    expect(evaluate({ variant: { clinvarSignificance: null } })).toEqual([]);
    expect(evaluate({ variant: { clinvarSignificance: "  " } })).toEqual([]);
  });

  it("skips a gene only one file reports a change in", () => {
    expect(evaluate({ b: { genotypes: new Map() } })).toEqual([]);
  });

  it("skips a gene where one file shows no changed copy, of the classified letter or at all", () => {
    expect(evaluate({ b: { genotypes: new Map([[900_001, "A/A"]]) } })).toEqual([]);
    expect(evaluate({ b: { genotypes: new Map([[900_001, "A/T"]]) } })).toEqual([]);
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
    expect(evaluate({ variant: { geneSymbol: " " } })).toEqual([]);
  });
});

describe("counting and ordering", () => {
  it("counts only the matches that carry a probability", () => {
    const both = new Map([
      [900_001, "A/G"],
      [900_002, "A/G"],
    ]);
    const matches = evaluateCarrierPairs({
      a: person({ dataSubjectId: SELF_A, displayLabel: "Ana", genotypes: both }),
      b: person({ dataSubjectId: SELF_B, displayLabel: "Bo", genotypes: both }),
      refVariants: [
        refVariant(),
        refVariant({ rsid: 900_002, geneSymbol: "OTHERGENE", clinvarSignificance: "Benign" }),
      ],
      conditions: [condition(), condition({ conditionId: "other", geneSymbols: ["OTHERGENE"] })],
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

  it("gives one match per gene, ordered by gene symbol alone, never by anything that reads as a rank", () => {
    const genotypes = new Map([
      [900_003, "A/G"],
      [900_001, "A/G"],
      [900_002, "A/G"],
    ]);
    const matches = evaluateCarrierPairs({
      a: person({ dataSubjectId: SELF_A, displayLabel: "Ana", genotypes }),
      b: person({ dataSubjectId: SELF_B, displayLabel: "Bo", genotypes }),
      refVariants: [
        refVariant({ rsid: 900_003, geneSymbol: "ZGENE" }),
        refVariant({ rsid: 900_001, geneSymbol: "MGENE" }),
        refVariant({ rsid: 900_002, geneSymbol: "MGENE", clinvarSignificance: "Benign" }),
      ],
      conditions: [condition({ geneSymbols: ["MGENE", "ZGENE"] })],
    });
    expect(matches.map((match) => match.gene)).toEqual(["MGENE", "ZGENE"]);
    // One match for MGENE, naming the pathogenic change at 900_001 rather than the benign one.
    expect(matches[0].a.variant.rsid).toBe(900_001);
    expect(matches[0].kind).toBe("probability");
  });

  it("joins the registry by gene symbol case-insensitively (X16.3)", () => {
    const matches = evaluate({ condition: { geneSymbols: ["testgene"] } });
    expect(matches[0].conditionId).toBe("test-recessive");
    expect(matches[0].kind).toBe("probability");
  });
});
