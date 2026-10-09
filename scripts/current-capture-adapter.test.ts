/** AUTHORED UNRUN refusal controls. Synthetic metadata only; no provider/CI evidence.
 * These proposed tests must be qualified after source/plan review and runtime admission.
 */
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { currentCaptureContext, type CurrentCaptureAdmission,
  type ValidatedHistoricalMetadata } from "./current-capture-adapter";

const hash = (raw: Buffer) => createHash("sha256").update(raw).digest("hex");
const emptySha = hash(Buffer.alloc(0));
const revision = (letter: string) => letter.repeat(40);
const makePin = (path: string, bytes = 1, sha256 = "a".repeat(64)) => ({ path, bytes, sha256 });
function fixture(event: "push" | "pull_request" = "push") {
  const directory = "/synthetic/capture";
  const head = revision("a"), tested = event === "push" ? head : revision("b"), tree = revision("c");
  const request = { schemaVersion: 1 as const, repository: "themariodiego/Inherit.bio" as const,
    runId: 9001, runAttempt: 1, workflow: ".github/workflows/ci.yml" as const,
    head, testedHead: tested, tree,
    ...(event === "push" ? { event, branch: "main" as const } : { event, pullRequest: 293, base: revision("d") }) };
  const metadata: ValidatedHistoricalMetadata = { runId: 9001, runAttempt: 1,
    workflowHead: head, testedHead: tested, tree, event, jobIds: [1, 2, 3, 4, 5, 6, 7, 8],
    artifacts: ["manifest", ...Array.from({ length: 6 }, (_, i) => `shard-${i + 1}`)]
      .map((name, i) => ({ name: `browser-case-1-${name}`, id: 101 + i })) };
  const prefix = ["gh", "api", "--method", "GET", "-H", "X-GitHub-Api-Version: 2022-11-28"];
  const base = "repos/themariodiego/Inherit.bio/";
  const rows: [string, string[]][] = [
    ["run", [...prefix, base + "actions/runs/9001/attempts/1"]],
    ["jobs", [...prefix, base + "actions/runs/9001/attempts/1/jobs?per_page=100"]],
    ["artifacts", [...prefix, base + "actions/runs/9001/artifacts?per_page=100"]],
    ["tested-commit", [...prefix, base + `git/commits/${tested}`]],
    ["context", [...prefix, base + (event === "push" ? "branches/main" : "pulls/293")]],
    ...["head", "tested"].flatMap(role => [
      [`${role}-checks`, [...prefix, base + `commits/${role === "head" ? head : tested}/check-runs?per_page=100&filter=latest`]],
      [`${role}-statuses`, [...prefix, base + `commits/${role === "head" ? head : tested}/status?per_page=100`]],
    ] as [string, string[]][]),
    ...metadata.jobIds.map(id => [`job-${id}`, [...prefix, "--allow-escape-sequences", base + `actions/jobs/${id}/logs`]] as [string, string[]]),
    ...metadata.artifacts.map(item => [item.name, [...prefix, base + `actions/artifacts/${item.id}/zip`]] as [string, string[]]),
  ];
  const source = makePin("/synthetic/source/producer.ts");
  const requestInput = makePin("/synthetic/admission/request.json");
  const value = { schemaVersion: 1, status: "CAPTURED_UNREVIEWED", request,
    atUtc: "2026-10-06T00:00:01.000Z", sourceBefore: [source], sourceAfter: [source],
    requestInputBefore: requestInput, requestInputAfter: requestInput,
    records: rows.map(([name, argv], i) => ({ name, argv,
      startedAt: "2026-10-06T00:00:00.000Z", finishedAt: "2026-10-06T00:00:01.000Z",
      elapsedMs: 1000, exitCode: 0, signal: null, timedOut: false, groupAbsent: true,
      errors: [], rawReadbackPending: false, stdout: `${directory}/${name}.raw`, stderr: `${directory}/${name}.stderr`,
      rawIdentities: {
        stdout: { dev: 1, ino: 1000 + i * 2, uid: 501, mode: 0o100600, size: 1, mtimeMs: 1 },
        stderr: { dev: 1, ino: 1001 + i * 2, uid: 501, mode: 0o100600, size: 0, mtimeMs: 1 },
      }, originalCommandPin: makePin(`${directory}/${name}.original-command.json`),
      readbackPin: makePin(`${directory}/${name}.raw-readback.json`),
      stdoutPin: makePin(`${directory}/${name}.raw`), stderrPin: makePin(`${directory}/${name}.stderr`, 0, emptySha),
    })), firstError: null };
  const admissionBase = { request, sourcePins: [source], requestInputPin: requestInput };
  return { value, metadata, admissionBase, directory };
}
function invoke(value: unknown, f: ReturnType<typeof fixture>,
  alterAdmission?: (admission: CurrentCaptureAdmission) => unknown) {
  const raw = Buffer.from(JSON.stringify(value));
  const admission: CurrentCaptureAdmission = { ...f.admissionBase,
    capturePin: makePin(`${f.directory}/capture-receipt.json`, raw.length, hash(raw)) };
  // Rebinding isolates a semantic refusal. It never represents a real reviewed capture.
  return currentCaptureContext(raw, (alterAdmission ? alterAdmission(admission) : admission) as CurrentCaptureAdmission, f.metadata);
}
describe("explicit current capture provenance (authored UNRUN)", () => {
  it.each(["push", "pull_request"] as const)("preserves distinct source identity for %s", event => {
    const f = fixture(event), result = invoke(f.value, f);
    expect(result.prHead).toBe(f.value.request.head);
    expect(result.testedMerge).toBe(f.value.request.testedHead);
    expect(result.pins).toHaveLength(24);
    expect(f.value.status).toBe("CAPTURED_UNREVIEWED");
  });
  it("rejects a wrong independently reviewed original digest", () => {
    const f = fixture();
    expect(() => invoke(f.value, f, a => ({ ...a, capturePin: { ...a.capturePin, sha256: "f".repeat(64) } }))).toThrow();
  });
  it("rejects an admission baseline/override field", () => {
    const f = fixture(); expect(() => invoke(f.value, f, a => ({ ...a, acceptBaseline: true }))).toThrow();
  });
  const refusals: [string, (value: ReturnType<typeof fixture>["value"], f: ReturnType<typeof fixture>) => void][] = [
    ["unknown capture field", v => { Reflect.set(v, "acceptBaseline", true); }],
    ["unknown request field", v => { Reflect.set(v.request, "skipCoverage", true); }],
    ["unknown record field", v => { Reflect.set(v.records[0], "waiveFailure", true); }],
    ["missing original record", v => { v.records.pop(); }],
    ["duplicate original record", v => { v.records[1] = v.records[0]; }],
    ["collector source changed", v => { v.sourceAfter = [{ ...v.sourceAfter[0], bytes: 2 }]; }],
    ["request input changed", v => { v.requestInputAfter = { ...v.requestInputAfter, bytes: 2 }; }],
    ["foreign tested tree", v => { v.request.tree = revision("e"); }],
    ["foreign tested checkout", v => { v.request.testedHead = revision("e"); }],
    ["foreign run attempt", v => { v.request.runAttempt = 2; }],
    ["write command", v => { v.records[0].argv[3] = "POST"; }],
    ["foreign job log route", v => { const args = v.records.find(r => r.name === "job-1")!.argv; args[args.length - 1] = "unused"; }],
    ["foreign output path", v => { v.records[0].stdoutPin.path = "/synthetic/other.raw"; }],
    ["nonempty stderr", v => { v.records[0].stderrPin.bytes = 1; }],
    ["nonzero exit", v => { v.records[0].exitCode = 1; }],
    ["timed out command", v => { v.records[0].timedOut = true; }],
    ["live process group", v => { v.records[0].groupAbsent = false; }],
    ["pending readback", v => { v.records[0].rawReadbackPending = true; }],
    ["permissive original stream metadata", v => { v.records[0].rawIdentities.stdout.mode = 0o100644; }],
    ["reported capture error", v => { Reflect.set(v, "firstError", "failure"); }],
  ];
  it.each(refusals)("refuses %s", (_name, mutate) => {
    const f = fixture(); mutate(f.value, f); expect(() => invoke(f.value, f)).toThrow();
  });
});
