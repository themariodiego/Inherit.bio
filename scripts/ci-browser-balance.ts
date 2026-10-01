import assert from "node:assert/strict";
import { z } from "zod";
import { browserReportCases, CI_BROWSER_SHARDS } from "./ci-browser-shards";

/** Complete, independent measurements. Keep their bodies and fixture ownership
 * intact; native scheduling must never concentrate them into one long job. */
export const ACCESSIBILITY_SWEEP_FILES = Object.freeze([
  "accessible-authenticated-pages.spec.ts",
  "control-target-size.spec.ts",
  "figure-text-alternatives.spec.ts",
  "page-reflow-accessibility.spec.ts",
  "public-pages-session-accessibility.spec.ts",
  "viewport-keyboard-accessibility.spec.ts",
]);
const group = z.object({ file: z.string(), project: z.string(), cases: z.array(z.string()).min(1) });
const placement = z.object({ index: z.number().int().min(1).max(CI_BROWSER_SHARDS), files: z.array(group).min(1) });
type FileGroup = z.infer<typeof group>;

/** This runs both before setup and after real execution. It reads only fixed
 * filenames, projects and case identities, never browser/private diagnostics. */
export function verifyAccessibilitySweepPlacement(value: unknown): { file: string; index: number }[] {
  const parts = z.array(placement).length(CI_BROWSER_SHARDS).parse(value);
  assert.deepEqual(parts.map(part => part.index).sort(), [1, 2, 3, 4, 5, 6], "Every native browser partition is required");
  const found = parts.flatMap(part => part.files
    .filter(file => ACCESSIBILITY_SWEEP_FILES.includes(file.file))
    .map(file => {
      assert(file.project === "chromium" && file.cases.length === 1,
        "Each registered accessibility sweep must remain one complete Chromium measurement");
      return { file: file.file, index: part.index };
    }));
  assert.deepEqual(found.map(item => item.file).sort(), [...ACCESSIBILITY_SWEEP_FILES].sort(),
    "A complete accessibility sweep is missing or duplicated");
  const jobs = new Set(found.map(item => item.index));
  assert(jobs.size >= 3 && [...jobs].every(index => found.filter(item => item.index === index).length <= 2),
    "Accessibility sweeps are concentrated: use at least three jobs, at most two complete sweeps per job");
  return found.sort((a, b) => a.file.localeCompare(b.file));
}

function fileGroups(value: unknown): FileGroup[] {
  // browserReportCases has already validated the complete native schema.
  const report = z.object({ suites: z.array(z.unknown()) }).parse(value);
  const suite = z.object({ specs: z.array(z.object({ id: z.string(), file: z.string(),
    tests: z.array(z.object({ projectName: z.string() })) })).optional(), suites: z.array(z.unknown()).optional() });
  const groups = new Map<string, FileGroup>();
  const visit = (values: unknown[]) => {
    for (const value of values) {
      const row = suite.parse(value);
      for (const spec of row.specs ?? []) for (const test of spec.tests) {
        const key = `${test.projectName}:${spec.file}`;
        const item = groups.get(key) ?? { file: spec.file, project: test.projectName, cases: [] };
        item.cases.push(`${spec.id}:${test.projectName}`); groups.set(key, item);
      }
      visit(row.suites ?? []);
    }
  };
  visit(report.suites); return [...groups.values()];
}

/** Use actual Playwright listings, never an estimated modulo/file-count plan. */
export function verifyNativeBrowserBalance(full: unknown, assignments: unknown[]): { file: string; index: number }[] {
  const expected = browserReportCases(full, null, false);
  assert(assignments.length === CI_BROWSER_SHARDS, "Six actual native listings are required");
  const cases = assignments.flatMap((report, index) => browserReportCases(report, index + 1, false));
  assert.deepEqual([...cases].sort(), expected, "Native partitions omit or duplicate full-suite cases");
  const parts = assignments.map((report, index) => ({ index: index + 1, files: fileGroups(report) }));
  const keys = (groups: FileGroup[]) => groups.map(file => `${file.project}:${file.file}`).sort();
  assert.deepEqual(parts.flatMap(part => keys(part.files)).sort(), keys(fileGroups(full)),
    "Native partitions split or omit a whole serial project/file group");
  return verifyAccessibilitySweepPlacement(parts);
}
