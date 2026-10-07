/** Saved hosted results only. No CI environment, browser, database or transport. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { z } from "zod";
import { CI_BROWSER_SHARDS, verifyBrowserShards, verifyBrowserSourceCensus,
  type CiBrowserManifest, type CiBrowserShardReceipt } from "./ci-browser-shards";
import { verifyAccessibilitySweepPlacement } from "./ci-browser-balance";
import { verifyBrowserQueueIsolation } from "./ci-browser-queue-isolation";
import { STANDARD_CI_BROWSER_PROJECTS } from "./ci-browser-project-registry";
import { REPORT_SLUG, RUNS, THRESHOLDS } from "./lighthouse-contract.mjs";

const sha = z.string().regex(/^[0-9a-f]{40}$/);
const id = z.number().int().positive().safe();
const common = { schemaVersion: z.literal(1), repository: z.string().regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/),
  runId: id, runAttempt: id, workflow: z.literal(".github/workflows/ci.yml"),
  head: sha, testedHead: sha, tree: sha };
export const hostedResultRequestSchema = z.discriminatedUnion("event", [
  z.object({ ...common, event: z.literal("push"), branch: z.literal("main") }).strict(),
  z.object({ ...common, event: z.literal("pull_request"), pullRequest: id, base: sha }).strict(),
]);
export type HostedResultRequest = z.infer<typeof hostedResultRequestSchema>;
/** Raw log bytes go only to owned private FDs. JSON and ZIP routes keep their exact argv. */
export function hostedGetArgv(route: string): string[] {
  assert(typeof route === "string" && route.startsWith("repos/") && !route.includes("\r") && !route.includes("\n")
    && !route.includes(String.fromCharCode(0)), "Invalid GET route");
  const argv = ["gh", "api", "--method", "GET", "-H", "X-GitHub-Api-Version: 2022-11-28"];
  if (route.includes("/actions/jobs/")) {
    const log = /^repos\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/actions\/jobs\/([1-9][0-9]*)\/logs$/.exec(route);
    assert(log && Number.isSafeInteger(Number(log[1])), "Only an exact positive-ID job-log route admits raw terminal bytes");
    argv.push("--allow-escape-sequences");
  }
  return [...argv, route];
}
export const hashBytes = (value: Uint8Array | string) => createHash("sha256").update(value).digest("hex");
const unique = (values: (string | number)[], message: string) => {
  assert(values.length > 0 && new Set(values).size === values.length, message);
};
const same = (actual: string[], expected: string[], message: string) => {
  unique(actual, message); unique(expected, message); assert.deepEqual([...actual].sort(), [...expected].sort(), message);
};

const step = z.object({ name: z.string().optional(), if: z.string().optional(), uses: z.string().optional(),
  run: z.string().optional(), "continue-on-error": z.boolean().optional(), with: z.record(z.string(), z.unknown()).optional() });
const workflowJob = z.object({ steps: z.array(step).min(1), strategy: z.object({
  matrix: z.object({ shard: z.array(id) }) }).optional() });
export type HostedWorkflowContract = ReturnType<typeof hostedWorkflowContract>;
/** Only the existing job family and producer format. New shapes require review. */
export function hostedWorkflowContract(value: unknown) {
  const workflow = z.object({ jobs: z.record(z.string(), workflowJob) }).parse(value);
  same(Object.keys(workflow.jobs), ["repository-checks", "browser", "checks"], "Unsupported workflow job family");
  assert.deepEqual(workflow.jobs.browser.strategy?.matrix.shard,
    Array.from({ length: CI_BROWSER_SHARDS }, (_, i) => i + 1), "Unsupported browser matrix");
  for (const family of ["repository-checks", "browser"]) {
    const steps = workflow.jobs[family].steps;
    const admission = steps.filter(item => item.name === "Admit signed Ubuntu APT mirror fallback");
    assert(admission.length === 1 && admission[0].if === undefined
      && admission[0]["continue-on-error"] !== true && admission[0].uses === undefined
      && admission[0].run === 'sudo -- python3 scripts/ci_apt_mirror_priority.py "$ImageOS" "$ImageVersion" "$GITHUB_ACTIONS" "$RUNNER_ENVIRONMENT"',
    "Mandatory exact Ubuntu APT admission differs");
    const installer = steps.filter(item => item.name === "Install Playwright Chromium");
    assert(installer.length === 1 && installer[0].if === undefined && installer[0]["continue-on-error"] !== true
      && installer[0].run === "pnpm exec playwright install --with-deps chromium"
      && steps.indexOf(admission[0]) < steps.indexOf(installer[0]), "Complete mandatory installer differs");
  }
  const jobs = Object.entries(workflow.jobs).map(([family, job]) => {
    const named = job.steps.map(item => item.name ?? `Run ${item.uses ?? item.run?.split("\n")[0]}`);
    unique(named, "Duplicate source step name");
    const failureUploads: string[] = [];
    for (const item of job.steps) {
      assert((item.run === undefined) !== (item.uses === undefined), "Each source step needs one run or action");
      assert(item.if === undefined || item.if === "always()" || item.if === "failure()", "Unsupported step condition");
      if (item.if === "failure()") {
        assert(item.name && item.uses === "actions/upload-artifact@v4" && !item.run,
          "Only a named failure-only artifact upload may be skipped");
        failureUploads.push(item.name);
      }
    }
    return { family, names: family === "browser"
      ? Array.from({ length: CI_BROWSER_SHARDS }, (_, i) => `browser (${i + 1})`) : [family], named, failureUploads };
  });
  const producer = (family: string, name: string, member: string) => {
    const matches = workflow.jobs[family].steps.filter(item => item.uses === "actions/upload-artifact@v4"
      && item.with?.name === name);
    assert(matches.length === 1 && matches[0].with?.path === `test-results/${member}`
      && matches[0].with?.["if-no-files-found"] === "error", "Unsupported coverage artifact producer");
  };
  producer("repository-checks", "browser-case-${{ github.run_attempt }}-manifest", "ci-browser-manifest.json");
  producer("browser", "browser-case-${{ github.run_attempt }}-shard-${{ matrix.shard }}", "ci-browser-shard.json");
  return { jobs, names: jobs.flatMap(job => job.names) };
}

const time = z.string().refine(value => /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$/.test(value)
  && Number.isFinite(Date.parse(value)), "Invalid explicit UTC-offset time");
export function elapsedMilliseconds(start: string, finish: string): number {
  const elapsed = Date.parse(time.parse(finish)) - Date.parse(time.parse(start));
  assert(Number.isSafeInteger(elapsed) && elapsed >= 0, "Reversed or invalid timestamps"); return elapsed;
}
const runSchema = z.object({ id, run_attempt: id, head_sha: sha, status: z.literal("completed"),
  conclusion: z.literal("success"), event: z.enum(["push", "pull_request"]), path: z.literal(".github/workflows/ci.yml"),
  created_at: time, updated_at: time, repository: z.object({ full_name: z.string() }) });
const jobSchema = z.object({ id, name: z.string(), run_id: id, run_attempt: id, head_sha: sha,
  status: z.literal("completed"), conclusion: z.literal("success"), started_at: time, completed_at: time,
  steps: z.array(z.object({ name: z.string(), number: id, status: z.literal("completed"),
    conclusion: z.enum(["success", "skipped"]) })).min(1) });
export function verifyHostedMetadata(request: HostedResultRequest, contract: HostedWorkflowContract,
  rawRun: unknown, rawJobs: unknown, rawCommit: unknown, rawCurrentContext: unknown) {
  const run = runSchema.parse(rawRun), jobs = z.object({ total_count: id, jobs: z.array(jobSchema) }).parse(rawJobs);
  const commit = z.object({ sha, tree: z.object({ sha }), parents: z.array(z.object({ sha })) }).parse(rawCommit);
  assert(run.id === request.runId && run.run_attempt === request.runAttempt && run.head_sha === request.head
    && run.event === request.event && run.path === request.workflow
    && run.repository.full_name.toLowerCase() === request.repository.toLowerCase(), "Run identity differs");
  assert(commit.sha === request.testedHead && commit.tree.sha === request.tree, "Tested source tree differs");
  if (request.event === "pull_request") {
    const pr = z.object({ number: id, state: z.literal("open"), head: z.object({ sha }), base: z.object({ sha }),
      merge_commit_sha: sha }).parse(rawCurrentContext);
    assert(pr.number === request.pullRequest && pr.head.sha === request.head && pr.base.sha === request.base
      && pr.merge_commit_sha === request.testedHead, "Current PR identity differs");
    assert.deepEqual(commit.parents.map(parent => parent.sha), [request.base, request.head], "PR merge parents differ");
  } else {
    const branch = z.object({ name: z.literal("main"), commit: z.object({ sha }) }).parse(rawCurrentContext);
    assert(request.head === request.testedHead && branch.commit.sha === request.head, "Current push identity differs");
    // A merge pushed to main has multiple parents. No global one-parent rule.
  }
  assert(jobs.total_count === jobs.jobs.length, "Incomplete job page");
  same(jobs.jobs.map(job => job.name), contract.names, "Missing, duplicate or foreign required job");
  unique(jobs.jobs.map(job => job.id), "Duplicate job ID");
  for (const job of jobs.jobs) {
    assert(job.run_id === run.id && job.run_attempt === run.run_attempt && job.head_sha === run.head_sha,
      "Job source/run/attempt differs");
    const source = contract.jobs.find(item => item.names.includes(job.name)); assert(source);
    unique(job.steps.map(item => item.number), "Duplicate step number");
    for (const name of source.named) assert(job.steps.filter(item => item.name === name).length === 1,
      "A source-declared step is missing or duplicated");
    for (const item of job.steps) assert(item.conclusion === "success"
      || item.conclusion === "skipped" && source.failureUploads.includes(item.name), "Mandatory step did not succeed");
    elapsedMilliseconds(job.started_at, job.completed_at);
    assert(Date.parse(job.started_at) >= Date.parse(run.created_at) && Date.parse(job.completed_at) <= Date.parse(run.updated_at),
      "Job timing lies outside its run");
  }
  const lastCompleted = jobs.jobs.map(job => job.completed_at).sort((a, b) => Date.parse(b) - Date.parse(a))[0];
  return { verifiedRequest: hostedResultRequestSchema.parse(request), run, jobs: jobs.jobs, actualParents: commit.parents.map(parent => parent.sha),
    requiredJobWallMs: elapsedMilliseconds(run.created_at, lastCompleted),
    runApiUpdatedIntervalMs: elapsedMilliseconds(run.created_at, run.updated_at), lastRequiredJobCompletedAt: lastCompleted };
}
const artifactSchema = z.object({ id, name: z.string(), size_in_bytes: id, digest: z.string().regex(/^sha256:[0-9a-f]{64}$/),
  expired: z.boolean(), workflow_run: z.object({ id, head_sha: sha }) });
export function coverageArtifacts(request: HostedResultRequest, value: unknown) {
  const inventory = z.object({ total_count: z.number().int().nonnegative(), artifacts: z.array(artifactSchema) }).parse(value);
  assert(inventory.total_count === inventory.artifacts.length, "Incomplete artifact page");
  const prefix = `browser-case-${request.runAttempt}-`, names = [`${prefix}manifest`,
    ...Array.from({ length: CI_BROWSER_SHARDS }, (_, i) => `${prefix}shard-${i + 1}`)];
  const selected = inventory.artifacts.filter(item => item.name.startsWith(prefix));
  same(selected.map(item => item.name), names, "Complete same-attempt coverage artifacts required");
  unique(selected.map(item => item.id), "Duplicate artifact ID");
  for (const item of selected) assert(!item.expired && item.workflow_run.id === request.runId
    && item.workflow_run.head_sha === request.head, "Artifact API identity differs");
  return names.map(name => {
    const artifact = selected.find(item => item.name === name)!;
    return { ...artifact, member: name.endsWith("manifest") ? "ci-browser-manifest.json" as const : "ci-browser-shard.json" as const };
  });
}
export function verifyArtifactBytes(artifact: { size_in_bytes: number; digest: string }, bytes: Buffer): void {
  assert(bytes.length === artifact.size_in_bytes && artifact.digest === `sha256:${hashBytes(bytes)}`,
    "Archive differs from original API digest/size");
}
export function verifyHostedCoverage(request: HostedResultRequest, manifestValue: unknown, shardValues: unknown[],
  trackedSpecs: string[], profileSha256: string | null) {
  const identity = { head: request.testedHead, runId: String(request.runId), runAttempt: String(request.runAttempt) };
  const count = verifyBrowserShards(manifestValue, shardValues, identity);
  // Existing closed schemas have already checked every field above.
  const manifest = manifestValue as CiBrowserManifest, shards = shardValues as CiBrowserShardReceipt[];
  verifyBrowserSourceCensus(manifest.files, trackedSpecs);
  same([...new Set(manifest.cases.map(value => value.split(":")[1]))], [...STANDARD_CI_BROWSER_PROJECTS],
    "Complete current browser project set differs");
  assert.equal(manifest.allocation?.profileSha256 ?? null, profileSha256, "Committed selected profile differs");
  const sweeps = verifyAccessibilitySweepPlacement(shards); verifyBrowserQueueIsolation(shards);
  return { cases: count, ordinaryFiles: manifest.files.length, wholeGroups: shards.reduce((n, item) => n + item.files.length, 0),
    assignments: [...shards].sort((a, b) => a.index - b.index).map(item => item.executedCases.length),
    providerUploads: shards.reduce((n, item) => n + item.providerUploads, 0), sweeps,
    allocation: manifest.allocation ?? null,
    timings: [...shards].sort((a, b) => a.index - b.index).map(item => ({ index: item.index, ...item.timings })),
    // Summed test durations are deliberately separate from job/body wall time.
    summedCaseDurationMs: shards.reduce((n, item) => n + item.files.reduce((s, file) => s + file.durationMs, 0), 0) };
}

export function commandLog(raw: string, command: string): string {
  const ansi = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");
  const text = raw.replace(ansi, "").replace(/^\d{4}-\d\d-\d\dT\S+\s/gm, "");
  const lines = text.split("\n"), starts = lines.flatMap((line, i) => line === `##[group]Run ${command}` ? [i] : []);
  assert(starts.length === 1, "Missing or ambiguous original command log");
  const next = lines.findIndex((line, i) => i > starts[0] && line.startsWith("##[group]"));
  return lines.slice(starts[0], next === -1 ? undefined : next).join("\n");
}
function single(text: string, expression: RegExp, message: string): RegExpMatchArray {
  const matches = [...text.matchAll(expression)]; assert(matches.length === 1, message); return matches[0];
}
export function repositoryLogSummary(raw: string) {
  const unit = commandLog(raw, "pnpm test"), db = commandLog(raw, "pnpm exec supabase test db"),
    locks = commandLog(raw, "pnpm test:invitation-locks"), lighthouse = commandLog(raw, "pnpm e2e:lighthouse");
  const files = single(unit, /Test Files\s+(\d+) passed \((\d+)\)/g, "Ambiguous unit file summary"),
    cases = single(unit, /(?:^|\n)\s*Tests\s+(\d+) passed \((\d+)\)/g, "Ambiguous unit case summary");
  assert(files[1] === files[2] && cases[1] === cases[2] && Number(files[1]) > 0 && Number(cases[1]) > 0
    && !/\d+ (?:failed|skipped|todo)/i.test(unit), "Unit failures/skips or incomplete summary");
  const database = single(db, /Files=(\d+), Tests=(\d+),/g, "Ambiguous database summary"),
    lock = single(locks, /(\d+)\/(\d+) independent-session lock checks passed\./g, "Ambiguous lock summary");
  assert(db.includes("All tests successful.") && /^Result: PASS$/m.test(db) && !/#\s*(?:SKIP|TODO)\b/i.test(db)
    && Number(database[1]) > 0 && Number(database[2]) > 0
    && lock[1] === lock[2] && Number(lock[1]) > 0, "Database/lock result is not complete PASS");
  assert([files[1], cases[1], database[1], database[2], lock[1]].every(value => Number.isSafeInteger(Number(value)) && Number(value) > 0),
    "Summary count is outside its safe integer range");
  const rows = lighthouse.split("\n").filter(line => line.startsWith('{"name":')).map(line => JSON.parse(line) as unknown);
  const scores = z.object({ performance: z.number().finite().min(0).max(100), accessibility: z.literal(100) }).strict();
  const samples = rows.filter(row => typeof row === "object" && row !== null && "run" in row).map(row =>
    z.object({ name: z.enum(["landing", "overview", "report"]), url: z.string(), run: z.number().int().min(1).max(RUNS),
      scores, failures: z.array(z.string()) }).strict().parse(row));
  const medians = rows.filter(row => typeof row === "object" && row !== null && "aggregation" in row).map(row =>
    z.object({ name: z.enum(["landing", "overview", "report"]), url: z.string(), aggregation: z.literal("median-of-three"), scores }).strict().parse(row));
  assert(rows.length === samples.length + medians.length, "Unknown Lighthouse result shape");
  const names = ["landing", "overview", "report"];
  same(samples.map(row => `${row.name}:${row.run}`), names.flatMap(name => Array.from({ length: RUNS }, (_, i) => `${name}:${i + 1}`)),
    "Incomplete Lighthouse samples");
  same(medians.map(row => row.name), ["landing", "overview", "report"], "Incomplete Lighthouse medians");
  for (const row of samples) assert.deepEqual(row.failures,
    row.scores.performance < THRESHOLDS.performance * 100
      ? [`${row.name}: performance below ${THRESHOLDS.performance * 100} or unavailable`] : [],
    "Lighthouse sample contains a non-median failure");
  for (const row of [...samples, ...medians]) {
    const url = new URL(row.url);
    assert(url.origin === "http://localhost:3100" && !url.hash && !url.username && !url.password, "Lighthouse target differs");
    const expectedPath = row.name === "landing" ? "/" : row.name === "overview" ? "/overview" : `/genome/me/reports/${REPORT_SLUG}`;
    assert(url.pathname === expectedPath, "Lighthouse route differs");
    if (row.name === "report") assert([...url.searchParams.keys()].join(",") === "source"
      && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(url.searchParams.get("source") ?? ""),
    "Lighthouse report source is not the fixture UUID");
    else assert(url.search === "", "Unexpected Lighthouse query");
  }
  for (const row of medians) {
    const matching = samples.filter(sample => sample.name === row.name);
    assert(matching.every(sample => sample.url === row.url), "Lighthouse samples used different targets");
    const actual = matching.map(sample => sample.scores.performance).sort((a, b) => a - b)[Math.floor(RUNS / 2)];
    assert(actual === row.scores.performance && actual >= THRESHOLDS.performance * 100, "Lighthouse median or threshold differs");
  }
  assert(lighthouse.includes("Lighthouse G1.14 passed:"), "Lighthouse terminal signal missing");
  return { unitFiles: Number(files[1]), unitCases: Number(cases[1]), databaseFiles: Number(database[1]),
    databaseAssertions: Number(database[2]), independentLocks: Number(lock[1]), lighthouseMedians: medians.map(row =>
      ({ name: row.name, performance: row.scores.performance, accessibility: row.scores.accessibility })) };
}

export function verifyCurrentChecks(request: HostedResultRequest, role: "head" | "tested",
  metadata: ReturnType<typeof verifyHostedMetadata>, checks: unknown, statuses: unknown): void {
  const current = hostedResultRequestSchema.parse(request);
  assert(role === "head" || role === "tested", "Unknown check inventory role");
  assert.deepEqual(metadata.verifiedRequest, current, "Check role is not bound to the verified metadata request");
  assert(metadata.run.id === current.runId && metadata.run.run_attempt === current.runAttempt
    && metadata.run.head_sha === current.head && metadata.run.event === current.event, "Check metadata source differs");
  same(metadata.jobs.map(job => job.name), ["repository-checks", "checks",
    ...Array.from({ length: CI_BROWSER_SHARDS }, (_, i) => `browser (${i + 1})`)], "Complete verified CI jobs required");
  assert(metadata.jobs.every(job => job.status === "completed" && job.conclusion === "success"
    && job.run_id === current.runId && job.run_attempt === current.runAttempt && job.head_sha === current.head), "Check metadata jobs differ");
  if (current.event === "pull_request") assert.deepEqual(metadata.actualParents, [current.base, current.head], "Check PR relationship differs");
  const revision = role === "head" ? current.head : current.testedHead;
  const mayHaveNoChecks = current.event === "pull_request" && role === "tested" && current.head !== current.testedHead;
  const runs = z.object({ total_count: z.number().int().nonnegative().safe(), check_runs: z.array(z.object({ head_sha: sha, status: z.literal("completed"),
    conclusion: z.literal("success") })) }).parse(checks);
  const combined = z.object({ sha, state: z.enum(["success", "pending"]), total_count: z.number().int().nonnegative(),
    statuses: z.array(z.object({ state: z.literal("success") })) }).parse(statuses);
  assert(runs.total_count === runs.check_runs.length && runs.check_runs.every(row => row.head_sha === revision)
    && (runs.total_count > 0 || mayHaveNoChecks)
    && combined.sha === revision && combined.total_count === combined.statuses.length
    && (combined.total_count === 0 || combined.state === "success"), "Incomplete or wrong-source current checks");
}
