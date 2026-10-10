import { readFileSync } from "node:fs";
import { afterEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ context: vi.fn(), admin: vi.fn() }));
vi.mock("../account-deletion", () => ({ getSensitiveAccountContext: mocks.context }));
vi.mock("../supabase/admin", () => ({ createAdminClient: mocks.admin }));
import { allowedConditionsRegistry } from "./allowed-conditions";
import { loadSavedEmbryoCarrierHold } from "./carrier-hold";
const account = "71000000-0000-4000-8000-000000000001", cohort = "71000000-0000-4000-8000-000000000002";
const session = "71000000-0000-4000-8000-000000000003";
const registry = { ...allowedConditionsRegistry(), conditions: [{ condition_id: "SYNTHETIC:1",
  condition_name: "Synthetic", category: "Having children", permitted_result_kinds: ["carrier_status"],
  risk_model_id: null, enabled_by_default: true }] };
afterEach(() => { vi.unstubAllEnvs();vi.clearAllMocks(); });
it("reads no saved row or account when the real registry is empty", async () => {
  vi.stubEnv("INHERIT_TEST_JURISDICTION", "1");
  expect(await loadSavedEmbryoCarrierHold(account, cohort)).toBeNull();
  expect(mocks.context).not.toHaveBeenCalled();expect(mocks.admin).not.toHaveBeenCalled();
});
it("derives the live account/session and admits only the closed saved hold", async () => {
  vi.stubEnv("INHERIT_TEST_JURISDICTION", "1");mocks.context.mockResolvedValue({ user: { id: account }, sessionId: session });
  const rpc = vi.fn().mockReturnValue({ abortSignal: async () => ({ error: null,
    data: { status: "held", reason: "scientific_disclosures_pending" } }) });
  expect(await loadSavedEmbryoCarrierHold(account, cohort, { registry, rpc })).toEqual({ status: "held", reason: "scientific_disclosures_pending" });
  expect(rpc).toHaveBeenCalledWith("current_embryo_carrier_hold_v1", { p_account: account, p_session: session, p_cohort: cohort, p_test: true });
});
it("cannot adopt a changed live account", async () => {
  vi.stubEnv("INHERIT_TEST_JURISDICTION", "1");mocks.context.mockResolvedValue({ user: { id: cohort }, sessionId: session });
  const rpc = vi.fn();expect(await loadSavedEmbryoCarrierHold(account, cohort, { registry, rpc })).toBeNull();
  expect(rpc).not.toHaveBeenCalled();
});
it.each([{ data: {}, error: null }, { data: { status: "held", reason: "scientific_disclosures_pending", finding: {} }, error: null },
  { data: null, error: { message: "failed" } }])("treats a failed or widened saved read as an error, never empty %#", async result => {
  vi.stubEnv("INHERIT_TEST_JURISDICTION", "1");mocks.context.mockResolvedValue({ user: { id: account }, sessionId: session });
  const rpc = vi.fn().mockReturnValue({ abortSignal: async () => result });
  await expect(loadSavedEmbryoCarrierHold(account, cohort, { registry, rpc })).rejects.toMatchObject({ table: "embryo_carrier_hold" });
});
it("connects the real saved reader after the complete gate in both product pages", () => {
  for (const path of ["src/app/(app)/embryos/compare/page.tsx", "src/app/(app)/embryos/[embryoId]/page.tsx"]) {
    const source = readFileSync(path, "utf8");
    expect(source.indexOf("savedHold = await loadSavedEmbryoCarrierHold(user.id, cohort.id)"))
      .toBeGreaterThan(source.indexOf('case "complete"'));
    expect(source).toContain('data-slot="saved-analysis-held"');
    expect(source).toContain('.is("computation_receipt", null)');
  }
});
