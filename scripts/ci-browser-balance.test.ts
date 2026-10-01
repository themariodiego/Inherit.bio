import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ACCESSIBILITY_SWEEP_FILES, verifyAccessibilitySweepPlacement, verifyNativeBrowserBalance } from "./ci-browser-balance";
import { STANDARD_CI_BROWSER_PROJECTS } from "./ci-browser-project-registry";

const projects = [...STANDARD_CI_BROWSER_PROJECTS];
const ordinaryProjects = ["chromium", "jurisdiction-off", "copilot-local", "prepared-source"];
const id = (n: number) => `${n.toString(16).padStart(20, "0")}-${n.toString(16).padStart(20, "0")}`;
function listing(numbers: number[], index: number | null = null) {
  const journeys = [
    { number: 120, project: "embryo-mixed-qc", file: "embryo-mixed-qc-journey.spec.ts", index: 1 },
    { number: 121, project: "embryo-ingest", file: "embryo-ingest-journey.spec.ts", index: 6 },
    { number: 122, project: "chromium", file: "embryo-qc-second-seed-journey.spec.ts", index: 5 },
  ].filter(journey => projects.includes(journey.project) && (index === null || journey.index === index));
  return { config: { workers: 1, fullyParallel: false, shard: index === null ? null : { current: index, total: 6 },
    projects: projects.map(name => ({ name, retries: 0, repeatEach: 1 })) },
  suites: [{ specs: [...numbers.map(n => ({ id: id(n), file: n <= 6 ? ACCESSIBILITY_SWEEP_FILES[n - 1] : `ordinary-${n}.spec.ts`,
    tests: [{ projectName: n <= 6 ? "chromium" : ordinaryProjects[(n - 7) % 4], expectedStatus: "passed", results: [] }] })),
    ...journeys.map(journey => ({ id: id(journey.number), file: journey.file,
      tests: [{ projectName: journey.project, expectedStatus: "passed", results: [] }] }))] }],
  errors: [], stats: { expected: 0, unexpected: 0, flaky: 0, skipped: numbers.length + journeys.length } };
}
function parts() {
  return ACCESSIBILITY_SWEEP_FILES.map((file, index) => ({ index: index + 1,
    files: [{ file, project: "chromium", cases: [`${id(index + 1)}:chromium`] }] }));
}
describe("permanent accessibility scheduling guard", () => {
  it("accepts actual complete native discovery and balanced indivisible sweeps", () => {
    const full = listing([1,2,3,4,5,6,7,8,9,10]);
    const assigned = [[1,7], [2,8], [3,9], [4,10], [5], [6]].map((values, i) => listing(values, i + 1));
    expect(verifyNativeBrowserBalance(full, assigned)).toEqual(parts().map(part => ({ file: part.files[0].file, index: part.index })));
    const paired = parts();
    for (const index of [1,3,5]) {
      paired[index - 1].files.push(...paired[index].files);
      paired[index].files = [{ file: `ordinary-${index}.spec.ts`, project: "chromium", cases: [id(index + 10)] }];
    }
    expect(new Set(verifyAccessibilitySweepPlacement(paired).map(item => item.index)).size).toBe(3);
  });
  it("refuses future concentration even if every case still runs once", () => {
    const assigned = [[1,2,3,4,5,6], [7], [8], [9], [10], [11]].map((values, i) => listing(values, i + 1));
    expect(() => verifyNativeBrowserBalance(listing([1,2,3,4,5,6,7,8,9,10,11]), assigned)).toThrow("concentrated");
    const concentrated = parts();
    concentrated[0].files.push(...concentrated[1].files, ...concentrated[2].files);
    concentrated[1].files = [{ file: "ordinary-a.spec.ts", project: "chromium", cases: [id(12)] }];
    concentrated[2].files = [{ file: "ordinary-b.spec.ts", project: "chromium", cases: [id(13)] }];
    expect(() => verifyAccessibilitySweepPlacement(concentrated)).toThrow("concentrated");
  });
  it("refuses absent, repeated, split, substituted or misprojected measurements", () => {
    const missing = parts(); missing[0].files[0].file = "ordinary.spec.ts";
    const duplicate = parts(); duplicate[1].files[0].file = duplicate[0].files[0].file;
    const split = parts(); split[0].files[0].cases.push(id(20));
    const wrongProject = parts(); wrongProject[0].files[0].project = "prepared-source";
    const repeatedIndex = parts(); repeatedIndex[0].index = 2;
    for (const value of [missing, duplicate, split, wrongProject, repeatedIndex, parts().slice(1)])
      expect(() => verifyAccessibilitySweepPlacement(value)).toThrow();
  });
  it("refuses altered native selectors, omitted cases and a serial file spanning partitions", () => {
    const values = [[1,7], [2,8], [3,9], [4,10], [5], [6]];
    const full = listing(values.flat());
    const foreign = values.map((v,i) => listing(v,i + 1)); foreign[0].config.shard!.current = 2;
    expect(() => verifyNativeBrowserBalance(full, foreign)).toThrow();
    expect(() => verifyNativeBrowserBalance(full, values.map((v,i) => listing(v.filter(n => n !== 7),i + 1)))).toThrow();
    const splitFull = listing([1,2,3,4,5,6,7,8,9,10]);
    splitFull.suites[0].specs[6].file = "ordinary-shared.spec.ts";
    splitFull.suites[0].specs[7].file = "ordinary-shared.spec.ts";
    splitFull.suites[0].specs[6].tests[0].projectName = "jurisdiction-off";
    const splitParts = values.map((v,i) => listing(v,i + 1));
    for (const part of splitParts) for (const spec of part.suites[0].specs)
      if ([id(7),id(8)].includes(spec.id)) { spec.file = "ordinary-shared.spec.ts"; spec.tests[0].projectName = "jurisdiction-off"; }
    expect(() => verifyNativeBrowserBalance(splitFull, splitParts)).toThrow("whole serial");
  });
  it("runs the guard before publishing the manifest and after strict final coverage", () => {
    const cli = readFileSync(new URL("./ci-browser-shards.run.mts", import.meta.url), "utf8");
    expect(cli).toContain("verifyNativeBrowserBalance(full");
    expect(cli).toContain("verifyAccessibilitySweepPlacement(receipts)");
    expect(cli.indexOf("verifyNativeBrowserBalance(full")).toBeLessThan(cli.indexOf('writeFileSync("test-results/ci-browser-manifest.json"'));
    expect(cli.indexOf("verifyAccessibilitySweepPlacement(receipts)")).toBeGreaterThan(cli.indexOf("verifyBrowserShards(manifest, receipts, source)"));
  });
});
