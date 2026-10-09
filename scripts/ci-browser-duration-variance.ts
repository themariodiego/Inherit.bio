import assert from "node:assert/strict";
import { browserDurationEstimator, type SelectedBrowserDurationProfile } from "./ci-browser-duration-plan";
import type { CiBrowserShardReceipt } from "./ci-browser-shards";

/** Informational sanitized fields only. Call AFTER all complete actual coverage guards. */
export function browserDurationVariance(receipts: CiBrowserShardReceipt[], profile: SelectedBrowserDurationProfile) {
  const estimate = browserDurationEstimator(profile);
  const history = profile.value.schemaVersion === 2 ? profile.value.sources : [{ runId: profile.value.source.runId, files: profile.value.files }];
  assert.deepEqual(receipts.map(receipt => receipt.index).sort(), [1, 2, 3, 4, 5, 6], "Six validated timing receipts required");
  const parts = receipts.map(receipt => {
    const files = receipt.files.map(file => {
      const estimatedBodyMs = estimate({ ...file, count: file.cases.length });
      const actualBodyMs = file.durationMs;
      assert(Number.isSafeInteger(actualBodyMs) && actualBodyMs >= 0, "Actual timing must remain a sanitized integer");
      const knownSources = history.filter(source => source.files.some(row => row.file === file.file && row.project === file.project));
      const sourceRunIds = (knownSources.length ? knownSources : history).map(source => source.runId).sort();
      return { project: file.project, file: file.file, caseCount: file.cases.length, estimatedBodyMs, actualBodyMs,
        bodyDifferenceMs: actualBodyMs - estimatedBodyMs, sourceRunIds };
    }).sort((a, b) => `${a.project}:${a.file}`.localeCompare(`${b.project}:${b.file}`));
    const estimatedBodyMs = files.reduce((sum, file) => sum + file.estimatedBodyMs, 0);
    const actualBodyMs = files.reduce((sum, file) => sum + file.actualBodyMs, 0);
    assert(Number.isSafeInteger(estimatedBodyMs) && Number.isSafeInteger(actualBodyMs), "Variance sum overflow");
    return { index: receipt.index, caseCount: receipt.executedCases.length, estimatedBodyMs, actualBodyMs,
      actualBrowserMs: receipt.timings.browserMs, bodyDifferenceMs: actualBodyMs - estimatedBodyMs,
      bodyRatio: Number((actualBodyMs / estimatedBodyMs).toFixed(4)),
      refreshSuggested: BigInt(actualBodyMs) * BigInt(2) > BigInt(estimatedBodyMs) * BigInt(3), files };
  }).sort((a, b) => a.index - b.index);
  return { schemaVersion: 1, informationalOnly: true, profileSha256: profile.sha256, parts };
}
