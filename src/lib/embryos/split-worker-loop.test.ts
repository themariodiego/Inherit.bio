import { afterEach, describe, expect, it, vi } from "vitest";
import { runEmbryoSplitWorkerLoop, type EmbryoSplitWorkerEvent } from "./split-worker-loop";

afterEach(() => { vi.unstubAllEnvs(); });

describe("embryo split worker loop", () => {
  it("refuses to start outside the test jurisdiction", async () => {
    vi.stubEnv("INHERIT_TEST_JURISDICTION", "");
    const runNext = vi.fn();
    await expect(runEmbryoSplitWorkerLoop({ signal: new AbortController().signal, emit: () => {}, readFragment: async () => new Uint8Array(), runNext }))
      .rejects.toMatchObject({ code: "worker_disabled" });
    expect(runNext).not.toHaveBeenCalled();
  });

  it("emits only closed words, whatever a run returns or throws", async () => {
    vi.stubEnv("INHERIT_TEST_JURISDICTION", "1");
    const events: EmbryoSplitWorkerEvent[] = [];
    const results = [
      { status: "published", jobId: "private-job", passed: 2, failed: 1 },
      { status: "failure_pending", jobId: "private-job", code: "stale-binding" },
      { status: "requeued", jobId: "private-job" },
    ];
    const runNext = vi.fn(async () => {
      const next = results.shift();
      if (!next) throw new Error("private failure detail");
      return next as never;
    });
    const result = await runEmbryoSplitWorkerLoop({ signal: new AbortController().signal,
      emit: (event) => { events.push(event); }, readFragment: async () => new Uint8Array(), runNext, maximumIterations: 4 });
    expect(events).toEqual(["split_published", "split_failure_pending", "split_requeued", "split_failed"]);
    expect(result).toEqual({ status: "limit", hadFailure: true });
    expect(JSON.stringify(events)).not.toMatch(/private/);
  });

  it("stops between runs when the test jurisdiction is withdrawn", async () => {
    vi.stubEnv("INHERIT_TEST_JURISDICTION", "1");
    const runNext = vi.fn(async () => { vi.stubEnv("INHERIT_TEST_JURISDICTION", ""); return { status: "published" } as never; });
    await expect(runEmbryoSplitWorkerLoop({ signal: new AbortController().signal, emit: () => {}, readFragment: async () => new Uint8Array(), runNext,
      maximumIterations: 3 })).rejects.toMatchObject({ code: "worker_disabled" });
    expect(runNext).toHaveBeenCalledOnce();
  });

  it("rejects an unbounded or malformed iteration limit", async () => {
    vi.stubEnv("INHERIT_TEST_JURISDICTION", "1");
    for (const maximumIterations of [0, 1001, 1.5]) {
      await expect(runEmbryoSplitWorkerLoop({ signal: new AbortController().signal, emit: () => {},
        readFragment: async () => new Uint8Array(), runNext: vi.fn(), maximumIterations })).rejects.toMatchObject({ code: "invalid_options" });
    }
  });
});
