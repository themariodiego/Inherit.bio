import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { measureEmbryoStatisticalCoverage, TEST_STATISTICAL_SCORE_PANEL } from "./statistical-coverage";
import { SYNTHETIC_FIT_POPULATION, evaluateSyntheticStatisticalFit, fitSyntheticStatisticalPackage } from "./synthetic-statistical-fit";
import { canonicalStatisticalFitPackage, evaluateStatisticalFitResult, statisticalFitFixed9,
  statisticalFitPackageDigest, statisticalFitPackageProjection, statisticalFitPackageSchema,
  statisticalFitReferenceSchema, statisticalFitResultSchema, statisticalFitSaveRowSchema,
  statisticalFittedReadSchema, STATISTICAL_FIT_ARTIFACT_SHA256, STATISTICAL_FIT_PANEL_SHA256 } from "./statistical-fit-contract";

const id = (n: number) => `90000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
// Pure contract identities, never native admission or publication evidence.
const source = { cohort_id: id(1), embryo_id: id(10), subject_id: id(20), file_id: id(30),
  canonical_build: "GRCh38", source_sha256: "a".repeat(64), source_binding_fingerprint: "a".repeat(64),
  source_publication_revision: 1, upload_revision: 1, normalization_source_revision: 1,
  call_immutability_proof: "exact-staged-calls-v1" };
const ownCalls = (n = 10) => TEST_STATISTICAL_SCORE_PANEL.variants.slice(0, n).map(row => ({
  fileId: source.file_id, chrom: row.chrom, pos: row.pos, ref: row.otherAllele, alt: row.effectAllele,
  genotype: `${row.otherAllele}/${row.effectAllele}` }));
const input = (n = 10, alleleDropout: number | null = .03) => ({ source, calls: ownCalls(n),
  qc: { callRate: 1, contamination: null, alleleDropout } });
function result(n = 10, dropout: number | null = .03) {
  const value = evaluateStatisticalFitResult(input(n, dropout));
  if (!value.ok) throw new Error("pure fit fixture refused");return value.result;
}
function reference() {
  const pkg = canonicalStatisticalFitPackage();
  return { singleton: true, version: 1, panel_sha256: STATISTICAL_FIT_PANEL_SHA256,
    panel: TEST_STATISTICAL_SCORE_PANEL, system_identifier: "123456789", database_name: "postgres",
    database_oid: 5, server_version: 170006, runtime_binding: { kind: "owned-linux", project: "sequence",
      head: "a".repeat(40), migrationSha256: "b".repeat(64), configSha256: "c".repeat(64),
      dbContainerId: "d".repeat(64), networkId: "e".repeat(64), owner: id(40), daemonId: "pure-unit-only",
      runtimeIdentity: { unitOnly: true } }, installed_at: "2026-10-10T00:00:00Z",
    fit_artifact: SYNTHETIC_FIT_POPULATION, fit_artifact_sha256: STATISTICAL_FIT_ARTIFACT_SHA256,
    fit_package: pkg, fit_package_digest: statisticalFitPackageDigest(pkg) };
}
function read(n = 10) {
  const observed = measureEmbryoStatisticalCoverage({ panel: TEST_STATISTICAL_SCORE_PANEL, source, calls: ownCalls(n) });
  if (!observed.ok) throw new Error("pure coverage fixture refused");
  const expected = statisticalFitSaveRowSchema.parse({ embryoId: id(10), conditionId: "SYNTHETIC:9001",
    measurement: observed.measurement, finding: observed.finding,
    reason: n < 8 ? "insufficient_coverage" : "sex_combined_model_unavailable", result: n < 8 ? null : result(n) });
  const pkg = canonicalStatisticalFitPackage();
  return statisticalFittedReadSchema.parse({ version: 1, producer: "embryo-test-statistical-fit-v1",
    jurisdiction: "TEST-LOCAL", cohortId: id(1), publicationRevision: 1, jobId: id(2), attempt: 1,
    captureSha256: "d".repeat(64), interpretation: "held", publication: "synthetic-fitted-test-only", clinicalPublication: false,
    rows: [{ embryoId: id(10), sampleOrdinal: 0, conditionId: "SYNTHETIC:9001", conditionName: "Synthetic score coverage",
      coverageState: "not_covered", reason: expected.reason, matchedVariants: n, requiredVariants: 10,
      scoreCoverage: n / 10, finding: expected.finding, result: expected.result,
      receipt: { version: 1, producer: "embryo-test-statistical-fit-v1", job_id: id(2), attempt: 1,
        capture_sha256: "d".repeat(64), condition_id: "SYNTHETIC:9001", source,
        reference_receipt: reference(), measurement: expected, publication: "synthetic-fitted-test-only",
        interpretation: "held", clinicalPublication: false, fitPackage: pkg, fitPackageDigest: statisticalFitPackageDigest(pkg) } }] });
}

describe("separate canonical fitted TEST contract", () => {
  it("binds entire invented artifacts and all actual fit/covariance/reference/calibration partitions", () => {
    expect(createHash("sha256").update(readFileSync("data/embryo/test-statistical-fit-population.json")).digest("hex"))
      .toBe(STATISTICAL_FIT_ARTIFACT_SHA256);
    expect(createHash("sha256").update(readFileSync("data/embryo/test-statistical-score-panel.json")).digest("hex"))
      .toBe(STATISTICAL_FIT_PANEL_SHA256);
    const raw = fitSyntheticStatisticalPackage(SYNTHETIC_FIT_POPULATION), pkg = canonicalStatisticalFitPackage();
    if (!raw.ok) throw new Error("pure artifact refused");
    expect(pkg.fit.coefficients).toEqual(raw.package.fit.coefficients.map(statisticalFitFixed9));
    expect(pkg.fit.covariance).toEqual(raw.package.fit.covariance.map(row => row.map(statisticalFitFixed9)));
    expect(pkg.reference.covariance).toEqual(raw.package.reference.covariance.map(row => row.map(statisticalFitFixed9)));
    expect([pkg.fit.observations, pkg.holdout.n, pkg.reference.n, pkg.baseline.n]).toEqual([64, 48, 96, 200]);
    expect(Object.isFrozen(pkg.fit.covariance[0])).toBe(true);
    expect(pkg.withinFamily).toEqual({ status: "not_measured", enabledByDefault: false,
      betaRatio: null, interval: null, familyCount: null, citation: null });
    expect(pkg.publicationEligible).toBe(false);expect(pkg.clinicalRegistryEligible).toBe(false);
  });
  it("encodes exact ordered array bytes, not JSON object order or a guessed native digest", () => {
    const p = canonicalStatisticalFitPackage();
    const exact = JSON.stringify([p.version, p.fit.coefficients, p.fit.covariance, p.fit.residualVariance,
      p.holdout.r2, p.holdout.interval, p.reference.centers, p.reference.covariance,
      p.baseline.point, p.baseline.interval, p.internalInventedPairControls.r2]);
    expect(statisticalFitPackageProjection(p)).toBe(exact);
    expect(statisticalFitPackageDigest(p)).toBe(createHash("sha256").update(exact).digest("hex"));
    expect(statisticalFitPackageSchema.parse(Object.fromEntries(Object.entries(p).reverse()))).toEqual(p);
  });
  it.each([[0, "0.000000000"], [-0, "0.000000000"], [.0000000005, "0.000000001"],
    [-.0000000005, "-0.000000001"], [1.25, "1.250000000"]])("canonicalizes output %s exactly", (value, expected) => {
    expect(statisticalFitFixed9(value as number)).toBe(expected);
  });
  it.each([NaN, Infinity, -Infinity, 1_000_000, -1_000_000, 999999.9999999999])("refuses unbounded/overflow output %s", value => {
    expect(() => statisticalFitFixed9(value)).toThrow("statistical_fit_refused");
  });
  it.each(["coefficient", "covariance", "holdout", "reference", "baseline", "sibling", "publication"])("refuses changed full package %s", fault => {
    const p = structuredClone(canonicalStatisticalFitPackage());
    if (fault === "coefficient") p.fit.coefficients[0] = "0.123456789";
    if (fault === "covariance") p.fit.covariance[0][1] = "0.123456789";
    if (fault === "holdout") p.holdout.interval.reverse();
    if (fault === "reference") p.reference.centers.reverse();
    if (fault === "baseline") p.baseline.events++;
    if (fault === "sibling") Object.assign(p.withinFamily, { enabledByDefault: true });
    if (fault === "publication") Object.assign(p, { clinicalRegistryEligible: true });
    expect(statisticalFitPackageSchema.safeParse(p).success).toBe(false);
  });
  it.each([8, 9, 10])("quantizes only the whole raw own-call model output at %i/10", n => {
    const raw = evaluateSyntheticStatisticalFit({ artifact: SYNTHETIC_FIT_POPULATION,
      panel: TEST_STATISTICAL_SCORE_PANEL, ...input(n) });
    if (!raw.ok) throw new Error("pure own-call fixture refused");const actual = result(n);
    expect(actual.point).toBe(statisticalFitFixed9(raw.experiment.point));
    expect(actual.interval).toEqual(raw.experiment.interval.map(statisticalFitFixed9));
    expect(actual.totalVariance).toBe(statisticalFitFixed9(raw.experiment.totalVariance));
    expect(actual.varianceComponents).toEqual(Object.fromEntries(Object.entries(raw.experiment.varianceComponents)
      .map(([key, value]) => [key, statisticalFitFixed9(value)])));
    expect(actual.figureBasis.basis).toBe("modelled");expect(actual.coverageBasis.basis).toBe("observed");
    expect(actual.clinicalPublication).toBe(false);expect(read(n).rows[0].finding).toBeNull();
    expect(read(n).rows[0].coverageState).toBe("not_covered");
  });
  it("retains missing-locus uncertainty and the actual unmeasured-dropout widening", () => {
    expect(Number(result(8).varianceComponents.missingCoverage)).toBeGreaterThan(0);
    expect(result(10).varianceComponents.missingCoverage).toBe("0.000000000");
    const known = result(8), unknown = result(8, null);
    expect(unknown.point).toBe(known.point);expect(unknown.dropoutMultiplier).toBe("1.500000000");
    expect(Number(unknown.interval[0])).toBeLessThan(Number(known.interval[0]));
    expect(Number(unknown.interval[1])).toBeGreaterThan(Number(known.interval[1]));
  });
  it("keeps below-floor and QC refusals nonnumeric and forbids injected fitting/reference data", () => {
    expect(evaluateStatisticalFitResult(input(7))).toMatchObject({ ok: false, reason: "below_coverage_floor" });
    for (const qc of [{ callRate: .94, contamination: null, alleleDropout: .03 },
      { callRate: 1, contamination: .06, alleleDropout: .03 }, { callRate: 1, contamination: null, alleleDropout: .11 }])
      expect(evaluateStatisticalFitResult({ ...input(), qc })).toMatchObject({ ok: false, reason: "qc_not_reportable" });
    expect(evaluateStatisticalFitResult({ ...input(), artifact: SYNTHETIC_FIT_POPULATION } as Parameters<typeof evaluateStatisticalFitResult>[0]))
      .toEqual({ ok: false, reason: "invalid_experiment_input" });
    expect(read(7).rows[0]).toMatchObject({ result: null, reason: "insufficient_coverage", scoreCoverage: .7 });
  });
  it("refuses foreign calls and a mismatched whole source instead of borrowing parental calls", () => {
    expect(evaluateStatisticalFitResult({ ...input(), calls: ownCalls().map(call => ({ ...call, fileId: id(99) })) })).toMatchObject({ ok: false });
    expect(evaluateStatisticalFitResult({ ...input(), source: { ...source, normalization_source_revision: 2 } })).toMatchObject({ ok: false });
    expect(evaluateStatisticalFitResult({ ...input(), parentCalls: ownCalls() } as Parameters<typeof evaluateStatisticalFitResult>[0]))
      .toEqual({ ok: false, reason: "invalid_experiment_input" });
  });
  it.each(["negative-zero", "number", "clinical", "sibling", "unordered", "extra"])("rejects noncanonical result %s", fault => {
    const value = structuredClone(result());
    if (fault === "negative-zero") value.logPoint = "-0.000000000";
    if (fault === "number") Object.assign(value, { point: Number(value.point) });
    if (fault === "clinical") Object.assign(value, { clinicalPublication: true });
    if (fault === "sibling") Object.assign(value.withinFamily, { betaRatio: "1.000000000" });
    if (fault === "unordered") value.interval.reverse();
    if (fault === "extra") Object.assign(value, { publicFinding: { kind: "risk" } });
    expect(statisticalFitResultSchema.safeParse(value).success).toBe(false);
  });
  it.each(["artifact", "digest", "panel", "unsafe-extra"])("requires complete captured reference %s", fault => {
    const value = structuredClone(reference());
    if (fault === "artifact") Object.assign(value.fit_artifact, { clinicalRegistryEligible: true });
    if (fault === "digest") value.fit_package_digest = "f".repeat(64);
    if (fault === "panel") value.panel.variants.pop();
    if (fault === "unsafe-extra") Object.assign(value, { sourcePassword: "not-accepted" });
    expect(statisticalFitReferenceSchema.safeParse(value).success).toBe(false);
  });
  it.each(["job", "attempt", "capture", "source", "revision", "row-result", "fraction", "ordinal", "duplicate", "publication"])(
    "refuses current fitted receipt %s mismatch without dropping a row", fault => {
      const value = read();
      if (fault === "job") value.rows[0].receipt.job_id = id(99);
      if (fault === "attempt") value.rows[0].receipt.attempt++;
      if (fault === "capture") value.rows[0].receipt.capture_sha256 = "f".repeat(64);
      if (fault === "source") value.rows[0].receipt.source!.file_id = id(99);
      if (fault === "revision") value.publicationRevision++;
      if (fault === "row-result") value.rows[0].result!.point = "0.123456789";
      if (fault === "fraction") value.rows[0].scoreCoverage = .9;
      if (fault === "ordinal") value.rows[0].sampleOrdinal = 1;
      if (fault === "duplicate") value.rows.push(structuredClone(value.rows[0]));
      if (fault === "publication") Object.assign(value, { clinicalPublication: true });
      expect(statisticalFittedReadSchema.safeParse(value).success).toBe(false);
    });
  it("requires QC-only null measurements/counts/results and cannot upgrade a coverage-only held row", () => {
    const value = read(), row = value.rows[0];
    Object.assign(row, { coverageState: "quality_not_measurable", reason: "embryo_call_rate",
      matchedVariants: null, requiredVariants: null, scoreCoverage: null, finding: null, result: null });
    Object.assign(row.receipt.measurement, { measurement: null, finding: null, reason: "embryo_call_rate", result: null });
    expect(statisticalFittedReadSchema.safeParse(value).success).toBe(true);
    Object.assign(row, { matchedVariants: 0 });expect(statisticalFittedReadSchema.safeParse(value).success).toBe(false);
    const held = read();held.rows[0].result = null;held.rows[0].receipt.measurement.result = null;
    expect(statisticalFittedReadSchema.safeParse(held).success).toBe(false);
  });
});
