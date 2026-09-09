import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ prepare: vi.fn(), cleanup: vi.fn(), admin: vi.fn() }));
vi.mock("./own-preparation-worker", () => ({ runNextOwnPreparation: m.prepare }));
vi.mock("../supabase/admin", () => ({ createAdminClient: m.admin }));
vi.mock("../genome/prepared-source/cleanup-integration", () => ({ drainPreparedScratch: m.cleanup }));
import { runOwnPreparationWorkerLoop } from "./own-preparation-worker-loop";
beforeEach(() => { vi.resetAllMocks(); vi.stubEnv("INHERIT_PREPARED_WGS_ENABLED", "true");
  m.prepare.mockResolvedValue({ status: "idle" }); m.cleanup.mockResolvedValue({ processed: 0, failed: 0 }); m.admin.mockReturnValue({}); });
afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers(); });
const args = () => ({ signal: new AbortController().signal, emit: vi.fn(), maximumIterations: 1 });
describe("operator preparation worker loop", () => {
  it.each([undefined, "false", "TRUE", "1"])("refuses disabled flag %s before queue/service work", async flag => {
    vi.stubEnv("INHERIT_PREPARED_WGS_ENABLED", flag);
    await expect(runOwnPreparationWorkerLoop(args())).rejects.toMatchObject({ code: "worker_disabled" });
    expect(m.prepare).not.toHaveBeenCalled(); expect(m.admin).not.toHaveBeenCalled();
  });
  it("awaits one preparation then one cleanup page and emits only coded outcomes", async () => {
    const order: string[] = [], o = args();
    m.prepare.mockImplementation(async () => { order.push("prepare"); return { status: "prepared", fileId: "synthetic sensitive identity" }; });
    m.cleanup.mockImplementation(async () => { order.push("cleanup"); return { processed: 16, failed: 0 }; });
    expect(await runOwnPreparationWorkerLoop(o)).toEqual({ status: "limit", hadFailure: false });
    expect(order).toEqual(["prepare", "cleanup"]);
    expect(o.emit.mock.calls).toEqual([["preparation_prepared"], ["cleanup_progress"]]);
    expect(m.cleanup).toHaveBeenCalledTimes(1);
  });
  it("still drains cleanup after preparation failure without exposing exception text", async () => {
    const o = args(); m.prepare.mockRejectedValue(new Error("synthetic provider secret text"));
    expect(await runOwnPreparationWorkerLoop(o)).toMatchObject({ hadFailure: true });
    expect(o.emit.mock.calls).toEqual([["preparation_failed"], ["cleanup_idle"]]);
  });
  it.each(["throw", "flag"])("reports cleanup %s failure without claiming completion", async mode => {
    const o = args();
    if (mode === "throw") m.cleanup.mockRejectedValue(new Error("private detail"));
    else m.cleanup.mockResolvedValue({ processed: 5, failed: 1 });
    expect(await runOwnPreparationWorkerLoop(o)).toMatchObject({ hadFailure: true });
    expect(o.emit).toHaveBeenLastCalledWith("cleanup_failed");
  });
  it("idle polling waits five seconds rather than repeatedly claiming", async () => {
    vi.useFakeTimers(); const o = { ...args(), maximumIterations: 2 };
    const work = runOwnPreparationWorkerLoop(o);
    await vi.advanceTimersByTimeAsync(4_999); expect(m.prepare).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1); await work; expect(m.prepare).toHaveBeenCalledTimes(2);
  });
  it("a failed busy cycle also waits five seconds", async () => {
    vi.useFakeTimers(); const o = { ...args(), maximumIterations: 2 };
    m.prepare.mockRejectedValue(new Error("failed")); const work = runOwnPreparationWorkerLoop(o);
    await vi.advanceTimersByTimeAsync(4_999); expect(m.prepare).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1); await work; expect(m.prepare).toHaveBeenCalledTimes(2);
  });
  it("SIGINT-equivalent abort interrupts idle wait without another claim", async () => {
    vi.useFakeTimers(); const controller = new AbortController(), emit = vi.fn();
    const work = runOwnPreparationWorkerLoop({ signal: controller.signal, emit });
    await vi.advanceTimersByTimeAsync(1); controller.abort();
    expect(await work).toEqual({ status: "stopped", hadFailure: false });
    expect(m.prepare).toHaveBeenCalledTimes(1); expect(emit).toHaveBeenLastCalledWith("worker_stopped");
    expect(vi.getTimerCount()).toBe(0);
  });
  it("passes cancellation to active preparation and does not start later cleanup", async () => {
    const controller = new AbortController(), emit = vi.fn();
    m.prepare.mockImplementation(async ({ signal }) => { expect(signal).toBe(controller.signal); controller.abort(); throw new Error("aborted"); });
    expect(await runOwnPreparationWorkerLoop({ signal: controller.signal, emit })).toEqual({ status: "stopped", hadFailure: false });
    expect(m.cleanup).not.toHaveBeenCalled(); expect(emit.mock.calls).toEqual([["worker_stopped"]]);
  });
  it("stops before a next job when operator flag is withdrawn", async () => {
    const o = { ...args(), maximumIterations: 2 };
    m.prepare.mockResolvedValue({ status: "prepared" });
    m.cleanup.mockImplementation(async () => { vi.stubEnv("INHERIT_PREPARED_WGS_ENABLED", "false"); return { processed: 0, failed: 0 }; });
    await expect(runOwnPreparationWorkerLoop(o)).rejects.toMatchObject({ code: "worker_disabled" });
    expect(m.prepare).toHaveBeenCalledTimes(1);
  });
  it.each([0, -1, 1.5, 1001, Number.NaN])("refuses unbounded invalid iteration option %s", async maximumIterations => {
    await expect(runOwnPreparationWorkerLoop({ ...args(), maximumIterations })).rejects.toMatchObject({ code: "invalid_options" });
    expect(m.prepare).not.toHaveBeenCalled();
  });
});
