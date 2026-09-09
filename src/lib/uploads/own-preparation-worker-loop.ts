import "server-only";
import { createAdminClient } from "../supabase/admin";
import { drainPreparedScratch } from "../genome/prepared-source/cleanup-integration";
import { runNextOwnPreparation } from "./own-preparation-worker";

export type PreparationWorkerEvent = "preparation_prepared" | "preparation_idle" | "preparation_failed"
  | "cleanup_progress" | "cleanup_idle" | "cleanup_failed" | "worker_stopped";
export class PreparationWorkerLoopError extends Error {
  constructor(readonly code: "worker_disabled" | "invalid_options") { super(code); this.name = "PreparationWorkerLoopError"; }
}
function idle(signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise(resolve => {
    const stop = () => { clearTimeout(timer); signal.removeEventListener("abort", stop); resolve(); };
    // Deliberately referenced: an idle operator-started CLI must stay alive.
    const timer = setTimeout(stop, 5_000);
    signal.addEventListener("abort", stop, { once: true });
    if (signal.aborted) stop();
  });
}

/** Sequential, awaited operator process. Each iteration runs at most one FIFO
 * preparation and one cleanup page. A failed claim/write is not retried here;
 * the next iteration uses SQL's current queue/cleanup eligibility. The existing
 * retention scheduler remains independent. Cleanup progress is not a claim of
 * queue emptiness, physical media erasure, or completion of all file artifacts.
 * No identifiers, source data, exception bodies or bearer material reach emit.
 */
export async function runOwnPreparationWorkerLoop(options: {
  signal: AbortSignal;
  emit: (event: PreparationWorkerEvent) => void;
  /** Bounded operator --once/test mode; omission keeps polling until signalled. */
  maximumIterations?: number;
}): Promise<{ status: "stopped" | "limit"; hadFailure: boolean }> {
  if (process.env.INHERIT_PREPARED_WGS_ENABLED !== "true") throw new PreparationWorkerLoopError("worker_disabled");
  if (options.maximumIterations !== undefined && (!Number.isSafeInteger(options.maximumIterations)
    || options.maximumIterations < 1 || options.maximumIterations > 1000)) throw new PreparationWorkerLoopError("invalid_options");
  let hadFailure = false, iterations = 0;
  while (!options.signal.aborted && (options.maximumIterations === undefined || iterations < options.maximumIterations)) {
    let prepared = false, cycleFailed = false;
    // Recheck operator enablement between jobs. SQL config and current source
    // authority independently gate the actual claim; this flag never sets them.
    if (process.env.INHERIT_PREPARED_WGS_ENABLED !== "true") throw new PreparationWorkerLoopError("worker_disabled");
    try {
      const result = await runNextOwnPreparation({ signal: options.signal });
      if (options.signal.aborted) break;
      prepared = result.status === "prepared";
      options.emit(prepared ? "preparation_prepared" : "preparation_idle");
    } catch {
      if (options.signal.aborted) break;
      hadFailure = true; cycleFailed = true; options.emit("preparation_failed");
    }
    try {
      const result = await drainPreparedScratch(createAdminClient(), options.signal);
      if (options.signal.aborted) break;
      if (result.failed) { hadFailure = true; cycleFailed = true; options.emit("cleanup_failed"); }
      else options.emit(result.processed > 0 ? "cleanup_progress" : "cleanup_idle");
    } catch {
      if (options.signal.aborted) break;
      hadFailure = true; cycleFailed = true; options.emit("cleanup_failed");
    }
    iterations++;
    if (options.maximumIterations !== undefined && iterations >= options.maximumIterations) break;
    // Idle and failing jobs cannot produce an unbounded hot polling loop.
    if (!prepared || cycleFailed) await idle(options.signal);
  }
  if (options.signal.aborted) { options.emit("worker_stopped"); return { status: "stopped", hadFailure }; }
  return { status: "limit", hadFailure };
}
