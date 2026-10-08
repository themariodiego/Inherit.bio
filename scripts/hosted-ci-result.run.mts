/** Explicit read-only capture/review CLI. Importing this file does not invoke it. */
import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { constants, lstatSync, realpathSync, mkdirSync, openSync, closeSync, fstatSync, readSync,
  writeFileSync, fsyncSync, statfsSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import AdmZip from "adm-zip";
import { z } from "zod";
import { decodeHistoricalZip } from "./ci-browser-duration-history-io";
import { selectBrowserDurationProfile } from "./ci-browser-duration-plan";
import { hostedResultRequestSchema, hostedWorkflowContract, verifyHostedMetadata, coverageArtifacts,
  verifyArtifactBytes, verifyHostedCoverage, repositoryLogSummary, verifyCurrentChecks, commandLog,
  hashBytes, hostedGetArgv, type HostedResultRequest } from "./hosted-ci-result";

const sourceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url), localRequire = createRequire(require.resolve("eslint"));
const yaml = localRequire("js-yaml") as { load(value: string): unknown };
const maxJson = 16 * 1024 ** 2, maxLog = 32 * 1024 ** 2, maxZip = 10_000_000;
const contractFiles = [".github/workflows/ci.yml", "scripts/ci_apt_mirror_priority.py", "scripts/ci-browser-shards.ts", "scripts/ci-browser-project-registry.ts",
  "scripts/ci-browser-balance.ts", "scripts/ci-browser-queue-isolation.ts", "scripts/ci-browser-duration-plan.ts",
  "scripts/ci-browser-duration-history.ts", "scripts/ci-browser-duration-history-io.ts",
  "scripts/ci-browser-duration-variance.ts",
  "scripts/ci-browser-shards.run.mts", "scripts/ci-browser-shards-io.ts",
  "scripts/ci-browser-config.ts", "scripts/ci-browser-setup-timings.ts", "scripts/ci-browser-setup-timings.run.mts",
  "scripts/run-upload-browser.mts", "scripts/lighthouse-contract.mjs", "scripts/lighthouse-check.ts",
  "package.json", "pnpm-lock.yaml"];
const runtimeFiles = [...contractFiles, "scripts/hosted-ci-result.ts", "scripts/hosted-ci-result.run.mts"];
const environment = () => ({ PATH: process.env.PATH, HOME: process.env.HOME, LANG: "C.UTF-8", TZ: "UTC", NODE_ENV: "test" as const,
  GH_TOKEN: process.env.GH_TOKEN, GITHUB_TOKEN: process.env.GITHUB_TOKEN, GH_CONFIG_DIR: process.env.GH_CONFIG_DIR });
function git(args: string[]): Buffer {
  return execFileSync("git", args, { cwd: sourceRoot, env: environment(), timeout: 5000, maxBuffer: maxJson, stdio: ["ignore", "pipe", "pipe"] });
}
type Identity = { path: string; uid: number; dev: number; ino: number };
function identity(file: string): Identity {
  assert(realpathSync(file) === file, "Canonical nonsymlink path required");
  const value = lstatSync(file); assert(!value.isSymbolicLink() && process.getuid && value.uid === process.getuid(), "Owned path required");
  return { path: file, uid: value.uid, dev: value.dev, ino: value.ino };
}
const within = (file: string, root: string) => file === root || file.startsWith(root + path.sep);
function unchanged(item: Identity): void { assert.deepEqual(identity(item.path), item, "Owned path identity changed"); }
export function reserveResultOutput(directory: string, protectedPaths: string[]) {
  const output = path.resolve(directory), parent = identity(path.dirname(output));
  assert(lstatSync(parent.path).isDirectory(), "Owned directory parent required");
  const protectedItems = protectedPaths.map(file => identity(realpathSync(file)));
  for (const item of protectedItems) assert(!within(output, item.path) && !within(item.path, output)
    && !(item.dev === parent.dev && item.ino === parent.ino), "Output aliases source/input evidence");
  mkdirSync(output, { mode: 0o700 }); // Existing output is never accepted.
  const owned = identity(output);
  return { path: output, check() {
    unchanged(parent); unchanged(owned);
    assert((lstatSync(output).mode & 0o777) === 0o700, "Private output mode changed");
    for (const item of protectedItems) unchanged(item);
  } };
}
type Output = ReturnType<typeof reserveResultOutput>;
function openOutput(output: Output, name: string): number {
  output.check(); assert(/^[A-Za-z0-9_.-]+$/.test(name), "Fixed output basename required");
  const fd = openSync(path.join(output.path, name), constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try { checkOutputFile(output, name, fd); return fd; }
  catch (error) { closeSync(fd); throw error; }
}
function checkOutputFile(output: Output, name: string, fd: number): void {
  output.check(); const actual = fstatSync(fd), named = lstatSync(path.join(output.path, name));
  assert(actual.isFile() && !named.isSymbolicLink() && actual.uid === process.getuid?.() && actual.nlink === 1
    && (actual.mode & 0o777) === 0o600 && actual.dev === named.dev && actual.ino === named.ino
    && named.nlink === 1, "Exclusive private output FD identity changed");
}
function save(output: Output, name: string, value: unknown): void {
  const fd = openOutput(output, name);
  try { writeFileSync(fd, JSON.stringify(value, null, 2) + "\n"); fsyncSync(fd); checkOutputFile(output, name, fd); }
  finally { closeSync(fd); }
}
function readBounded(file: string, limit = maxJson, allowEmpty = false): Buffer {
  const named = lstatSync(file); assert(named.isFile() && !named.isSymbolicLink() && named.nlink === 1
    && (allowEmpty || named.size > 0) && named.size <= limit, "Input file type/size refused");
  const fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const start = fstatSync(fd); assert(start.dev === named.dev && start.ino === named.ino, "Input open identity changed");
    assert((allowEmpty || start.size > 0) && start.size <= limit, "Opened input size refused");
    const raw = Buffer.alloc(start.size); let offset = 0;
    while (offset < raw.length) {
      const count = readSync(fd, raw, offset, raw.length - offset, offset);
      assert(count > 0, "Input shortened during read"); offset += count;
    }
    const extra = Buffer.alloc(1); assert(readSync(fd, extra, 0, 1, raw.length) === 0, "Input grew during read");
    const end = fstatSync(fd), after = lstatSync(file);
    assert(raw.length === start.size && raw.length <= limit && start.dev === end.dev && start.ino === end.ino
      && start.size === end.size && start.mtimeMs === end.mtimeMs && after.dev === end.dev && after.ino === end.ino
      && after.size === end.size && after.mtimeMs === end.mtimeMs, "Input changed during read"); return raw;
  } finally { closeSync(fd); }
}
const filePin = (file: string, limit = maxJson, allowEmpty = false) => { const raw = readBounded(file, limit, allowEmpty);
  return { path: file, bytes: raw.length, sha256: hashBytes(raw) }; };
function sourceVector() { return runtimeFiles.map(file => filePin(path.join(sourceRoot, file))); }
function sourceContract(request: HostedResultRequest) {
  assert(git(["rev-parse", `${request.testedHead}^{tree}`]).toString().trim() === request.tree, "Local tested Git tree differs");
  assert(git(["rev-parse", `${request.head}^{tree}`]).toString().trim() === request.tree, "Head and tested whole trees differ");
  for (const file of contractFiles) assert(git(["show", `${request.testedHead}:${file}`]).equals(readBounded(path.join(sourceRoot, file))),
    "The tested source uses a different reader contract");
  const tracked = git(["ls-tree", "-r", "--name-only", request.testedHead]).toString().trim().split("\n");
  const profile = (file: string) => {
    if (!tracked.includes(file)) throw Object.assign(new Error("Absent optional profile"), { code: "ENOENT" });
    return git(["show", `${request.testedHead}:${file}`]).toString("utf8");
  };
  const selected = selectBrowserDurationProfile(() => profile("data/ci/browser-duration-profile.json"),
    () => profile("data/ci/browser-duration-profile-v2.json"));
  return { workflow: hostedWorkflowContract(yaml.load(git(["show", `${request.testedHead}:${request.workflow}`]).toString())),
    trackedSpecs: tracked.filter(file => file.startsWith("e2e/") && file.endsWith(".spec.ts")), profileSha256: selected?.sha256 ?? null,
    actualParents: git(["show", "-s", "--format=%P", request.testedHead]).toString().trim().split(/\s+/).filter(Boolean) };
}
type CaptureRecord = { name: string; argv: string[]; startedAt: string; finishedAt: string; elapsedMs: number;
  exitCode: number | null; signal: string | null; timedOut: boolean; groupAbsent: boolean; errors: string[];
  rawReadbackPending: boolean; stdout: string; stderr: string;
  rawIdentities: Partial<Record<"stdout" | "stderr", { dev: number; ino: number; uid: number; mode: number; size: number; mtimeMs: number }>>;
  originalCommandPin?: ReturnType<typeof filePin>; readbackPin?: ReturnType<typeof filePin>;
  stdoutPin?: ReturnType<typeof filePin>; stderrPin?: ReturnType<typeof filePin> };
const pinSchema = z.object({ path: z.string(), bytes: z.number().int().nonnegative().safe(),
  sha256: z.string().regex(/^[0-9a-f]{64}$/) }).strict();
const rawIdentitySchema = z.object({ dev: z.number().int().nonnegative().safe(), ino: z.number().int().nonnegative().safe(),
  uid: z.number().int().nonnegative().safe(), mode: z.number().int().nonnegative(), size: z.number().int().nonnegative().safe(),
  mtimeMs: z.number().finite() }).strict();
const recordSchema = z.object({ name: z.string().regex(/^[A-Za-z0-9_.-]+$/), argv: z.array(z.string()).min(1),
  startedAt: z.string(), finishedAt: z.string(), elapsedMs: z.number().finite().nonnegative(), exitCode: z.number().int().nullable(),
  signal: z.string().nullable(), timedOut: z.boolean(), groupAbsent: z.boolean(), errors: z.array(z.string()),
  rawReadbackPending: z.boolean(), stdout: z.string(), stderr: z.string(),
  rawIdentities: z.object({ stdout: rawIdentitySchema.optional(), stderr: rawIdentitySchema.optional() }).strict(),
  originalCommandPin: pinSchema.optional(), readbackPin: pinSchema.optional(), stdoutPin: pinSchema.optional(), stderrPin: pinSchema.optional() }).strict();
const captureSchema = z.object({ schemaVersion: z.literal(1), status: z.literal("CAPTURED_UNREVIEWED"),
  request: hostedResultRequestSchema, atUtc: z.string(), sourceBefore: z.array(pinSchema), sourceAfter: z.array(pinSchema),
  requestInputBefore: pinSchema, requestInputAfter: pinSchema,
  records: z.array(recordSchema).min(1), firstError: z.null() }).strict();
export async function captureHostedGet(output: Output, name: string, route: string, limit: number): Promise<CaptureRecord> {
  const argv = hostedGetArgv(route);
  const stdout = `${name}.raw`, stderr = `${name}.stderr`, fds: number[] = [];
  const record: CaptureRecord = { name, argv, startedAt: new Date().toISOString(), finishedAt: "", elapsedMs: 0,
    exitCode: null, signal: null, timedOut: false, groupAbsent: false, errors: [], rawReadbackPending: true,
    stdout: path.join(output.path, stdout), stderr: path.join(output.path, stderr), rawIdentities: {} };
  const start = performance.now(); let child: ReturnType<typeof spawn> | null = null;
  const kill = () => { if (child?.pid) try { process.kill(-child.pid, "SIGKILL"); } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ESRCH") record.errors.push("owned-group-kill-uncertain");
  } };
  let timer: ReturnType<typeof setTimeout> | undefined, bound: ReturnType<typeof setInterval> | undefined;
  try {
    fds.push(openOutput(output, stdout)); fds.push(openOutput(output, stderr));
    const owned = spawn(argv[0], argv.slice(1), { cwd: sourceRoot, env: environment(), detached: true,
      stdio: ["ignore", fds[0], fds[1]] }); child = owned;
    timer = setTimeout(() => { record.timedOut = true; kill(); }, 60_000);
    bound = setInterval(() => { try {
      output.check(); if (fstatSync(fds[0]).size > limit || fstatSync(fds[1]).size > maxJson) {
        record.errors.push("raw-size-bound-exceeded"); kill(); }
    } catch { record.errors.push("raw-output-identity-uncertain"); kill(); } }, 250);
    let closed = false;
    const terminal = new Promise<void>(resolve => {
      owned.once("error", () => { record.errors.push("read-only-command-start-failed"); });
      owned.once("close", (code, signal) => { record.exitCode = code; record.signal = signal; closed = true; resolve(); });
    });
    let terminalTimer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([terminal, new Promise<void>(resolve => {
      terminalTimer = setTimeout(() => { record.timedOut = true; kill(); resolve(); }, 60_000);
    })]);
    if (terminalTimer) clearTimeout(terminalTimer);
    const until = performance.now() + 5000;
    while (owned.pid && performance.now() < until) {
      try { process.kill(-owned.pid, 0); kill(); }
      catch (error) { if ((error as NodeJS.ErrnoException).code === "ESRCH") { record.groupAbsent = true; break; }
        record.errors.push("owned-group-settlement-uncertain"); break; }
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    if (!owned.pid) record.groupAbsent = true;
    if (!closed) { kill(); record.errors.push("original-child-terminal-not-observed"); }
  } catch { record.errors.push("capture-operation-failed"); kill(); }
  finally {
    if (timer) clearTimeout(timer); if (bound) clearInterval(bound);
    for (const [index, fd] of fds.entries()) {
      try { fsyncSync(fd); checkOutputFile(output, index === 0 ? stdout : stderr, fd);
        const actual = fstatSync(fd); record.rawIdentities[index === 0 ? "stdout" : "stderr"] = {
          dev: actual.dev, ino: actual.ino, uid: actual.uid, mode: actual.mode, size: actual.size, mtimeMs: actual.mtimeMs }; }
      catch { record.errors.push("raw-sync-identity-uncertain"); }
      try { closeSync(fd); } catch { record.errors.push("raw-close-uncertain"); }
    }
  }
  record.finishedAt = new Date().toISOString(); record.elapsedMs = performance.now() - start;
  // Retain original command outcome before any reopened stream or source-post check.
  save(output, `${name}.original-command.json`, record);
  record.originalCommandPin = filePin(path.join(output.path, `${name}.original-command.json`));
  const readback: { stdout?: ReturnType<typeof filePin>; stderr?: ReturnType<typeof filePin>; errors: string[] } = { errors: [] };
  for (const stream of ["stdout", "stderr"] as const) try {
    const file = record[stream], raw = lstatSync(file);
    const original = record.rawIdentities[stream]; assert(original && raw.dev === original.dev && raw.ino === original.ino
      && raw.uid === original.uid && raw.mode === original.mode && raw.size === original.size && raw.mtimeMs === original.mtimeMs,
    "Original raw FD/named identity differs");
    // Empty streams are retained through the same owned FD readback checks.
    readback[stream] = filePin(file, stream === "stdout" ? limit : maxJson, true);
  } catch { readback.errors.push(`${stream}-readback-refused`); }
  save(output, `${name}.raw-readback.json`, readback);
  record.readbackPin = filePin(path.join(output.path, `${name}.raw-readback.json`));
  record.stdoutPin = readback.stdout; record.stderrPin = readback.stderr;
  record.errors.push(...readback.errors); record.rawReadbackPending = false;
  assert(record.exitCode === 0 && !record.signal && !record.timedOut && record.groupAbsent && record.errors.length === 0,
    "Read-only capture failed; original outcome retained"); return record;
}
function parse(file: string): unknown { return JSON.parse(readBounded(file).toString("utf8")); }
function readSaved(capture: string, name: string, receipt: { records: CaptureRecord[] }, limit = maxJson): Buffer {
  const records = receipt.records.filter(record => record.name === name); assert(records.length === 1, "Missing/duplicate saved capture record");
  const record = records[0];
  assert(record.exitCode === 0 && !record.signal && !record.timedOut && record.groupAbsent && !record.rawReadbackPending
    && record.errors.length === 0 && record.stdoutPin && record.stderrPin && record.originalCommandPin && record.readbackPin,
    "Saved original command is not qualified");
  assert.deepEqual(filePin(path.join(capture, `${name}.original-command.json`)), record.originalCommandPin, "Original outcome changed");
  assert.deepEqual(filePin(path.join(capture, `${name}.raw-readback.json`)), record.readbackPin, "Original raw readback changed");
  const original = { ...record }; delete original.stdoutPin; delete original.stderrPin;
  delete original.originalCommandPin; delete original.readbackPin; original.rawReadbackPending = true;
  assert.deepEqual(parse(path.join(capture, `${name}.original-command.json`)), original, "Original command fields differ");
  assert(record.stdout === path.join(capture, `${name}.raw`) && record.stderr === path.join(capture, `${name}.stderr`), "Saved raw path differs");
  for (const stream of ["stdout", "stderr"] as const) {
    const actual = lstatSync(record[stream]), original = record.rawIdentities[stream];
    assert(original && actual.dev === original.dev && actual.ino === original.ino && actual.uid === original.uid
      && actual.mode === original.mode && actual.size === original.size && actual.mtimeMs === original.mtimeMs,
    "Saved original raw FD identity changed");
  }
  const bytes = readBounded(record.stdout, limit);
  assert.deepEqual(filePin(record.stdout, limit), record.stdoutPin, "Saved raw bytes changed");
  const error = lstatSync(record.stderr);
  assert(error.isFile() && !error.isSymbolicLink() && error.nlink === 1 && error.size <= maxJson, "Saved stderr type differs");
  assert.deepEqual(filePin(record.stderr, maxJson, true), record.stderrPin, "Saved stderr changed");
  return bytes;
}
function verifySaved(capture: string) {
  const request = hostedResultRequestSchema.parse(parse(path.join(capture, "request.json")));
  const receipt = captureSchema.parse(parse(path.join(capture, "capture-receipt.json")));
  assert.deepEqual(receipt.request, request); assert.deepEqual(receipt.sourceBefore, receipt.sourceAfter, "Original source drift");
  assert.deepEqual(receipt.requestInputBefore, receipt.requestInputAfter, "Original capture request drift");
  assert.deepEqual(sourceVector(), receipt.sourceAfter, "Reader source differs from saved capture");
  const contract = sourceContract(request), read = (name: string) => JSON.parse(readSaved(capture, name, receipt).toString("utf8")) as unknown;
  const metadata = verifyHostedMetadata(request, contract.workflow, read("run"), read("jobs"), read("tested-commit"), read("context"));
  assert.deepEqual(metadata.actualParents, contract.actualParents, "Actual API/Git parent vectors differ");
  const inventory = coverageArtifacts(request, read("artifacts"));
  const base = `repos/${request.repository}`, expectedRoutes: Record<string, string> = {
    run: `${base}/actions/runs/${request.runId}/attempts/${request.runAttempt}`,
    jobs: `${base}/actions/runs/${request.runId}/attempts/${request.runAttempt}/jobs?per_page=100`,
    artifacts: `${base}/actions/runs/${request.runId}/artifacts?per_page=100`,
    "tested-commit": `${base}/git/commits/${request.testedHead}`,
    context: request.event === "push" ? `${base}/branches/main` : `${base}/pulls/${request.pullRequest}`,
  };
  for (const [prefix, revision] of [["head", request.head], ["tested", request.testedHead]]) {
    expectedRoutes[`${prefix}-checks`] = `${base}/commits/${revision}/check-runs?per_page=100&filter=latest`;
    expectedRoutes[`${prefix}-statuses`] = `${base}/commits/${revision}/status?per_page=100`;
  }
  for (const job of metadata.jobs) expectedRoutes[`job-${job.id}`] = `${base}/actions/jobs/${job.id}/logs`;
  for (const artifact of inventory) expectedRoutes[artifact.name] = `${base}/actions/artifacts/${artifact.id}/zip`;
  assert.deepEqual(receipt.records.map(record => record.name).sort(), Object.keys(expectedRoutes).sort(), "Capture record inventory differs");
  const expectedFiles = ["request.json", "capture-receipt.json", ...receipt.records.flatMap(record =>
    ["raw", "stderr", "original-command.json", "raw-readback.json"].map(suffix => `${record.name}.${suffix}`))].sort();
  assert.deepEqual(readdirSync(capture).sort(), expectedFiles, "Saved capture file inventory differs");
  for (const record of receipt.records) assert.deepEqual(record.argv,
    hostedGetArgv(expectedRoutes[record.name]), "Original GET argv differs");
  const members: { name: string; member: string; bytes: number; sha256: string }[] = [];
  const decoded = inventory.map(artifact => {
    const bytes = readSaved(capture, artifact.name, receipt, maxZip); verifyArtifactBytes(artifact, bytes);
    // Inventory comes first; the existing decoder then enforces one exact member/CRC/flags/bounds.
    const zip = new AdmZip(bytes), names = zip.getEntries().map(entry => entry.entryName);
    assert.deepEqual(names, [artifact.member], "Unsupported ZIP inventory, including six-project QC sidecars");
    const value = decodeHistoricalZip(bytes, artifact.member);
    members.push({ name: artifact.name, member: artifact.member, bytes: bytes.length, sha256: hashBytes(bytes) }); return value;
  });
  const browser = verifyHostedCoverage(request, decoded[0], decoded.slice(1), contract.trackedSpecs, contract.profileSha256);
  const logs = (name: string) => readSaved(capture, `job-${metadata.jobs.find(job => job.name === name)!.id}`, receipt, maxLog).toString("utf8");
  const repository = repositoryLogSummary(logs("repository-checks"));
  for (let index = 1; index <= browser.assignments.length; index++) {
    const part = commandLog(logs(`browser (${index})`), `pnpm exec tsx scripts/run-upload-browser.mts --ci-shard=${index}/6`);
    const sentence = `E2E contract passed: ${browser.assignments[index - 1]} result(s), no skips, no retries.`;
    assert(part.split(sentence).length === 2, "Original browser result signal differs");
  }
  const aggregate = commandLog(logs("checks"), "pnpm exec tsx scripts/ci-browser-shards.run.mts aggregate ci-browser-coverage");
  assert(aggregate.includes(`Full browser coverage: ${browser.cases} cases, exactly once, zero skips or retries, six isolated jobs, source ${request.testedHead}.`),
    "Original complete aggregate signal differs");
  for (const role of ["head", "tested"] as const)
    verifyCurrentChecks(request, role, metadata, read(`${role}-checks`), read(`${role}-statuses`));
  return { request, metadata, browser, repository, members, savedCaptureReceipt: filePin(path.join(capture, "capture-receipt.json")),
    boundaries: ["Saved original result calculation. Different-author review and fresh merge head/base checks remain required.",
      "No native, provider, clinical, feature journey or release admission. Summaries do not invent unsaved per-unit/TAP identities."] };
}
async function capture(requestFile: string, directory: string) {
  const input = path.resolve(requestFile), requestInputBefore = filePin(input);
  const request = hostedResultRequestSchema.parse(parse(input)), before = sourceVector(); sourceContract(request);
  assert.deepEqual(filePin(input), requestInputBefore, "Capture request changed before reservation");
  assert(Number(process.versions.node.split(".")[0]) === 22, "Locked Node22 reader required");
  const free = statfsSync(path.dirname(path.resolve(directory))); assert(free.bavail * free.bsize >= 100_000_000, "Capture requires 100MB free");
  const output = reserveResultOutput(directory, [sourceRoot, input]); save(output, "request.json", request);
  const base = `repos/${request.repository}`, records: CaptureRecord[] = [];
  const get = async (name: string, route: string, limit = maxJson) => { const record = await captureHostedGet(output, name, route, limit); records.push(record); };
  const wave = async (queue: (() => Promise<void>)[]) => {
    const results = await Promise.allSettled(Array.from({ length: 3 }, async () => {
      while (queue.length) { const operation = queue.shift(); assert(operation); await operation(); }
    }));
    assert(results.every(result => result.status === "fulfilled") && queue.length === 0, "One or more original GETs failed");
  };
  let error: string | null = null;
  try {
    const metadataQueue = [
      () => get("run", `${base}/actions/runs/${request.runId}/attempts/${request.runAttempt}`),
      () => get("jobs", `${base}/actions/runs/${request.runId}/attempts/${request.runAttempt}/jobs?per_page=100`),
      () => get("artifacts", `${base}/actions/runs/${request.runId}/artifacts?per_page=100`),
      () => get("tested-commit", `${base}/git/commits/${request.testedHead}`),
      () => get("context", request.event === "push" ? `${base}/branches/main` : `${base}/pulls/${request.pullRequest}`),
    ];
    for (const [prefix, revision] of [["head", request.head], ["tested", request.testedHead]]) {
      metadataQueue.push(() => get(`${prefix}-checks`, `${base}/commits/${revision}/check-runs?per_page=100&filter=latest`));
      metadataQueue.push(() => get(`${prefix}-statuses`, `${base}/commits/${revision}/status?per_page=100`));
    }
    await wave(metadataQueue);
    const contract = sourceContract(request), values = (name: string) => parse(path.join(output.path, `${name}.raw`));
    const metadata = verifyHostedMetadata(request, contract.workflow, values("run"), values("jobs"), values("tested-commit"), values("context"));
    assert.deepEqual(metadata.actualParents, contract.actualParents, "Actual API/Git parent vectors differ");
    const artifacts = coverageArtifacts(request, values("artifacts"));
    assert(artifacts.reduce((n, item) => n + item.size_in_bytes, 0) <= maxZip, "Coverage archive total exceeds its bound");
    // Independent read-only downloads in one bounded wave; every original result stays retained.
    const queue = [...metadata.jobs.map(job => () => get(`job-${job.id}`, `${base}/actions/jobs/${job.id}/logs`, maxLog)),
      ...artifacts.map(item => () => get(item.name, `${base}/actions/artifacts/${item.id}/zip`, maxZip))];
    await wave(queue);
  } catch { error = "capture-failed-see-original-command-records"; }
  let after: ReturnType<typeof sourceVector> | null = null;
  let requestInputAfter: ReturnType<typeof filePin> | null = null;
  try { after = sourceVector(); requestInputAfter = filePin(input); assert.deepEqual(after, before);
    assert.deepEqual(requestInputAfter, requestInputBefore); } catch { error ??= "source-or-request-postflight-hold"; }
  save(output, "capture-receipt.json", { schemaVersion: 1, status: error ? "HOLD" : "CAPTURED_UNREVIEWED", request,
    atUtc: new Date().toISOString(), sourceBefore: before, sourceAfter: after,
    requestInputBefore, requestInputAfter, records, firstError: error });
  if (error) throw new Error(error);
  return output.path;
}
export async function hostedResultMain(args: string[]): Promise<void> {
  assert(args.length === 3 && ["capture", "review"].includes(args[0]), "Usage: capture request.json fresh-output | review capture-directory fresh-output");
  assert(Number(process.versions.node.split(".")[0]) === 22, "Locked Node22 reader required");
  if (args[0] === "capture") {
    const directory = await capture(args[1], args[2]); console.log(JSON.stringify({ status: "CAPTURED_UNREVIEWED", directory })); return;
  }
  const input = realpathSync(args[1]), output = reserveResultOutput(args[2], [sourceRoot, input]), before = sourceVector();
  const inputVector = () => readdirSync(input).sort().map(name => filePin(path.join(input, name), maxLog, true));
  const originalInputs = inputVector(); save(output, "original-input-before.json", originalInputs);
  let result: ReturnType<typeof verifySaved> | null = null, error: string | null = null;
  try { result = verifySaved(input); } catch { error = "saved-result-validation-hold"; }
  save(output, "original-readback-result.json", { atUtc: new Date().toISOString(), result, firstError: error });
  let after: ReturnType<typeof sourceVector> | null = null, inputAfter: ReturnType<typeof inputVector> | null = null;
  try { after = sourceVector(); inputAfter = inputVector(); assert.deepEqual(after, before);
    assert.deepEqual(inputAfter, originalInputs); } catch { error ??= "reader-source-or-input-postflight-hold"; }
  save(output, "receipt.json", { schemaVersion: 1, status: error ? "HOLD" : "VALIDATED_SAVED_RUN", firstError: error,
    atUtc: new Date().toISOString(), sourceBefore: before, sourceAfter: after, inputBefore: originalInputs, inputAfter, result });
  console.log(JSON.stringify({ status: error ? "HOLD" : "VALIDATED_SAVED_RUN", directory: output.path }));
  if (error) throw new Error(error);
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href)
  hostedResultMain(process.argv.slice(2)).catch(() => { console.error("Hosted result reader HOLD; inspect private original evidence."); process.exitCode = 1; });
