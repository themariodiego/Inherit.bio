import assert from "node:assert/strict";
import { lstatSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import path from "node:path";
import { browserSetupTimingSchema, ciBrowserSetupTimingReceiptSchema, type CiBrowserIdentity } from "./ci-browser-shards";

type Environment = Readonly<Record<string, string | undefined>>;
function ownedRoot(env: Environment) {
  const root = env.RUNNER_TEMP;
  assert(root && path.isAbsolute(root) && realpathSync(root) === path.resolve(root), "Canonical owned RUNNER_TEMP required for setup timings");
  const stat = lstatSync(root);
  assert(stat.isDirectory() && !stat.isSymbolicLink() && stat.uid === process.getuid?.(), "Setup timing directory must belong to this job user");
  const relative = path.relative(path.resolve("test-results"), root);
  assert(relative.startsWith(`..${path.sep}`) || relative === ".." || path.isAbsolute(relative), "Setup timings must remain outside Playwright outputDir");
  return root;
}
export function ciBrowserSetupTimingPath(env: Environment, source: CiBrowserIdentity, index: number) {
  ciBrowserSetupTimingReceiptSchema.parse({ ...source, schemaVersion: 1, total: 6, index, setupMs: 0, buildMs: 0 });
  return path.join(ownedRoot(env), `inherit-ci-setup-${source.head}-${source.runId}-${source.runAttempt}-${index}.json`);
}
export function ciBrowserSetupStartPath(env: Environment, source: CiBrowserIdentity, index: number) {
  ciBrowserSetupTimingPath(env, source, index);
  return path.join(ownedRoot(env), `inherit-ci-setup-start-${source.runId}-${source.runAttempt}-${index}`);
}
function readOwned(file: string) {
  const stat = lstatSync(file);
  assert(stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1 && stat.uid === process.getuid?.()
    && (stat.mode & 0o777) === 0o600 && stat.size > 0 && stat.size <= 4096,
  "Setup timing input must be a bounded private regular file owned by this job");
  return readFileSync(file, "utf8");
}
export function writeCiBrowserSetupTimings(env: Environment, source: CiBrowserIdentity, index: number,
  buildStarted: number, finished = Date.now()) {
  const started = Number(readOwned(ciBrowserSetupStartPath(env, source, index)));
  assert([started, buildStarted, finished].every(value => Number.isSafeInteger(value) && value > 0)
    && started <= buildStarted && buildStarted <= finished, "Actual ordered setup/build timestamps required");
  const receipt = ciBrowserSetupTimingReceiptSchema.parse({ ...source, schemaVersion: 1, total: 6, index,
    setupMs: buildStarted - started, buildMs: finished - buildStarted });
  writeFileSync(ciBrowserSetupTimingPath(env, source, index), JSON.stringify(receipt) + "\n", { mode: 0o600, flag: "wx" });
}
export function readCiBrowserSetupTimings(env: Environment, source: CiBrowserIdentity, index: number) {
  const receipt = ciBrowserSetupTimingReceiptSchema.parse(JSON.parse(readOwned(ciBrowserSetupTimingPath(env, source, index))));
  assert.deepEqual({ head: receipt.head, runId: receipt.runId, runAttempt: receipt.runAttempt, index: receipt.index },
    { ...source, index }, "Setup timing source/run/attempt/shard differs");
  return browserSetupTimingSchema.parse({ setupMs: receipt.setupMs, buildMs: receipt.buildMs });
}
