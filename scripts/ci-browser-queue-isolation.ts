import assert from "node:assert/strict";

/** Exact existing publication journeys. Missing files add no current cases. */
export const QUEUE_EXCLUSIVE_BROWSER_FILES = Object.freeze({
  "embryo-ingest-journey.spec.ts": "embryo-ingest",
  "embryo-mixed-qc-journey.spec.ts": "embryo-mixed-qc",
  "embryo-qc-second-seed-journey.spec.ts": "chromium",
  "reviews-keyless-owner-notice-journey.spec.ts": "chromium",
  "embryo-third-party-journey.spec.ts": "chromium",
});
type Group = { file: string; project: string; cases: readonly string[] };
const exclusiveProjects = ["embryo-ingest", "embryo-mixed-qc"];
export function isQueueExclusiveBrowserFile(file: string): boolean {
  return Object.hasOwn(QUEUE_EXCLUSIVE_BROWSER_FILES, file);
}

/** Current groups must retain the native guard's exact file/project/single case. */
export function assertBrowserQueueGroups(groups: readonly Group[]): number {
  const exclusive = groups.filter(group => isQueueExclusiveBrowserFile(group.file) || exclusiveProjects.includes(group.project));
  for (const group of exclusive) assert(isQueueExclusiveBrowserFile(group.file)
    && QUEUE_EXCLUSIVE_BROWSER_FILES[group.file as keyof typeof QUEUE_EXCLUSIVE_BROWSER_FILES] === group.project
    && group.cases.length === 1, "Each queue journey requires its exact project and single complete case");
  assert(new Set(exclusive.map(group => group.file)).size === exclusive.length, "Duplicate queue journey file");
  return exclusive.length;
}

export function assertBrowserQueuePartition(groups: readonly Group[]): void {
  assert(assertBrowserQueueGroups(groups) <= 1, "Each fresh browser partition permits at most one queue journey");
}

/** Check planned groups and independently observed listings/execution receipts. */
export function verifyBrowserQueueIsolation(parts: readonly { index: number; files: readonly Group[] }[]): void {
  assert.deepEqual(parts.map(part => part.index).sort(), [1, 2, 3, 4, 5, 6], "Six queue-isolated browser partitions are required");
  for (const part of parts) assertBrowserQueuePartition(part.files);
  assertBrowserQueueGroups(parts.flatMap(part => part.files));
}
