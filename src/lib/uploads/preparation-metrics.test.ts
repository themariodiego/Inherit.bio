import { describe, expect, it, vi } from "vitest";
import { PreparationMetrics, preparationMetricOperations, preparationMetricPhases,
  type PreparationMetricsClock, type PreparationMetricPhase, type PreparationMetricOperation } from "./preparation-metrics";

function fixture() {
  const sink = vi.fn(); let wall = 0, user = 0, system = 0;
  const clock: PreparationMetricsClock = { now: () => wall, cpu: () => ({ user, system }) };
  const metrics = new PreparationMetrics(sink, clock);
  return { metrics, sink, clock, advance: (ms: number, us = 0, sys = 0) => { wall += ms; user += us; system += sys; } };
}
describe("optional aggregate preparation metrics", () => {
  it("attributes operations to their start phase and separates active work from acknowledged checkpoints", () => {
    const f = fixture(); f.advance(5, 11, 3); f.metrics.enterPhase("canonical_materialization");
    const read = f.metrics.operation("artifact_read"); f.advance(7, 13, 2);
    f.metrics.checkpointCompleted("canonical-materialization"); f.metrics.enterPhase("rsid_runs");
    f.advance(4, 17, 1); read(true, 20); read(false);
    f.metrics.finish("failed");
    const event = f.sink.mock.calls[0][0];
    expect(event).toMatchObject({ outcome: "failed", activePhase: "rsid_runs", lastCompletedCheckpoint: "canonical-materialization", completedCheckpoints: 1, dropped: 0 });
    expect(event.phases.claim).toMatchObject({ wallMs: 5, cpuUserUs: 11, cpuSystemUs: 3, completed: true });
    expect(event.phases.canonical_materialization).toMatchObject({ wallMs: 7, completed: true,
      operations: { artifact_read: { started: 1, completed: 1, failed: 0, incomplete: 0, wallMs: 11, completedBytes: 20 } } });
    expect(event.phases.rsid_runs).toMatchObject({ wallMs: 4, cpuUserUs: 17, cpuSystemUs: 1, completed: false });
    expect(event.phases.publication).toMatchObject({ entered: false, completed: false, wallMs: 0 });
  });
  it("keeps failure and in-flight outcomes distinct, does not revise a flushed event on late completion", () => {
    const f = fixture(), failed = f.metrics.operation("provider_get"), pending = f.metrics.operation("rpc");
    f.advance(9); failed(false, 100); f.advance(4); f.metrics.finish("aborted");
    const event = f.sink.mock.calls[0][0], snapshot = JSON.stringify(event);
    expect(event.phases.claim.operations.provider_get).toEqual({ started: 1, completed: 0, failed: 1, incomplete: 0, wallMs: 9, completedBytes: 0 });
    expect(event.phases.claim.operations.rpc).toEqual({ started: 1, completed: 0, failed: 0, incomplete: 1, wallMs: 13, completedBytes: 0 });
    pending(true, 5); f.metrics.enterPhase("publication"); f.metrics.checkpointCompleted("publication-preflight");
    f.metrics.operation("rpc")(true); f.metrics.finish("prepared");
    expect(f.sink).toHaveBeenCalledOnce(); expect(JSON.stringify(event)).toBe(snapshot);
    expect(Object.isFrozen(event.phases.claim.operations.rpc)).toBe(true); expect(Object.isFrozen(event.phases)).toBe(true);
  });
  it("bounds pending state and saturates durations/byte counters", () => {
    const f = fixture(), complete = Array.from({ length: 33 }, () => f.metrics.operation("artifact_read"));
    f.advance(Number.MAX_VALUE, Number.MAX_VALUE, Number.MAX_VALUE);
    complete.forEach(end => end(true, Number.MAX_SAFE_INTEGER)); f.metrics.finish("prepared");
    const event = f.sink.mock.calls[0][0];
    expect(event.dropped).toBe(1);
    expect(event.phases.claim).toMatchObject({ wallMs: Number.MAX_SAFE_INTEGER, cpuUserUs: Number.MAX_SAFE_INTEGER, cpuSystemUs: Number.MAX_SAFE_INTEGER });
    expect(event.phases.claim.operations.artifact_read).toMatchObject({ started: 32, completed: 32, completedBytes: Number.MAX_SAFE_INTEGER, wallMs: Number.MAX_SAFE_INTEGER });
  });
  it.each([Number.NaN, Infinity, -1, 0.5, Number.MAX_SAFE_INTEGER + 1])("drops invalid byte metric %s without failing completed work", bytes => {
    const f = fixture(); f.metrics.operation("source_get")(true, bytes); f.metrics.finish("prepared");
    expect(f.sink.mock.calls[0][0].phases.claim.operations.source_get).toMatchObject({ completed: 1, completedBytes: 0 });
    expect(f.sink.mock.calls[0][0].dropped).toBe(1);
  });
  it.each(["throw", "invalid", "backwards", "unavailable"])("tolerates %s clocks and reports unavailable deltas", mode => {
    const f = fixture(); f.advance(20, 10, 10); f.metrics.enterPhase("setup");
    if (mode === "throw") { f.clock.now = () => { throw new Error("private clock detail"); }; f.clock.cpu = () => { throw new Error("private clock detail"); }; }
    if (mode === "invalid") { f.clock.now = () => NaN; f.clock.cpu = () => ({ user: Infinity, system: -1 }); }
    if (mode === "backwards") f.advance(-1, -1, -1);
    if (mode === "unavailable") f.clock.cpu = () => null;
    const end = f.metrics.operation("rpc"); end(true); f.metrics.finish("prepared");
    const event = f.sink.mock.calls[0][0];
    expect(event.phases.setup.cpuAvailable).toBe(false);
    expect(event.phases.setup.wallAvailable).toBe(mode === "unavailable");
    expect(JSON.stringify(event)).not.toMatch(/private|NaN|Infinity/);
  });
  it("rejects dynamic labels and emits only a fixed schema with numeric/boolean values", () => {
    const f = fixture(); const privateText = "synthetic-private-object-path";
    f.metrics.enterPhase(privateText as PreparationMetricPhase); f.metrics.operation(privateText as PreparationMetricOperation)(true);
    f.metrics.checkpointCompleted(privateText as "source-scan"); f.metrics.finish("idle");
    const event = f.sink.mock.calls[0][0];
    expect(Object.keys(event).sort()).toEqual(["activePhase", "completedCheckpoints", "dropped", "event", "lastCompletedCheckpoint", "outcome", "phases"].sort());
    expect(Object.keys(event.phases)).toEqual(preparationMetricPhases);
    for (const phase of Object.values(event.phases) as Record<string, unknown>[]) {
      expect(Object.keys(phase).sort()).toEqual(["entered", "completed", "wallMs", "cpuUserUs", "cpuSystemUs", "wallAvailable", "cpuAvailable", "operations"].sort());
      expect(Object.keys(phase.operations as object)).toEqual(preparationMetricOperations);
      for (const value of Object.values(phase.operations as Record<string, object>)) {
        expect(Object.keys(value).sort()).toEqual(["started", "completed", "failed", "incomplete", "wallMs", "completedBytes"].sort());
        expect(Object.values(value).every(v => Number.isSafeInteger(v) && v >= 0)).toBe(true);
      }
    }
    expect(event.dropped).toBe(3); expect(JSON.stringify(event)).not.toContain(privateText);
  });
  it.each(["throw", "reject", "thenable"])("contains a %s sink without changing work or leaving an unhandled rejection", async mode => {
    const sink = vi.fn(() => {
      if (mode === "throw") throw new Error("private sink detail");
      if (mode === "reject") return Promise.reject(new Error("private sink detail"));
      return Object.defineProperty({}, "then", { get() { throw new Error("private thenable detail"); } });
    });
    const metrics = new PreparationMetrics(sink); expect(() => metrics.finish("idle")).not.toThrow();
    await new Promise(resolve => setImmediate(resolve)); expect(sink).toHaveBeenCalledOnce();
  });
});
