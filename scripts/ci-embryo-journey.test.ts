import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import type { ChildProcess } from "node:child_process";
import { afterEach, describe, expect, it, vi } from "vitest";
import { checkedEmbryoWorkerEnvironment, EMBRYO_JOURNEY_ENV, EMBRYO_WORKER_ARGS, EMBRYO_WORKER_LIMIT_MS,
  runEmbryoWorkerInside, withEmbryoJourney, type EmbryoJourneyIo } from "./ci-embryo-journey";

const owner = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", cohort = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const worker = { NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
  SUPABASE_SERVICE_ROLE_KEY: "EXAMPLE_SYNTHETIC_SERVICE", INHERIT_TEST_JURISDICTION: "1",
  ...EMBRYO_JOURNEY_ENV, INHERIT_UPLOAD_SIGNING_JWK: "EXAMPLE_SYNTHETIC_SIGNER" };
const env = { ...worker, CI: "true", GITHUB_ACTIONS: "true", RUNNER_ENVIRONMENT: "github-hosted",
  INHERIT_DISPOSABLE_LOCAL_E2E: "true", INHERIT_CI_BROWSER_RUNTIME: "ready",
  INHERIT_CI_RUNTIME_UID: "1001", INHERIT_CI_RUNTIME_GID: "1001" };
const original = { split: { singleton: true, enabled: false },
  objects: { singleton: true, provider: null as string | null, r2_bucket: null as string | null } };
function harness() {
  const statements: string[] = [], commands: Array<{ args: string[]; input?: string; timeout?: number }> = [];
  let current = structuredClone(original), identity: Record<string, unknown> = {}, empty = true, exact = true;
  let activationLoss = false, workerLoss = false;
  const io: EmbryoJourneyIo = {
    root: () => "/synthetic/checkout", owner: () => ({ owner }),
    execute: async (args, input, timeout) => {
      commands.push({ args, input, timeout });
      if (args[0] === "inspect") return JSON.stringify({ name: `/${args.at(-1)}`, running: true,
        project: "sequence", owner, network: "supabase_network_sequence",
        mounts: [{ Source: "/synthetic/checkout", Destination: "/app", RW: false }], ...identity });
      if (args.includes("psql")) {
        statements.push(input!);
        if (input!.startsWith("select jsonb_build_object")) return JSON.stringify(current);
        if (input!.startsWith("select (not exists")) return String(empty);
        if (input!.startsWith("-- embryo-fixture-activate")) {
          current = { split: { singleton: true, enabled: true },
            objects: { singleton: true, provider: "r2", r2_bucket: "inherit-embryo-ci" } };
          if (activationLoss) throw new Error("uncertain activation");
          return "true";
        }
        if (input!.startsWith("-- embryo-fixture-restore")) {
          if (current.objects.provider === "r2" && current.objects.r2_bucket === "inherit-embryo-ci" && current.split.enabled)
            current = structuredClone(original);
          else if (JSON.stringify(current) !== JSON.stringify(original)) throw new Error("configuration drift");
          return JSON.stringify(current);
        }
        if (input!.startsWith("select ((select count")) return String(exact);
        if (input!.startsWith("select json_build_object")) return '{"jobs":1,"sources":2}';
        throw new Error("Unexpected SQL");
      }
      if (workerLoss) throw new Error("uncertain worker");
      return "EMBRYO_JOURNEY_WORKER_COMPLETE";
    },
  };
  return { io, statements, commands, current: () => current,
    identity: (value: Record<string, unknown>) => { identity = value; },
    configure: (value: typeof original) => { current = value; },
    stale: () => { empty = false; }, wrongJob: () => { exact = false; },
    loseActivation: () => { activationLoss = true; }, loseWorker: () => { workerLoss = true; } };
}
describe("one real embryo worker in the owned disposable CI namespace", () => {
  it("uses only the exact new synthetic cohort, starts the production entry and restores both gates", async () => {
    const h = harness();
    await withEmbryoJourney(env, async fixture => {
      await fixture.runWorker(cohort);
      expect(await fixture.proof(cohort)).toEqual({ jobs: 1, sources: 2 });
      await expect(fixture.runWorker(cohort)).rejects.toThrow("duplicate");
    }, h.io, "linux");
    expect(h.current()).toEqual(original);
    const launch = h.commands.filter(c => c.args.includes("/app/scripts/ci-browser/embryo-worker.mts"));
    expect(launch).toEqual([{ args: ["exec", "-i", "--user", "1001:1001", "inherit-ci-browser-runtime",
      "node", "--import", "tsx", "/app/scripts/ci-browser/embryo-worker.mts"],
    input: JSON.stringify(worker) + "\n", timeout: 110_000 }]);
    const mutations = h.statements.filter(sql => /update /i.test(sql));
    expect(mutations).toHaveLength(2);
    expect(mutations.join("\n")).not.toMatch(/insert into|delete from|update public\.|set max_|set status|set attempts|set.*grant/i);
    expect(h.statements.find(sql => sql.startsWith("select ((select count"))).toContain(`w.cohort_id='${cohort}'::uuid`);
    expect(h.statements.join("\n")).toContain("u.email like '%@e2e.local'");
  });
  it.each([{ CI: "" }, { RUNNER_ENVIRONMENT: "self-hosted" }, { VERCEL: "1" },
    { NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co" }, { INHERIT_CI_BROWSER_RUNTIME: "" },
    { INHERIT_CI_RUNTIME_UID: "0" }, { DEBUG: "*" }])("refuses unsafe environment before any command: %j", async change => {
    const h = harness();
    await expect(withEmbryoJourney({ ...env, ...change }, async () => {}, h.io, "linux")).rejects.toThrow();
    expect(h.commands).toEqual([]);
  });
  it.each([{ owner: "unrelated" }, { running: false }, { network: "host" }, { project: "production" },
    { mounts: [{ Source: "/unrelated", Destination: "/app", RW: false }] },
    { mounts: [{ Source: "/synthetic/checkout", Destination: "/app", RW: true }] }])(
    "refuses wrong ownership or namespace before SQL: %j", async identity => {
      const h = harness(); h.identity(identity);
      await expect(withEmbryoJourney(env, async () => {}, h.io, "linux")).rejects.toThrow();
      expect(h.statements).toEqual([]);
    });
  it("refuses old jobs, fragment intents and any existing provider or enabled worker", async () => {
    const h = harness(); h.stale();
    await expect(withEmbryoJourney(env, async () => {}, h.io, "linux")).rejects.toThrow("empty split");
    expect(h.statements.some(sql => sql.startsWith("-- embryo-fixture-activate"))).toBe(false);
    expect(h.statements.at(-1)).toContain("private.embryo_ingest_write_intents");
    expect(h.statements.at(-1)).toContain("private.embryo_canonical_parts");
    for (const config of [{ ...original, split: { singleton: true, enabled: true } },
      { ...original, objects: { singleton: true, provider: "supabase", r2_bucket: null } }]) {
      const candidate = harness(); candidate.configure(config);
      await expect(withEmbryoJourney(env, async () => {}, candidate.io, "linux")).rejects.toThrow("Never take over");
    }
  });
  it("restores after a work error and after losing activation's acknowledgement", async () => {
    for (const loss of [false, true]) {
      const h = harness(); if (loss) h.loseActivation();
      await expect(withEmbryoJourney(env, async () => { throw new Error("work failure"); }, h.io, "linux")).rejects.toThrow();
      expect(h.current()).toEqual(original);
    }
  });
  it("rejects wrong queued work and SQL injection before worker launch", async () => {
    const h = harness(); h.wrongJob();
    await withEmbryoJourney(env, async fixture => {
      await expect(fixture.runWorker(cohort)).rejects.toThrow("unrelated");
      await expect(fixture.runWorker(cohort + "';select 1;")).rejects.toThrow("Exact synthetic");
      await expect(fixture.proof("not-a-cohort")).rejects.toThrow("Exact synthetic");
    }, h.io, "linux");
    expect(h.commands.some(c => c.args.includes("/app/scripts/ci-browser/embryo-worker.mts"))).toBe(false);
  });
  it("never retries an uncertain worker and never overwrites a concurrent provider selection", async () => {
    const h = harness(); h.loseWorker();
    await expect(withEmbryoJourney(env, async fixture => {
      await expect(fixture.runWorker(cohort)).rejects.toThrow("uncertain worker");
      await expect(fixture.runWorker(cohort)).rejects.toThrow("duplicate");
      h.configure({ split: { singleton: true, enabled: true },
        objects: { singleton: true, provider: "r2", r2_bucket: "inherit-embryo-other" } });
    }, h.io, "linux")).rejects.toThrow("drift");
    expect(h.current().objects.r2_bucket).toBe("inherit-embryo-other");
    expect(h.commands.filter(c => c.args.includes("/app/scripts/ci-browser/embryo-worker.mts"))).toHaveLength(1);
  });
});

import { runEmbryoFittedStatisticalWorkerInside, type FittedEmbryoJourney } from "./ci-embryo-journey";

const fittedCohort = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const statisticalJob = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
function fittedHarness() {
  const base = harness(), native = base.io.execute;
  let complete = true, historyReads = 0, driftAt = Infinity;
  let queue = true, fresh = true, publication = true, fittedOutput = "EMBRYO_STATISTICAL_FITTED_JOURNEY_WORKER_COMPLETE";
  const io: EmbryoJourneyIo = { ...base.io, execute: async (args, input, timeout) => {
    if (args.includes("psql") && (input!.startsWith("-- embryo-first-completed-history")
      || input!.startsWith("-- embryo-fitted-") || input!.startsWith("select public.enqueue_embryo_test_statistical")
      || input!.startsWith("select (exists(select 1 from private.embryo_test_statistical_admission)")
      || input!.startsWith("with capture as materialized"))) {
      base.commands.push({ args, input, timeout });base.statements.push(input!);
      if (input!.startsWith("-- embryo-first-completed-history")) {
        historyReads++;
        return JSON.stringify({ complete, sha256: (historyReads >= driftAt ? "b" : "a").repeat(64) });
      }
      if (input!.startsWith("-- embryo-fitted-empty-queue")) return String(queue);
      if (input!.startsWith("-- embryo-fitted-settled-queue")) return String(queue);
      if (input!.startsWith("-- embryo-fitted-fresh-cohort")) return String(fresh);
      if (input!.startsWith("-- embryo-fitted-current-publication")) return String(publication);
      if (input!.startsWith("select public.enqueue_embryo_test_statistical"))
        return JSON.stringify({ status: "queued", jobId: statisticalJob });
      if (input!.startsWith("with capture as materialized")) return '{"bindingsCurrent":true}';
      return "true";
    }
    if (args.includes("/app/scripts/ci-browser/embryo-statistical-worker.mts")) {
      base.commands.push({ args, input, timeout });
      return input!.includes('"kind":"fitted-test"') ? fittedOutput : "EMBRYO_STATISTICAL_JOURNEY_WORKER_COMPLETE";
    }
    return native(args, input, timeout);
  } };
  return { ...base, io, incomplete: () => { complete = false; }, drift: (at: number) => { driftAt = at; },
    denyQueue: () => { queue = false; }, denyFresh: () => { fresh = false; }, denyPublication: () => { publication = false; },
    output: (value: string) => { fittedOutput = value; } };
}
async function originalThenFitted(h: ReturnType<typeof fittedHarness>, work: (fixture: FittedEmbryoJourney) => Promise<void>) {
  await withEmbryoJourney(env, async runtime => {
    await runtime.runWorker(cohort);await runtime.runStatisticalWorker(cohort);
    await runtime.withFittedJourney(cohort, work);
  }, h.io, "linux");
}

describe("additive fitted journey after the unchanged original publication", () => {
  it("runs one untouched signed-parent cohort, independently binds the native rows and restores both original configuration rows", async () => {
    const h = fittedHarness();
    await originalThenFitted(h, async fitted => {
      await fitted.runWorker(fittedCohort);await fitted.runStatisticalWorker(fittedCohort);
      expect(await fitted.statisticalProof(fittedCohort)).toEqual({ bindingsCurrent: true });
      await expect(fitted.runWorker(fittedCohort)).rejects.toThrow("One distinct fresh");
      await expect(fitted.runStatisticalWorker(fittedCohort)).rejects.toThrow("One fitted worker attempt");
      await expect(fitted.proof(cohort)).rejects.toThrow("Exact second");
    });
    expect(h.current()).toEqual(original);
    const fittedLaunch = h.commands.filter(row => row.input?.includes('"kind":"fitted-test"'));
    expect(fittedLaunch).toEqual([{ args: ["exec", "-i", "--user", "1001:1001", "inherit-ci-browser-runtime",
      "node", "--import", "tsx", "/app/scripts/ci-browser/embryo-statistical-worker.mts"],
    input: JSON.stringify({ kind: "fitted-test", environment: worker }) + "\n", timeout: 110_000 }]);
    const freshSql = h.statements.find(row => row.startsWith("-- embryo-fitted-fresh-cohort"))!;
    expect(freshSql).toContain("and (select count(*) from public.worker_jobs where cohort_id='");
    expect(freshSql).toContain("=1");expect(freshSql).toContain("w.status='queued' and w.attempts=0");
    expect(freshSql).toContain("u.email='fitted-test@e2e.local'");
    expect(freshSql).toContain("private.embryo_canonical_sources");
    const queueSql = h.statements.find(row => row.startsWith("-- embryo-fitted-empty-queue"))!;
    expect(queueSql).toContain("private.embryo_split_ordinals");expect(queueSql).toContain("private.embryo_split_variants");
    expect(queueSql).toContain("private.embryo_ingest_write_intents where state<>'landed'");
    expect(queueSql).toContain("private.embryo_canonical_parts where state<>'landed'");
    const proof = h.statements.find(row => row.startsWith("with capture as materialized"))!;
    expect(proof).toContain("private.capture_embryo_test_statistical_fit_v1");
    expect(proof).toContain("(s).computation_receipt=private.embryo_test_fit_receipt_v1(j,e,c,m)");
    expect(proof).toContain("convert_to(to_jsonb(j)::text,'UTF8')");
    expect(proof).toContain("convert_to(to_jsonb(s)::text,'UTF8')");
    expect(proof).toContain("private.expected_embryo_test_fit_measurement_v1(e,c)");
    expect(h.statements.filter(row => /update /i.test(row))).toHaveLength(2);
  });
  it.each(["incomplete", "history-drift", "pending-queue"])("refuses %s before starting the second cohort and still restores configuration", async fault => {
    const h = fittedHarness(), work = vi.fn();
    if (fault === "incomplete") h.incomplete();
    if (fault === "history-drift") h.drift(2);
    if (fault === "pending-queue") h.denyQueue();
    await expect(originalThenFitted(h, async fitted => {
      work();await fitted.runWorker(fittedCohort);
    })).rejects.toThrow();
    if (fault !== "history-drift") expect(work).not.toHaveBeenCalled();
    expect(h.commands.filter(row => row.args.includes("/app/scripts/ci-browser/embryo-worker.mts"))).toHaveLength(1);
    expect(h.current()).toEqual(original);
  });
  it.each(["foreign-or-touched-cohort", "stale-publication", "uncertain-fit-output"])("refuses %s without a second fitted attempt and restores configuration", async fault => {
    const h = fittedHarness();
    if (fault === "foreign-or-touched-cohort") h.denyFresh();
    if (fault === "stale-publication") h.denyPublication();
    if (fault === "uncertain-fit-output") h.output("EMBRYO_STATISTICAL_JOURNEY_WORKER_COMPLETE");
    await expect(originalThenFitted(h, async fitted => {
      await fitted.runWorker(fittedCohort);
      await expect(fitted.runStatisticalWorker(fittedCohort)).rejects.toThrow();
      if (fault === "uncertain-fit-output") await expect(fitted.runStatisticalWorker(fittedCohort)).rejects.toThrow("One fitted worker attempt");
      throw new Error("Refused fitted work");
    })).rejects.toThrow();
    expect(h.commands.filter(row => row.input?.includes('"kind":"fitted-test"'))).toHaveLength(fault === "uncertain-fit-output" ? 1 : 0);
    expect(h.current()).toEqual(original);
  });
  it("retains a changed whole first-history refusal at the final bookend and never overwrites concurrent configuration", async () => {
    const h = fittedHarness();
    await expect(originalThenFitted(h, async fitted => {
      await fitted.runWorker(fittedCohort);h.drift(4);
    })).rejects.toThrow("Original whole journey history changed");
    expect(h.current()).toEqual(original);
    const drift = fittedHarness();
    await expect(originalThenFitted(drift, async () => {
      drift.configure({ split: { singleton: true, enabled: true }, objects: { singleton: true, provider: "r2", r2_bucket: "inherit-embryo-other" } });
    })).rejects.toThrow("configuration drift");
    expect(drift.current().objects.r2_bucket).toBe("inherit-embryo-other");
  });
  it("refuses an incomplete second journey or unsettled final queue instead of silently adopting prior work", async () => {
    const missing = fittedHarness();
    await expect(originalThenFitted(missing, async () => {})).rejects.toThrow("complete both actual worker attempts");
    expect(missing.current()).toEqual(original);
    const pending = fittedHarness();
    await expect(originalThenFitted(pending, async fitted => {
      await fitted.runWorker(fittedCohort);await fitted.runStatisticalWorker(fittedCohort);pending.denyQueue();
    })).rejects.toThrow("left pending fragment work");
    expect(pending.current()).toEqual(original);
  });
  it("refuses a caught uncertain fitted outcome rather than treating the attempted job as completed", async () => {
    const h = fittedHarness();h.output("EMBRYO_STATISTICAL_JOURNEY_WORKER_COMPLETE");
    await expect(originalThenFitted(h, async fitted => {
      await fitted.runWorker(fittedCohort);
      await expect(fitted.runStatisticalWorker(fittedCohort)).rejects.toThrow("settle completely");
      await expect(fitted.runStatisticalWorker(fittedCohort)).rejects.toThrow("One fitted worker attempt");
      // The callback has consumed the failure and returns normally. The outer
      // successful result still requires accepted completion, without retry.
    })).rejects.toThrow("complete both actual worker attempts");
    expect(h.commands.filter(row => row.input?.includes('"kind":"fitted-test"'))).toHaveLength(1);
    expect(h.current()).toEqual(original);
  });
});

describe("fixed fitted worker terminal and limits", () => {
  afterEach(() => vi.useRealTimers());
  function childFixture() {
    const child = Object.assign(new EventEmitter(), { pid: 12345, stdout: new PassThrough(), stderr: new PassThrough() });
    return { child, dependencies: { spawn: vi.fn(() => child as unknown as ChildProcess), kill: vi.fn() } };
  }
  it("accepts only the fitted terminal on clean close", async () => {
    const h = childFixture(), result = runEmbryoFittedStatisticalWorkerInside(worker, new AbortController().signal, h.dependencies);
    h.child.stdout.write("fitted_saved\n");h.child.emit("close", 0);await result;
    expect(h.dependencies.spawn).toHaveBeenCalledWith(worker);expect(h.dependencies.kill).not.toHaveBeenCalled();
  });
  it.each(["coverage_saved\n", "fitted_saved\nextra\n", "fitted_idle\n"])("refuses %s with all original guards", async output => {
    const h = childFixture(), result = runEmbryoFittedStatisticalWorkerInside(worker, new AbortController().signal, h.dependencies);
    h.child.stdout.write(output);h.child.emit("close", 0);await expect(result).rejects.toThrow("not a clean completion");
  });
  it("keeps the original finite deadline, TERM/5-second/KILL settlement and no launch after pre-cancellation", async () => {
    vi.useFakeTimers();
    const h = childFixture(), result = runEmbryoFittedStatisticalWorkerInside(worker, new AbortController().signal, h.dependencies);
    const failed = expect(result).rejects.toThrow("not a clean completion");
    await vi.advanceTimersByTimeAsync(EMBRYO_WORKER_LIMIT_MS);expect(h.dependencies.kill).toHaveBeenCalledWith(12345, "SIGTERM");
    await vi.advanceTimersByTimeAsync(5000);expect(h.dependencies.kill).toHaveBeenCalledWith(12345, "SIGKILL");
    await vi.advanceTimersByTimeAsync(1000);await failed;expect(vi.getTimerCount()).toBe(0);
    const stopped = childFixture();await expect(runEmbryoFittedStatisticalWorkerInside(worker, AbortSignal.abort(), stopped.dependencies)).rejects.toThrow("cancelled");
    expect(stopped.dependencies.spawn).not.toHaveBeenCalled();
  });
});
describe("bounded embryo worker process lifecycle", () => {
  afterEach(() => vi.useRealTimers());
  function processFixture() {
    const child = Object.assign(new EventEmitter(), { pid: 12345, stdout: new PassThrough(), stderr: new PassThrough() });
    return { child, dependencies: { spawn: vi.fn(() => child as unknown as ChildProcess), kill: vi.fn() } };
  }
  it("admits exactly its six fields and fixes the one-iteration production command", () => {
    expect(EMBRYO_WORKER_ARGS).toEqual(["--conditions=react-server", "--import", "/app/scripts/server-only-shim.mjs",
      "--import", "tsx", "/app/scripts/embryo-split-worker.run.mts", "--once"]);
    expect(checkedEmbryoWorkerEnvironment(worker)).toEqual(worker);
    for (const bad of [{ ...worker, NODE_OPTIONS: "--inspect" }, { ...worker, COMMAND: "other" },
      { ...worker, INHERIT_EMBRYO_R2_ORIGIN: "https://external.invalid" },
      { ...worker, INHERIT_EMBRYO_R2_BUCKET: "inherit-embryo-other" },
      { ...worker, INHERIT_TEST_JURISDICTION: "" }, { ...worker, SUPABASE_SERVICE_ROLE_KEY: "" },
      { ...worker, INHERIT_UPLOAD_SIGNING_JWK: "" }]) expect(() => checkedEmbryoWorkerEnvironment(bad)).toThrow();
  });
  it("requires exact publication output and a clean process close", async () => {
    const h = processFixture(), result = runEmbryoWorkerInside(worker, new AbortController().signal, h.dependencies);
    h.child.stdout.write("split_"); h.child.stdout.write("published\n"); h.child.emit("close", 0);
    await result; expect(h.dependencies.spawn).toHaveBeenCalledWith(worker); expect(h.dependencies.kill).not.toHaveBeenCalled();
  });
  it.each(["split_idle\n", "split_failure_pending\n", "split_requeued\n", "split_failed\n", "split_published\nextra\n"])(
    "refuses every idle, partial or uncertain outcome: %s", async output => {
      const h = processFixture(), result = runEmbryoWorkerInside(worker, new AbortController().signal, h.dependencies);
      h.child.stdout.write(output); h.child.emit("close", 0);
      await expect(result).rejects.toThrow("not a clean completion");
    });
  it("terminates a stuck worker with TERM then KILL and reports uncertainty", async () => {
    vi.useFakeTimers();
    const h = processFixture(), result = runEmbryoWorkerInside(worker, new AbortController().signal, h.dependencies);
    const failure = expect(result).rejects.toThrow("not a clean completion");
    await vi.advanceTimersByTimeAsync(EMBRYO_WORKER_LIMIT_MS);
    expect(h.dependencies.kill).toHaveBeenCalledWith(12345, "SIGTERM");
    await vi.advanceTimersByTimeAsync(5000);
    expect(h.dependencies.kill).toHaveBeenCalledWith(12345, "SIGKILL");
    await vi.advanceTimersByTimeAsync(1000); await failure;
    expect(vi.getTimerCount()).toBe(0);
  });
  it("refuses output overflow, cancellation, nonzero exits and pre-aborted starts", async () => {
    for (const mode of ["overflow", "abort", "nonzero"]) {
      const h = processFixture(), controller = new AbortController();
      const result = runEmbryoWorkerInside(worker, controller.signal, h.dependencies);
      if (mode === "overflow") h.child.stdout.write("x".repeat(513));
      else if (mode === "abort") controller.abort(); else h.child.stdout.write("split_published\n");
      h.child.emit("close", mode === "nonzero" ? 1 : 0);
      await expect(result).rejects.toThrow();
    }
    const h = processFixture();
    await expect(runEmbryoWorkerInside(worker, AbortSignal.abort(), h.dependencies)).rejects.toThrow("cancelled");
    expect(h.dependencies.spawn).not.toHaveBeenCalled();
  });
});
