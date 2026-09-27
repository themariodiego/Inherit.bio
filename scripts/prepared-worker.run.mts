/** Operator-started only: pnpm worker:prepared [--once] [--metrics]. */
import { preparedWorkerOptions } from "../src/lib/uploads/prepared-worker-options";
const controller = new AbortController();
const stop = () => controller.abort();
process.once("SIGINT", stop);
process.once("SIGTERM", stop);
try {
  const options = preparedWorkerOptions(process.argv.slice(2));
  if (process.env.INHERIT_PREPARED_WGS_ENABLED !== "true") throw new Error("worker_disabled");
  const { runOwnPreparationWorkerLoop } = await import("../src/lib/uploads/own-preparation-worker-loop");
  const result = await runOwnPreparationWorkerLoop({ signal: controller.signal,
    maximumIterations: options.maximumIterations,
    emit: event => { process.stdout.write(`${event}\n`); },
    ...(options.metrics ? { emitMetrics: (event: unknown) => { process.stdout.write(`${JSON.stringify(event)}\n`); } } : {}),
  });
  if (result.hadFailure) process.exitCode = 1;
} catch {
  // No raw config, SDK, provider response, source identity or stack diagnostics.
  process.stderr.write("prepared_worker_unavailable\n");
  process.exitCode = 1;
} finally {
  controller.abort();
  process.removeListener("SIGINT", stop);
  process.removeListener("SIGTERM", stop);
}
