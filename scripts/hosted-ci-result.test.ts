import { describe, it, expect } from "vitest";
import { readFileSync, mkdtempSync, rmSync, mkdirSync, symlinkSync, renameSync, writeFileSync, statSync, realpathSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import AdmZip from "adm-zip";
import { hostedResultRequestSchema, hostedWorkflowContract, verifyHostedMetadata, coverageArtifacts,
  verifyArtifactBytes, verifyHostedCoverage, elapsedMilliseconds, repositoryLogSummary, commandLog,
  hashBytes, verifyCurrentChecks, hostedGetArgv, type HostedResultRequest } from "./hosted-ci-result";
import { decodeHistoricalZip } from "./ci-browser-duration-history-io";
import { ACCESSIBILITY_SWEEP_FILES } from "./ci-browser-balance";
import { STANDARD_CI_BROWSER_PROJECTS } from "./ci-browser-project-registry";
import { reserveResultOutput, captureHostedGet } from "./hosted-ci-result.run.mjs";

const require = createRequire(import.meta.url), localRequire = createRequire(require.resolve("eslint"));
const yaml = localRequire("js-yaml") as { load(value: string): unknown };
const contract = () => hostedWorkflowContract(yaml.load(readFileSync(".github/workflows/ci.yml", "utf8")));
const oid = (value: string) => value.repeat(40);
function request(): HostedResultRequest {
  return hostedResultRequestSchema.parse({ schemaVersion: 1, repository: "example/ci-fixture", runId: 123,
    runAttempt: 1, workflow: ".github/workflows/ci.yml", head: oid("a"), testedHead: oid("a"), tree: oid("d"), event: "push", branch: "main" });
}
function metadata(req = request()) {
  const source = contract(), run = { id: req.runId, run_attempt: req.runAttempt, head_sha: req.head,
    status: "completed", conclusion: "success", event: req.event, path: req.workflow,
    created_at: "2026-10-05T12:00:00Z", updated_at: "2026-10-05T12:02:01Z", repository: { full_name: req.repository } };
  const jobs = { total_count: source.names.length, jobs: source.jobs.flatMap(family => family.names.map((name, i) => ({
    id: source.names.indexOf(name) + 10, name, run_id: req.runId, run_attempt: req.runAttempt, head_sha: req.head,
    status: "completed", conclusion: "success", started_at: "2026-10-05T12:00:05Z", completed_at: "2026-10-05T12:02:00Z",
    steps: family.named.map((step, n) => ({ name: step, number: n + 1, status: "completed",
      conclusion: family.failureUploads.includes(step) ? "skipped" : "success" })), fixtureIndex: i,
  }))) };
  const commit = { sha: req.testedHead, tree: { sha: req.tree }, parents: [{ sha: oid("b") }, { sha: oid("c") }] };
  const context = { name: "main", commit: { sha: req.head } };
  return { source, run, jobs, commit, context };
}
function coverage() {
  const req = request(), cases = (i: number, project: string) => `${String(i).padStart(20, "0")}-${"0".repeat(20)}:${project}`;
  const groups = ACCESSIBILITY_SWEEP_FILES.map((file, i) => ({ file, project: "chromium", cases: [cases(i + 1, "chromium")], durationMs: 10 }));
  STANDARD_CI_BROWSER_PROJECTS.filter(project => project !== "chromium").forEach((project, i) => {
    groups.push({ file: `fixture-${project}.spec.ts`, project, cases: [cases(i + 20, project)], durationMs: 20 });
  });
  const fullCases = groups.flatMap(group => group.cases).sort(), fullFiles = groups.map(group => `e2e/${group.file}`).sort();
  const manifest = { head: req.testedHead, runId: String(req.runId), runAttempt: String(req.runAttempt),
    schemaVersion: 1, total: 6, cases: fullCases, files: fullFiles };
  const shards = Array.from({ length: 6 }, (_, index) => {
    const files = groups.filter((_, i) => i % 6 === index), selected = files.flatMap(file => file.cases).sort();
    return { head: req.testedHead, runId: String(req.runId), runAttempt: String(req.runAttempt), schemaVersion: 1,
      total: 6, index: index + 1, fullCases, fullFiles, assignedCases: selected, executedCases: selected,
      providerUploads: index === 0 ? 1 : 0, files, timings: { setupMs: 100, buildMs: 50, bootstrapMs: 30, browserMs: 40 } };
  });
  return { req, manifest, shards, tracked: fullFiles };
}
function artifactInventory() {
  const req = request(), prefix = `browser-case-${req.runAttempt}-`;
  return { total_count: 7, artifacts: ["manifest", ...Array.from({ length: 6 }, (_, i) => `shard-${i + 1}`)].map((suffix, i) => ({
    id: i + 1, name: prefix + suffix, size_in_bytes: 3, digest: `sha256:${hashBytes("abc")}`, expired: false,
    workflow_run: { id: req.runId, head_sha: req.head } })) };
}
function repositoryLog(unitCases = 9) {
  const header = (command: string) => `##[group]Run ${command}\n##[endgroup]\n`;
  const url = (name: string) => "http://localhost:3100" + (name === "landing" ? "/" : name === "overview" ? "/overview"
    : "/genome/me/reports/caffeine-metabolism-cyp1a2-rs762551?source=00000000-0000-4000-8000-000000000001");
  const rows = ["landing", "overview", "report"].flatMap(name => [1, 2, 3].map(run => JSON.stringify({ name, url: url(name), run,
    scores: { performance: 95, accessibility: 100 }, failures: [] })).concat(JSON.stringify({ name, url: url(name),
      aggregation: "median-of-three", scores: { performance: 95, accessibility: 100 } })));
  return header("pnpm test") + `Test Files 3 passed (3)\nTests ${unitCases} passed (${unitCases})\n`
    + header("pnpm exec supabase test db") + "All tests successful.\nFiles=2, Tests=17, 1 wallclock sec\nResult: PASS\n"
    + header("pnpm test:invitation-locks") + "4/4 independent-session lock checks passed.\n"
    + header("pnpm e2e:lighthouse") + rows.join("\n") + "\nLighthouse G1.14 passed: fixture\n";
}

describe("mandatory signed APT setup", () => {
  it("refuses missing, optional, reordered or altered admission and incomplete installs", () => {
    const source = () => yaml.load(readFileSync(".github/workflows/ci.yml", "utf8")) as {
      jobs: Record<string, { steps: { name?: string; run?: string; if?: string; "continue-on-error"?: boolean }[] }>
    };
    for (const family of ["repository-checks", "browser"]) {
      for (const mutation of ["missing", "conditional", "optional", "command", "order", "installer"]) {
        const changed = source(), steps = changed.jobs[family].steps;
        const index = steps.findIndex(item => item.name === "Admit signed Ubuntu APT mirror fallback");
        expect(index).toBeGreaterThanOrEqual(0);
        if (mutation === "missing") steps.splice(index, 1);
        if (mutation === "conditional") steps[index].if = "always()";
        if (mutation === "optional") steps[index]["continue-on-error"] = true;
        if (mutation === "command") steps[index].run += " || true";
        if (mutation === "order") [steps[index], steps[index + 1]] = [steps[index + 1], steps[index]];
        if (mutation === "installer") steps[index + 1].run = "pnpm exec playwright install chromium";
        expect(() => hostedWorkflowContract(changed)).toThrow();
      }
    }
  });
});

describe("source-bound hosted result readback", () => {
  it("refuses an unreviewed producer member or source step condition", () => {
    const source = () => yaml.load(readFileSync(".github/workflows/ci.yml", "utf8")) as {
      jobs: Record<string, { steps: { uses?: string; if?: string; with?: Record<string, unknown> }[] }> };
    const wrongMember = source();
    const producer = wrongMember.jobs["repository-checks"].steps.find(step => step.with?.name === "browser-case-${{ github.run_attempt }}-manifest");
    expect(producer).toBeDefined(); if (!producer?.with) throw new Error("Synthetic producer mutation did not reach its target");
    producer.with.path = "test-results/unknown.json";
    expect(() => hostedWorkflowContract(wrongMember)).toThrow();
    const wrongCondition = source(); wrongCondition.jobs["repository-checks"].steps[0].if = "cancelled()";
    expect(() => hostedWorkflowContract(wrongCondition)).toThrow();
  });
  it("accepts a two-parent main push and derives separate wall/API-update times", () => {
    const v = metadata(); const result = verifyHostedMetadata(request(), v.source, v.run, v.jobs, v.commit, v.context);
    expect(result.actualParents).toEqual([oid("b"), oid("c")]);
    expect(result.requiredJobWallMs).toBe(120000); expect(result.runApiUpdatedIntervalMs).toBe(121000);
  });
  it("accepts only the exact PR base/head relationship and current context", () => {
    const value: Record<string, unknown> = { ...request(), event: "pull_request",
      pullRequest: 7, base: oid("b"), head: oid("c"), testedHead: oid("a") }; delete value.branch;
    const req = hostedResultRequestSchema.parse(value); expect(req.event).toBe("pull_request");
    if (req.event !== "pull_request") throw new Error("Synthetic PR fixture shape differs");
    const v = metadata(req), context = { number: 7, state: "open", head: { sha: req.head }, base: { sha: req.base }, merge_commit_sha: req.testedHead };
    expect(verifyHostedMetadata(req, v.source, v.run, v.jobs, v.commit, context).actualParents).toEqual([req.base, req.head]);
    expect(() => verifyHostedMetadata(req, v.source, v.run, v.jobs, { ...v.commit, parents: v.commit.parents.slice(0, 1) }, context)).toThrow();
    expect(() => verifyHostedMetadata(req, v.source, v.run, v.jobs, v.commit, { ...context, head: { sha: oid("f") } })).toThrow();
  });
  it.each(["head", "run_attempt", "id"])("refuses stale run identity %s", field => {
    const v = metadata(), run = { ...v.run, [field]: field === "head" ? oid("e") : 99 };
    // API source is head_sha; use its actual key for this negative.
    if (field === "head") run.head_sha = oid("e");
    expect(() => verifyHostedMetadata(request(), v.source, run, v.jobs, v.commit, v.context)).toThrow();
  });
  it("refuses missing/duplicate jobs and skipped mandatory steps", () => {
    const v = metadata(); v.jobs.jobs.pop();
    expect(() => verifyHostedMetadata(request(), v.source, v.run, v.jobs, v.commit, v.context)).toThrow();
    const w = metadata(); w.jobs.jobs[1] = w.jobs.jobs[0];
    expect(() => verifyHostedMetadata(request(), w.source, w.run, w.jobs, w.commit, w.context)).toThrow();
    const x = metadata(); x.jobs.jobs[0].steps[0].conclusion = "skipped";
    expect(() => verifyHostedMetadata(request(), x.source, x.run, x.jobs, x.commit, x.context)).toThrow();
    const y = metadata(); y.jobs.jobs[0].steps = y.jobs.jobs[0].steps.filter(step => step.name !== "Run pnpm install --frozen-lockfile");
    expect(() => verifyHostedMetadata(request(), y.source, y.run, y.jobs, y.commit, y.context)).toThrow();
  });
  it("permits only source-declared failure-only upload skips", () => {
    const v = metadata(); expect(verifyHostedMetadata(request(), v.source, v.run, v.jobs, v.commit, v.context)).toBeDefined();
    v.jobs.jobs[0].steps.push({ name: "Unknown upload", number: 100, status: "completed", conclusion: "skipped" });
    expect(() => verifyHostedMetadata(request(), v.source, v.run, v.jobs, v.commit, v.context)).toThrow();
  });
  it("discovers exact producer members and refuses missing/foreign/mixed-attempt artifacts", () => {
    const v = artifactInventory(); expect(coverageArtifacts(request(), v).map(row => row.member)).toEqual([
      "ci-browser-manifest.json", ...Array(6).fill("ci-browser-shard.json")]);
    v.artifacts[1].name = "browser-case-1-foreign";
    expect(() => coverageArtifacts(request(), v)).toThrow();
    const w = artifactInventory(); w.artifacts[2].workflow_run.id = 999;
    expect(() => coverageArtifacts(request(), w)).toThrow();
  });
  it("binds API whole archive digest and size", () => {
    const artifact = artifactInventory().artifacts[0]; expect(() => verifyArtifactBytes(artifact, Buffer.from("abc"))).not.toThrow();
    expect(() => verifyArtifactBytes(artifact, Buffer.from("abd"))).toThrow();
    expect(() => verifyArtifactBytes(artifact, Buffer.from("abcd"))).toThrow();
  });
  it("refuses a foreign ZIP member and a QC sidecar without accepting its presence", () => {
    const zip = new AdmZip(); zip.addFile("foreign.json", Buffer.from("{}"));
    expect(() => decodeHistoricalZip(zip.toBuffer(), "ci-browser-manifest.json")).toThrow();
    const withSidecar = new AdmZip(); withSidecar.addFile("ci-browser-shard.json", Buffer.from("{}"));
    withSidecar.addFile("embryo-qc-seed.json", Buffer.from("{}"));
    expect(() => decodeHistoricalZip(withSidecar.toBuffer(), "ci-browser-shard.json")).toThrow();
  });
  it("refuses corrupt payload and central-only CRC records", () => {
    const zip = new AdmZip(); zip.addFile("ci-browser-manifest.json", Buffer.from('{"fixture":"synthetic"}'));
    const payload = zip.toBuffer(), local = payload.indexOf(Buffer.from([0x50, 0x4b, 0x03, 0x04]));
    const start = local + 30 + payload.readUInt16LE(local + 26) + payload.readUInt16LE(local + 28);
    payload[start] ^= 1; expect(() => decodeHistoricalZip(payload, "ci-browser-manifest.json")).toThrow();
    const central = zip.toBuffer(), at = central.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
    central.writeUInt32LE((central.readUInt32LE(at + 16) ^ 1) >>> 0, at + 16);
    expect(() => decodeHistoricalZip(central, "ci-browser-manifest.json")).toThrow();
  });
  it("derives all current cases and whole groups without a historical count constant", () => {
    const v = coverage(), result = verifyHostedCoverage(v.req, v.manifest, v.shards, v.tracked, null);
    expect(result.cases).toBe(v.manifest.cases.length); expect(result.wholeGroups).toBe(v.manifest.files.length);
    expect(result.sweeps).toHaveLength(ACCESSIBILITY_SWEEP_FILES.length);
  });
  it("refuses duplicate/missing cases, changed source census and profile identity", () => {
    const v = coverage(); v.shards[1].executedCases = v.shards[0].executedCases;
    expect(() => verifyHostedCoverage(v.req, v.manifest, v.shards, v.tracked, null)).toThrow();
    const w = coverage(); expect(() => verifyHostedCoverage(w.req, w.manifest, w.shards, w.tracked.slice(1), null)).toThrow();
    expect(() => verifyHostedCoverage(w.req, w.manifest, w.shards, w.tracked, "f".repeat(64))).toThrow();
  });
  it("uses exact timestamp offsets and refuses reversed time", () => {
    expect(elapsedMilliseconds("2026-10-05T12:00:00Z", "2026-10-05T14:00:00+02:00")).toBe(0);
    expect(() => elapsedMilliseconds("2026-10-05T12:00:01Z", "2026-10-05T12:00:00Z")).toThrow();
    expect(() => elapsedMilliseconds("unknown", "2026-10-05T12:00:00Z")).toThrow();
    const v = metadata(); v.jobs.jobs[0].started_at = "2026-10-04T12:00:00Z";
    expect(() => verifyHostedMetadata(request(), v.source, v.run, v.jobs, v.commit, v.context)).toThrow();
  });
  it("derives changed valid unit/database/lock counts from the original sections", () => {
    expect(repositoryLogSummary(repositoryLog(9)).unitCases).toBe(9);
    const larger = repositoryLogSummary(repositoryLog(17)); expect(larger.unitCases).toBe(17);
    expect(larger.databaseAssertions).toBe(17); expect(larger.independentLocks).toBe(4);
  });
  it("retains a valid slow Lighthouse sample while requiring its exact passing median", () => {
    const slow = repositoryLog().replace('"run":1,"scores":{"performance":95,"accessibility":100},"failures":[]',
      '"run":1,"scores":{"performance":80,"accessibility":100},"failures":["landing: performance below 90 or unavailable"]');
    expect(repositoryLogSummary(slow).lighthouseMedians[0].performance).toBe(95);
    expect(() => repositoryLogSummary(slow.replace("landing: performance below 90 or unavailable", "landing: unsuccessful document"))).toThrow();
  });
  it("refuses ambiguous/missing/failed/skipped unit summaries", () => {
    for (const text of [repositoryLog() + "##[group]Run pnpm test\nTests 9 passed (9)\n",
      repositoryLog().replace("Tests 9 passed (9)", "Tests 8 passed (9)"),
      repositoryLog().replace("Tests 9 passed (9)", "Tests 9 passed (9) 1 skipped"),
      repositoryLog().replace("Tests 9 passed (9)", "Tests 999999999999999999 passed (999999999999999999)"),
      repositoryLog().replace("Tests 9 passed (9)", "")]) expect(() => repositoryLogSummary(text)).toThrow();
    expect(() => commandLog("##[group]Run other\n", "pnpm test")).toThrow();
  });
  it("refuses incomplete database, locks and Lighthouse sample/median evidence", () => {
    for (const text of [repositoryLog().replace("Result: PASS", "Result: FAIL"),
      repositoryLog().replace("4/4 independent", "3/4 independent"),
      repositoryLog().replace('"run":2', '"run":1'),
      repositoryLog().replace('"accessibility":100', '"accessibility":99'),
      repositoryLog().replace("http://localhost:3100", "http://localhost:3101")]) expect(() => repositoryLogSummary(text)).toThrow();
  });
  it("accepts no-status API pending only when its actual status inventory is empty", () => {
    const checks = { total_count: 1, check_runs: [{ head_sha: oid("a"), status: "completed", conclusion: "success" }] };
    const req = request(), v = metadata(), proof = verifyHostedMetadata(req, v.source, v.run, v.jobs, v.commit, v.context);
    expect(() => verifyCurrentChecks(req, "head", proof, checks, { sha: oid("a"), state: "pending", total_count: 0, statuses: [] })).not.toThrow();
    expect(() => verifyCurrentChecks(req, "head", proof, checks, { sha: oid("a"), state: "pending", total_count: 1, statuses: [{ state: "success" }] })).toThrow();
  });
});

describe("request-bound check inventory roles", () => {
  function verifiedPr() {
    const raw: Record<string, unknown> = { ...request(), event: "pull_request", pullRequest: 7,
      base: oid("b"), head: oid("c"), testedHead: oid("a") }; delete raw.branch;
    const req = hostedResultRequestSchema.parse(raw); if (req.event !== "pull_request") throw new Error("PR fixture required");
    const v = metadata(req), context = { number: 7, state: "open", head: { sha: req.head }, base: { sha: req.base }, merge_commit_sha: req.testedHead };
    const proof = verifyHostedMetadata(req, v.source, v.run, v.jobs, v.commit, context);
    return { req, proof };
  }
  const empty = { total_count: 0, check_runs: [] };
  const noStatuses = (revision: string) => ({ sha: revision, state: "pending", total_count: 0, statuses: [] });
  it("accepts an empty tested PR merge inventory only after exact metadata and complete jobs pass", () => {
    const { req, proof } = verifiedPr();
    expect(() => verifyCurrentChecks(req, "tested", proof, empty, noStatuses(req.testedHead))).not.toThrow();
  });
  it("refuses an empty head inventory even for the same green PR", () => {
    const { req, proof } = verifiedPr();
    expect(() => verifyCurrentChecks(req, "head", proof, empty, noStatuses(req.head))).toThrow();
  });
  it("refuses empty push inventories for both explicit roles", () => {
    const req = request(), v = metadata(), proof = verifyHostedMetadata(req, v.source, v.run, v.jobs, v.commit, v.context);
    for (const role of ["head", "tested"] as const) expect(() => verifyCurrentChecks(req, role, proof, empty, noStatuses(req.head))).toThrow();
  });
  it("refuses a changed request, parent relationship or incomplete verified-job set", () => {
    const { req, proof } = verifiedPr();
    expect(() => verifyCurrentChecks({ ...req, base: oid("e") }, "tested", proof, empty, noStatuses(req.testedHead))).toThrow();
    expect(() => verifyCurrentChecks(req, "tested", { ...proof, actualParents: [req.head, req.base] }, empty, noStatuses(req.testedHead))).toThrow();
    expect(() => verifyCurrentChecks(req, "tested", { ...proof, jobs: proof.jobs.slice(1) }, empty, noStatuses(req.testedHead))).toThrow();
    const sameHead = { ...req, testedHead: req.head };
    expect(() => verifyCurrentChecks(sameHead, "tested", { ...proof, verifiedRequest: sameHead }, empty, noStatuses(req.head))).toThrow();
    const push = request();
    expect(() => verifyCurrentChecks(push, "tested", proof, empty, noStatuses(push.testedHead))).toThrow();
  });
  it("refuses nonzero missing checks and foreign role revisions or statuses", () => {
    const { req, proof } = verifiedPr();
    expect(() => verifyCurrentChecks(req, "tested", proof, { total_count: 1, check_runs: [] }, noStatuses(req.testedHead))).toThrow();
    const headChecks = { total_count: 1, check_runs: [{ head_sha: req.head, status: "completed", conclusion: "success" }] };
    expect(() => verifyCurrentChecks(req, "tested", proof, headChecks, noStatuses(req.testedHead))).toThrow();
    expect(() => verifyCurrentChecks(req, "tested", proof, empty, noStatuses(req.head))).toThrow();
    expect(() => Reflect.apply(verifyCurrentChecks, undefined, [req, "foreign", proof, empty, noStatuses(req.testedHead)])).toThrow();
  });
});

describe("raw job-log GET argv", () => {
  it("preserves terminal bytes only on the exact derived positive-ID log route", () => {
    const route = "repos/example/ci-fixture/actions/jobs/42/logs";
    expect(hostedGetArgv(route)).toEqual(["gh", "api", "--method", "GET", "-H", "X-GitHub-Api-Version: 2022-11-28",
      "--allow-escape-sequences", route]);
  });
  it("keeps JSON and coverage ZIP routes unchanged", () => {
    for (const route of ["repos/example/ci-fixture/actions/runs/123/attempts/1/jobs?per_page=100",
      "repos/example/ci-fixture/actions/artifacts/42/zip"])
      expect(hostedGetArgv(route)).toEqual(["gh", "api", "--method", "GET", "-H", "X-GitHub-Api-Version: 2022-11-28", route]);
  });
  it("refuses malformed or widened job-log routes and control characters", () => {
    for (const suffix of ["0/logs", "-1/logs", "42/logs?raw=1", "42/logs/extra", "999999999999999999/logs", "42"])
      expect(() => hostedGetArgv("repos/example/ci-fixture/actions/jobs/" + suffix)).toThrow();
    expect(() => hostedGetArgv("repos/example/ci-fixture/actions/artifacts/42/zip\n")).toThrow();
  });
});

describe("private evidence output ownership", () => {
  function withDirectory(run: (root: string) => void) {
    const root = mkdtempSync(path.join(realpathSync(os.tmpdir()), "hosted-result-fixture-"));
    try { run(root); } finally { rmSync(root, { recursive: true, force: true }); }
  }
  it("creates a fresh private reservation and refuses reuse", () => withDirectory(root => {
    const output = reserveResultOutput(path.join(root, "output"), []); output.check();
    expect(statSync(output.path).mode & 0o777).toBe(0o700);
    expect(() => reserveResultOutput(output.path, [])).toThrow();
  }));
  it("refuses a symlink parent and containment in protected evidence", () => withDirectory(root => {
    mkdirSync(path.join(root, "input")); symlinkSync(path.join(root, "input"), path.join(root, "alias"));
    expect(() => reserveResultOutput(path.join(root, "alias", "output"), [])).toThrow();
    expect(() => reserveResultOutput(path.join(root, "input", "output"), [path.join(root, "input")])).toThrow();
  }));
  it("refuses a changed reserved output identity", () => withDirectory(root => {
    const output = reserveResultOutput(path.join(root, "output"), []);
    renameSync(output.path, path.join(root, "old")); mkdirSync(output.path, { mode: 0o700 });
    expect(() => output.check()).toThrow();
  }));
  it("refuses a replaced protected input even when its bytes are identical", () => withDirectory(root => {
    const input = path.join(root, "input.json"); writeFileSync(input, "synthetic");
    const output = reserveResultOutput(path.join(root, "output"), [input]);
    renameSync(input, path.join(root, "old.json")); writeFileSync(input, "synthetic");
    expect(() => output.check()).toThrow();
  }));
  it("retains an original failed owned command before its raw readback and refusal", async () => {
    const root = mkdtempSync(path.join(realpathSync(os.tmpdir()), "hosted-result-command-fixture-")), oldPath = process.env.PATH;
    try {
      mkdirSync(path.join(root, "bin"));
      // An actual local Node child receives a nonexistent script argument. No GitHub client or request runs.
      symlinkSync(process.execPath, path.join(root, "bin", "gh")); process.env.PATH = path.join(root, "bin");
      const output = reserveResultOutput(path.join(root, "output"), []);
      await expect(captureHostedGet(output, "fixture", "repos/example/ci-fixture", 1024 * 1024)).rejects.toThrow();
      const original = JSON.parse(readFileSync(path.join(output.path, "fixture.original-command.json"), "utf8"));
      const readback = JSON.parse(readFileSync(path.join(output.path, "fixture.raw-readback.json"), "utf8"));
      expect(original.exitCode).toBe(1); expect(original.groupAbsent).toBe(true); expect(original.rawReadbackPending).toBe(true);
      expect(original.timedOut).toBe(false); expect(readback.errors).toEqual([]);
      expect(readback.stdout.bytes).toBe(0); expect(readback.stderr.bytes).toBeGreaterThan(0);
      expect(original.rawIdentities.stderr.mtimeMs).toBeLessThanOrEqual(statSync(path.join(output.path, "fixture.original-command.json")).mtimeMs);
      expect(statSync(path.join(output.path, "fixture.original-command.json")).mtimeMs)
        .toBeLessThanOrEqual(statSync(path.join(output.path, "fixture.raw-readback.json")).mtimeMs);
      expect(readback.stderr.sha256).toBe(hashBytes(readFileSync(path.join(output.path, "fixture.stderr"))));
    } finally {
      if (oldPath === undefined) delete process.env.PATH; else process.env.PATH = oldPath;
      rmSync(root, { recursive: true, force: true });
    }
  });
});
