/** Pure format/provenance adapter; no IO, transport or acceptance.
 * Integrate after the stock historical run/jobs/artifacts/commit schemas validate.
 * The original capture Buffer remains the metadata captureReceiptSha256 input.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import path from "node:path";
import { z } from "zod";

const digest = z.string().regex(/^[0-9a-f]{64}$/);
const revision = z.string().regex(/^[0-9a-f]{40}$/);
const safeInt = z.number().int().nonnegative().safe();
const positive = safeInt.min(1);
const absolute = z.string().min(1).refine(value => path.isAbsolute(value));
const pin = z.object({ path: absolute, bytes: safeInt, sha256: digest }).strict();
export type CapturePin = z.infer<typeof pin>;
const emptySha = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
const requestBase = {
  schemaVersion: z.literal(1), repository: z.literal("themariodiego/Inherit.bio"),
  runId: positive, runAttempt: positive, workflow: z.literal(".github/workflows/ci.yml"),
  head: revision, testedHead: revision, tree: revision,
};
const request = z.discriminatedUnion("event", [
  z.object({ ...requestBase, event: z.literal("push"), branch: z.literal("main") }).strict(),
  z.object({ ...requestBase, event: z.literal("pull_request"), pullRequest: positive, base: revision }).strict(),
]);
const stat = z.object({ dev: safeInt, ino: positive, uid: safeInt,
  mode: z.literal(0o100600), size: safeInt, mtimeMs: z.number().finite().nonnegative() }).strict();
const record = z.object({
  name: z.string().min(1), argv: z.array(z.string()).min(1),
  startedAt: z.string().datetime(), finishedAt: z.string().datetime(),
  elapsedMs: z.number().finite().nonnegative(), exitCode: z.literal(0),
  signal: z.null(), timedOut: z.literal(false), groupAbsent: z.literal(true),
  errors: z.array(z.never()).length(0), rawReadbackPending: z.literal(false),
  stdout: absolute, stderr: absolute,
  rawIdentities: z.object({ stdout: stat, stderr: stat }).strict(),
  originalCommandPin: pin, readbackPin: pin, stdoutPin: pin, stderrPin: pin,
}).strict();
const receipt = z.object({ schemaVersion: z.literal(1), status: z.literal("CAPTURED_UNREVIEWED"),
  request, atUtc: z.string().datetime(), sourceBefore: z.array(pin).min(1).max(64),
  sourceAfter: z.array(pin).min(1).max(64), requestInputBefore: pin, requestInputAfter: pin,
  records: z.array(record).length(24), firstError: z.null(),
}).strict();
export type CurrentCaptureRequest = z.infer<typeof request>;
export type CurrentCaptureAdmission = Readonly<{
  capturePin: CapturePin; request: CurrentCaptureRequest;
  sourcePins: readonly CapturePin[]; requestInputPin: CapturePin;
}>;
const admissionSchema = z.object({ capturePin: pin, request,
  sourcePins: z.array(pin).min(1).max(64), requestInputPin: pin }).strict();
/** Values already admitted by the existing full historical validator. No raw
 * API object, alternate baseline, project registry or current discovery enters here.
 */
export type ValidatedHistoricalMetadata = Readonly<{
  runId: number; runAttempt: number; workflowHead: string; testedHead: string;
  tree: string; event: "push" | "pull_request";
  jobIds: readonly number[];
  artifacts: readonly { id: number; name: string }[];
}>;
const metadataSchema = z.object({ runId: positive, runAttempt: positive,
  workflowHead: revision, testedHead: revision, tree: revision,
  event: z.enum(["push", "pull_request"]), jobIds: z.array(positive).length(8),
  artifacts: z.array(z.object({ id: positive, name: z.string().min(1) }).strict()).length(7),
}).strict();
export type CaptureContext = Readonly<{
  runId: number; runAttempt: number; prHead: string; testedMerge: string;
  tree: string; event: "push" | "pull_request"; pins: CapturePin[];
}>;
const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const unique = (values: readonly unknown[], message: string) =>
  assert(new Set(values).size === values.length, message);

/** Explicit hosted-reader-raw-v1 entry point. A caller supplies source-reviewed
 * expected pins; neither CAPTURED_UNREVIEWED nor a computed hash supplies approval.
 * Never manufacture or serialize a legacy capture receipt.
 */
export function currentCaptureContext(raw: Buffer, inputAdmission: CurrentCaptureAdmission,
  inputMetadata: ValidatedHistoricalMetadata): CaptureContext {
  const admission = admissionSchema.parse(inputAdmission);
  const metadata = metadataSchema.parse(inputMetadata);
  const approved = admission.capturePin;
  assert(raw.length === approved.bytes && sha(raw) === approved.sha256,
    "Capture bytes differ from the independently reviewed original pin");
  assert(path.basename(approved.path) === "capture-receipt.json", "Exact original capture filename required");
  const value = receipt.parse(JSON.parse(raw.toString("utf8")));
  const expectedRequest = request.parse(admission.request);
  assert.deepEqual(value.request, expectedRequest, "Request differs from the reviewed capture admission");
  assert.deepEqual({ runId: value.request.runId, runAttempt: value.request.runAttempt,
    workflowHead: value.request.head, testedHead: value.request.testedHead,
    tree: value.request.tree, event: value.request.event },
  { runId: metadata.runId, runAttempt: metadata.runAttempt, workflowHead: metadata.workflowHead,
    testedHead: metadata.testedHead, tree: metadata.tree, event: metadata.event },
  "Capture request differs from validated run/tested commit");
  assert(value.request.event !== "push" || value.request.head === value.request.testedHead,
    "Push capture must test its exact workflow head");
  assert.deepEqual(value.sourceBefore, value.sourceAfter, "Collector source changed during capture");
  assert.deepEqual(value.sourceBefore, admission.sourcePins.map(item => pin.parse(item)),
    "Collector source differs from the reviewed vector");
  unique(value.sourceBefore.map(item => item.path), "Duplicate collector source pin");
  assert.deepEqual(value.requestInputBefore, value.requestInputAfter, "Request source changed during capture");
  assert.deepEqual(value.requestInputBefore, pin.parse(admission.requestInputPin),
    "Request input pin differs from the reviewed original");
  assert(metadata.jobIds.length === 8, "Full eight validated jobs required");
  unique(metadata.jobIds, "Duplicate validated job");
  const prefix = `browser-case-${metadata.runAttempt}-`;
  const artifactNames = [prefix + "manifest", ...Array.from({ length: 6 }, (_, i) => prefix + `shard-${i + 1}`)];
  assert.deepEqual(metadata.artifacts.map(item => item.name).sort(), artifactNames.sort(),
    "Seven validated same-attempt artifacts required");
  unique(metadata.artifacts.map(item => item.id), "Duplicate validated artifact");
  const route = `repos/themariodiego/Inherit.bio/`;
  const api = ["gh", "api", "--method", "GET", "-H", "X-GitHub-Api-Version: 2022-11-28"];
  const commands = new Map<string, string[]>([
    ["run", [...api, `${route}actions/runs/${metadata.runId}/attempts/${metadata.runAttempt}`]],
    ["jobs", [...api, `${route}actions/runs/${metadata.runId}/attempts/${metadata.runAttempt}/jobs?per_page=100`]],
    ["artifacts", [...api, `${route}actions/runs/${metadata.runId}/artifacts?per_page=100`]],
    ["tested-commit", [...api, `${route}git/commits/${metadata.testedHead}`]],
    ["context", [...api, value.request.event === "push" ? `${route}branches/main` : `${route}pulls/${value.request.pullRequest}`]],
    ["head-checks", [...api, `${route}commits/${metadata.workflowHead}/check-runs?per_page=100&filter=latest`]],
    ["head-statuses", [...api, `${route}commits/${metadata.workflowHead}/status?per_page=100`]],
    ["tested-checks", [...api, `${route}commits/${metadata.testedHead}/check-runs?per_page=100&filter=latest`]],
    ["tested-statuses", [...api, `${route}commits/${metadata.testedHead}/status?per_page=100`]],
    ...metadata.jobIds.map(id => [`job-${id}`, [...api, "--allow-escape-sequences", `${route}actions/jobs/${id}/logs`]] as [string, string[]]),
    ...metadata.artifacts.map(item => [item.name, [...api, `${route}actions/artifacts/${item.id}/zip`]] as [string, string[]]),
  ]);
  unique(value.records.map(item => item.name), "Duplicate captured record");
  assert.deepEqual(value.records.map(item => item.name).sort(), [...commands.keys()].sort(),
    "Missing or unregistered captured record");
  const directory = path.dirname(approved.path);
  for (const item of value.records) {
    assert.deepEqual(item.argv, commands.get(item.name), "Captured command differs from its exact read-only route");
    for (const [field, suffix] of [["stdoutPin", ".raw"], ["stderrPin", ".stderr"],
      ["originalCommandPin", ".original-command.json"], ["readbackPin", ".raw-readback.json"]] as const)
      assert(item[field].path === path.join(directory, item.name + suffix), "Captured pin escapes its original fixed path");
    assert(item.stdout === item.stdoutPin.path && item.stderr === item.stderrPin.path,
      "Original stream path differs from its pin");
    assert(item.rawIdentities.stdout.size === item.stdoutPin.bytes
      && item.rawIdentities.stderr.size === item.stderrPin.bytes, "Captured stream size differs from its pin");
    assert(item.stderrPin.bytes === 0 && item.stderrPin.sha256 === emptySha, "Captured command reported stderr");
    assert(Date.parse(item.finishedAt) >= Date.parse(item.startedAt), "Captured chronology is invalid");
  }
  return { runId: value.request.runId, runAttempt: value.request.runAttempt,
    prHead: value.request.head, testedMerge: value.request.testedHead,
    tree: value.request.tree, event: value.request.event,
    pins: value.records.map(item => item.stdoutPin) };
}
