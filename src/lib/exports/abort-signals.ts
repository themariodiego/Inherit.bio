/**
 * Combine abort signals for one bounded operation.
 *
 * Node's `AbortSignal.any()` registers the result as a dependant of every
 * source and prunes each source's dependant set from a FinalizationRegistry
 * callback that scans the whole set once per collected dependant
 * (lib/internal/abort_controller.js, Node 22). Thousands of per-operation
 * calls against one job-lifetime signal therefore stall the event loop for
 * seconds when those dependants are collected.
 *
 * This links through ordinary `abort` listeners instead. Every listener is
 * removed as soon as the combined signal aborts, so the caller must abort one
 * of its own sources when the operation ends (each caller does, in `finally`).
 * The first aborted source, in order, supplies the reason, as with
 * `AbortSignal.any()`.
 */
export function anySignal(signals: readonly AbortSignal[]): AbortSignal {
  const combined = new AbortController();
  for (const source of signals) {
    if (source.aborted) {
      combined.abort(source.reason);
      return combined.signal;
    }
  }
  for (const source of signals) {
    source.addEventListener("abort", () => combined.abort(source.reason), { once: true, signal: combined.signal });
  }
  return combined.signal;
}
