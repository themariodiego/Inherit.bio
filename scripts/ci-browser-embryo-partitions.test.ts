import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { assertEmbryoCiShard, assertEmbryoJourneyPartition } from "./ci-browser-embryo-partitions";

const journeys = [
  { project: "embryo-ingest", file: "embryo-ingest-journey.spec.ts", cases: 1 },
  { project: "embryo-mixed-qc", file: "embryo-mixed-qc-journey.spec.ts", cases: 1 },
];
describe("fresh native embryo partitions", () => {
  it("requires both inventoried journeys but permits only one in each fresh job", () => {
    expect(() => assertEmbryoJourneyPartition(journeys, true)).not.toThrow();
    for (const journey of journeys) expect(() => assertEmbryoJourneyPartition([journey], false)).not.toThrow();
    expect(() => assertEmbryoJourneyPartition([], false)).not.toThrow();
    expect(() => assertEmbryoJourneyPartition(journeys, false)).toThrow("at most one");
    for (const invalid of [[], journeys.slice(0, 1), [journeys[0], journeys[0]],
      [journeys[0], { ...journeys[1], file: journeys[0].file }],
      [journeys[0], { ...journeys[1], cases: 2 }]]) expect(() => assertEmbryoJourneyPartition(invalid, true)).toThrow();
    expect(() => assertEmbryoJourneyPartition([{ ...journeys[1], project: "chromium" }], false)).toThrow();
  });
  it("refuses unsharded CI while preserving ordinary local behavior", () => {
    expect(() => assertEmbryoCiShard(null, { CI: "true" })).toThrow("unsharded CI");
    expect(() => assertEmbryoCiShard(1, { CI: "true" })).not.toThrow();
    expect(() => assertEmbryoCiShard(null, {})).not.toThrow();
  });
  it("checks native assignment before Playwright execution and during independent full inventory", () => {
    const run = readFileSync("scripts/run-e2e.ts", "utf8");
    expect(run.indexOf("browserReportCases(assignedDiscovery, shard, false)")).toBeLessThan(run.indexOf('spawnSync(command, ["test"'));
    const inventory = readFileSync("scripts/ci-browser-shards.run.mts", "utf8");
    expect(inventory).toContain("browserReportCases(discoverBrowserCases(index), index, false)");
    expect(inventory.indexOf("discoverBrowserCases(index)")).toBeLessThan(inventory.indexOf('writeFileSync("test-results/ci-browser-manifest.json"'));
  });
});
