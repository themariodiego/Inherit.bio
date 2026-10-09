import "server-only";

export const APPEAL_INTAKE_REQUEST_LIMIT_MS = 30_000;
const held = () => new Error("appeal_intake_runtime_held");
type RpcLabel = "suspension-prepare" | "public-prepare" | "public-commit";

/** One monotonic caller clock, created before reading any body byte. Actual
 * operations remain owned after a timeout/abort. This owner never issues a
 * native cleanup ACK and never treats transport abort as transaction rollback.
 * Immutable strings and provider/platform copies remain separately unproved. */
export function createAppealIntakeRuntime(requestSignal: AbortSignal) {
  const startedAt = performance.now();
  const originalDeadline = startedAt + APPEAL_INTAKE_REQUEST_LIMIT_MS;
  const controller = new AbortController();
  const tasks = new Set<Promise<unknown>>();
  const buffers = new Set<Uint8Array>();
  const rpcTasks = new Map<RpcLabel, Promise<unknown>>();
  let closing = false, cleanupHeld = false, commitStarted = false, lateCommitUncertain = false;
  let rejectStopped!: (reason: Error) => void;
  const stopped = new Promise<never>((_, reject) => { rejectStopped = reject; });
  void stopped.catch(() => {});

  function stop() {
    cleanupHeld = true;
    if (commitStarted) lateCommitUncertain = true;
    if (!controller.signal.aborted) {
      controller.abort(held());
      rejectStopped(held());
    }
  }
  function assertOpen() {
    if (performance.now() >= originalDeadline) stop();
    if (closing || controller.signal.aborted) throw held();
  }
  function clear(bytes: Uint8Array) {
    try {
      bytes.fill(0);
      if (bytes.some(byte => byte !== 0)) throw held();
      buffers.delete(bytes);
    } catch { cleanupHeld = true; }
  }
  function track<T>(work: () => PromiseLike<T> | T, cleanup: boolean): Promise<T> {
    if (!cleanup) assertOpen();
    // Register the actual task before its first invocation, including a
    // synchronous throw or a cold PostgREST builder's single assimilation.
    const actual = Promise.resolve().then(() => {
      if (!cleanup) assertOpen();
      return work();
    }).catch(error => {
      if (cleanup) cleanupHeld = true;
      throw error;
    });
    const tracked = actual.finally(() => tasks.delete(tracked));
    tasks.add(tracked);
    void tracked.catch(() => {});
    return tracked;
  }
  const timer = setTimeout(stop, Math.max(0, originalDeadline - performance.now()));
  timer.unref();
  requestSignal.addEventListener("abort", stop, { once: true });
  if (requestSignal.aborted) stop();

  const owner = {
    signal: controller.signal,
    startedAt,
    originalDeadline,
    assertOpen,
    clear,
    holdCleanup() { cleanupHeld = true; },
    own<T extends Uint8Array>(bytes: T): T {
      if (!(bytes instanceof Uint8Array)) throw held();
      buffers.add(bytes);
      // A read may deliver a chunk after the caller has already returned.
      // Its real completion still transfers ownership and clears that chunk.
      if (closing || controller.signal.aborted) clear(bytes);
      return bytes;
    },
    read<T>(work: () => PromiseLike<T> | T) { return track(work, false); },
    cleanup<T>(work: () => PromiseLike<T> | T) { return track(work, true); },
    rpc<T>(label: RpcLabel, work: () => PromiseLike<T> | T): Promise<T> {
      const prior = rpcTasks.get(label);
      if (prior) return prior as Promise<T>;
      const task = track(() => {
        assertOpen();
        if (label === "public-commit") commitStarted = true;
        return work();
      }, false);
      rpcTasks.set(label, task);
      return task;
    },
    async wait<T>(actual: PromiseLike<T>): Promise<T> {
      if (performance.now() >= originalDeadline) stop();
      if (controller.signal.aborted) throw held();
      return Promise.race([actual, stopped]);
    },
    async minimumResponseDelay() {
      const remaining = 250 - (performance.now() - startedAt);
      if (remaining <= 0 || controller.signal.aborted) return;
      let delay: ReturnType<typeof setTimeout> | undefined;
      try {
        await owner.wait(new Promise<void>(resolve => { delay = setTimeout(resolve, remaining); }));
      } catch { /* The original caller bound wins; no new response clock. */ }
      finally { clearTimeout(delay); }
    },
    async finish() {
      closing = true;
      // Cancellation settlement is never a prerequisite for zeroing bytes.
      for (const bytes of [...buffers]) clear(bytes);
      const actual = (async () => {
        while (tasks.size) await Promise.allSettled([...tasks]);
        for (const bytes of [...buffers]) clear(bytes);
      })();
      void actual.catch(() => { cleanupHeld = true; });
      try { await owner.wait(actual); } catch { cleanupHeld = true; }
      finally {
        clearTimeout(timer);
        requestSignal.removeEventListener("abort", stop);
        // Real late tasks keep this owner alive and remain registered. Abort
        // tells the transport to stop; it does not prove native settlement.
        if (!controller.signal.aborted) controller.abort(held());
      }
    },
    disposition() {
      return Object.freeze({ cleanupHeld, lateCommitUncertain,
        pendingActualTasks: tasks.size, ownedMutableBuffers: buffers.size });
    },
  };
  return Object.freeze(owner);
}
export type AppealIntakeRuntime = ReturnType<typeof createAppealIntakeRuntime>;
