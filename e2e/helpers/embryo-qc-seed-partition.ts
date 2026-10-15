import assert from "node:assert/strict";
import { lstatSync } from "node:fs";
import type { TestInfo } from "@playwright/test";
import { ciBrowserShard, CI_BROWSER_SHARDS, type CiBrowserAllocation, type CiBrowserIdentity } from "../../scripts/ci-browser-shards";
import { ciBrowserSetupTimingPath, readCiBrowserSetupTimings } from "../../scripts/ci-browser-setup-timings";

/** The current job's setup receipt carries its index in every runner mode.
 * Both planned list modes deliberately leave Playwright's native shard null. */
export function qcSeedJobPartition(shard: TestInfo["config"]["shard"], source: CiBrowserIdentity,
  allocationMode: CiBrowserAllocation["mode"] | "native", env: Readonly<Record<string, string | undefined>> = process.env,
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
  assert(["native", "duration-v1", "queue-v1"].includes(allocationMode), "Actual source allocation mode required");
  if (allocationMode !== "native") assert(shard === null, "Planned-list execution cannot also use native sharding");
  else assert.deepEqual(shard, { current: index, total: CI_BROWSER_SHARDS }, "Native shard must match its actual job");
  return index;
}
