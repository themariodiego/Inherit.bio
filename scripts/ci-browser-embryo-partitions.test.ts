import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { assertEmbryoCiShard, assertEmbryoJourneyPartition, assertEmbryoJourneyAudits, EMBRYO_BROWSER_JOURNEYS } from "./ci-browser-embryo-partitions";

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
    expect(inventory).toContain("const native = discoverBrowserCases(index)");
    expect(inventory).toContain("browserReportCases(native, index, false)");
    expect(inventory.indexOf("discoverBrowserCases(index)")).toBeLessThan(inventory.indexOf('writeFileSync("test-results/ci-browser-manifest.json"'));
  });
});

describe("permanent genuine embryo audit preflight", () => {
  const real = () => Object.fromEntries(Object.values(EMBRYO_BROWSER_JOURNEYS)
    .map(file => [file, readFileSync(`e2e/${file}`, "utf8")]));
  it("requires both real network audits and the connected populated all-pass audit", () => {
    expect(() => assertEmbryoJourneyAudits(real())).not.toThrow();
    for (const file of Object.values(EMBRYO_BROWSER_JOURNEYS)) {
      const current = real();
      current[file] = current[file].replace('from "./audited-test"', 'from "@playwright/test"');
      expect(() => assertEmbryoJourneyAudits(current)).toThrow("genuine state network audit");
      current[file] += '\n// import { test } from "./audited-test";';
      expect(() => assertEmbryoJourneyAudits(current)).toThrow("genuine state network audit");
    }
    const name = EMBRYO_BROWSER_JOURNEYS["embryo-ingest"];
    for (const replacement of ["unconnectedAudit", "auditPublishedEmbryoSurfaces.toString"]) {
      const current = real();current[name] = current[name].replace("await auditPublishedEmbryoSurfaces(", `await ${replacement}(`);
      expect(() => assertEmbryoJourneyAudits(current)).toThrow("populated surface audit");
    }
    const missing = real();delete missing[name];
    expect(() => assertEmbryoJourneyAudits(missing)).toThrow("source inventory");
    expect(() => assertEmbryoJourneyAudits({ ...real(), "unknown.spec.ts": "" })).toThrow("source inventory");
  });
  it("checks source before execution and in the independent inventory and aggregation entry point", () => {
    const run = readFileSync("scripts/run-e2e.ts", "utf8");
    expect(run.indexOf("assertEmbryoJourneyAudits(Object.fromEntries")).toBeLessThan(run.indexOf('spawnSync(command, ["test"'));
    const inventory = readFileSync("scripts/ci-browser-shards.run.mts", "utf8");
    expect(inventory.indexOf("assertEmbryoJourneyAudits(Object.fromEntries")).toBeLessThan(inventory.indexOf("const source = ciBrowserSourceIdentity()"));
  });
});
