/** Historical measurements are data. This module has no current registry, CI identity, discovery or transport. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { z } from "zod";
import { verifyBrowserQueueIsolation } from "./ci-browser-queue-isolation";

const digest = z.string().regex(/^[0-9a-f]{64}$/);
const head = z.string().regex(/^[0-9a-f]{40}$/);
const decimal = z.string().regex(/^[1-9][0-9]*$/);
const project = z.string().regex(/^[a-z][a-z-]*$/);
const file = z.string().regex(/^[a-z0-9][a-z0-9._/-]*\.spec\.ts$/).refine(value => !value.includes(".."));
const specFile = z.string().regex(/^e2e\/[a-z0-9][a-z0-9._/-]*\.spec\.ts$/).refine(value => !value.includes(".."));
const milliseconds = z.number().int().min(0).max(3_600_000);
const positive = z.number().int().positive().safe();
const caseId = z.string().regex(/^[0-9a-f]{20}-[0-9a-f]{20}:[a-z][a-z-]*$/);
const caseSet = z.array(caseId).min(1);
const identity = z.object({ head, runId: decimal, runAttempt: decimal }).strict();
const rawFile = z.object({ file, project, baselineCaseCount: positive, durationMs: milliseconds }).strict();
export const multiRunDurationSourceSchema = z.object({
  head, workflowHead: head, tree: head, runId: decimal, runAttempt: decimal,
  projects: z.array(project).min(1), manifestSha256: digest,
  shards: z.array(z.object({ index: z.number().int().min(1).max(6), sha256: digest }).strict()).length(6),
  metadata: z.object({ runSha256: digest, jobsSha256: digest, testedCommitSha256: digest,
    artifactsSha256: digest, captureReceiptSha256: digest }).strict(),
  files: z.array(rawFile).min(1),
}).strict();
export const multiRunDurationHistorySchema = z.object({ schemaVersion: z.literal(2),
  estimator: z.object({ mode: z.literal("max-per-case-v1") }).strict(),
  sources: z.array(multiRunDurationSourceSchema).min(2).max(3),
}).strict();
export type MultiRunDurationSource = z.infer<typeof multiRunDurationSourceSchema>;
export type MultiRunDurationHistory = z.infer<typeof multiRunDurationHistorySchema>;
export type MultiRunDurationProfile = { value: MultiRunDurationHistory; sha256: string };
const key = (row: { project: string; file: string }) => `${row.project}:${row.file}`;
const sha = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");
function unique<T extends string | number>(values: T[], message: string): T[] {
  assert(values.length > 0 && new Set(values).size === values.length, message);
  return [...values].sort();
}
function same(actual: string[], expected: string[], message: string) {
  assert.deepEqual(unique(actual, message), unique(expected, message), message);
}
export function validateMultiRunDurationHistory(value: MultiRunDurationHistory): void {
  unique(value.sources.map(source => source.runId), "Distinct complete run IDs required");
  for (const source of value.sources) {
    assert.deepEqual(source.shards.map(row => row.index).sort(), [1, 2, 3, 4, 5, 6], "Six distinct historical shards required");
    unique(source.files.map(key), "Duplicate historical project/file");
    same(source.projects, [...new Set(source.files.map(row => row.project))], "Historical rows differ from declared historical projects");
  }
}
export function parseMultiRunBrowserDurationProfile(raw: string): MultiRunDurationProfile {
  const value = multiRunDurationHistorySchema.parse(JSON.parse(raw));
  validateMultiRunDurationHistory(value);
  return { value, sha256: sha(raw) };
}
export function optionalMultiRunBrowserDurationProfile(read: () => string): MultiRunDurationProfile | null {
  let raw: string;
  try { raw = read(); } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  return parseMultiRunBrowserDurationProfile(raw);
}
type Ratio = { durationMs: number; baselineCaseCount: number };
function maximumRatio(rows: Ratio[], floorOne: boolean): Ratio {
  assert(rows.length > 0, "A measured ratio is required");
  let best: Ratio = floorOne ? { durationMs: 1, baselineCaseCount: 1 } : rows[0];
  for (const row of rows) if (BigInt(row.durationMs) * BigInt(best.baselineCaseCount)
    > BigInt(best.durationMs) * BigInt(row.baselineCaseCount)) best = row;
  return best;
}
function scaled(ratio: Ratio, currentCases: number): number {
  positive.parse(currentCases);
  const numerator = BigInt(ratio.durationMs) * BigInt(currentCases), denominator = BigInt(ratio.baselineCaseCount);
  const value = (numerator + denominator - BigInt(1)) / denominator;
  assert(value <= BigInt(Number.MAX_SAFE_INTEGER), "Duration estimate overflow");
  return Math.max(1, Number(value));
}
/** Known groups use an exact rational maximum. Unknown cost has floor1 BEFORE count scaling. */
export function multiRunDurationEstimator(profile: MultiRunDurationProfile): (group: { file: string; project: string; count: number }) => number {
  const history = multiRunDurationHistorySchema.parse(profile.value);
  digest.parse(profile.sha256); validateMultiRunDurationHistory(history);
  const rows = history.sources.flatMap(source => source.files);
  const maximumFileMs = Math.max(1, ...rows.map(row => row.durationMs));
  const maximumCaseRatio = maximumRatio(rows, true);
  const known = new Map<string, Ratio[]>();
  for (const row of rows) known.set(key(row), [...(known.get(key(row)) ?? []), row]);
  return group => {
    file.parse(group.file); project.parse(group.project); positive.parse(group.count);
    const previous = known.get(key(group));
    return previous ? scaled(maximumRatio(previous, false), group.count)
      : Math.max(maximumFileMs, scaled(maximumCaseRatio, group.count));
  };
}

// Historical receipt validation deliberately uses EACH historical project set.
// It never imports the current registry or current GitHub-only runner modules.
const allocationIdentity = z.object({ mode: z.literal("duration-v1"), profileSha256: digest, planSha256: digest }).strict();
const allocation = allocationIdentity.extend({ parts: z.array(z.object({
  index: z.number().int().min(1).max(6), cases: caseSet,
}).strict()).length(6) }).strict();
const manifestSchema = identity.extend({ schemaVersion: z.literal(1), total: z.literal(6),
  cases: caseSet, files: z.array(specFile).min(1), allocation: allocation.optional() }).strict();
const measuredFile = z.object({ file, project, cases: caseSet, durationMs: milliseconds }).strict();
const historicalReceiptSchema = identity.extend({ schemaVersion: z.literal(1), total: z.literal(6),
  index: z.number().int().min(1).max(6), fullCases: caseSet, assignedCases: caseSet, executedCases: caseSet,
  fullFiles: z.array(specFile).min(1), providerUploads: z.number().int().nonnegative().safe(),
  timings: z.object({ setupMs: milliseconds, buildMs: milliseconds, bootstrapMs: milliseconds, browserMs: milliseconds }).strict(),
  files: z.array(measuredFile).min(1), allocation: allocationIdentity.optional(),
}).strict();
export type DecodedHistoricalZip = { bytes: Buffer; value: unknown };
export type HistoricalCaptureInput = { run: Buffer; jobs: Buffer; artifacts: Buffer; testedCommit: Buffer;
  captureReceipt: Buffer; manifest: DecodedHistoricalZip; shards: DecodedHistoricalZip[] };
function readJson(bytes: Buffer): unknown { return JSON.parse(bytes.toString("utf8")); }
const capturePin = z.object({ path: z.string(), bytes: z.number().int().nonnegative().safe(), sha256: digest });
function capturedPins(value: unknown): z.infer<typeof capturePin>[] {
  const record = z.object({ metadataPins: z.array(capturePin).optional(), downloadPins: z.array(capturePin).optional(),
    metadataCaptures: z.array(z.object({ output: capturePin })).optional(), downloadCaptures: z.array(z.object({ output: capturePin })).optional() }).parse(value);
  return [...(record.metadataPins ?? []), ...(record.downloadPins ?? []),
    ...(record.metadataCaptures ?? []).map(row => row.output), ...(record.downloadCaptures ?? []).map(row => row.output)];
}
function binding(pins: z.infer<typeof capturePin>[], bytes: Buffer): void {
  assert(pins.some(pin => pin.bytes === bytes.length && pin.sha256 === sha(bytes)), "Input differs from retained capture closure");
}
const apiArtifact = z.object({ id: positive, name: z.string(), size_in_bytes: positive, digest: z.string().regex(/^sha256:[0-9a-f]{64}$/),
  expired: z.literal(false), workflow_run: z.object({ id: positive, head_sha: head }) });
const mandatoryJobs = ["repository-checks", "checks", ...Array.from({ length: 6 }, (_, index) => `browser (${index + 1})`)];
// Historical equivalent of the source-pinned six canonical sweep policy;
// importing the current balance module would import current registry validation.
const historicalSweeps = ["accessible-authenticated-pages.spec.ts", "control-target-size.spec.ts", "figure-text-alternatives.spec.ts",
  "page-reflow-accessibility.spec.ts", "public-pages-session-accessibility.spec.ts", "viewport-keyboard-accessibility.spec.ts"];
/** Pure validation of one genuine captured source; IO/ZIP decoding belongs to the explicit offline helper. */
export function historicalDurationSource(input: HistoricalCaptureInput): MultiRunDurationSource {
  const run = z.object({ id: positive, run_attempt: positive, head_sha: head, status: z.literal("completed"),
    conclusion: z.literal("success"), event: z.enum(["pull_request", "push"]), path: z.literal(".github/workflows/ci.yml") }).parse(readJson(input.run));
  const jobs = z.object({ total_count: z.literal(8), jobs: z.array(z.object({ id: positive, name: z.string(), run_id: positive, run_attempt: positive,
    head_sha: head, status: z.literal("completed"), conclusion: z.literal("success"),
    steps: z.array(z.object({ status: z.literal("completed"), conclusion: z.enum(["success", "skipped"]) })) })).length(8) }).parse(readJson(input.jobs));
  same(jobs.jobs.map(job => job.name), mandatoryJobs, "Complete mandatory job set differs");
  unique(jobs.jobs.map(job => job.id), "Distinct actual jobs required");
  for (const job of jobs.jobs) assert(job.run_id === run.id && job.run_attempt === run.run_attempt && job.head_sha === run.head_sha,
    "Job belongs to another source/run/attempt");
  const commit = z.object({ sha: head, tree: z.object({ sha: head }) }).parse(readJson(input.testedCommit));
  const capture = z.object({ runId: positive, runAttempt: positive, prHead: head, testedMerge: head }).parse(readJson(input.captureReceipt));
  assert(capture.runId === run.id && capture.runAttempt === run.run_attempt && capture.prHead === run.head_sha
    && capture.testedMerge === commit.sha, "Retained capture source differs");
  const pins = capturedPins(readJson(input.captureReceipt));
  for (const bytes of [input.run, input.jobs, input.artifacts, input.testedCommit, input.manifest.bytes, ...input.shards.map(zip => zip.bytes)]) binding(pins, bytes);
  const artifacts = z.object({ total_count: z.number().int().nonnegative(), artifacts: z.array(apiArtifact) }).parse(readJson(input.artifacts));
  assert.equal(artifacts.total_count, artifacts.artifacts.length, "Incomplete artifact metadata");
  const prefix = `browser-case-${run.run_attempt}-`;
  const names = [`${prefix}manifest`, ...Array.from({ length: 6 }, (_, index) => `${prefix}shard-${index + 1}`)];
  const selected = artifacts.artifacts.filter(row => row.name.startsWith(prefix));
  same(selected.map(row => row.name), names, "Seven exact same-attempt case artifacts required");
  unique(selected.map(row => row.id), "Distinct actual artifacts required");
  assert.equal(input.shards.length, 6, "Six historical decoded shards required");
  for (const [index, zip] of [input.manifest, ...input.shards].entries()) {
    const artifact = selected.find(row => row.name === names[index]); assert(artifact, "Artifact is absent");
    assert(artifact.workflow_run.id === run.id && artifact.workflow_run.head_sha === run.head_sha
      && artifact.size_in_bytes === zip.bytes.length && artifact.digest === `sha256:${sha(zip.bytes)}`, "ZIP differs from authenticated artifact metadata");
  }
  const manifest = manifestSchema.parse(input.manifest.value);
  const receipts = input.shards.map(zip => historicalReceiptSchema.parse(zip.value));
  assert(manifest.head === commit.sha && manifest.runId === String(run.id) && manifest.runAttempt === String(run.run_attempt), "Manifest belongs to another tested checkout");
  unique(manifest.cases, "Empty/duplicate historical full cases"); unique(manifest.files, "Empty/duplicate historical full files");
  assert.deepEqual(receipts.map(row => row.index), [1, 2, 3, 4, 5, 6], "Historical shard order/index differs");
  if (manifest.allocation) {
    assert.deepEqual(manifest.allocation.parts.map(row => row.index).sort(), [1, 2, 3, 4, 5, 6], "Complete duration allocation required");
    same(manifest.allocation.parts.flatMap(row => row.cases), manifest.cases, "Historical allocation coverage differs");
    const canonical = { profileSha256: manifest.allocation.profileSha256,
      parts: manifest.allocation.parts.map(row => ({ index: row.index, cases: unique(row.cases, "Duplicate historical allocation case") })).sort((a, b) => a.index - b.index) };
    assert.equal(sha(JSON.stringify(canonical)), manifest.allocation.planSha256, "Historical allocation hash differs");
  }
  const rows: MultiRunDurationSource["files"] = [];
  for (const receipt of receipts) {
    assert(receipt.head === manifest.head && receipt.runId === manifest.runId && receipt.runAttempt === manifest.runAttempt, "Mixed historical receipt source");
    same(receipt.fullCases, manifest.cases, "Historical full cases differ"); same(receipt.fullFiles, manifest.files, "Historical full files differ");
    same(receipt.executedCases, receipt.assignedCases, "Historical execution differs from assigned cases");
    same(receipt.files.flatMap(row => row.cases), receipt.executedCases, "Historical file case coverage differs");
    assert(receipt.executedCases.every(id => manifest.cases.includes(id)), "Foreign historical case");
    assert.deepEqual(receipt.allocation, manifest.allocation ? { mode: manifest.allocation.mode,
      profileSha256: manifest.allocation.profileSha256, planSha256: manifest.allocation.planSha256 } : undefined, "Historical allocation identity differs");
    if (manifest.allocation) same(receipt.assignedCases, manifest.allocation.parts.find(row => row.index === receipt.index)!.cases,
      "Historical assigned allocation differs");
    for (const row of receipt.files) {
      assert(row.cases.every(id => id.split(":")[1] === row.project), "Historical file project differs from cases");
      rows.push({ file: row.file, project: row.project, baselineCaseCount: row.cases.length, durationMs: row.durationMs });
    }
  }
  same(receipts.flatMap(row => row.executedCases), manifest.cases, "Historical complete execution omitted/duplicated cases");
  verifyBrowserQueueIsolation(receipts);
  const sweeps = receipts.flatMap(receipt => receipt.files.filter(row => historicalSweeps.includes(row.file)).map(row => {
    assert(row.project === "chromium" && row.cases.length === 1, "Historical sweep must remain one whole Chromium case");
    return { file: row.file, index: receipt.index };
  }));
  same(sweeps.map(row => row.file), historicalSweeps, "Historical complete sweeps differ");
  assert(new Set(sweeps.map(row => row.index)).size >= 3 && receipts.every(receipt => sweeps.filter(row => row.index === receipt.index).length <= 2),
    "Historical sweeps are concentrated");
  unique(rows.map(key), "Historical project/file was split or duplicated");
  same([...new Set(rows.map(row => `e2e/${row.file}`))], manifest.files, "Historical measured file census differs");
  assert(receipts.reduce((sum, row) => sum + row.providerUploads, 0) > 0, "No actual historical provider upload");
  const projects = [...new Set(rows.map(row => row.project))].sort();
  same([...new Set(manifest.cases.map(id => id.split(":")[1]))], projects, "Historical declared project coverage differs");
  return multiRunDurationSourceSchema.parse({ head: manifest.head, workflowHead: run.head_sha, tree: commit.tree.sha,
    runId: manifest.runId, runAttempt: manifest.runAttempt, projects, manifestSha256: sha(input.manifest.bytes),
    shards: input.shards.map((zip, index) => ({ index: index + 1, sha256: sha(zip.bytes) })),
    metadata: { runSha256: sha(input.run), jobsSha256: sha(input.jobs), testedCommitSha256: sha(input.testedCommit),
      artifactsSha256: sha(input.artifacts), captureReceiptSha256: sha(input.captureReceipt) },
    files: rows.sort((a, b) => key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0) });
}
export function multiRunHistoryFromCaptures(inputs: HistoricalCaptureInput[]): MultiRunDurationHistory {
  const value = multiRunDurationHistorySchema.parse({ schemaVersion: 2, estimator: { mode: "max-per-case-v1" },
    sources: inputs.map(historicalDurationSource).sort((a, b) => BigInt(a.runId) < BigInt(b.runId) ? -1 : 1) });
  validateMultiRunDurationHistory(value); return value;
}
