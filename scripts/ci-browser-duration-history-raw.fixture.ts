/** Small OFFLINE_SYNTHETIC fixture. Real local files/ZIPs, synthetic API and
 * command envelopes; never an actual CI capture or independently approved source. */
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync, lstatSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import AdmZip from "adm-zip";
import { type CurrentCaptureAdmission } from "./current-capture-adapter";
import { type OriginalPin } from "./current-capture-io";
import { observeCurrentRawInput } from "./ci-browser-duration-history-raw";
const sha = (raw: Buffer) => createHash("sha256").update(raw).digest("hex");
const json = (value: unknown) => Buffer.from(JSON.stringify(value));
const revision = (letter: string) => letter.repeat(40);
export function syntheticRawCapture(event: "push" | "pull_request" = "push", runId = 9001) {
  const parent = realpathSync(mkdtempSync(path.join(os.tmpdir(), "ci-raw-")));
  const root = path.join(parent, "capture"); mkdirSync(root, { mode: 0o700 });
  const sourceDirectory = path.join(parent, "source"); mkdirSync(sourceDirectory, { mode: 0o700 });
  const head = revision("a"), tested = event === "push" ? head : revision("b"), tree = revision("c");
  const request = { schemaVersion: 1 as const, repository: "themariodiego/Inherit.bio" as const,
    runId, runAttempt: 1, workflow: ".github/workflows/ci.yml" as const, head, testedHead: tested, tree,
    ...(event === "push" ? { event, branch: "main" as const } : { event, pullRequest: 293, base: revision("d") }) };
  const files = ["accessible-authenticated-pages.spec.ts", "control-target-size.spec.ts", "figure-text-alternatives.spec.ts",
    "page-reflow-accessibility.spec.ts", "public-pages-session-accessibility.spec.ts", "viewport-keyboard-accessibility.spec.ts"];
  const cases = files.map((_, i) => `${String(i + 1).padStart(20, "0")}-${"1".repeat(20)}:chromium`);
  const identity = { schemaVersion: 1, total: 6, head: tested, runId: String(runId), runAttempt: "1" };
  const zip = (member: string, value: unknown) => { const a = new AdmZip(); a.addFile(member, json(value)); return a.toBuffer(); };
  const zipBytes = [zip("ci-browser-manifest.json", { ...identity, cases, files: files.map(file => `e2e/${file}`) }),
    ...files.map((file, i) => zip("ci-browser-shard.json", { ...identity, index: i + 1, fullCases: cases,
      assignedCases: [cases[i]], executedCases: [cases[i]], fullFiles: files.map(value => `e2e/${value}`), providerUploads: 1,
      timings: { setupMs: 1, buildMs: 1, bootstrapMs: 1, browserMs: 100 },
      files: [{ file, project: "chromium", cases: [cases[i]], durationMs: 100 }] }))];
  const artifactNames = ["manifest", ...Array.from({ length: 6 }, (_, i) => `shard-${i + 1}`)].map(name => `browser-case-1-${name}`);
  const raw = new Map<string, Buffer>([
    ["run", json({ id: runId, run_attempt: 1, head_sha: head, status: "completed", conclusion: "success", event, path: ".github/workflows/ci.yml" })],
    ["jobs", json({ total_count: 8, jobs: ["repository-checks", "checks", ...Array.from({ length: 6 }, (_, i) => `browser (${i + 1})`)].map((name, i) => ({
      id: i + 1, name, run_id: runId, run_attempt: 1, head_sha: head, status: "completed", conclusion: "success",
      steps: [{ status: "completed", conclusion: "success" }] })) })],
    ["artifacts", json({ total_count: 7, artifacts: zipBytes.map((bytes, i) => ({ id: 101 + i, name: artifactNames[i],
      size_in_bytes: bytes.length, digest: `sha256:${sha(bytes)}`, expired: false, workflow_run: { id: runId, head_sha: head } })) })],
    ["tested-commit", json({ sha: tested, tree: { sha: tree } })],
    ...zipBytes.map((bytes, i) => [artifactNames[i], bytes] as [string, Buffer]),
  ]);
  const prefix = ["gh", "api", "--method", "GET", "-H", "X-GitHub-Api-Version: 2022-11-28"], base = "repos/themariodiego/Inherit.bio/";
  const routes: [string, string[]][] = [
    ["run", [...prefix, base + `actions/runs/${runId}/attempts/1`]],
    ["jobs", [...prefix, base + `actions/runs/${runId}/attempts/1/jobs?per_page=100`]],
    ["artifacts", [...prefix, base + `actions/runs/${runId}/artifacts?per_page=100`]],
    ["tested-commit", [...prefix, base + `git/commits/${tested}`]],
    ["context", [...prefix, base + (event === "push" ? "branches/main" : "pulls/293")]],
    ...["head", "tested"].flatMap(role => [
      [`${role}-checks`, [...prefix, base + `commits/${role === "head" ? head : tested}/check-runs?per_page=100&filter=latest`]],
      [`${role}-statuses`, [...prefix, base + `commits/${role === "head" ? head : tested}/status?per_page=100`]],
    ] as [string, string[]][]),
    ...Array.from({ length: 8 }, (_, i) => [`job-${i + 1}`, [...prefix, "--allow-escape-sequences", base + `actions/jobs/${i + 1}/logs`]] as [string, string[]]),
    ...artifactNames.map((name, i) => [name, [...prefix, base + `actions/artifacts/${101 + i}/zip`]] as [string, string[]]),
  ];
  const pin = (file: string, bytes: Buffer): OriginalPin => ({ path: file, bytes: bytes.length, sha256: sha(bytes) });
  const records = routes.map(([name, argv]) => {
    const bytes = raw.get(name) ?? json({ scope: "OFFLINE_SYNTHETIC", name });
    const file = path.join(root, name + ".raw"), stderr = path.join(root, name + ".stderr");
    writeFileSync(file, bytes, { mode: 0o600, flag: "wx" }); writeFileSync(stderr, Buffer.alloc(0), { mode: 0o600, flag: "wx" });
    const fields = (p: string) => { const s = lstatSync(p); return { dev: s.dev, ino: s.ino, uid: s.uid, mode: s.mode, size: s.size, mtimeMs: s.mtimeMs }; };
    const original = path.join(root, name + ".original-command.json"), readback = path.join(root, name + ".raw-readback.json");
    const placeholder = json({ scope: "OFFLINE_SYNTHETIC_NO_ACTUAL_COMMAND", name });
    writeFileSync(original, placeholder, { mode: 0o600, flag: "wx" }); writeFileSync(readback, placeholder, { mode: 0o600, flag: "wx" });
    return { name, argv, startedAt: "2026-10-06T00:00:00.000Z", finishedAt: "2026-10-06T00:00:01.000Z", elapsedMs: 1000,
      exitCode: 0, signal: null, timedOut: false, groupAbsent: true, errors: [], rawReadbackPending: false,
      stdout: file, stderr, rawIdentities: { stdout: fields(file), stderr: fields(stderr) },
      stdoutPin: pin(file, bytes), stderrPin: pin(stderr, Buffer.alloc(0)), originalCommandPin: pin(original, placeholder), readbackPin: pin(readback, placeholder) };
  });
  const sourcePins = [pin(path.join(sourceDirectory, "synthetic-producer.ts"), Buffer.from("SYNTHETIC"))];
  const requestInputPin = pin(path.join(parent, "synthetic-request.json"), json(request));
  const receiptRaw = json({ schemaVersion: 1, status: "CAPTURED_UNREVIEWED", request, atUtc: "2026-10-06T00:00:01.000Z",
    sourceBefore: sourcePins, sourceAfter: sourcePins, requestInputBefore: requestInputPin, requestInputAfter: requestInputPin,
    records, firstError: null });
  const receiptFile = path.join(root, "capture-receipt.json"); writeFileSync(receiptFile, receiptRaw, { mode: 0o600, flag: "wx" });
  const captureAdmission: CurrentCaptureAdmission = { capturePin: pin(receiptFile, receiptRaw), request, sourcePins, requestInputPin };
  const originalPins = [captureAdmission.capturePin, ...["run", "jobs", "artifacts", "tested-commit", ...artifactNames].map(name => records.find(r => r.name === name)!.stdoutPin)];
  const io = observeCurrentRawInput(root, 1, originalPins);
  return { parent, root, sourceDirectory, captureAdmission, originalPins, io, raw, zipBytes,
    savedArtifactFixturesAreSynthetic: true as const };
}
