/** Run Playwright, then enforce fresh JSON evidence with no skips or retries.
 * Invoked inside run-upload-browser.mts so every run has a real local provider.
 */
import assert from "node:assert/strict";
import { assertEmbryoCiShard, assertEmbryoJourneyAudits, EMBRYO_BROWSER_JOURNEYS } from "./ci-browser-embryo-partitions";
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { verifyE2EReport } from "./e2e-report-contract";
import { browserReportCases, browserShardReceipt, ciBrowserShard } from "./ci-browser-shards";
import { ciBrowserSourceIdentity, discoverBrowserCases, trackedBrowserSpecs } from "./ci-browser-shards-io";

assert(process.env.INHERIT_LOCAL_BROWSER_STORAGE_PROXY && process.env.INHERIT_UPLOAD_SIGNING_JWK,
  "Run pnpm e2e through the real local provider bootstrap");
assertEmbryoJourneyAudits(Object.fromEntries(Object.values(EMBRYO_BROWSER_JOURNEYS)
  .map(file => [file, readFileSync(path.join("e2e", file), "utf8")])));
const reportPath = path.resolve("test-results/results.json");
const args = process.argv.slice(2);
const browserStarted = performance.now();
const shard = ciBrowserShard(args[1], process.env);
assertEmbryoCiShard(shard, process.env);
if (process.env.CI) assert(args[0] === "--config=playwright.config.ts"
  && (shard === null ? args.length === 1 : args.length === 2),
"CI execution accepts only the full standard suite or its registered native shard, without selectors");
let fullDiscovery: unknown, assignedDiscovery: unknown;
// This run's verifier exists only in inherited process memory. The fixed
// TEST-LOCAL variant alone receives it; no file, log or production secret.
if (process.env.CI) process.env.INHERIT_CI_SYNTHETIC_WEBHOOK_SECRET = `whsec_${randomBytes(32).toString("base64")}`;
if (shard !== null) {
  assert(args.length === 2 && args[0] === "--config=playwright.config.ts"
    && process.env.INHERIT_CI_BROWSER_RUNTIME === "ready", "Only the preflighted standard CI shard is accepted");
  ciBrowserSourceIdentity();
  rmSync("test-results/ci-browser-shard.json", { force: true });
  rmSync("test-results/ci-browser-shard-pending.json", { force: true });
  fullDiscovery = discoverBrowserCases(); assignedDiscovery = discoverBrowserCases(shard);
  browserReportCases(fullDiscovery, null, false);
  browserReportCases(assignedDiscovery, shard, false);
  args[1] = `--shard=${shard}/6`;
}
// A crashed run must not reuse an earlier successful report.
rmSync(reportPath, { force: true });
const command = process.platform === "win32" ? "playwright.cmd" : "playwright";
const run = spawnSync(command, ["test", ...args], {
  env: process.env,
  stdio: "inherit",
});
if (run.error) throw new Error("Playwright did not start");
if (run.status !== 0) process.exit(run.status ?? 1);
const report = JSON.parse(readFileSync(reportPath, "utf8"));
const count = verifyE2EReport(report);
if (shard !== null) {
  const receipt = browserShardReceipt(fullDiscovery, assignedDiscovery, report, ciBrowserSourceIdentity(), shard, 1,
    { setupMs: 0, buildMs: 0, bootstrapMs: 0, browserMs: Math.round(performance.now() - browserStarted) }, trackedBrowserSpecs());
  const pending = { ...receipt }; delete (pending as Partial<typeof pending>).providerUploads;
  writeFileSync("test-results/ci-browser-shard-pending.json", JSON.stringify(pending) + "\n", { mode: 0o600, flag: "wx" });
}
console.log(`E2E contract passed: ${count} result(s), no skips, no retries.`);
