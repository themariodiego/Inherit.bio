import { getEventListeners } from "node:events";
import { describe, expect, it } from "vitest";
import { anySignal } from "./abort-signals";

describe("anySignal", () => {
  it("stays open until a source aborts, then carries that source's reason", () => {
    const job = new AbortController(), local = new AbortController(), combined = anySignal([job.signal, local.signal]);
    expect(combined.aborted).toBe(false);
    const reason = new Error("job stopped");
    job.abort(reason);
    expect(combined.aborted).toBe(true);
    expect(combined.reason).toBe(reason);
  });

  it("starts aborted with the first already-aborted source's reason, in order", () => {
    const first = new AbortController(), second = new AbortController();
    second.abort("second");
    first.abort("first");
    const combined = anySignal([new AbortController().signal, first.signal, second.signal]);
    expect(combined.aborted).toBe(true);
    expect(combined.reason).toBe("first");
    expect(getEventListeners(first.signal, "abort")).toHaveLength(0);
  });

  it("removes every listener from a long-lived source once each operation's local signal aborts", () => {
    const job = new AbortController();
    for (let operation = 0; operation < 20_000; operation++) {
      const local = new AbortController(), combined = anySignal([job.signal, local.signal]);
      expect(combined.aborted).toBe(false);
      local.abort();
      expect(combined.aborted).toBe(true);
    }
    expect(getEventListeners(job.signal, "abort")).toHaveLength(0);
    expect(job.signal.aborted).toBe(false);
  });

  it("still propagates a later job abort to an operation that is in progress", () => {
    const job = new AbortController(), local = new AbortController(), combined = anySignal([job.signal, local.signal]);
    let fired = 0;
    combined.addEventListener("abort", () => fired++, { once: true });
    job.abort("deadline");
    local.abort();
    expect(fired).toBe(1);
    expect(combined.reason).toBe("deadline");
    expect(getEventListeners(local.signal, "abort")).toHaveLength(0);
  });
});
