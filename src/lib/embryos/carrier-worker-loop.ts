import "server-only";
import { isTestJurisdictionEnabled } from "../legal/jurisdictions";
import { runNextEmbryoCarrier } from "./carrier-worker";
import { reconcileNextEmbryoCarriers } from "./carrier-reconcile";

export type EmbryoCarrierEvent = "carrier_saved_held" | "carrier_cancelled" | "carrier_idle"
  | "carrier_failed" | "carrier_held" | "worker_stopped";
function idle(signal: AbortSignal): Promise<void> {
  return new Promise(resolve => {
    const stop = () => { clearTimeout(timer);signal.removeEventListener("abort", stop);resolve(); };
    const timer = setTimeout(stop, 5_000);
    signal.addEventListener("abort", stop, { once: true });
    if (signal.aborted) stop();
  });
}
/** Awaited operator process, with closed events and one complete cohort at a
 * time. It stops at the empty registry hold and never logs DNA or identities. */
export async function runEmbryoCarrierWorkerLoop(options: { signal: AbortSignal;
  emit: (event: EmbryoCarrierEvent) => void; maximumIterations?: number;
  runNext?: typeof runNextEmbryoCarrier;
  reconcile?: typeof reconcileNextEmbryoCarriers;
}): Promise<{ status: "held" | "stopped" | "limit"; hadFailure: boolean }> {
  if (!isTestJurisdictionEnabled()) throw new Error("worker_disabled");
  if (options.maximumIterations !== undefined && (!Number.isSafeInteger(options.maximumIterations)
    || options.maximumIterations < 1 || options.maximumIterations > 1000)) throw new Error("invalid_options");
  let hadFailure = false, count = 0, afterCohortId: string | null = null;
  while (!options.signal.aborted && (options.maximumIterations === undefined || count < options.maximumIterations)) {
    if (!isTestJurisdictionEnabled()) throw new Error("worker_disabled");
    let worked = false;
    try {
      const page = await (options.reconcile ?? reconcileNextEmbryoCarriers)({ signal: options.signal, afterCohortId });
      if (options.signal.aborted) break;
      if ("status" in page) { options.emit("carrier_held");return { status: "held", hadFailure }; }
      afterCohortId = page.nextCursor;
      const result = await (options.runNext ?? runNextEmbryoCarrier)({ signal: options.signal });
      if (options.signal.aborted) break;
      if (result.status === "held") { options.emit("carrier_held");return { status: "held", hadFailure }; }
      options.emit(`carrier_${result.status}`);
      hadFailure ||= result.status === "failed";
      worked = result.status === "saved_held" || result.status === "cancelled" || page.nextCursor !== null;
    } catch {
      if (options.signal.aborted) break;
      hadFailure = true;options.emit("carrier_failed");
    }
    count++;
    if (options.maximumIterations !== undefined && count >= options.maximumIterations) break;
    if (!worked) await idle(options.signal);
  }
  if (options.signal.aborted) { options.emit("worker_stopped");return { status: "stopped", hadFailure }; }
  return { status: "limit", hadFailure };
}
