import { afterEach, describe, expect, it, vi } from "vitest";
const account = vi.hoisted(() => ({ value: null as null | { user: { id: string }; sessionId: string } }));
vi.mock("../account-deletion", () => ({ getSensitiveAccountContext: async () => account.value }));
vi.mock("../supabase/admin", () => ({ createAdminClient: () => { throw new Error("unexpected client"); } }));
import { loadSavedEmbryoStatisticalCoverage, statisticalCoverageReadSchema } from "./statistical-read";
import { canonicalStatisticalFitPackage, evaluateStatisticalFitResult, statisticalFitPackageDigest,
  statisticalFittedReadSchema, STATISTICAL_FIT_ARTIFACT_SHA256, STATISTICAL_FIT_PANEL_SHA256 } from "./statistical-fit-contract";
import { measureEmbryoStatisticalCoverage, TEST_STATISTICAL_SCORE_PANEL } from "./statistical-coverage";
import { SYNTHETIC_FIT_POPULATION } from "./synthetic-statistical-fit";

const id = (n: number) => `90000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
function dto(matched = 2) {
  return { version: 1, producer: "embryo-test-score-coverage-v1", jurisdiction: "TEST-LOCAL", cohortId: id(1),
    publicationRevision: 1, jobId: id(2), attempt: 1, captureSha256: "d".repeat(64), interpretation: "held",
    rows: [{ embryoId: id(10), sampleOrdinal: 0, conditionId: "SYNTHETIC:9001", conditionName: "Synthetic score coverage",
      coverageState: "not_covered", reason: matched < 8 ? "insufficient_coverage" : "sex_combined_model_unavailable",
      matchedVariants: matched, requiredVariants: 10, scoreCoverage: matched / 10, finding: matched < 8 ? {
        schema_version: 2, figure_basis: { version: 1, basis: "observed" }, kind: "coverage_failure", metric: "score_coverage",
        measured_value: matched / 10, required_minimum: 0.8, display_copy_id: "embryo.result.insufficient-coverage",
      } : null }] };
}
afterEach(() => { vi.unstubAllEnvs();account.value = null; });
describe("complete current statistical read", () => {
  it.each([0, 2, 7, 8, 9, 10])("accepts %i only with exact count/fraction/finding and honest model hold", n => {
    expect(statisticalCoverageReadSchema.safeParse(dto(n)).success).toBe(true);
  });
  it.each(["risk", "metric", "fraction", "denominator", "missing-finding", "wrong-floor", "positive-model", "duplicate", "ordinal", "interpretation"])(
    "refuses %s without dropping a row/value", fault => {
      const value = dto() as ReturnType<typeof dto> & { risk?: unknown };
      if (fault === "risk") value.risk = 0.7;
      if (fault === "metric") value.rows[0].finding!.metric = "call_rate";
      if (fault === "fraction") value.rows[0].scoreCoverage = 0.3;
      if (fault === "denominator") value.rows[0].requiredVariants = 9;
      if (fault === "missing-finding") value.rows[0].finding = null;
      if (fault === "wrong-floor") value.rows[0].finding!.required_minimum = 0.79;
      if (fault === "positive-model") value.rows[0].reason = "covered";
      if (fault === "duplicate") value.rows.push(structuredClone(value.rows[0]));
      if (fault === "ordinal") value.rows[0].sampleOrdinal = 1;
      if (fault === "interpretation") value.interpretation = "approved";
      expect(statisticalCoverageReadSchema.safeParse(value).success).toBe(false);
    });
  it("admits QC refusal only with no measurement/finding and an exact QC reason", () => {
    const value = dto() as unknown as { rows: Record<string, unknown>[] };
    Object.assign(value.rows[0], { coverageState: "quality_not_measurable", reason: "embryo_call_rate",
      matchedVariants: null, requiredVariants: null, scoreCoverage: null, finding: null });
    expect(statisticalCoverageReadSchema.safeParse(value).success).toBe(true);
    value.rows[0].matchedVariants = 0;expect(statisticalCoverageReadSchema.safeParse(value).success).toBe(false);
    value.rows[0].matchedVariants = null;value.rows[0].reason = "within_family_validation_unavailable";
    expect(statisticalCoverageReadSchema.safeParse(value).success).toBe(false);
  });
  it("refuses non-TEST and foreign/missing sessions before any native call", async () => {
    const rpc = vi.fn();vi.stubEnv("INHERIT_TEST_JURISDICTION", "0");
    expect(await loadSavedEmbryoStatisticalCoverage(id(3), id(1), [id(10)], { rpc })).toBeNull();
    vi.stubEnv("INHERIT_TEST_JURISDICTION", "1");account.value = { user: { id: id(4) }, sessionId: id(5) };
    expect(await loadSavedEmbryoStatisticalCoverage(id(3), id(1), [id(10)], { rpc })).toBeNull();expect(rpc).not.toHaveBeenCalled();
  });
  it("binds the actual derived account/session and complete current own embryo set", async () => {
    vi.stubEnv("INHERIT_TEST_JURISDICTION", "1");account.value = { user: { id: id(3) }, sessionId: id(5) };
    const rpc = vi.fn((name: string) => ({ abortSignal: async () => ({ data: name === "current_embryo_test_statistical_fit_v1" ? null : dto(), error: null }) }));
    expect(await loadSavedEmbryoStatisticalCoverage(id(3), id(1), [id(10)], { rpc })).toEqual(dto());
    expect(rpc).toHaveBeenCalledWith("current_embryo_test_statistical_v1", { p_account: id(3), p_session: id(5), p_cohort: id(1), p_test: true });
    await expect(loadSavedEmbryoStatisticalCoverage(id(3), id(1), [id(11)], { rpc })).rejects.toThrow("saved read unavailable");
  });
  it("keeps absent native admission null but suppresses raw native error details", async () => {
    vi.stubEnv("INHERIT_TEST_JURISDICTION", "1");account.value = { user: { id: id(3) }, sessionId: id(5) };
    expect(await loadSavedEmbryoStatisticalCoverage(id(3), id(1), [id(10)], { rpc: () => ({ abortSignal: async () => ({ data: null, error: null }) }) })).toBeNull();
    await expect(loadSavedEmbryoStatisticalCoverage(id(3), id(1), [id(10)], { rpc: () => ({ abortSignal: async () => {
      throw new Error("synthetic-private-native-canary"); } }) })).rejects.toThrow("saved read unavailable");
  });
});

function fittedDto() {
  const source = { cohort_id: id(1), embryo_id: id(10), subject_id: id(20), file_id: id(30), canonical_build: "GRCh38",
    source_sha256: "a".repeat(64), source_binding_fingerprint: "a".repeat(64), source_publication_revision: 1,
    upload_revision: 1, normalization_source_revision: 1, call_immutability_proof: "exact-staged-calls-v1" };
  const calls = TEST_STATISTICAL_SCORE_PANEL.variants.map(v => ({ fileId: id(30), chrom: v.chrom, pos: v.pos,
    ref: v.otherAllele, alt: v.effectAllele, genotype: `${v.otherAllele}/${v.effectAllele}` }));
  const observed = measureEmbryoStatisticalCoverage({ panel: TEST_STATISTICAL_SCORE_PANEL, source, calls });
  const fitted = evaluateStatisticalFitResult({ source, calls, qc: { callRate: 1, contamination: null, alleleDropout: .03 } });
  if (!observed.ok || !fitted.ok) throw new Error("pure read fixture refused");
  const pkg = canonicalStatisticalFitPackage();
  const reference = { singleton: true, version: 1, panel_sha256: STATISTICAL_FIT_PANEL_SHA256,
    panel: TEST_STATISTICAL_SCORE_PANEL, system_identifier: "123456789", database_name: "postgres", database_oid: 5,
    server_version: 170006, runtime_binding: { kind: "owned-linux", project: "sequence", head: "a".repeat(40),
      migrationSha256: "b".repeat(64), configSha256: "c".repeat(64), dbContainerId: "d".repeat(64), networkId: "e".repeat(64),
      owner: id(40), daemonId: "pure-unit-only", runtimeIdentity: { unitOnly: true } }, installed_at: "2026-10-10T00:00:00Z",
    fit_artifact: SYNTHETIC_FIT_POPULATION, fit_artifact_sha256: STATISTICAL_FIT_ARTIFACT_SHA256,
    fit_package: pkg, fit_package_digest: statisticalFitPackageDigest(pkg) };
  const expected = { embryoId: id(10), conditionId: "SYNTHETIC:9001", measurement: observed.measurement,
    finding: null, reason: "sex_combined_model_unavailable", result: fitted.result };
  return statisticalFittedReadSchema.parse({ ...dto(10), producer: "embryo-test-statistical-fit-v1",
    publication: "synthetic-fitted-test-only", clinicalPublication: false,
    rows: [{ ...dto(10).rows[0], result: fitted.result,
      receipt: { version: 1, producer: "embryo-test-statistical-fit-v1", job_id: id(2), attempt: 1,
        capture_sha256: "d".repeat(64), condition_id: "SYNTHETIC:9001", source, reference_receipt: reference,
        measurement: expected, publication: "synthetic-fitted-test-only", interpretation: "held",
        clinicalPublication: false, fitPackage: pkg, fitPackageDigest: statisticalFitPackageDigest(pkg) } }] });
}
function ownSession() {
  vi.stubEnv("INHERIT_TEST_JURISDICTION", "1");account.value = { user: { id: id(3) }, sessionId: id(5) };
}
describe("current separate fitted TEST read", () => {
  it("returns only the full current fitted receipt and actual account/session-bound own set", async () => {
    ownSession();const value = fittedDto();
    const rpc = vi.fn(() => ({ abortSignal: async () => ({ data: value, error: null }) }));
    expect(await loadSavedEmbryoStatisticalCoverage(id(3), id(1), [id(10)], { rpc })).toEqual(value);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("current_embryo_test_statistical_fit_v1", {
      p_account: id(3), p_session: id(5), p_cohort: id(1), p_test: true });
    expect(value.rows[0].finding).toBeNull();expect(value.clinicalPublication).toBe(false);
    expect(value.rows[0].result?.withinFamily.status).toBe("not_measured");
  });
  it("falls back only from explicit native absent fit to unchanged coverage-only data", async () => {
    ownSession();const rpc = vi.fn((name: string) => ({ abortSignal: async () => ({
      data: name === "current_embryo_test_statistical_fit_v1" ? null : dto(10), error: null }) }));
    expect(await loadSavedEmbryoStatisticalCoverage(id(3), id(1), [id(10)], { rpc })).toEqual(dto(10));
    expect(rpc.mock.calls.map(([name]) => name)).toEqual(["current_embryo_test_statistical_fit_v1", "current_embryo_test_statistical_v1"]);
    expect(statisticalFittedReadSchema.safeParse(dto(10)).success).toBe(false);
  });
  it.each(["denied", "stale", "malformed", "undefined", "coverage-as-fit", "risk", "source", "capture", "partial-set"])(
    "refuses %s fitted state without reading or relabelling prior coverage", async fault => {
      ownSession();let data: unknown = fittedDto(), error: unknown = null;
      if (fault === "denied" || fault === "stale") { data = null;error = { code: "42501", message: "synthetic-private-native-canary" }; }
      if (fault === "malformed") data = { status: "unavailable" };
      if (fault === "undefined") data = undefined;
      if (fault === "coverage-as-fit") data = dto(10);
      if (fault === "risk") Object.assign(data as object, { clinicalPublication: true });
      if (fault === "source") (data as ReturnType<typeof fittedDto>).rows[0].receipt.source!.cohort_id = id(99);
      if (fault === "capture") (data as ReturnType<typeof fittedDto>).captureSha256 = "f".repeat(64);
      if (fault === "partial-set") (data as ReturnType<typeof fittedDto>).rows = [];
      const rpc = vi.fn((name: string) => ({ abortSignal: async () => name === "current_embryo_test_statistical_fit_v1"
        ? { data, error } : { data: dto(10), error: null } }));
      await expect(loadSavedEmbryoStatisticalCoverage(id(3), id(1), [id(10)], { rpc })).rejects.toMatchObject({
        table: "embryo_statistical_coverage", message: "embryo read failed: embryo_statistical_coverage: saved read unavailable" });
      expect(rpc).toHaveBeenCalledTimes(1);
    });
  it("refuses a current fitted receipt for a different complete selected embryo set", async () => {
    ownSession();const rpc = vi.fn(() => ({ abortSignal: async () => ({ data: fittedDto(), error: null }) }));
    await expect(loadSavedEmbryoStatisticalCoverage(id(3), id(1), [id(11)], { rpc })).rejects.toThrow("saved read unavailable");
    expect(rpc).toHaveBeenCalledTimes(1);
  });
  it("rechecks TEST after the native response without exposing any fitted number or legacy read", async () => {
    ownSession();const rpc = vi.fn(() => ({ abortSignal: async () => {
      vi.stubEnv("INHERIT_TEST_JURISDICTION", "0");return { data: fittedDto(), error: null }; } }));
    await expect(loadSavedEmbryoStatisticalCoverage(id(3), id(1), [id(10)], { rpc })).rejects.toThrow("saved read unavailable");
    expect(rpc).toHaveBeenCalledTimes(1);
  });
});
