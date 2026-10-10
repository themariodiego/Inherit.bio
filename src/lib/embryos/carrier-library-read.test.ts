import { afterEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ context: vi.fn(), acknowledged: vi.fn(), admin: vi.fn() }));
vi.mock("../account-deletion", () => ({ getSensitiveAccountContext: mocks.context }));
vi.mock("./tier2", () => ({ acknowledged: mocks.acknowledged }));
vi.mock("../supabase/admin", () => ({ createAdminClient: mocks.admin }));
import { allowedConditionsRegistry } from "./allowed-conditions";
import type { EmbryoCohortView } from "./cohorts";
import { loadSavedCarrierLibraryCoverage } from "./carrier-library-read";

const account = "71000000-0000-4000-8000-000000000001", session = "71000000-0000-4000-8000-000000000002";
const cohort: EmbryoCohortView = { id: "71000000-0000-4000-8000-000000000003", status: "active",
  createdAt: "2026-10-10T00:00:00Z", embryoCount: 2, viewerRole: "required_upload_principal",
  requiredUploadPrincipalAccountIds: [account], requiredUploadPrincipalsWithoutAccount: 0,
  analysisGranted: true, viewerAnalysisGranted: true, analysisGrantsMissing: 0,
  retentionExpiresAt: "2026-11-10T00:00:00Z", embryos: [4, 5].map(value => ({
    id: `71000000-0000-4000-8000-00000000000${value}`, subjectId: `71000000-0000-4000-8000-00000000000${value + 2}`,
    sampleOrdinal: value - 3, displayLabel: `Embryo ${value - 3}`, status: "qc_pass" })) };
const registry = { ...allowedConditionsRegistry(), conditions: [1, 2].map(id => ({ condition_id: `SYNTHETIC:${id}`,
  condition_name: `Synthetic ${id}`, category: "Having children", permitted_result_kinds: ["carrier_status"],
  risk_model_id: null, enabled_by_default: true })) };
function response() {
  return { version: "embryo-carrier-library-read-v1", cohortId: cohort.id, publicationRevision: 1,
    rows: cohort.embryos.flatMap(embryo => registry.conditions.map(condition => ({
      embryoId: embryo.id, conditionId: condition.condition_id, qualityReason: null as string | null,
      coverage: { version: "embryo-carrier-library-coverage-v1", basis: "distinct-grch38-reviewed-loci-v1",
        conditionId: condition.condition_id, conditionName: condition.condition_name, referenceReleaseId: "synthetic-coverage",
        checkedPositions: 1, requiredPositions: 2, coverageState: "partial", interpretationStatus: "held",
        holdReason: "scientific_disclosures_pending", unresolved: [{ reasons: ["not_covered"], positions: 1 }] } as unknown }))) };
}
function live() {
  vi.stubEnv("INHERIT_TEST_JURISDICTION", "1");
  mocks.context.mockResolvedValue({ user: { id: account }, sessionId: session });mocks.acknowledged.mockResolvedValue(true);
}
function rpcFor(data: unknown, error: unknown = null) {
  const abortSignal = vi.fn().mockResolvedValue({ data, error });
  return { rpc: vi.fn().mockReturnValue({ abortSignal }), abortSignal };
}
afterEach(() => { vi.unstubAllEnvs();vi.resetAllMocks(); });

describe("closed current carrier-library read behind the live gates", () => {
  it("does not read an account, service client or result for the real empty registry", async () => {
    live();expect(await loadSavedCarrierLibraryCoverage(account, cohort)).toBeNull();
    expect(mocks.context).not.toHaveBeenCalled();expect(mocks.admin).not.toHaveBeenCalled();
  });
  it.each(["jurisdiction", "draft", "analysis", "account", "tier2"])("refuses before the RPC when %s authority is absent", async gate => {
    live();const target = { ...cohort };const { rpc } = rpcFor(response());
    if (gate === "jurisdiction") vi.stubEnv("INHERIT_TEST_JURISDICTION", "0");
    if (gate === "draft") target.status = "ingesting";
    if (gate === "analysis") target.analysisGranted = false;
    if (gate === "account") mocks.context.mockResolvedValue({ user: { id: cohort.id }, sessionId: session });
    if (gate === "tier2") mocks.acknowledged.mockResolvedValue(false);
    expect(await loadSavedCarrierLibraryCoverage(account, target, { registry, rpc })).toBeNull();expect(rpc).not.toHaveBeenCalled();
  });
  it("uses the current account/session and requires the whole embryo-condition set", async () => {
    live();const data = response();const { rpc, abortSignal } = rpcFor(data);
    expect(await loadSavedCarrierLibraryCoverage(account, cohort, { registry, rpc })).toEqual(data.rows);
    expect(rpc).toHaveBeenCalledExactlyOnceWith("current_embryo_carrier_library_coverage_v1",
      { p_account: account, p_session: session, p_cohort: cohort.id, p_test: true });
    expect(abortSignal.mock.calls[0][0]).toBeInstanceOf(AbortSignal);
  });
  it("keeps quality refusal distinct from zero position coverage", async () => {
    live();const data = response();data.rows[0].coverage = null;data.rows[0].qualityReason = "embryo_call_rate";
    const { rpc } = rpcFor(data);
    const result = await loadSavedCarrierLibraryCoverage(account, cohort, { registry, rpc });
    expect(result?.[0]).toEqual({ embryoId: cohort.embryos[0].id, conditionId: "SYNTHETIC:1",
      coverage: null, qualityReason: "embryo_call_rate" });
  });
  it("returns honest absence when the native full current publication no longer resolves", async () => {
    live();const { rpc } = rpcFor(null);expect(await loadSavedCarrierLibraryCoverage(account, cohort, { registry, rpc })).toBeNull();
  });
  it.each(["missing", "extra", "duplicate", "foreign-embryo", "foreign-condition", "foreign-cohort", "wrong-name",
    "clinical-value", "lost-quality-cause", "quality-as-coverage", "error"])("fails closed on %s saved output", async defect => {
    live();const data = response();let error: unknown = null;
    if (defect === "missing") data.rows.pop();
    if (defect === "extra") data.rows.push(data.rows[0]);
    if (defect === "duplicate") data.rows[1] = data.rows[0];
    if (defect === "foreign-embryo") data.rows[0].embryoId = account;
    if (defect === "foreign-condition") data.rows[0].conditionId = "SYNTHETIC:3";
    if (defect === "foreign-cohort") data.cohortId = account;
    if (defect === "wrong-name") data.rows[0].coverage = { ...(data.rows[0].coverage as object), conditionName: "Other" };
    if (defect === "clinical-value") data.rows[0].coverage = { ...(data.rows[0].coverage as object), observed_copies: 1 };
    if (defect === "lost-quality-cause") data.rows[0].coverage = null;
    if (defect === "quality-as-coverage") data.rows[0].qualityReason = "embryo_call_rate";
    if (defect === "error") error = { message: "private response canary" };
    const { rpc } = rpcFor(data, error);
    await expect(loadSavedCarrierLibraryCoverage(account, cohort, { registry, rpc }))
      .rejects.toMatchObject({ table: "embryo_carrier_library",
        message: "embryo read failed: embryo_carrier_library: saved coverage unavailable" });
  });
});
