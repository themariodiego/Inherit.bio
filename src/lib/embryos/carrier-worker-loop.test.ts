import { afterEach, expect, it, vi } from "vitest";
import { runEmbryoCarrierWorkerLoop, type EmbryoCarrierEvent } from "./carrier-worker-loop";
import { runNextEmbryoCarrier } from "./carrier-worker";
afterEach(() => { vi.unstubAllEnvs();vi.useRealTimers(); });
it("runs the actual empty-registry path once and stops without any configured client", async () => {
  vi.stubEnv("INHERIT_TEST_JURISDICTION", "1");const events: EmbryoCarrierEvent[] = [];
  expect(await runEmbryoCarrierWorkerLoop({ signal: new AbortController().signal, emit: e => events.push(e) }))
    .toEqual({ status: "held", hadFailure: false });
  expect(events).toEqual(["carrier_held"]);
});
it("awaits each complete cohort and emits only closed results", async () => {
  vi.stubEnv("INHERIT_TEST_JURISDICTION", "1");const events: EmbryoCarrierEvent[] = [];
  const runNext = vi.fn<typeof runNextEmbryoCarrier>().mockResolvedValueOnce({ status: "saved_held" })
    .mockResolvedValueOnce({ status: "cancelled" });
  expect(await runEmbryoCarrierWorkerLoop({ signal: new AbortController().signal, maximumIterations: 2,
    emit: e => events.push(e), runNext })).toEqual({ status: "limit", hadFailure: false });
  expect(runNext).toHaveBeenCalledTimes(2);expect(events).toEqual(["carrier_saved_held", "carrier_cancelled"]);
});
it("stops without emitting a late result after cancellation", async () => {
  vi.stubEnv("INHERIT_TEST_JURISDICTION", "1");const controller = new AbortController();const events: EmbryoCarrierEvent[] = [];
  const runNext = vi.fn<typeof runNextEmbryoCarrier>().mockImplementation(async () => {
    controller.abort();return { status: "saved_held" };
  });
  expect(await runEmbryoCarrierWorkerLoop({ signal: controller.signal, emit: e => events.push(e), runNext }))
    .toEqual({ status: "stopped", hadFailure: false });
  expect(events).toEqual(["worker_stopped"]);
});
it.each([0, 1001, 1.5, Number.NaN])("refuses invalid finite process limit %s before a claim", async limit => {
  vi.stubEnv("INHERIT_TEST_JURISDICTION", "1");const runNext = vi.fn<typeof runNextEmbryoCarrier>();
  await expect(runEmbryoCarrierWorkerLoop({ signal: new AbortController().signal, emit: () => {}, runNext,
    maximumIterations: limit })).rejects.toThrow("invalid_options");expect(runNext).not.toHaveBeenCalled();
});
