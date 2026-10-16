/** Operator-started only, TEST-LOCAL only: pnpm worker:embryo-split [--once]. */
import { preparedWorkerOptions } from "../src/lib/uploads/prepared-worker-options";
const controller = new AbortController();
const stop = () => controller.abort();
process.once("SIGINT", stop);
process.once("SIGTERM", stop);
try {
  const options = preparedWorkerOptions(process.argv.slice(2));
  if (options.metrics) throw new Error("invalid_options");
  const { runEmbryoSplitWorkerLoop } = await import("../src/lib/embryos/split-worker-loop");
  const { r2EmbryoCanonicalPartWriter, r2EmbryoFragmentReader } = await import("../src/lib/embryos/split-fragment-reader");
  const result = await runEmbryoSplitWorkerLoop({ signal: controller.signal,
    maximumIterations: options.maximumIterations, readFragment: r2EmbryoFragmentReader(),
    writeCanonicalPart: r2EmbryoCanonicalPartWriter(),
    emit: event => { process.stdout.write(`${event}\n`); },
  });
  if (result.hadFailure) process.exitCode = 1;
} catch {
  // No raw config, SDK, provider response, source identity or stack diagnostics.
  process.stderr.write("embryo_split_worker_unavailable\n");
  process.exitCode = 1;
} finally {
  controller.abort();
  process.removeListener("SIGINT", stop);
  process.removeListener("SIGTERM", stop);
}
