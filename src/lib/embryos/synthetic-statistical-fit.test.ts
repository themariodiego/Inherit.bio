import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { TEST_STATISTICAL_SCORE_PANEL } from "./statistical-coverage";
import { evaluateSyntheticStatisticalFit, fitSyntheticLeastSquares, fitSyntheticStatisticalPackage,
  SYNTHETIC_FIT_POPULATION, syntheticBaselineInterval } from "./synthetic-statistical-fit";

const fileId = "91000000-0000-4000-8000-000000000004";
// Invented identities used only by the existing strict pure matcher. They grant nothing.
const source = { cohort_id: "91000000-0000-4000-8000-000000000001",
  embryo_id: "91000000-0000-4000-8000-000000000002", subject_id: "91000000-0000-4000-8000-000000000003",
  file_id: fileId, canonical_build: "GRCh38", source_sha256: "b".repeat(64), source_binding_fingerprint: "b".repeat(64),
  source_publication_revision: 3, upload_revision: 2, normalization_source_revision: 2, call_immutability_proof: "exact-staged-calls-v1" };
function calls(indices = Array.from({ length: 10 }, (_, i) => i)) {
  return indices.map(i => { const row = TEST_STATISTICAL_SCORE_PANEL.variants[i];
    return { fileId, chrom: row.chrom, pos: row.pos, ref: row.otherAllele, alt: row.effectAllele,
      genotype: `${row.otherAllele}/${row.effectAllele}` }; });
}
const input = () => ({ artifact: SYNTHETIC_FIT_POPULATION, panel: TEST_STATISTICAL_SCORE_PANEL,
  source, calls: calls(), qc: { callRate: 1, contamination: null, alleleDropout: .03 } });
function evaluated(patch: Record<string, unknown> = {}) {
  const result = evaluateSyntheticStatisticalFit({ ...input(), ...patch });
  if (!result.ok) throw new Error(`invented experiment refused: ${result.reason}`);
  return result.experiment;
}
function fitted() {
  const result = fitSyntheticStatisticalPackage(SYNTHETIC_FIT_POPULATION);
  if (!result.ok) throw new Error("invented package refused"); return result.package;
}

describe("pure invented fitted statistical package", () => {
  it("binds the complete invented data bytes and separates every partition identity", () => {
    const raw = readFileSync("data/embryo/test-statistical-fit-population.json");
    expect(createHash("sha256").update(raw).digest("hex")).toBe("5355327cfe90cda24ca2d27cd3afab2e53d26b5d6995b69cb296d3b975c6d408");
    const ids = [...SYNTHETIC_FIT_POPULATION.training, ...SYNTHETIC_FIT_POPULATION.holdout,
      ...SYNTHETIC_FIT_POPULATION.reference, ...SYNTHETIC_FIT_POPULATION.familyControls,
      ...SYNTHETIC_FIT_POPULATION.calibration].map(row => row.id);
    expect(new Set(ids).size).toBe(440);
    expect(Object.isFrozen(SYNTHETIC_FIT_POPULATION.training[0].dosages)).toBe(true);
    expect(Object.isFrozen(fitted().fit.covariance[0])).toBe(true);
  });
  it("fits the analytic five-row control and its complete residual covariance", () => {
    const fit = fitSyntheticLeastSquares([[-2], [-1], [0], [1], [2]].map(row => [1, ...row]), [-3, -1, 1, 3, 6]);
    expect(fit.coefficients[0]).toBeCloseTo(1.2, 13); expect(fit.coefficients[1]).toBeCloseTo(2.2, 13);
    expect(fit.residualVariance).toBeCloseTo(.4 / 3, 13); expect(fit.degreesOfFreedom).toBe(3);
    expect(fit.covariance[0][0]).toBeCloseTo(.4 / 15, 13); expect(fit.covariance[1][1]).toBeCloseTo(.4 / 30, 13);
    expect(fit.covariance[0][1]).toBe(0); expect(fit.covariance[1][0]).toBe(0);
  });
  it.each([
    { design: [[1, 1], [1, 1], [1, 1]], outcomes: [1, 2, 3] },
    { design: [[1], [1]], outcomes: [1] }, { design: [[1], [NaN]], outcomes: [1, 2] },
    { design: [[1], [1]], outcomes: [1, Infinity] }, { design: [[1, 0], [1, 1]], outcomes: [1, 2] },
  ])("refuses singular, incomplete, nonfinite and no-residual-degrees input: $design", ({ design, outcomes }) => {
    expect(() => fitSyntheticLeastSquares(design, outcomes)).toThrow("synthetic fit refused");
  });
  it("satisfies every fitted normal equation and coefficient-covariance identity", () => {
    const pkg = fitted(), x = SYNTHETIC_FIT_POPULATION.training.map(row => [1, ...row.dosages.map((dose, i) => dose - pkg.reference.centers[i])]);
    const residuals = x.map((row, i) => SYNTHETIC_FIT_POPULATION.training[i].liability
      - row.reduce((sum, v, j) => sum + v * pkg.fit.coefficients[j], 0));
    for (let j = 0; j < 11; j++) {
      expect(x.reduce((sum, row, i) => sum + row[j] * residuals[i], 0)).toBeCloseTo(0, 10);
      for (let k = 0; k < 11; k++) {
        const product = Array.from({ length: 11 }, (_, l) => x.reduce((sum, row) => sum + row[j] * row[l], 0) * pkg.fit.covariance[l][k]).reduce((a, b) => a + b, 0);
        expect(product).toBeCloseTo(j === k ? pkg.fit.residualVariance : 0, 11);
        expect(pkg.fit.covariance[j][k]).toBeCloseTo(pkg.fit.covariance[k][j], 14);
      }
    }
    expect(pkg.fit.residualVariance).toBeGreaterThan(0); expect(pkg.fit.observations).toBe(64);
  });
  it("measures the untouched independent holdout, with deterministic finite resampling", () => {
    const pkg = fitted(), rows = SYNTHETIC_FIT_POPULATION.holdout;
    const mean = rows.reduce((sum, row) => sum + row.liability, 0) / rows.length;
    const sse = rows.reduce((sum, row) => { const prediction = pkg.fit.coefficients[0]
      + row.dosages.reduce((v, dose, i) => v + (dose - pkg.reference.centers[i]) * pkg.fit.coefficients[i + 1], 0);
      return sum + (row.liability - prediction) ** 2; }, 0);
    const total = rows.reduce((sum, row) => sum + (row.liability - mean) ** 2, 0);
    expect(pkg.holdout.r2).toBeCloseTo(1 - sse / total, 14);
    expect(pkg.holdout).toMatchObject({ n: 48, method: "invented-holdout-percentile-bootstrap-256" });
    expect(pkg.holdout.interval[0]).toBeLessThan(pkg.holdout.interval[1]);
    expect(pkg.holdout.interval.every(Number.isFinite)).toBe(true);
    expect(fitted()).toEqual(pkg);
  });
  it("keeps invented pair metrics separate from every unavailable human sibling field", () => {
    const pkg = fitted(); expect(pkg.internalInventedPairControls).toMatchObject({ pairs: 16, evidence: "invented-pairs-not-human-siblings" });
    expect(Number.isFinite(pkg.internalInventedPairControls.r2)).toBe(true);
    expect(pkg.withinFamily).toEqual({ status: "not_measured", enabledByDefault: false, betaRatio: null,
      interval: null, familyCount: null, citation: null });
    expect(pkg.publicationEligible).toBe(false); expect(pkg.clinicalRegistryEligible).toBe(false);
  });
  it.each([
    (a: typeof SYNTHETIC_FIT_POPULATION) => ({ ...a, provenance: "human-sibling-validation" }),
    (a: typeof SYNTHETIC_FIT_POPULATION) => ({ ...a, withinFamily: { status: "measured_no_attenuation" } }),
    (a: typeof SYNTHETIC_FIT_POPULATION) => ({ ...a, clinicalRegistryEligible: true }),
    (a: typeof SYNTHETIC_FIT_POPULATION) => ({ ...a, training: a.training.slice(1) }),
    (a: typeof SYNTHETIC_FIT_POPULATION) => ({ ...a, training: [{ ...a.training[0], liability: 12 }, ...a.training.slice(1)] }),
  ])("rejects invented authority or changed/subset fitting data", mutate => {
    expect(fitSyntheticStatisticalPackage(mutate(SYNTHETIC_FIT_POPULATION))).toEqual({ ok: false, reason: "invalid_synthetic_artifact" });
  });
  it("derives baseline point/count and strict Wilson bounds from all invented binary records", () => {
    const pkg = fitted(); expect(pkg.baseline.events).toBe(33); expect(pkg.baseline.n).toBe(200);
    expect(pkg.baseline.point).toBe(33 / 200); expect(pkg.baseline.interval[0]).toBeLessThan(pkg.baseline.point);
    expect(pkg.baseline.interval[1]).toBeGreaterThan(pkg.baseline.point);
    const balanced = syntheticBaselineInterval(50, 100);
    expect(balanced.interval[0]).toBeCloseTo(.4038315303659956, 13);
    expect(balanced.interval[1]).toBeCloseTo(.5961684696340044, 13);
    expect(() => syntheticBaselineInterval(0, 100)).toThrow(); expect(() => syntheticBaselineInterval(100, 100)).toThrow();
  });
  it("sums all four ordered variances before transforming each bound exactly once", () => {
    const e = evaluated(); expect(Object.keys(e.varianceComponents)).toEqual(["modelAccuracy", "referenceSampling", "baselineSampling", "missingCoverage"]);
    expect(Object.values(e.varianceComponents).every(v => Number.isFinite(v) && v >= 0)).toBe(true);
    expect(e.totalVariance).toBe(Object.values(e.varianceComponents).reduce((a, b) => a + b, 0));
    expect(e.varianceComponents.referenceSampling).toBeGreaterThan(0); expect(e.varianceComponents.baselineSampling).toBeGreaterThan(0);
    expect(e.varianceComponents.missingCoverage).toBe(0);
    expect(e.logBounds[0]).toBeLessThan(e.logPoint); expect(e.logBounds[1]).toBeGreaterThan(e.logPoint);
    expect(e.point).toBe(1 / (1 + Math.exp(-e.logPoint)));
    expect(e.interval).toEqual(e.logBounds.map(v => 1 / (1 + Math.exp(-v))));
    expect(e.publicFinding).toBeNull(); expect(e.publicationEligible).toBe(false);
  });
  it.each([8, 9, 10])("preserves the inclusive floor with %i actual own matched rows", n => {
    const e = evaluated({ calls: calls(Array.from({ length: n }, (_, i) => i)) });
    expect(e.coverage).toBe(n / 10); expect(e.matchedVariants).toBe(n); expect(e.requiredVariants).toBe(10);
    expect(e.varianceComponents.missingCoverage).toEqual(n < 10 ? expect.any(Number) : 0);
    if (n < 10) expect(e.varianceComponents.missingCoverage).toBeGreaterThan(0);
  });
  it("keeps absent loci in uncertainty instead of accepting parent imputation", () => {
    const own = calls([2, 3, 4, 5, 6, 7, 8, 9]); const e = evaluated({ calls: own });
    expect(e.varianceComponents.missingCoverage).toBeGreaterThan(.02);
    expect(evaluateSyntheticStatisticalFit({ ...input(), calls: own, parentCalls: calls([0, 1]) }))
      .toEqual({ ok: false, reason: "invalid_experiment_input" });
    expect(evaluateSyntheticStatisticalFit({ ...input(), calls: calls([0, 1, 2, 3, 4, 5, 6]) }))
      .toEqual({ ok: false, reason: "below_coverage_floor" });
  });
  it("widens the same log interval by exactly1.5 for unmeasured dropout", () => {
    const known = evaluated(), unknown = evaluated({ qc: { ...input().qc, alleleDropout: null } });
    expect(unknown.dropoutMultiplier).toBe(1.5); expect(unknown.point).toBe(known.point);
    expect(unknown.logBounds[1] - unknown.logPoint).toBeCloseTo((known.logBounds[1] - known.logPoint) * 1.5, 14);
    expect(unknown.interval[0]).toBeLessThan(known.interval[0]); expect(unknown.interval[1]).toBeGreaterThan(known.interval[1]);
  });
  it.each([
    { callRate: .949999, contamination: null, alleleDropout: .03 },
    { callRate: 1, contamination: .050001, alleleDropout: .03 },
    { callRate: 1, contamination: null, alleleDropout: .100001 },
  ])("retains exact original QC refusals: $callRate/$contamination/$alleleDropout", qc => {
    expect(evaluateSyntheticStatisticalFit({ ...input(), qc })).toEqual({ ok: false, reason: "qc_not_reportable" });
  });
  it("retains all inclusive QC boundaries and whole-source/source-call refusals", () => {
    expect(evaluated({ qc: { callRate: .95, contamination: .05, alleleDropout: .1 } }).publicationEligible).toBe(false);
    expect(evaluateSyntheticStatisticalFit({ ...input(), calls: calls().map(call => ({ ...call, fileId: "91000000-0000-4000-8000-000000000099" })) }))
      .toEqual({ ok: false, reason: "invalid_calls" });
    expect(evaluateSyntheticStatisticalFit({ ...input(), source: { ...source, normalization_source_revision: 1 } }))
      .toEqual({ ok: false, reason: "invalid_source" });
  });
  it("has no imports from a native/public producer or consumer", () => {
    for (const path of ["statistical-worker.ts", "statistical-read.ts", "statistical-source.test.ts"])
      expect(readFileSync(`src/lib/embryos/${path}`, "utf8")).not.toContain('from "./synthetic-statistical-fit"');
    expect(readFileSync("data/embryo/allowed_conditions.json", "utf8")).toContain('"conditions": []');
  });
});
