import assert from "node:assert/strict";
import { z } from "zod";
import { assertStandardCiBrowserProjects, STANDARD_CI_BROWSER_PROJECTS } from "./ci-browser-project-registry";

export const CI_BROWSER_SHARDS = 6;
const caseId = z.string().regex(/^[0-9a-f]{20}-[0-9a-f]{20}:[a-z-]+$/)
  .refine(value => STANDARD_CI_BROWSER_PROJECTS.includes(value.split(":")[1]));
const caseSet = z.array(caseId).min(1);
const milliseconds = z.number().int().min(0).max(3_600_000);
export const browserSetupTimingSchema = z.object({ setupMs: milliseconds, buildMs: milliseconds }).strict();
const fileTiming = z.object({ file: z.string().regex(/^[a-z0-9][a-z0-9._/-]*\.spec\.ts$/)
  .refine(value => !value.includes("..")), project: z.string().refine(value => STANDARD_CI_BROWSER_PROJECTS.includes(value)),
  cases: caseSet, durationMs: milliseconds }).strict();
const identity = z.object({ head: z.string().regex(/^[0-9a-f]{40}$/),
  runId: z.string().regex(/^[1-9][0-9]*$/), runAttempt: z.string().regex(/^[1-9][0-9]*$/) }).strict();
export type CiBrowserIdentity = z.infer<typeof identity>;
const specFile = z.string().regex(/^e2e\/[a-z0-9][a-z0-9._/-]*\.spec\.ts$/).refine(value => !value.includes(".."));
const manifestSchema = identity.extend({ schemaVersion: z.literal(1), total: z.literal(CI_BROWSER_SHARDS), cases: caseSet,
  files: z.array(specFile).min(1) }).strict();
const receiptSchema = identity.extend({ schemaVersion: z.literal(1), total: z.literal(CI_BROWSER_SHARDS),
  index: z.number().int().min(1).max(CI_BROWSER_SHARDS), fullCases: caseSet, assignedCases: caseSet,
  executedCases: caseSet, providerUploads: z.number().int().nonnegative().safe(), fullFiles: z.array(specFile).min(1),
  timings: browserSetupTimingSchema.extend({ bootstrapMs: milliseconds, browserMs: milliseconds }).strict(),
  files: z.array(fileTiming).min(1),
}).strict();
export type CiBrowserManifest = z.infer<typeof manifestSchema>;
export type CiBrowserShardReceipt = z.infer<typeof receiptSchema>;

/** Only the closed native shard option is admitted. It is never a file, grep,
 * project, retry or alternate-config selector, and has no local runtime mode. */
export function ciBrowserShard(value: string | undefined, env: Readonly<Record<string, string | undefined>>,
  platform: NodeJS.Platform = process.platform): number | null {
  if (!value?.startsWith("--ci-shard")) return null;
  assert(platform === "linux" && env.CI === "true" && env.GITHUB_ACTIONS === "true"
    && env.RUNNER_ENVIRONMENT === "github-hosted" && env.INHERIT_DISPOSABLE_LOCAL_E2E === "true",
  "Browser sharding requires a fresh disposable GitHub-hosted Linux job");
  const match = value.match(/^--ci-shard=([1-6])\/6$/);
  assert(match, "Only one of the six registered browser shards is allowed");
  assert(!env.INHERIT_DENSITY_CAPTURE && !env.INHERIT_COMPREHENSION_RUN,
    "The standard browser case set cannot enable optional captures or paid runs");
  return Number(match[1]);
}

const reportSchema = z.object({
  config: z.object({ workers: z.literal(1), fullyParallel: z.literal(false),
    shard: z.object({ current: z.number().int(), total: z.literal(CI_BROWSER_SHARDS) }).nullable(),
    projects: z.array(z.object({ name: z.string(), retries: z.literal(0), repeatEach: z.literal(1) })),
  }),
  suites: z.array(z.unknown()), errors: z.array(z.unknown()).max(0),
  stats: z.object({ unexpected: z.literal(0), flaky: z.literal(0), skipped: z.literal(0) }),
});
const testSchema = z.object({ projectName: z.string(), expectedStatus: z.literal("passed"),
  results: z.array(z.object({ status: z.literal("passed"), retry: z.literal(0), duration: milliseconds })),
});
const suiteSchema = z.object({ specs: z.array(z.object({ id: z.string(), file: fileTiming.shape.file, tests: z.array(testSchema).min(1) })).optional(),
  suites: z.array(z.unknown()).optional() });
function sortedUnique(values: string[]) {
  assert(values.length > 0 && new Set(values).size === values.length, "Empty or duplicate browser case identity");
  return [...values].sort();
}
function sameCases(actual: string[], expected: string[]) {
  assert.deepEqual(sortedUnique(actual), sortedUnique(expected), "Browser case coverage differs");
}
/** Raw Playwright JSON stays in memory. Only fixed case IDs are returned;
 * configuration, environments, errors, stdout and attachments are never copied. */
export function browserReportCases(value: unknown, index: number | null, executed: boolean): string[] {
  const report = reportSchema.parse(value);
  assertStandardCiBrowserProjects(report.config.projects.map(project => project.name));
  assert.deepEqual(report.config.shard, index === null ? null : { current: index, total: CI_BROWSER_SHARDS }, "Browser shard differs");
  const cases: string[] = [];
  const visit = (values: unknown[]) => {
    for (const value of values) {
      const suite = suiteSchema.parse(value);
      for (const spec of suite.specs ?? []) for (const test of spec.tests) {
        assert(test.results.length === (executed ? 1 : 0), "Each browser case requires exactly one execution and no discovery execution");
        cases.push(caseId.parse(`${spec.id}:${test.projectName}`));
      }
      visit(suite.suites ?? []);
    }
  };
  visit(report.suites);
  if (index === null) assertStandardCiBrowserProjects([...new Set(cases.map(id => id.split(":")[1]))]);
  return sortedUnique(cases);
}
export const OPTIONAL_BROWSER_SPEC_FILES = Object.freeze([
  "e2e/density-post-change.density.spec.ts", "e2e/comprehension-run.spec.ts",
]);
export function verifyBrowserSourceCensus(discovered: string[], tracked: string[]): string[] {
  const expected = tracked.map(value => specFile.parse(value)).filter(value => !OPTIONAL_BROWSER_SPEC_FILES.includes(value));
  assert.deepEqual(sortedUnique(discovered), sortedUnique(expected), "Standard browser discovery omitted a tracked ordinary spec or admitted an optional capture");
  return sortedUnique(discovered);
}
function discoveredFiles(value: unknown): string[] {
  const files = new Set<string>();
  const visit = (suites: unknown[]) => {
    for (const value of suites) {
      const suite = suiteSchema.parse(value);
      for (const spec of suite.specs ?? []) files.add(`e2e/${spec.file}`);
      visit(suite.suites ?? []);
    }
  };
  visit(reportSchema.parse(value).suites); return [...files].sort();
}
export function browserManifest(value: unknown, source: CiBrowserIdentity, trackedSpecs: string[]): CiBrowserManifest {
  return manifestSchema.parse({ ...identity.parse(source), schemaVersion: 1, total: CI_BROWSER_SHARDS,
    cases: browserReportCases(value, null, false), files: verifyBrowserSourceCensus(discoveredFiles(value), trackedSpecs) });
}
export function browserShardReceipt(full: unknown, assigned: unknown, executed: unknown,
  source: CiBrowserIdentity, index: number, providerUploads: number,
  timings: CiBrowserShardReceipt["timings"], trackedSpecs: string[]): CiBrowserShardReceipt {
  const fullCases = browserReportCases(full, null, false);
  const assignedCases = browserReportCases(assigned, index, false);
  const executedCases = browserReportCases(executed, index, true);
  sameCases(executedCases, assignedCases);
  assert(assignedCases.every(id => fullCases.includes(id)), "Shard contains a case absent from full discovery");
  const files = new Map<string, z.infer<typeof fileTiming>>();
  const visit = (suites: unknown[]) => {
    for (const value of suites) {
      const suite = suiteSchema.parse(value);
      for (const spec of suite.specs ?? []) for (const test of spec.tests) {
        const key = `${test.projectName}:${spec.file}`;
        const row = files.get(key) ?? { file: spec.file, project: test.projectName, cases: [], durationMs: 0 };
        row.cases.push(`${spec.id}:${test.projectName}`); row.durationMs += test.results[0].duration;
        files.set(key, row);
      }
      visit(suite.suites ?? []);
    }
  };
  visit(reportSchema.parse(executed).suites);
  return receiptSchema.parse({ ...identity.parse(source), schemaVersion: 1, total: CI_BROWSER_SHARDS,
    index, fullCases, assignedCases, executedCases, providerUploads, timings, files: [...files.values()],
    fullFiles: verifyBrowserSourceCensus(discoveredFiles(full), trackedSpecs) });
}
export function verifyBrowserShards(expected: unknown, values: unknown[], source: CiBrowserIdentity): number {
  const manifest = manifestSchema.parse(expected), receipts = values.map(value => receiptSchema.parse(value));
  const current = identity.parse(source);
  for (const item of [manifest, ...receipts]) {
    assert.deepEqual({ head: item.head, runId: item.runId, runAttempt: item.runAttempt }, current,
      "Browser evidence belongs to a different source, run or attempt");
  }
  assert(receipts.length === CI_BROWSER_SHARDS && new Set(receipts.map(item => item.index)).size === CI_BROWSER_SHARDS,
    "Exactly one receipt for every registered browser shard is required");
  for (const receipt of receipts) {
    sameCases(receipt.fullCases, manifest.cases);
    sameCases(receipt.executedCases, receipt.assignedCases);
    sameCases(receipt.files.flatMap(file => file.cases), receipt.executedCases);
    assert.deepEqual(sortedUnique(receipt.fullFiles), sortedUnique(manifest.files), "Browser source file inventories differ");
  }
  sortedUnique(receipts.flatMap(receipt => receipt.files.map(file => `${file.project}:${file.file}`)));
  assert(receipts.reduce((sum, receipt) => sum + receipt.providerUploads, 0) > 0,
    "No browser upload crossed the actual provider across the complete suite");
  // sortedUnique refuses duplicates across shards before comparing complete sets.
  sameCases(receipts.flatMap(receipt => receipt.assignedCases), manifest.cases);
  sameCases(receipts.flatMap(receipt => receipt.executedCases), manifest.cases);
  return manifest.cases.length;
}
