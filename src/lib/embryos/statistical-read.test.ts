import { afterEach, describe, expect, it, vi } from "vitest";
const account = vi.hoisted(() => ({ value: null as null | { user: { id: string }; sessionId: string } }));
vi.mock("../account-deletion", () => ({ getSensitiveAccountContext: async () => account.value }));
vi.mock("../supabase/admin", () => ({ createAdminClient: () => { throw new Error("unexpected client"); } }));
import { loadSavedEmbryoStatisticalCoverage, statisticalCoverageReadSchema } from "./statistical-read";

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
    const rpc = vi.fn(() => ({ abortSignal: async () => ({ data: dto(), error: null }) }));
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
