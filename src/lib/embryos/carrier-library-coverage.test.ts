import { describe, expect, it } from "vitest";
import type { CarrierAssertionRow } from "../family/carrier-assertions";
import { carrierLibraryCoverageFigure, carrierLibraryCoverageSchema, deriveCarrierLibraryCoverage } from "./carrier-library-coverage";

// Synthetic pure inputs establish projection semantics, not a review,
// registry activation, native source publication or clinical result.
const assertion: CarrierAssertionRow = {
  assertion_id: 1, release_id: "synthetic-coverage", gene_validity_read_on: "2026-10-10", variation_id: 1,
  condition_id: "SYNTHETIC:1", condition_name: "Synthetic condition", gene_symbol: "SYNTHETIC",
  inheritance_mode: "autosomal_recessive", penetrance_class: "unestablished", penetrance_citation: null,
  variant_name: "Synthetic A>G", classification: "Pathogenic", review_status: "reviewed by expert panel",
  review_stars: 3, last_evaluated: null, chrom: 1, pos: 1000, ref: "A", alt: "G", equivalents: [],
};
const measured = (id: number, reason: "not_covered" | "source_call_disputed" | "invalid_calls" | null = null) =>
  ({ assertion_id: id, observed_copies: reason === null ? 0 : null, reason });
const project = (assertions: unknown = [assertion], measurements: unknown = [measured(1)]) =>
  deriveCarrierLibraryCoverage({ conditionId: assertion.condition_id, conditionName: assertion.condition_name,
    assertions, measurements });

describe("complete carrier-library position coverage with interpretation held", () => {
  it("counts multiple reviewed alleles at one position once, without leaking their copy counts", () => {
    const rows = [assertion, { ...assertion, assertion_id: 2, variation_id: 2, alt: "C" }];
    const result = project(rows, [measured(1), { ...measured(2), observed_copies: 2 }]);
    expect(result).toMatchObject({ checkedPositions: 1, requiredPositions: 1, coverageState: "covered",
      interpretationStatus: "held", unresolved: [] });
    expect(result).not.toHaveProperty("observed_copies");
    expect(JSON.stringify(result)).not.toMatch(/carrier_state|genotype|absolute_risk|score_coverage|covered_assertions/);
  });

  it("never counts alternate spellings as additional required positions", () => {
    const indel = { ...assertion, ref: "ATCT", alt: "A", equivalents: [[1001, "TCTT", "T"], [1002, "CTTT", "T"]] };
    expect(project([indel])).toMatchObject({ checkedPositions: 1, requiredPositions: 1 });
  });

  it("counts the same coordinate on different chromosomes as distinct loci", () => {
    expect(project([assertion, { ...assertion, assertion_id: 2, chrom: 2 }], [measured(1), measured(2)]))
      .toMatchObject({ checkedPositions: 2, requiredPositions: 2 });
  });

  it("keeps a locus unresolved when any of its complete allele readings is missing or disputed", () => {
    const rows = [assertion, { ...assertion, assertion_id: 2, alt: "C" },
      { ...assertion, assertion_id: 3, pos: 2000 }, { ...assertion, assertion_id: 4, pos: 2000, alt: "C" }];
    const result = project(rows, [measured(1), measured(2, "not_covered"),
      measured(3, "not_covered"), measured(4, "source_call_disputed")]);
    expect(result).toMatchObject({ checkedPositions: 0, requiredPositions: 2, coverageState: "not_covered",
      unresolved: [{ reasons: ["not_covered"], positions: 1 },
        { reasons: ["not_covered", "source_call_disputed"], positions: 1 }] });
  });

  it("reports partial position coverage while holding every clinical interpretation", () => {
    const result = project([assertion, { ...assertion, assertion_id: 2, pos: 2000 }],
      [measured(1), measured(2, "invalid_calls")]);
    expect(result).toMatchObject({ checkedPositions: 1, requiredPositions: 2, coverageState: "partial",
      unresolved: [{ reasons: ["invalid_calls"], positions: 1 }], holdReason: "scientific_disclosures_pending" });
  });

  it.each([0, 1, 2] as const)("treats %i observed copies as the same file-coverage fact", dose => {
    expect(project([assertion], [{ ...measured(1), observed_copies: dose }])).toEqual(project());
  });

  it.each(["empty", "missing", "extra", "duplicate", "mixed-condition", "mixed-release", "qc-refusal",
    "inconsistent-reading", "foreign-id", "unsupported-inheritance"])("refuses %s complete evidence", mode => {
    let rows: unknown = [assertion]; let readings: unknown = [measured(1)];
    if (mode === "empty") { rows = []; readings = []; }
    if (mode === "missing") readings = [];
    if (mode === "extra") readings = [measured(1), measured(2)];
    if (mode === "duplicate") { rows = [assertion, assertion]; readings = [measured(1), measured(1)]; }
    if (mode === "mixed-condition") rows = [{ ...assertion, condition_id: "SYNTHETIC:2" }];
    if (mode === "mixed-release") { rows = [assertion, { ...assertion, assertion_id: 2, release_id: "synthetic-other" }]; readings = [measured(1), measured(2)]; }
    if (mode === "qc-refusal") readings = [{ ...measured(1, "not_covered"), reason: "embryo_call_rate" }];
    if (mode === "inconsistent-reading") readings = [{ ...measured(1), reason: "not_covered" }];
    if (mode === "foreign-id") readings = [measured(2)];
    if (mode === "unsupported-inheritance") rows = [{ ...assertion, inheritance_mode: "autosomal_dominant" }];
    expect(() => project(rows, readings)).toThrow("invalid complete carrier position coverage");
  });

  it("does not mutate the complete reference or observed measurements", () => {
    const rows = [assertion], readings = [measured(1)]; const before = JSON.stringify({ rows, readings });
    const result = project(rows, readings); result.conditionName = "Changed output";
    expect(JSON.stringify({ rows, readings })).toBe(before);
  });

  it("carries the same admitted native counts and condition into the observed file figure", () => {
    const coverage = project([assertion, { ...assertion, assertion_id: 2, pos: 2000 }], [measured(1), measured(2, "not_covered")]);
    expect(carrierLibraryCoverageFigure(coverage)).toEqual({ kind: "coverage", class: "quality", basis: "observed",
      provenance: { kind: "computed", module: "embryos/carrier-library-coverage" }, read: 1, needed: 2,
      wording: "reviewed-condition", condition: "Synthetic condition" });
    expect(() => carrierLibraryCoverageFigure({ ...coverage, checkedPositions: 2 })).toThrow("invalid complete carrier position coverage");
  });

  it("refuses widened public clinical or numeric state, incorrect counts and lost causes", () => {
    const result = project();
    for (const invalid of [{ ...result, genotype: "A/G" }, { ...result, carrier_state: "not_detected" },
      { ...result, interpretationStatus: "published" }, { ...result, requiredPositions: 0 },
      { ...result, checkedPositions: 2 }, { ...result, coverageState: "partial" },
      { ...result, checkedPositions: 0, coverageState: "not_covered", unresolved: [] },
      { ...result, checkedPositions: 0, coverageState: "not_covered", unresolved: [{ reasons: ["source_call_disputed", "not_covered"], positions: 1 }] }]) {
      expect(carrierLibraryCoverageSchema.safeParse(invalid).success).toBe(false);
    }
  });
});
