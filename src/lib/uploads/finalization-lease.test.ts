import { afterEach, expect, it, vi } from "vitest";
import { FinalizationInterrupted, startFinalizationLease, waitForFinalization } from "./finalization-lease";

afterEach(() => vi.useRealTimers());

it("serializes heartbeat and boundary renewal, then settles before stopping", async () => {
  vi.useFakeTimers();
  let finish!: () => void;
  const renew = vi.fn(() => new Promise<void>(resolve => { finish = resolve; }));
  const lease = startFinalizationLease(renew);
  const boundary = lease.check();
  await vi.advanceTimersByTimeAsync(40_000);
  expect(renew).toHaveBeenCalledTimes(1);
  let stopped = false;
  const stopping = lease.stop().then(() => { stopped = true; });
  await Promise.resolve();
  expect(stopped).toBe(false);
  finish(); await boundary; await stopping;
  await vi.advanceTimersByTimeAsync(60_000);
  expect(renew).toHaveBeenCalledTimes(1);
  expect(vi.getTimerCount()).toBe(0);
});

it("never resumes work or retries renewal after ownership is refused", async () => {
  vi.useFakeTimers();
  const renew = vi.fn().mockRejectedValue(new Error("synthetic revoked claim"));
  const lease = startFinalizationLease(renew);
  await vi.advanceTimersByTimeAsync(20_000);
  await expect(lease.check()).rejects.toBeInstanceOf(FinalizationInterrupted);
  await vi.advanceTimersByTimeAsync(60_000);
  expect(renew).toHaveBeenCalledTimes(1);
  await lease.stop();
});

it("does not reuse a heartbeat begun before the range arrived as its consumption check", async () => {
  vi.useFakeTimers();
  let finish!: () => void;
  const renew = vi.fn().mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }))
    .mockResolvedValue(undefined);
  const lease = startFinalizationLease(renew);
  await vi.advanceTimersByTimeAsync(20_000);
  const consuming = lease.check();
  expect(renew).toHaveBeenCalledTimes(1);
  finish(); await consuming;
  expect(renew).toHaveBeenCalledTimes(2);
  await lease.stop();
});

it("returns on cancellation when an owned transport ignores it and consumes its late failure", async () => {
  const controller = new AbortController();
  let fail!: (error: Error) => void;
  const transport = new Promise<void>((_, reject) => { fail = reject; });
  const waiting = waitForFinalization(transport, controller.signal);
  controller.abort();
  await expect(waiting).rejects.toBeInstanceOf(FinalizationInterrupted);
  fail(new Error("synthetic late transport failure"));
  await Promise.resolve();
});
