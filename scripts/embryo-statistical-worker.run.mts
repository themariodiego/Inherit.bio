/** One TEST-LOCAL complete cohort. No reconciliation/retry or model call. */
import { preparedWorkerOptions } from "../src/lib/uploads/prepared-worker-options";
const controller = new AbortController();
const stop = () => controller.abort();
process.once("SIGINT", stop);process.once("SIGTERM", stop);
try {
  const options = preparedWorkerOptions(process.argv.slice(2));
  if (options.metrics || options.maximumIterations !== 1) throw new Error("invalid_options");
  const { runNextEmbryoStatisticalCoverage } = await import("../src/lib/embryos/statistical-worker");
  const result = await runNextEmbryoStatisticalCoverage({ signal: controller.signal });
  if (result.status !== "saved_coverage") throw new Error("unavailable");
  process.stdout.write("coverage_saved\n");
} catch { process.stderr.write("embryo_test_statistical_worker_unavailable\n");process.exitCode = 1; }
finally { controller.abort();process.removeListener("SIGINT", stop);process.removeListener("SIGTERM", stop); }
