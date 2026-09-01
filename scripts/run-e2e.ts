/**
 * Runs Playwright and makes the no-skip/no-retry contract part of `pnpm e2e`.
 * Playwright itself treats a skipped test as a successful run, so the JSON
 * report must be checked before the command can report success.
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

type Result = { retry?: number; status?: string };
type Test = { results?: Result[] };
type Spec = { tests?: Test[] };
type Suite = { specs?: Spec[]; suites?: Suite[] };
type Report = { suites?: Suite[] };

const reportPath = path.resolve("test-results/results.json");
const command = process.platform === "win32" ? "playwright.cmd" : "playwright";
const run = spawnSync(command, ["test"], {
  env: process.env,
  stdio: "inherit",
});

if (run.error) throw run.error;
if (run.status !== 0) process.exit(run.status ?? 1);

const report = JSON.parse(readFileSync(reportPath, "utf8")) as Report;
const results: Result[] = [];

function collect(suites: Suite[]) {
  for (const suite of suites) {
    for (const spec of suite.specs ?? []) {
      for (const test of spec.tests ?? []) results.push(...(test.results ?? []));
    }
    collect(suite.suites ?? []);
  }
}

collect(report.suites ?? []);
const skipped = results.filter((result) => result.status === "skipped");
const retried = results.filter((result) => (result.retry ?? 0) > 0);

if (skipped.length > 0 || retried.length > 0) {
  console.error(
    `E2E contract failed: ${skipped.length} skipped result(s), ${retried.length} retried result(s).`,
  );
  process.exit(1);
}

console.log(`E2E contract passed: ${results.length} result(s), no skips, no retries.`);
