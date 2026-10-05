import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { z } from "zod";
import { ACCESSIBILITY_SWEEP_FILES, verifyAccessibilitySweepPlacement } from "./ci-browser-balance";
import { browserAllocationHash, browserReportCases, CI_BROWSER_SHARDS, type CiBrowserAllocation } from "./ci-browser-shards";
import { STANDARD_CI_BROWSER_PROJECTS } from "./ci-browser-project-registry";
import { assertBrowserQueueGroups, assertBrowserQueuePartition, isQueueExclusiveBrowserFile, verifyBrowserQueueIsolation } from "./ci-browser-queue-isolation";
import { multiRunDurationEstimator, optionalMultiRunBrowserDurationProfile, type MultiRunDurationProfile } from "./ci-browser-duration-history";

const digest = z.string().regex(/^[0-9a-f]{64}$/);
const file = z.string().regex(/^[a-z0-9][a-z0-9._/-]*\.spec\.ts$/).refine(value => !value.includes(".."));
const project = z.string().refine(value => STANDARD_CI_BROWSER_PROJECTS.includes(value));
const historicalProject = z.string().regex(/^[a-z][a-z-]*$/);
const profileSchema = z.object({ schemaVersion: z.literal(1), source: z.object({
  head: z.string().regex(/^[0-9a-f]{40}$/), runId: z.string().regex(/^[1-9][0-9]*$/),
  runAttempt: z.string().regex(/^[1-9][0-9]*$/), manifestSha256: digest,
  projects: z.array(historicalProject).min(1),
  shards: z.array(z.object({ index: z.number().int().min(1).max(6), sha256: digest }).strict()).length(6),
}).strict(), files: z.array(z.object({ file, project: historicalProject,
  baselineCaseCount: z.number().int().positive().safe(),
  durationMs: z.number().int().min(0).max(3_600_000),
}).strict()).min(1) }).strict();
type Profile = z.infer<typeof profileSchema>;
type Group = { file: string; project: string; cases: string[] };
export type BrowserDurationProfile = { value: Profile; sha256: string };
export type SelectedBrowserDurationProfile = BrowserDurationProfile | MultiRunDurationProfile;
export type BrowserDurationPlan = { allocation: CiBrowserAllocation;
  parts: { index: number; files: Group[]; estimatedMs: number }[] };
const key = (group: { file: string; project: string }) => `${group.project}:${group.file}`;
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;

function validateHistory(value: Profile): void {
  assert.deepEqual(value.source.shards.map(row => row.index).sort(), [1, 2, 3, 4, 5, 6], "Duration provenance requires six distinct shards");
  assert(new Set(value.files.map(key)).size === value.files.length, "Duplicate duration project/file weight");
  assert(new Set(value.source.projects).size === value.source.projects.length, "Duplicate historical project provenance");
  assert.deepEqual([...new Set(value.files.map(row => row.project))].sort(), [...value.source.projects].sort(),
    "Duration weights differ from their historical project provenance");
}

/** Timing history is performance input. It is never the current case census. */
export function parseBrowserDurationProfile(raw: string): BrowserDurationProfile {
  const value = profileSchema.parse(JSON.parse(raw)); validateHistory(value);
  return { value, sha256: createHash("sha256").update(raw).digest("hex") };
}

/** Only a missing optional profile selects the unchanged native fallback. */
export function optionalBrowserDurationProfile(read: () => string): BrowserDurationProfile | null {
  let raw: string;
  try { raw = read(); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  return parseBrowserDurationProfile(raw);
}

/** Fixed expected-version inputs are BOTH checked. Only ENOENT is absence. */
export function selectBrowserDurationProfile(readV1: () => string, readV2: () => string): SelectedBrowserDurationProfile | null {
  const legacy = optionalBrowserDurationProfile(readV1);
  const current = optionalMultiRunBrowserDurationProfile(readV2);
  return current ?? legacy;
}

/** Preserve the original V1 numerical path; V2 uses an exact rational maximum. */
export function browserDurationEstimator(profile: SelectedBrowserDurationProfile): (group: { file: string; project: string; count: number }) => number {
  if (profile.value.schemaVersion === 2) return multiRunDurationEstimator({ value: profile.value, sha256: profile.sha256 });
  const history = profileSchema.parse(profile.value); digest.parse(profile.sha256); validateHistory(history);
  const weights = new Map(history.files.map(row => [key(row), row]));
  const maximumFileMs = Math.max(1, ...history.files.map(row => row.durationMs));
  const maximumCaseMs = Math.max(1, ...history.files.map(row => row.durationMs / row.baselineCaseCount));
  return group => {
    const previous = weights.get(key(group));
    const estimatedMs = previous
      ? Math.max(1, Math.ceil(previous.durationMs * group.count / previous.baselineCaseCount))
      : Math.ceil(Math.max(maximumFileMs, maximumCaseMs * group.count));
    assert(Number.isSafeInteger(estimatedMs), "Duration weight overflow");
    return estimatedMs;
  };
}

function groups(value: unknown): Group[] {
  const report = z.object({ suites: z.array(z.unknown()) }).parse(value);
  const suite = z.object({ specs: z.array(z.object({ id: z.string(), file,
    tests: z.array(z.object({ projectName: project })) })).optional(), suites: z.array(z.unknown()).optional() });
  const found = new Map<string, Group>();
  const visit = (values: unknown[]) => {
    for (const value of values) {
      const row = suite.parse(value);
      for (const spec of row.specs ?? []) for (const test of spec.tests) {
        const groupKey = key({ file: spec.file, project: test.projectName });
        const group = found.get(groupKey) ?? { file: spec.file, project: test.projectName, cases: [] };
        group.cases.push(`${spec.id}:${test.projectName}`); found.set(groupKey, group);
      }
      visit(row.suites ?? []);
    }
  };
  visit(report.suites); return [...found.values()].map(row => ({ ...row, cases: row.cases.sort() }))
    .sort((a, b) => compare(key(a), key(b)));
}

/** Longest whole file first, with deterministic ties, intact accessibility sweeps and isolated publication queues.
 * Known groups scale by CURRENT case count; new groups get at least the largest
 * saved file cost and the largest saved mean per-case cost. Removed groups add no cases. */
export function browserDurationPlan(full: unknown, profile: SelectedBrowserDurationProfile): BrowserDurationPlan {
  const currentCases = browserReportCases(full, null, false);
  // Revalidate callers' input; a mutable object cannot bypass the closed schema.
  const estimate = browserDurationEstimator(profile);
  const currentGroups = groups(full); assertBrowserQueueGroups(currentGroups);
  const weighted = currentGroups.map(group => {
    const estimatedMs = estimate({ ...group, count: group.cases.length });
    assert(Number.isSafeInteger(estimatedMs), "Duration weight overflow");
    return { ...group, estimatedMs };
  }).sort((a, b) => b.estimatedMs - a.estimatedMs || compare(key(a), key(b)));
  const parts = Array.from({ length: CI_BROWSER_SHARDS }, (_, index) => ({ index: index + 1, files: [] as Group[], estimatedMs: 0 }));
  for (const group of weighted) {
    const sweep = ACCESSIBILITY_SWEEP_FILES.includes(group.file);
    const exclusive = isQueueExclusiveBrowserFile(group.file);
    const eligible = parts.filter(part => (!sweep || part.files.filter(file => ACCESSIBILITY_SWEEP_FILES.includes(file.file)).length < 2)
      && (!exclusive || !part.files.some(file => isQueueExclusiveBrowserFile(file.file))));
    const part = eligible.sort((a, b) => a.estimatedMs - b.estimatedMs || a.index - b.index)[0];
    assert(part, "No whole-file partition is available");
    part.files.push({ file: group.file, project: group.project, cases: group.cases }); part.estimatedMs += group.estimatedMs;
    assert(Number.isSafeInteger(part.estimatedMs), "Duration partition overflow");
  }
  for (const part of parts) part.files.sort((a, b) => compare(key(a), key(b)));
  verifyAccessibilitySweepPlacement(parts);
  verifyBrowserQueueIsolation(parts);
  const allocationParts = parts.map(part => ({ index: part.index, cases: part.files.flatMap(file => file.cases).sort() }));
  const assigned = allocationParts.flatMap(part => part.cases);
  assert(new Set(assigned).size === assigned.length, "Duration plan duplicates current cases");
  assert.deepEqual([...assigned].sort(), currentCases, "Duration plan omits current cases");
  return { parts, allocation: { mode: "duration-v1", profileSha256: profile.sha256,
    planSha256: browserAllocationHash(profile.sha256, allocationParts), parts: allocationParts } };
}

/** Official Playwright test-list grammar: project + file, no title/line selector.
 * Filenames are relative to the unchanged config's rootDir (./e2e). */
export function browserDurationTestList(plan: BrowserDurationPlan, index: number): string {
  const part = plan.parts.find(part => part.index === index);
  assert(part && part.files.length > 0, "Empty or unknown duration partition");
  return part.files.map(group => `[${project.parse(group.project)}] › ${file.parse(group.file)}`).join("\n") + "\n";
}

export function verifyBrowserDurationPartitionListing(value: unknown, plan: BrowserDurationPlan, index: number): void {
  const part = plan.parts.find(part => part.index === index);
  const expected = plan.allocation.parts.find(part => part.index === index);
  assert(part && expected, "Unknown duration partition");
  assertBrowserQueuePartition(part.files);
  assertBrowserQueuePartition(groups(value));
  assert.deepEqual(browserReportCases(value, null, false, true), expected.cases,
    "Official duration listing differs from its complete assigned cases");
  assert.deepEqual(groups(value), part.files, "Official duration listing split or changed a whole project/file group");
}

/** Independently collected official listings must match the complete plan exactly. */
export function verifyBrowserDurationListings(full: unknown, assignments: unknown[], plan: BrowserDurationPlan): void {
  const current = browserReportCases(full, null, false);
  assert(assignments.length === CI_BROWSER_SHARDS, "Six actual duration listings are required");
  const parts = assignments.map((value, index) => {
    verifyBrowserDurationPartitionListing(value, plan, index + 1);
    return { index: index + 1, files: groups(value) };
  });
  const all = assignments.flatMap(value => browserReportCases(value, null, false, true));
  assert(new Set(all).size === all.length, "Duration listings duplicate current cases");
  assert.deepEqual([...all].sort(), current, "Duration listings omit current cases");
  verifyAccessibilitySweepPlacement(parts);
  verifyBrowserQueueIsolation(parts);
}
