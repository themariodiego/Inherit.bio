/** Inside-only, unprivileged, fixed-command worker entry. Never log stdin. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runPreparedWorkerInside } from "../ci-prepared-journey";

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
  await runPreparedWorkerInside(JSON.parse(input), controller.signal);
  process.stdout.write("PREPARED_JOURNEY_WORKER_COMPLETE\n");
} catch {
  process.stderr.write("prepared_journey_worker_unavailable\n");
  process.exitCode = 1;
} finally {
  controller.abort();
  process.removeListener("SIGTERM", stop);
  process.removeListener("SIGINT", stop);
}
