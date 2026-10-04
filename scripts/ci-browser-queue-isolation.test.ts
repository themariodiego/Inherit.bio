import { readFileSync } from "node:fs";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { STANDARD_CI_BROWSER_PROJECTS } from "./ci-browser-project-registry";
import { assertBrowserQueueGroups, assertBrowserQueuePartition, QUEUE_EXCLUSIVE_BROWSER_FILES, verifyBrowserQueueIsolation } from "./ci-browser-queue-isolation";

const journeys = Object.entries(QUEUE_EXCLUSIVE_BROWSER_FILES).map(([file, project], index) => ({ file, project, cases: [`case-${index}`] }));
const parts = () => Array.from({ length: 6 }, (_, index) => ({ index: index + 1, files: journeys[index] ? [journeys[index]] : [] }));
function durationJourneyPredicate(source: string): string[] {
  const file = ts.createSourceFile("ci-browser-shards.ts", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const predicates: string[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "assertEmbryoJourneyPartition"
      && ts.isIdentifier(node.arguments[0]) && node.arguments[0].text === "journeyRows")
      predicates.push(node.arguments[1].getText(file).replace(/\s/g, ""));
    ts.forEachChild(node, visit);
  };
  visit(file); return predicates;
}

describe("current publication queue isolation", () => {
  it("retains exact canonical project/file/single-case constraints and admits absent files", () => {
    expect(assertBrowserQueueGroups([])).toBe(0);
    expect(assertBrowserQueueGroups([{ file: "ordinary.spec.ts", project: "chromium", cases: ["a", "b"] }])).toBe(0);
    expect(() => verifyBrowserQueueIsolation(parts())).not.toThrow();
    for (const journey of journeys) {
      expect(() => assertBrowserQueuePartition([journey])).not.toThrow();
      for (const invalid of [{ ...journey, project: "wrong-project" }, { ...journey, cases: [] },
        { ...journey, cases: ["a", "b"] }]) expect(() => assertBrowserQueuePartition([invalid])).toThrow("exact project and single complete case");
    }
    for (const project of ["embryo-ingest", "embryo-mixed-qc"])
      expect(() => assertBrowserQueuePartition([{ file: "ordinary.spec.ts", project, cases: ["a"] }])).toThrow();
    expect(() => assertBrowserQueueGroups([journeys[0], journeys[0]])).toThrow("Duplicate queue journey");
  });
  it("refuses queue collisions and incomplete or duplicated partition evidence", () => {
    expect(() => assertBrowserQueuePartition([journeys[2], journeys[3]])).toThrow("at most one queue journey");
    expect(() => verifyBrowserQueueIsolation(parts().slice(1))).toThrow("Six queue-isolated");
    const duplicate = parts(); duplicate[5].index = 1;
    expect(() => verifyBrowserQueueIsolation(duplicate)).toThrow("Six queue-isolated");
    const repeated = parts(); repeated[5].files = [journeys[0]];
    expect(() => verifyBrowserQueueIsolation(repeated)).toThrow("Duplicate queue journey");
  });
  it("keeps the existing six-project full guard and admits truthful duration partial listings only", () => {
    const current = durationJourneyPredicate(readFileSync("scripts/ci-browser-shards.ts", "utf8"));
    if (STANDARD_CI_BROWSER_PROJECTS.includes("embryo-ingest") || STANDARD_CI_BROWSER_PROJECTS.includes("embryo-mixed-qc"))
      expect(current).toEqual(["index===null&&!durationPartition"]);
    else expect(current).toEqual([]);
    expect(durationJourneyPredicate("assertEmbryoJourneyPartition(journeyRows, index === null);"))
      .not.toEqual(["index===null&&!durationPartition"]);
    expect(durationJourneyPredicate("assertEmbryoJourneyPartition(journeyRows, index === null && !durationPartition);"))
      .toEqual(["index===null&&!durationPartition"]);
  });
});
