/** Run Playwright, then enforce fresh JSON evidence with no skips or retries.
 * Invoked inside run-upload-browser.mts so every run has a real local provider.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { verifyE2EReport } from "./e2e-report-contract";

assert(process.env.INHERIT_LOCAL_BROWSER_STORAGE_PROXY && process.env.INHERIT_UPLOAD_SIGNING_JWK,
  "Run pnpm e2e through the real local provider bootstrap");
const reportPath = path.resolve("test-results/results.json");
// A crashed run must not reuse an earlier successful report.
rmSync(reportPath, { force: true });
const command = process.platform === "win32" ? "playwright.cmd" : "playwright";
const run = spawnSync(command, ["test", ...process.argv.slice(2)], {
  env: process.env,
  stdio: "inherit",
});
if (run.error) throw new Error("Playwright did not start");
if (run.status !== 0) process.exit(run.status ?? 1);
const count = verifyE2EReport(JSON.parse(readFileSync(reportPath, "utf8")));
console.log(`E2E contract passed: ${count} result(s), no skips, no retries.`);
