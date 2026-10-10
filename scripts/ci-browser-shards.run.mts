/** GitHub-only case inventory and fail-closed aggregation; no browser transport. */
import assert from "node:assert/strict";
import { checkedQcSeed, verifyQcSeedPublications } from "./ci-browser/embryo-qc-two-seed";
import { assertEmbryoJourneyAudits, EMBRYO_BROWSER_JOURNEYS } from "./ci-browser-embryo-partitions";
import { appendFileSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { ciBrowserSourceIdentity, createBrowserDurationList, discoverBrowserCases, loadBrowserDurationProfile, trackedBrowserSpecs } from "./ci-browser-shards-io";
import { browserManifest, CI_BROWSER_SHARDS, verifyBrowserShards, type CiBrowserShardReceipt } from "./ci-browser-shards";
import { verifyAccessibilitySweepPlacement } from "./ci-browser-balance";
import { browserDurationPlan, DEFAULT_BROWSER_ALLOCATION_SHA256, verifyBrowserDurationListings } from "./ci-browser-duration-plan";
import { verifyBrowserQueueIsolation } from "./ci-browser-queue-isolation";
import { browserDurationVariance } from "./ci-browser-duration-variance";

const invoked = process.argv[1] && path.resolve(process.argv[1]) === path.resolve("scripts/ci-browser-shards.run.mts");
if (invoked) {
  assertEmbryoJourneyAudits(Object.fromEntries(Object.values(EMBRYO_BROWSER_JOURNEYS)
    .map(file => [file, readFileSync(path.join("e2e", file), "utf8")])));
  const source = ciBrowserSourceIdentity(), mode = process.argv[2];
  if (mode === "manifest") {
    assert(process.argv.length === 3, "Manifest has no selectors");
    const full = discoverBrowserCases();
    const profile = loadBrowserDurationProfile();
    const plan = browserDurationPlan(full, profile);
    const assignments = plan.parts.map(part => {
      const list = createBrowserDurationList(plan, part.index);
      try { return discoverBrowserCases(null, list.path); } finally { list.cleanup(); }
    });
    verifyBrowserDurationListings(full, assignments, plan);
    const manifest = browserManifest(full, source, trackedBrowserSpecs(), plan.allocation);
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
    const profile = loadBrowserDurationProfile();
    assert.equal(manifest.allocation?.profileSha256, profile?.sha256 ?? DEFAULT_BROWSER_ALLOCATION_SHA256,
      "Manifest allocation must use the current committed duration profile, or public queue-aware defaults when absent");
    assert.equal(manifest.allocation?.mode, profile ? "duration-v1" : "queue-v1",
      "Manifest allocation mode must match the actual scheduling input");
    const count = verifyBrowserShards(manifest, receipts, source);
    verifyAccessibilitySweepPlacement(receipts);
    verifyBrowserQueueIsolation(receipts);
    console.log(`Full browser coverage: ${count} cases, exactly once, zero skips or retries, six isolated jobs, source ${source.head}.`);
    const clean = receipts as CiBrowserShardReceipt[];
    const seedReceipts = clean.flatMap(job => {
      const name = `browser-case-${source.runAttempt}-shard-${job.index}`;
      const files = readdirSync(path.join(directory, name)).sort();
      assert(files.every(file => ["ci-browser-shard.json", "embryo-qc-seed.json"].includes(file)), "Unregistered native artifact contents");
      if (!files.includes("embryo-qc-seed.json")) return [];
      const receipt = checkedQcSeed(read(name, "embryo-qc-seed.json"));
      assert.equal(receipt.index, job.index, "QC receipt must come from its actual artifact job");
      return [receipt];
    });
    const qcProof = verifyQcSeedPublications(seedReceipts, clean, source);
    mkdirSync("test-results", { recursive: true });
    writeFileSync("test-results/embryo-qc-two-seed.json", JSON.stringify(qcProof) + "\n", { mode: 0o600, flag: "wx" });
    console.log(`Embryo QC: ${qcProof.comparedFigures} corresponding figures changed across two actual independent native publications.`);
    const seconds = (value: number) => (value / 1000).toFixed(1);
    const rows = clean.sort((a, b) => a.index - b.index).map(receipt =>
      `| ${receipt.index} | ${receipt.executedCases.length} | ${seconds(receipt.timings.setupMs)} | ${seconds(receipt.timings.buildMs)} | ${seconds(receipt.timings.bootstrapMs)} | ${seconds(receipt.timings.browserMs)} | ${receipt.providerUploads} |`);
    const files = clean.flatMap(receipt => receipt.files).sort((a, b) => b.durationMs - a.durationMs).slice(0, 10);
    const variance = profile ? browserDurationVariance(clean, profile) : null;
    const summary = `Browser source: ${source.head}; run ${source.runId}, attempt ${source.runAttempt}.\n\n`
      + `${count} discovered and executed cases, exactly once. Zero skips/retries.\n\n`
      + "| Shard | Cases | Setup s | Build s | Bootstrap s | Browser s | Actual provider uploads |\n|---|---|---|---|---|---|---|\n"
      + rows.join("\n") + "\n\nLongest file groups (sum of actual test durations):\n\n"
      + files.map(file => `- ${file.project}/${file.file}: ${file.cases.length} cases, ${seconds(file.durationMs)} s`).join("\n") + "\n"
      + (variance ? `\nInformational duration variance (estimates are not execution proof):\n\n\`\`\`json\n${JSON.stringify(variance)}\n\`\`\`\n`
        : "\nPublic queue-aware defaults: no saved duration profile; weights are not measured timings.\n");
    assert(process.env.GITHUB_STEP_SUMMARY, "Actual GitHub summary destination required");
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
  }
}
