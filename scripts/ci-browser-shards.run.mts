/** GitHub-only case inventory and fail-closed aggregation; no browser transport. */
import assert from "node:assert/strict";
import { appendFileSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { ciBrowserSourceIdentity, discoverBrowserCases, trackedBrowserSpecs } from "./ci-browser-shards-io";
import { browserManifest, CI_BROWSER_SHARDS, verifyBrowserShards, type CiBrowserShardReceipt } from "./ci-browser-shards";
import { verifyAccessibilitySweepPlacement, verifyNativeBrowserBalance } from "./ci-browser-balance";

const invoked = process.argv[1] && path.resolve(process.argv[1]) === path.resolve("scripts/ci-browser-shards.run.mts");
if (invoked) {
  const source = ciBrowserSourceIdentity(), mode = process.argv[2];
  if (mode === "manifest") {
    assert(process.argv.length === 3, "Manifest has no selectors");
    const full = discoverBrowserCases();
    const manifest = browserManifest(full, source, trackedBrowserSpecs());
    verifyNativeBrowserBalance(full, Array.from({ length: CI_BROWSER_SHARDS }, (_, index) => discoverBrowserCases(index + 1)));
    mkdirSync("test-results", { recursive: true });
    writeFileSync("test-results/ci-browser-manifest.json", JSON.stringify(manifest) + "\n", { mode: 0o600, flag: "wx" });
    console.log(`Browser manifest: ${manifest.cases.length} cases on ${source.head}.`);
  } else {
    assert(mode === "aggregate" && process.argv.length === 4, "Only manifest or aggregate is allowed");
    const directory = process.argv[3];
    const names = [`browser-case-${source.runAttempt}-manifest`,
      ...Array.from({ length: CI_BROWSER_SHARDS }, (_, i) => `browser-case-${source.runAttempt}-shard-${i + 1}`)];
    assert.deepEqual(readdirSync(directory).sort(), names.sort(),
      "Missing or unregistered browser coverage artifact for this run attempt. Use Re-run all jobs; "
      + "Re-run failed jobs cannot supply the independent manifest and six fresh same-attempt shard receipts.");
    const read = (name: string, file: string) => JSON.parse(readFileSync(path.join(directory, name, file), "utf8"));
    const manifest = read(`browser-case-${source.runAttempt}-manifest`, "ci-browser-manifest.json");
    const receipts = Array.from({ length: CI_BROWSER_SHARDS }, (_, i) =>
      read(`browser-case-${source.runAttempt}-shard-${i + 1}`, "ci-browser-shard.json"));
    const count = verifyBrowserShards(manifest, receipts, source);
    verifyAccessibilitySweepPlacement(receipts);
    console.log(`Full browser coverage: ${count} cases, exactly once, zero skips or retries, six isolated jobs, source ${source.head}.`);
    const clean = receipts as CiBrowserShardReceipt[];
    const seconds = (value: number) => (value / 1000).toFixed(1);
    const rows = clean.sort((a, b) => a.index - b.index).map(receipt =>
      `| ${receipt.index} | ${receipt.executedCases.length} | ${seconds(receipt.timings.setupMs)} | ${seconds(receipt.timings.buildMs)} | ${seconds(receipt.timings.bootstrapMs)} | ${seconds(receipt.timings.browserMs)} | ${receipt.providerUploads} |`);
    const files = clean.flatMap(receipt => receipt.files).sort((a, b) => b.durationMs - a.durationMs).slice(0, 10);
    const summary = `Browser source: ${source.head}; run ${source.runId}, attempt ${source.runAttempt}.\n\n`
      + `${count} discovered and executed cases, exactly once. Zero skips/retries.\n\n`
      + "| Shard | Cases | Setup s | Build s | Bootstrap s | Browser s | Actual provider uploads |\n|---|---|---|---|---|---|---|\n"
      + rows.join("\n") + "\n\nLongest file groups (sum of actual test durations):\n\n"
      + files.map(file => `- ${file.project}/${file.file}: ${file.cases.length} cases, ${seconds(file.durationMs)} s`).join("\n") + "\n";
    assert(process.env.GITHUB_STEP_SUMMARY, "Actual GitHub summary destination required");
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
  }
}
