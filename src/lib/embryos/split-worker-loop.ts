import "server-only";
import { isTestJurisdictionEnabled } from "../legal/jurisdictions";
import { runNextEmbryoSplit, type EmbryoFragmentReader, type EmbryoSplitResult } from "./split-worker";

export type EmbryoSplitWorkerEvent = "split_staged" | "split_failure_pending" | "split_requeued"
  | "split_idle" | "split_failed" | "worker_stopped";
export class EmbryoSplitWorkerLoopError extends Error {
  constructor(readonly code: "worker_disabled" | "invalid_options") { super(code); this.name = "EmbryoSplitWorkerLoopError"; }
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

const EVENTS: Record<EmbryoSplitResult["status"], EmbryoSplitWorkerEvent> = {
  idle: "split_idle", staged: "split_staged", failure_pending: "split_failure_pending", requeued: "split_requeued",
};

/**
 * Sequential, awaited operator process for embryo sanitization. Embryo
 * ingest is TEST-LOCAL only, so the loop refuses to start, and stops, outside
 * the test jurisdiction; the database independently refuses every claim while
 * `private.embryo_split_config` is off. Events are closed words only: no
 * identifier, count, object name, genotype or error text reaches `emit`.
 * The fragment store is injected: `pnpm worker:embryo-split` passes the R2
 * reader (`split-fragment-reader.ts`).
 */
export async function runEmbryoSplitWorkerLoop(options: {
  signal: AbortSignal;
  emit: (event: EmbryoSplitWorkerEvent) => void;
  readFragment: EmbryoFragmentReader;
  maximumIterations?: number;
  runNext?: typeof runNextEmbryoSplit;
}): Promise<{ status: "stopped" | "limit"; hadFailure: boolean }> {
  if (!isTestJurisdictionEnabled()) throw new EmbryoSplitWorkerLoopError("worker_disabled");
  if (options.maximumIterations !== undefined && (!Number.isSafeInteger(options.maximumIterations)
    || options.maximumIterations < 1 || options.maximumIterations > 1000)) throw new EmbryoSplitWorkerLoopError("invalid_options");
  const runNext = options.runNext ?? runNextEmbryoSplit;
  let hadFailure = false, iterations = 0;
  while (!options.signal.aborted && (options.maximumIterations === undefined || iterations < options.maximumIterations)) {
    if (!isTestJurisdictionEnabled()) throw new EmbryoSplitWorkerLoopError("worker_disabled");
    let worked = false;
    try {
      const result = await runNext({ signal: options.signal, readFragment: options.readFragment });
      if (options.signal.aborted) break;
      options.emit(EVENTS[result.status]);
      worked = result.status !== "idle";
    } catch {
      if (options.signal.aborted) break;
      hadFailure = true;
      options.emit("split_failed");
    }
    iterations++;
    if (options.maximumIterations !== undefined && iterations >= options.maximumIterations) break;
    // Idle and failing claims never become a hot polling loop.
    if (!worked) await idle(options.signal);
  }
  if (options.signal.aborted) { options.emit("worker_stopped"); return { status: "stopped", hadFailure }; }
  return { status: "limit", hadFailure };
}
