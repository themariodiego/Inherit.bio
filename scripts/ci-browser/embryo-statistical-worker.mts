/** Inside-only, unprivileged, fixed-command worker entry. Never log stdin. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runEmbryoStatisticalWorkerInside, runEmbryoFittedStatisticalWorkerInside } from "../ci-embryo-journey";

const controller = new AbortController();
const stop = () => controller.abort();
process.once("SIGTERM", stop);
process.once("SIGINT", stop);
try {
  assert(process.argv.length === 2 && process.platform === "linux" && process.getuid!() > 0);
  assert.match(readFileSync("/proc/self/status", "utf8"), /^CapEff:\s+0+$/m);
  const input = await new Promise<string>((resolve, reject) => {
    let text = "";
    const timer = setTimeout(() => { process.stdin.destroy(); reject(new Error("Worker input timed out")); }, 5000);
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", chunk => {
      text += chunk;
      if (text.length > 16_384) { clearTimeout(timer); process.stdin.destroy(); reject(new Error("Worker input too large")); }
    });
    process.stdin.once("error", () => { clearTimeout(timer); reject(new Error("Worker input unavailable")); });
    process.stdin.once("end", () => { clearTimeout(timer); resolve(text); });
  });
  const value: unknown = JSON.parse(input);
  if (value !== null && typeof value === "object" && !Array.isArray(value) && "kind" in value) {
    const fitted = value as Record<string, unknown>;
    assert(Object.keys(fitted).length === 2 && Object.keys(fitted).every(key => key === "kind" || key === "environment")
      && fitted.kind === "fitted-test", "Exact fitted worker input required");
    await runEmbryoFittedStatisticalWorkerInside(fitted.environment, controller.signal);
    process.stdout.write("EMBRYO_STATISTICAL_FITTED_JOURNEY_WORKER_COMPLETE\n");
  } else {
    await runEmbryoStatisticalWorkerInside(JSON.parse(input), controller.signal);
    process.stdout.write("EMBRYO_STATISTICAL_JOURNEY_WORKER_COMPLETE\n");
  }
} catch {
  process.stderr.write("embryo_statistical_journey_worker_unavailable\n");
  process.exitCode = 1;
} finally {
  controller.abort();
  process.removeListener("SIGTERM", stop);
  process.removeListener("SIGINT", stop);
}
