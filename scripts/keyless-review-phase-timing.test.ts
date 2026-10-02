import { describe, expect, it } from "vitest";
import { keylessReviewPhaseTiming } from "../e2e/helpers/keyless-review-phase-timing";

describe("keyless documentary timing remains inert and secret-free", () => {
  it("returns the original result and records only fixed labels and monotonic relative time", async () => {
    const times = [100, 103.25, 110.5];
    const records: unknown[] = [];
    const phase = keylessReviewPhaseTiming({ now: () => times.shift()!, emit: record => records.push(record) });
    const result = { token: "synthetic-secret-result" };
    expect(await phase("claim-create", async () => result)).toBe(result);
    expect(records).toEqual([
      { diagnostic: "keyless-review-phase-v1", phase: "claim-create", sequence: 1,
        event: "start", elapsedMs: 3.25, durationMs: 0 },
      { diagnostic: "keyless-review-phase-v1", phase: "claim-create", sequence: 1,
        event: "complete", elapsedMs: 10.5, durationMs: 7.25 },
    ]);
    expect(JSON.stringify(records)).not.toContain(result.token);
  });

  it("preserves the exact thrown error and records neither its text nor private fields", async () => {
    const times = [200, 201, 207];
    const records: unknown[] = [];
    const phase = keylessReviewPhaseTiming({ now: () => times.shift()!, emit: record => records.push(record) });
    const failure = new Error("synthetic-private-error");
    await expect(phase("effect-proof", async () => { throw failure; })).rejects.toBe(failure);
    expect(records).toEqual([
      { diagnostic: "keyless-review-phase-v1", phase: "effect-proof", sequence: 1,
        event: "start", elapsedMs: 1, durationMs: 0 },
      { diagnostic: "keyless-review-phase-v1", phase: "effect-proof", sequence: 1,
        event: "failed", elapsedMs: 7, durationMs: 6 },
    ]);
    expect(JSON.stringify(records)).not.toContain(failure.message);
  });

  it("keeps nested observations ordered without sharing clocks or sequence state between cases", async () => {
    const times = [0, 1, 2, 3, 4];
    const records: { sequence: number; event: string; elapsedMs: number }[] = [];
    const first = keylessReviewPhaseTiming({ now: () => times.shift()!, emit: record => records.push(record) });
    expect(await first("a11y-themes", () => first("themed-photo", async () => true))).toBe(true);
    expect(records.map(({ sequence, event }) => [sequence, event])).toEqual([
      [1, "start"], [2, "start"], [2, "complete"], [1, "complete"],
    ]);
    const otherTimes = [50, 52, 55];
    const other: unknown[] = [];
    const second = keylessReviewPhaseTiming({ now: () => otherTimes.shift()!, emit: record => other.push(record) });
    await second("reviewer-auth", async () => undefined);
    expect(other).toEqual([
      { diagnostic: "keyless-review-phase-v1", phase: "reviewer-auth", sequence: 1,
        event: "start", elapsedMs: 2, durationMs: 0 },
      { diagnostic: "keyless-review-phase-v1", phase: "reviewer-auth", sequence: 1,
        event: "complete", elapsedMs: 5, durationMs: 3 },
    ]);
  });

  it("refuses arbitrary contextual labels before executing or emitting anything", async () => {
    const records: unknown[] = [];
    const phase = keylessReviewPhaseTiming({ now: () => 0, emit: record => records.push(record) });
    let called = false;
    await expect(phase("synthetic-private-label" as Parameters<typeof phase>[0], async () => { called = true; }))
      .rejects.toThrow("Unregistered keyless review timing phase");
    expect(called).toBe(false); expect(records).toEqual([]);
  });
});
