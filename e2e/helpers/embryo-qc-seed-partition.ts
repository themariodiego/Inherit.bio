import assert from "node:assert/strict";
import { lstatSync } from "node:fs";
import type { TestInfo } from "@playwright/test";
import { ciBrowserShard, CI_BROWSER_SHARDS, type CiBrowserIdentity } from "../../scripts/ci-browser-shards";
import { ciBrowserSetupTimingPath, readCiBrowserSetupTimings } from "../../scripts/ci-browser-setup-timings";

/** The current job's setup receipt carries its index in both runner modes.
 * A duration list deliberately leaves Playwright's native shard null. */
export function qcSeedJobPartition(shard: TestInfo["config"]["shard"], source: CiBrowserIdentity,
  durationPartition: boolean, env: Readonly<Record<string, string | undefined>> = process.env,
  platform: NodeJS.Platform = process.platform): number {
  assert(env.GITHUB_JOB === "browser" && env.INHERIT_CI_BROWSER_RUNTIME === "ready"
    && env.GITHUB_SHA === source.head && env.GITHUB_RUN_ID === source.runId
    && env.GITHUB_RUN_ATTEMPT === source.runAttempt, "Exact current browser job and ready runtime required");
  const indexes = Array.from({ length: CI_BROWSER_SHARDS }, (_, offset) => offset + 1)
    .filter(index => lstatSync(ciBrowserSetupTimingPath(env, source, index), { throwIfNoEntry: false }) !== undefined);
  assert(indexes.length === 1, "Exactly one current-job browser setup receipt required");
  const index = indexes[0];
  readCiBrowserSetupTimings(env, source, index);
  assert(ciBrowserShard(`--ci-shard=${index}/${CI_BROWSER_SHARDS}`, env, platform) === index,
    "Registered hosted browser partition required");
  assert(typeof durationPartition === "boolean", "Actual committed duration-profile admission required");
  if (durationPartition) assert(shard === null, "Duration-list execution cannot also use native sharding");
  else assert.deepEqual(shard, { current: index, total: CI_BROWSER_SHARDS }, "Native shard must match its actual job");
  return index;
}
