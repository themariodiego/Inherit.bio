import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { browserManifest, browserReportCases, browserShardReceipt, ciBrowserShard, verifyBrowserShards, verifyBrowserSourceCensus } from "./ci-browser-shards";

const source = { head: "a".repeat(40), runId: "12345", runAttempt: "2" };
const projects = ["chromium", "jurisdiction-off", "copilot-local", "prepared-source", "embryo-ingest"];
function id(n: number) { return `${n.toString(16).padStart(20, "0")}-${n.toString(16).padStart(20, "0")}`; }
const tracked = [1,2,3,4,5,6].map(n => `e2e/synthetic-${n}.spec.ts`);
const timings = { setupMs: 100, buildMs: 200, bootstrapMs: 300, browserMs: 400 };
function report(cases: number[], shard: number | null = null, executed = false) {
  return { config: { workers: 1, fullyParallel: false, shard: shard === null ? null : { current: shard, total: 6 },
    projects: projects.map(name => ({ name, retries: 0, repeatEach: 1 })), webServer: { env: { PRIVATE_FIXTURE: "must not be copied" } } },
  suites: [{ suites: [{ specs: cases.map(n => ({ id: id(n), file: `synthetic-${n}.spec.ts`, tests: [{ projectName: projects[(n-1)%projects.length], expectedStatus: "passed",
    results: executed ? [{ status: "passed", retry: 0, duration: 10, stdout: ["private fixture"], attachments: ["private fixture"] }] : [] }] })) }] }],
  errors: [], stats: { expected: executed ? cases.length : 0,
    unexpected: 0, flaky: 0, skipped: executed ? 0 : cases.length } };
}
function evidence() {
  const full = report([1, 2, 3, 4, 5, 6]);
  return { manifest: browserManifest(full, source, tracked), receipts: [1, 2, 3, 4, 5, 6].map(index =>
    browserShardReceipt(full, report([index], index), report([index], index, true), source, index, index, timings, tracked)) };
}
describe("mandatory browser coverage across isolated jobs", () => {
  it("requires the real native listing statistics and refuses declared skips or discovery executions", () => {
    const cases = [1, 2, 3, 4, 5, 6];
    expect(browserReportCases(report(cases), null, false)).toHaveLength(6);
    for (const stats of [{ expected: 0, skipped: 0 }, { expected: 0, skipped: 5 },
      { expected: 1, skipped: 6 }]) {
      const value = report(cases); Object.assign(value.stats, stats);
      expect(() => browserReportCases(value, null, false)).toThrow();
    }
    const skipped = report(cases);
    Object.assign(skipped.suites[0].suites[0].specs[0].tests[0], { expectedStatus: "skipped" });
    expect(() => browserReportCases(skipped, null, false)).toThrow();
    expect(() => browserReportCases(report(cases, null, true), null, false)).toThrow();
  });
  it("requires exact native passed-result counts and zero skipped executions", () => {
    expect(browserReportCases(report([1], 1, true), 1, true)).toHaveLength(1);
    for (const stats of [{ expected: 0, skipped: 0 }, { expected: 2, skipped: 0 },
      { expected: 1, skipped: 1 }]) {
      const value = report([1], 1, true); Object.assign(value.stats, stats);
      expect(() => browserReportCases(value, 1, true)).toThrow();
    }
  });
  it("accepts exactly-once complete discovery/execution and copies no raw configuration or private evidence", () => {
    const { manifest, receipts } = evidence();
    expect(verifyBrowserShards(manifest, receipts, source)).toBe(6);
    const serialized = JSON.stringify({ manifest, receipts });
    expect(serialized).not.toMatch(/PRIVATE_FIXTURE|private fixture|webServer|stdout|attachments/);
  });
  it("refuses a missing, duplicate, empty or extra shard receipt", () => {
    const { manifest, receipts } = evidence();
    for (const values of [[], receipts.slice(1), [...receipts, receipts[0]], [...receipts.slice(1), receipts[1]]])
      expect(() => verifyBrowserShards(manifest, values, source)).toThrow();
  });
  it("refuses foreign commit, prior run and stale rerun evidence", () => {
    for (const change of [{ head: "b".repeat(40) }, { runId: "12346" }, { runAttempt: "1" }]) {
      const { manifest, receipts } = evidence();
      expect(() => verifyBrowserShards(manifest, [{ ...receipts[0], ...change }, ...receipts.slice(1)], source)).toThrow();
      expect(() => verifyBrowserShards({ ...manifest, ...change }, receipts, source)).toThrow();
    }
  });
  it("refuses drifted full manifests and missing or duplicate cross-shard cases", () => {
    const { manifest, receipts } = evidence();
    expect(() => verifyBrowserShards(manifest, [{ ...receipts[0], fullCases: receipts[0].fullCases.slice(1) }, ...receipts.slice(1)], source)).toThrow();
    const duplicate = { ...receipts[1], assignedCases: receipts[0].assignedCases, executedCases: receipts[0].executedCases };
    expect(() => verifyBrowserShards(manifest, [receipts[0], duplicate, ...receipts.slice(2)], source)).toThrow();
    expect(() => verifyBrowserShards({ ...manifest, cases: manifest.cases.slice(1) }, receipts, source)).toThrow();
  });
  it("refuses skipped, retried, failed, interrupted, unexecuted and multiply executed cases", () => {
    for (const results of [[], [{ status: "skipped", retry: 0 }], [{ status: "failed", retry: 0 }],
      [{ status: "interrupted", retry: 0 }], [{ status: "passed", retry: 1 }],
      [{ status: "passed", retry: 0 }, { status: "passed", retry: 0 }]]) {
      const value = report([1], 1, true);
      Object.assign(value.suites[0].suites[0].specs[0].tests[0], { results });
      expect(() => browserReportCases(value, 1, true)).toThrow();
    }
  });
  it("refuses global errors, omitted projects, parallel/shared DB workers and retry settings", () => {
    for (const mutate of [(r: ReturnType<typeof report>) => { r.config.workers = 2; },
      (r: ReturnType<typeof report>) => { r.config.fullyParallel = true; },
      (r: ReturnType<typeof report>) => { r.config.projects.pop(); },
      (r: ReturnType<typeof report>) => { r.config.projects[0].retries = 1; },
      (r: ReturnType<typeof report>) => { r.config.projects[0].repeatEach = 2; },
      (r: ReturnType<typeof report>) => { Object.assign(r, { errors: [{}] }); }]) {
      const value = report([1], 1, true); mutate(value);
      expect(() => browserReportCases(value, 1, true)).toThrow();
    }
  });
  it("refuses narrowed, mismatched or additional executed cases and negative provider receipt", () => {
    const full = report([1, 2, 3, 4, 5, 6]);
    for (const executed of [report([2], 1, true), report([1, 2], 1, true), report([1], 2, true)])
      expect(() => browserShardReceipt(full, report([1], 1), executed, source, 1, 1, timings, tracked)).toThrow();
    expect(() => browserShardReceipt(full, report([1], 1), report([1], 1, true), source, 1, -1, timings, tracked)).toThrow();
  });
  it("keeps the whole-suite provider upload invariant with a legitimately upload-free shard", () => {
    const { manifest, receipts } = evidence();
    expect(verifyBrowserShards(manifest, [{ ...receipts[0], providerUploads: 0 }, ...receipts.slice(1)], source)).toBe(6);
    expect(() => verifyBrowserShards(manifest, receipts.map(r => ({ ...r, providerUploads: 0 })), source)).toThrow();
    expect(() => verifyBrowserShards(manifest, [{ ...receipts[0], providerUploads: -1 }, ...receipts.slice(1)], source)).toThrow();
  });
  it("requires every tracked ordinary spec, with only two exact documented opt-in exceptions", () => {
    expect(verifyBrowserSourceCensus(tracked, [...tracked, "e2e/density-post-change.density.spec.ts", "e2e/comprehension-run.spec.ts"])).toEqual([...tracked].sort());
    expect(() => verifyBrowserSourceCensus(tracked.slice(1), tracked)).toThrow("omitted a tracked ordinary spec");
    expect(() => verifyBrowserSourceCensus(tracked, [...tracked, "e2e/new-default.spec.ts"])).toThrow();
    expect(() => verifyBrowserSourceCensus(tracked, [...tracked, "e2e/new.density.spec.ts"])).toThrow();
    expect(() => verifyBrowserSourceCensus([...tracked, "e2e/comprehension-run.spec.ts"], tracked)).toThrow();
  });
  it("refuses a registered project that discovers no case and an unregistered project", () => {
    expect(() => browserReportCases(report([1, 2, 3, 4]), null, false)).toThrow("Standard browser projects differ");
    const value = report([1, 2, 3, 4, 5]); value.config.projects[4].name = "unregistered";
    expect(() => browserReportCases(value, null, false)).toThrow("Standard browser projects differ");
  });
  it("refuses fractional, negative, nonfinite or over-job-budget timing receipts", () => {
    const { manifest, receipts } = evidence();
    for (const value of [-1, 0.5, NaN, Infinity, 3_600_001]) for (const field of ["setupMs", "buildMs", "bootstrapMs", "browserMs"])
      expect(() => verifyBrowserShards(manifest, [{ ...receipts[0], timings: { ...receipts[0].timings, [field]: value } }, ...receipts.slice(1)], source)).toThrow();
    expect(() => verifyBrowserShards(manifest, [{ ...receipts[0], files: [{ ...receipts[0].files[0], durationMs: 3_600_001 }] }, ...receipts.slice(1)], source)).toThrow();
  });
  it("admits only the six registered native partitions on the disposable hosted job class", () => {
    const env = { CI: "true", GITHUB_ACTIONS: "true", RUNNER_ENVIRONMENT: "github-hosted", INHERIT_DISPOSABLE_LOCAL_E2E: "true" };
    expect(ciBrowserShard(undefined, {}, "darwin")).toBeNull();
    for (let index = 1; index <= 6; index++) expect(ciBrowserShard(`--ci-shard=${index}/6`, env, "linux")).toBe(index);
    for (const arg of ["--ci-shard", "--ci-shard=0/6", "--ci-shard=7/6", "--ci-shard=1/4", "--ci-shard=1/6 --grep=upload"])
      expect(() => ciBrowserShard(arg, env, "linux")).toThrow();
    for (const altered of [{}, { ...env, CI: "" }, { ...env, RUNNER_ENVIRONMENT: "self-hosted" },
      { ...env, INHERIT_DENSITY_CAPTURE: "1" }, { ...env, INHERIT_COMPREHENSION_RUN: "1" }])
      expect(() => ciBrowserShard("--ci-shard=1/6", altered, "linux")).toThrow();
    expect(() => ciBrowserShard("--ci-shard=1/6", env, "darwin")).toThrow();
  });
  it("keeps the default workflow's release check dependent on every job and sanitized coverage", () => {
    const workflow = readFileSync(".github/workflows/ci.yml", "utf8");
    const aggregate = workflow.slice(workflow.indexOf("\n  checks:"));
    expect(aggregate).toContain("    if: always()\n    needs: [repository-checks, browser]");
    expect(aggregate).toContain('test "$REPOSITORY_RESULT" = success');
    expect(aggregate).toContain('test "$BROWSER_RESULT" = success');
    expect(aggregate).toContain("scripts/ci-browser-shards.run.mts aggregate ci-browser-coverage");
    expect(workflow).toContain("shard: [1, 2, 3, 4, 5, 6]");
    expect(workflow).toContain("fail-fast: false");
    expect(workflow).toContain("scripts/run-upload-browser.mts --ci-shard=${{ matrix.shard }}/6");
    expect(workflow).not.toMatch(/continue-on-error|--grep|--project|--retries|merge-multiple:|path:.*results\.json/);
    for (const unsafe of ["            test-results/\n", "            playwright-report/\n"])
      expect(workflow).not.toContain(unsafe);
  });
  it("parses the actual workflow graph, matrix and main-safe concurrency with the existing ESLint YAML library", () => {
    const require = createRequire(import.meta.url);
    const yaml = createRequire(require.resolve("eslint"))("js-yaml") as { load(value: string): unknown };
    const doc = yaml.load(readFileSync(".github/workflows/ci.yml", "utf8")) as { jobs: Record<string, {
      if?: string; needs?: string[]; strategy?: { "fail-fast": boolean; "max-parallel": number; matrix: { shard: number[] } };
      "continue-on-error"?: boolean; steps: { uses?: string; run?: string; with?: Record<string, unknown> }[] }>; concurrency: Record<string, string> };
    expect(Object.keys(doc.jobs).sort()).toEqual(["browser", "checks", "repository-checks"]);
    expect(doc.jobs.checks.needs).toEqual(["repository-checks", "browser"]); expect(doc.jobs.checks.if).toBe("always()");
    expect(doc.jobs.browser.strategy).toEqual({ "fail-fast": false, "max-parallel": 6, matrix: { shard: [1, 2, 3, 4, 5, 6] } });
    expect(doc.jobs.browser.if).toBeUndefined(); expect(doc.jobs["repository-checks"].if).toBeUndefined();
    expect(doc.jobs.checks.steps.find(step => step.uses === "actions/download-artifact@v4")?.with?.pattern)
      .toBe("browser-case-${{ github.run_attempt }}-*");
    expect(doc.concurrency["cancel-in-progress"]).toBe("${{ github.event_name == 'pull_request' }}");
    expect(doc.concurrency.group).toBe("ci-${{ github.event_name }}-${{ github.event.pull_request.number || github.run_id }}");
    for (const job of Object.values(doc.jobs)) {
      expect(job["continue-on-error"]).toBeUndefined();
      const checkout = job.steps.find(step => step.uses === "actions/checkout@v4")!;
      expect(checkout.with).toEqual({ "fetch-depth": 0, "persist-credentials": false });
    }
    const foundation = doc.jobs["repository-checks"].steps.flatMap(step => step.run ?? []).join("\n");
    for (const command of ["pnpm typecheck", "pnpm lint", "pnpm test", "pnpm exec supabase test db", "pnpm test:invitation-locks",
      "pnpm gate:catalog-drift", "SERVER_URL=http://127.0.0.1:3199 pnpm gate:legal", "pnpm e2e:lighthouse"])
      expect(foundation).toContain(command);
    for (const gate of ["legal", "first-glance", "names", "templates", "readability", "secrets", "routes", "claims", "env", "jurisdictions"])
      expect(foundation).toContain(`pnpm gate:${gate}`);
  });
  it("selects only the exact rerun attempt even when an old shard number matches it", () => {
    const require = createRequire(import.meta.url);
    const localRequire = createRequire(require.resolve("eslint"));
    const yaml = localRequire("js-yaml") as { load(value: string): unknown };
    const minimatch = localRequire("minimatch") as {
      Minimatch: new (pattern: string) => { match(name: string): boolean };
    };
    const workflow = yaml.load(readFileSync(".github/workflows/ci.yml", "utf8")) as {
      jobs: { checks: { steps: { uses?: string; with?: { pattern?: string } }[] } };
    };
    const pattern = workflow.jobs.checks.steps.find(step => step.uses === "actions/download-artifact@v4")!.with!.pattern!;
    const names = (attempt: number) => [`browser-case-${attempt}-manifest`,
      ...Array.from({ length: 6 }, (_, i) => `browser-case-${attempt}-shard-${i + 1}`)];
    const retained = [...names(1), ...names(2), ...names(12), "browser-failure-evidence-2-1"];
    for (const attempt of [1, 2, 12]) {
      const matcher = new minimatch.Minimatch(pattern.replace("${{ github.run_attempt }}", String(attempt)));
      expect(retained.filter(name => matcher.match(name))).toEqual(names(attempt));
    }
  });
});
