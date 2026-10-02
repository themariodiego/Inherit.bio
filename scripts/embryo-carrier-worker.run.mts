/** Operator-started, TEST-LOCAL only: pnpm worker:embryo-carrier [--once]. */
import { preparedWorkerOptions } from "../src/lib/uploads/prepared-worker-options";
const controller = new AbortController();
const stop = () => controller.abort();
process.once("SIGINT", stop);process.once("SIGTERM", stop);
try {
  const options = preparedWorkerOptions(process.argv.slice(2));
  if (options.metrics) throw new Error("invalid_options");
  const { runEmbryoCarrierWorkerLoop } = await import("../src/lib/embryos/carrier-worker-loop");
  const result = await runEmbryoCarrierWorkerLoop({ signal: controller.signal,
    maximumIterations: options.maximumIterations, emit: event => { process.stdout.write(`${event}\n`); } });
  if (result.hadFailure) process.exitCode = 1;
} catch {
  process.stderr.write("embryo_carrier_worker_unavailable\n");process.exitCode = 1;
} finally {
  controller.abort();process.removeListener("SIGINT", stop);process.removeListener("SIGTERM", stop);
}
