import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { measureEmbryoStatisticalCoverage, TEST_STATISTICAL_SCORE_PANEL } from "./statistical-coverage";

// Invented TEST source identities and calls. They confer no native authority.
const file = "90000000-0000-4000-8000-000000000004";
const source = {
  cohort_id: "90000000-0000-4000-8000-000000000001",
  embryo_id: "90000000-0000-4000-8000-000000000002",
  subject_id: "90000000-0000-4000-8000-000000000003", file_id: file,
  canonical_build: "GRCh38", source_sha256: "a".repeat(64), source_binding_fingerprint: "a".repeat(64),
  source_publication_revision: 3, upload_revision: 2, normalization_source_revision: 2,
  call_immutability_proof: "exact-staged-calls-v1",
};
function call(index: number, patch: Record<string, unknown> = {}) {
  const row = TEST_STATISTICAL_SCORE_PANEL.variants[index];
  return { fileId: file, chrom: row.chrom, pos: row.pos, ref: row.otherAllele,
    alt: row.effectAllele, genotype: `${row.otherAllele}/${row.effectAllele}`, ...patch };
}
function measure(calls: unknown, patch: { panel?: unknown; source?: unknown } = {}) {
  return measureEmbryoStatisticalCoverage({ panel: TEST_STATISTICAL_SCORE_PANEL, source, calls, ...patch });
}
function measured(calls: unknown) {
  const result = measure(calls);
  if (!result.ok) throw new Error("Synthetic measurement refused");
  return result;
}

describe("complete synthetic statistical panel coverage", () => {
  it.each([0, 1, 2, 7, 8, 9, 10])("retains all ten rows with %i usable matched calls and the exact inclusive floor", count => {
    const result = measured(Array.from({ length: count }, (_, index) => call(index)));
    expect(result.measurement.matchedVariants).toBe(count);
    expect(result.measurement.requiredVariants).toBe(10);
    expect(result.measurement.scoreCoverage).toBe(count / 10);
    expect(result.measurement.rows).toHaveLength(10);
    expect(result.measurement.rows.map(row => row.variantId)).toEqual(TEST_STATISTICAL_SCORE_PANEL.variants.map(row => row.id));
    expect(result.finding).toEqual(count < 8 ? {
      schema_version: 2, figure_basis: { version: 1, basis: "observed" }, kind: "coverage_failure",
      metric: "score_coverage", measured_value: count / 10, required_minimum: 0.8,
      display_copy_id: "embryo.result.insufficient-coverage",
    } : null);
    expect(JSON.stringify(result)).not.toMatch(/raw_score|weighted_sum|percentile|absolute_risk|interval|calibrat|ranking/);
  });

  it("counts a usable homozygous reference call without requiring an ALT or an effect copy", () => {
    const own = call(0, { alt: null, genotype: "A/A" });
    expect(measured([own]).measurement).toMatchObject({ matchedVariants: 1, scoreCoverage: 0.1 });
    expect(measure([call(0, { alt: null })])).toEqual({ ok: false, reason: "invalid_calls" });
  });

  it.each([[], [call(0, { genotype: "--" })], [call(0, { usable: false })],
    [call(0), call(0, { genotype: "--" })]].map(calls => ({ calls })))("keeps missing, unreadable and mixed unreadable rows in the denominator: $calls", ({ calls }) => {
    const result = measured(calls);
    expect(result.measurement).toMatchObject({ matchedVariants: 0, requiredVariants: 10, scoreCoverage: 0 });
    expect(result.measurement.rows[0].state).toBe("not_covered");
  });

  it("neither multiplies duplicate agreeing calls nor selects the first conflicting call", () => {
    const agree = measured([call(0), call(0, { genotype: "G/A" })]);
    expect(agree.measurement.matchedVariants).toBe(1);
    const conflict = measured([call(0), call(0, { genotype: "G/G" })]);
    expect(conflict.measurement.matchedVariants).toBe(0);
    expect(conflict.measurement.rows[0].state).toBe("source_call_disputed");
    expect(measured([call(0, { genotype: "G/G" }), call(0)])).toEqual(conflict);
  });

  it("does not count another allele pair or a strand inference as a matched panel row", () => {
    const result = measured([call(0, { ref: "C", alt: "T", genotype: "C/T" })]);
    expect(result.measurement).toMatchObject({ matchedVariants: 0, scoreCoverage: 0 });
    expect(result.measurement.rows[0].state).toBe("invalid_call");
  });

  it("does not mutate or alias source/calls, and its complete reference is frozen", () => {
    const request = { panel: structuredClone(TEST_STATISTICAL_SCORE_PANEL), source: { ...source }, calls: [call(0)] };
    const before = JSON.stringify(request);
    const result = measureEmbryoStatisticalCoverage(request);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    result.measurement.source.source_sha256 = "b".repeat(64);
    result.measurement.rows[0].state = "not_covered";
    expect(JSON.stringify(request)).toBe(before);
    expect(Object.isFrozen(TEST_STATISTICAL_SCORE_PANEL)).toBe(true);
    expect(Object.isFrozen(TEST_STATISTICAL_SCORE_PANEL.variants)).toBe(true);
    expect(TEST_STATISTICAL_SCORE_PANEL.variants.every(Object.isFrozen)).toBe(true);
  });
});

describe("closed reference/source/call inputs", () => {
  it.each(["subset", "reordered", "other-position", "duplicate", "larger-denominator", "clinical-purpose", "risk-field"])(
    "refuses a %s reference rather than selecting a convenient score subset", fault => {
      const panel = structuredClone(TEST_STATISTICAL_SCORE_PANEL) as unknown as Record<string, unknown> & {
        variants: typeof TEST_STATISTICAL_SCORE_PANEL.variants };
      if (fault === "subset") panel.variants.pop();
      if (fault === "reordered") panel.variants.reverse();
      if (fault === "other-position") panel.variants[0].pos++;
      if (fault === "duplicate") panel.variants[1] = { ...panel.variants[0] };
      if (fault === "larger-denominator") panel.nVariants = 11;
      if (fault === "clinical-purpose") panel.purpose = "absolute-risk";
      if (fault === "risk-field") panel.absolute_risk = 0.1;
      expect(measure([], { panel })).toEqual({ ok: false, reason: "invalid_reference" });
    });

  it.each([
    { normalization_source_revision: 1 }, { source_binding_fingerprint: "b".repeat(64) },
    { canonical_build: "GRCh37" }, { call_immutability_proof: null }, { upload_revision: 0 },
    { file_id: "not-an-id" }, { risk_model_id: "invented" },
  ])("refuses stale, widened or incomplete source evidence %j", patch => {
    expect(measure([], { source: { ...source, ...patch } })).toEqual({ ok: false, reason: "invalid_source" });
  });

  it.each([
    call(0, { fileId: "90000000-0000-4000-8000-000000000005" }),
    call(0, { pos: 999 }), call(0, { chrom: 23 }), call(0, { genotype: "G" }),
    call(0, { genotype: "A/G/G" }), call(0, { genotype: "0/1" }), call(0, { genotype: "A|G" }),
    call(0, { genotype: "A/C" }), call(0, { ref: "A", alt: "A", genotype: "A/A" }),
    call(0, { ref: "AT", alt: "G" }), call(0, { quality: 0.7 }), call(0, { usable: "true" }),
  ])("refuses foreign or noncanonical inputs without returning their values: %j", own => {
    expect(measure([own])).toEqual({ ok: false, reason: "invalid_calls" });
  });

  it("refuses an overlarge call bag without truncating or publishing a partial denominator", () => {
    expect(measure(Array.from({ length: 257 }, () => call(0)))).toEqual({ ok: false, reason: "invalid_calls" });
  });

  it("has no eligibility, clinical model or QC-input door and preserves the committed empty condition registry", () => {
    const library = JSON.parse(readFileSync("data/embryo/allowed_conditions.json", "utf8"));
    expect(library.conditions).toEqual([]);
    expect(Object.keys(TEST_STATISTICAL_SCORE_PANEL).sort()).toEqual([
      "conditionId", "conditionName", "jurisdiction", "nVariants", "panelId", "purpose", "referenceBuild", "variants", "version",
    ]);
    expect(measure([call(0, { genotype: "CANARY_PRIVATE_CALL", absolute_risk: 0.6 })]))
      .toEqual({ ok: false, reason: "invalid_calls" });
  });
});
