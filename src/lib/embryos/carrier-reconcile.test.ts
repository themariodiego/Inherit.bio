import { afterEach, expect, it, vi } from "vitest";
import { allowedConditionsRegistry } from "./allowed-conditions";
import { reconcileNextEmbryoCarriers } from "./carrier-reconcile";
import type { EmbryoCarrierRpc } from "./carrier-worker";
const registry = { ...allowedConditionsRegistry(), conditions: [{ condition_id: "SYNTHETIC:1",
  condition_name: "Synthetic", category: "Having children", permitted_result_kinds: ["carrier_status"],
  risk_model_id: null, enabled_by_default: true }] };
const id = (n: number) => `71000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
afterEach(() => vi.unstubAllEnvs());
it("stops the empty real registry before any client or inventory read", async () => {
  vi.stubEnv("INHERIT_TEST_JURISDICTION", "1");const rpc = vi.fn<EmbryoCarrierRpc>();
  expect(await reconcileNextEmbryoCarriers({ rpc })).toEqual({ status: "held", reason: "no_registered_conditions" });
  expect(rpc).not.toHaveBeenCalled();
});
it("refuses outside TEST-LOCAL before reconciliation", async () => {
  vi.stubEnv("INHERIT_TEST_JURISDICTION", "0");const rpc = vi.fn<EmbryoCarrierRpc>();
  await expect(reconcileNextEmbryoCarriers({ rpc, registry })).rejects.toMatchObject({ code: "worker_disabled" });
  expect(rpc).not.toHaveBeenCalled();
});
it("requests only a bounded inventory cursor with no selected source or authority", async () => {
  vi.stubEnv("INHERIT_TEST_JURISDICTION", "1");
  const rpc = vi.fn<EmbryoCarrierRpc>().mockResolvedValue({ version: "embryo-carrier-reconcile-v1",
    checked: 4, queued: 1, nextCursor: id(9) });
  expect(await reconcileNextEmbryoCarriers({ rpc, registry, afterCohortId: id(1) })).toMatchObject({ nextCursor: id(9) });
  expect(rpc.mock.calls[0][1]).toEqual({ p_operation: "reconcile", p_job_id: null, p_attempt: null,
    p_claim_token_hash: expect.stringMatching(/^[0-9a-f]{64}$/), p_payload: { afterCohortId: id(1) }, p_test_jurisdiction: true });
});
it.each([
  { version: "embryo-carrier-reconcile-v1", checked: 4, queued: 1, nextCursor: id(1) },
  { version: "embryo-carrier-reconcile-v1", checked: 1, queued: 2, nextCursor: null },
  { version: "embryo-carrier-reconcile-v1", checked: 4, queued: 1, nextCursor: null },
  { version: "embryo-carrier-reconcile-v1", checked: 4, queued: 1, nextCursor: id(9), capture: {} },
])("rejects a malformed or nonadvancing bounded response %#", async value => {
  vi.stubEnv("INHERIT_TEST_JURISDICTION", "1");const rpc = vi.fn<EmbryoCarrierRpc>().mockResolvedValue(value);
  await expect(reconcileNextEmbryoCarriers({ rpc, registry, afterCohortId: id(1) })).rejects.toMatchObject({ code: "invalid_response" });
});
it("discards a late inventory response after cancellation", async () => {
  vi.stubEnv("INHERIT_TEST_JURISDICTION", "1");const c = new AbortController();
  const rpc = vi.fn<EmbryoCarrierRpc>().mockImplementation(async () => {
    c.abort();return { version: "embryo-carrier-reconcile-v1", checked: 0, queued: 0, nextCursor: null };
  });
  await expect(reconcileNextEmbryoCarriers({ rpc, registry, signal: c.signal })).rejects.toMatchObject({ code: "aborted" });
});
