import "server-only";

/** An interrupted attempt leaves its source and durable progress for a retry. */
export class FinalizationInterrupted extends Error {
  constructor() { super("finalization_interrupted"); }
}

/** Bound the caller even if a transport ignores cancellation. A late RPC still
 * carries the old claim, which SQL must fence independently of this timer. */
export async function waitForFinalization<T>(pending: PromiseLike<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) {
    void Promise.resolve(pending).catch(() => {});
    throw new FinalizationInterrupted();
  }
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(new FinalizationInterrupted());
    signal.addEventListener("abort", abort, { once: true });
    Promise.resolve(pending).then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
    if (signal.aborted) abort();
  });
}

/** One renewal at a time. Every boundary awaits it, and stop settles the last
 * renewal before publication/cleanup; no renewal survives the request. */
export function startFinalizationLease(renew: () => Promise<void>) {
  let stopped = false;
  let lost = false;
  let pending: Promise<void> | undefined;
  async function renewOnce() {
    if (stopped || lost) throw new FinalizationInterrupted();
    if (!pending) {
      pending = renew().catch(() => { lost = true; throw new FinalizationInterrupted(); })
        .finally(() => { pending = undefined; });
    }
    await pending;
  }
  const timer = setInterval(() => { void renewOnce().catch(() => {}); }, 20_000);
  timer.unref();
  return {
    async check() {
      // A heartbeat may have started before a range arrived. Settle it, then
      // issue a fresh authority check immediately before consuming that range.
      await pending;
      await renewOnce();
    },
    async stop() {
      stopped = true;
      clearInterval(timer);
      await pending?.catch(() => {});
    },
  };
}
