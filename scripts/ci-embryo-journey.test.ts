import { readFileSync } from "node:fs";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import type { ChildProcess } from "node:child_process";
import { afterEach, describe, expect, it, vi } from "vitest";
import { encodeFittedFailure, fittedFailureFrom, fittedProofOverflowPipe } from "../src/lib/embryos/statistical-fit-diagnostic";
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
      || input!.startsWith("with fitted_proof_compact_value(proof) as materialized"))) {
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
      if (input!.startsWith("with fitted_proof_compact_value(proof) as materialized")) return '{"bindingsCurrent":true}';
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
    const proof = h.statements.find(row => row.startsWith("with fitted_proof_compact_value(proof) as materialized"))!;
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


describe("fitted process safe refusal observations", () => {
  afterEach(() => vi.useRealTimers());
  function processFixture() {
    const child = Object.assign(new EventEmitter(), { pid: 12345, stdout: new PassThrough(), stderr: new PassThrough() });
    return { child, dependencies: { spawn: vi.fn(() => child as unknown as ChildProcess), kill: vi.fn() } };
  }
  it.each(["WORK_EXIT", "WORK_TERMINAL_REFUSED", "WORK_OUTPUT_BOUND", "WORK_SPAWN_REFUSED", "WORK_CANCELLED"] as const)(
    "keeps %s a failure even beside a valid private-free worker packet", async kind => {
      const h = processFixture(), controller = new AbortController();
      const result = runEmbryoFittedStatisticalWorkerInside(worker, controller.signal, h.dependencies);
      const packet = encodeFittedFailure({ outer: "NOT_OBSERVED", inner: "RPC_REFUSED", operation: "SAVE", code: "unavailable" });
      h.child.stderr.write(packet + "\n");
      if (kind === "WORK_EXIT") { h.child.stdout.write("fitted_saved\n");h.child.emit("close", 1); }
      if (kind === "WORK_TERMINAL_REFUSED") { h.child.stdout.write("fitted_saved\nextra");h.child.emit("close", 0); }
      if (kind === "WORK_OUTPUT_BOUND") { h.child.stdout.write("x".repeat(513));h.child.emit("close", 0); }
      if (kind === "WORK_SPAWN_REFUSED") { h.child.emit("error", new Error("synthetic-private-process-canary"));h.child.emit("close", 0); }
      if (kind === "WORK_CANCELLED") { controller.abort();h.child.stdout.write("fitted_saved\n");h.child.emit("close", 0); }
      const error = await result.catch(value => value);
      expect(error).toBeInstanceOf(Error);expect(error.message).toContain("not a clean completion");
      expect(fittedFailureFrom(error)).toEqual({ outer: "NOT_OBSERVED", inner: kind, operation: "SAVE", code: "unavailable" });
      expect(error.message).not.toContain("synthetic-private-process-canary");
    });
  it("observes the unchanged deadline without accepting an exact terminal after stop", async () => {
    vi.useFakeTimers();const h = processFixture();
    const result = runEmbryoFittedStatisticalWorkerInside(worker, new AbortController().signal, h.dependencies);
    const error = result.catch(value => value);
    await vi.advanceTimersByTimeAsync(90_000);expect(h.dependencies.kill).toHaveBeenCalledWith(12345, "SIGTERM");
    h.child.stdout.write("fitted_saved\n");
    await vi.advanceTimersByTimeAsync(5000);expect(h.dependencies.kill).toHaveBeenCalledWith(12345, "SIGKILL");
    await vi.advanceTimersByTimeAsync(1000);expect(fittedFailureFrom(await error).inner).toBe("WORK_DEADLINE");
    expect(vi.getTimerCount()).toBe(0);
  });
  it("refuses synchronous spawn loss using only the closed failure label", async () => {
    const dependencies = { spawn: vi.fn(() => { throw new Error("synthetic-private-spawn-canary"); }), kill: vi.fn() };
    const error = await runEmbryoFittedStatisticalWorkerInside(worker, new AbortController().signal, dependencies).catch(value => value);
    expect(fittedFailureFrom(error).inner).toBe("WORK_SPAWN_REFUSED");expect(error.message).not.toContain("synthetic-private");
    expect(dependencies.kill).not.toHaveBeenCalled();
  });
  it.each(["synthetic-private-stderr-canary", "x".repeat(513)])("never emits arbitrary or overflowing stderr %#", async text => {
    const h = processFixture(), result = runEmbryoFittedStatisticalWorkerInside(worker, new AbortController().signal, h.dependencies);
    h.child.stderr.write(text);h.child.emit("close", 1);const error = await result.catch(value => value);
    expect(fittedFailureFrom(error)).toEqual({ outer: "NOT_OBSERVED", inner: "WORK_EXIT", operation: "NOT_OBSERVED", code: "NOT_OBSERVED" });
    expect(error.message).not.toContain(text);
  });
  it("retains successful exact stdout/close even when unrelated stderr is drained", async () => {
    const h = processFixture(), result = runEmbryoFittedStatisticalWorkerInside(worker, new AbortController().signal, h.dependencies);
    h.child.stderr.write("synthetic-private-stderr-canary");h.child.stdout.write("fitted_saved\n");h.child.emit("close", 0);
    await result;expect(h.dependencies.kill).not.toHaveBeenCalled();
  });
});


import { embryoJourneyCommandFailure, isFittedNativeProofCommand, fittedNativeProofSizeSql,
  fittedNativeProofSizeFrame, observeFittedNativeProofSizeFailure } from "./ci-embryo-journey";

async function fittedProofCommand() {
  const h = fittedHarness(), native = h.io.execute;
  const observed: Array<{ args: string[]; input?: string; timeout?: number; context?: "fitted-native-proof" }> = [];
  const retained = { bindingsCurrent: true, wholeRowHashes: { jobs: [], scores: [] }, exactOutput: "synthetic-proof-output" };
  h.io.execute = async (args, input, timeout, context) => {
    observed.push({ args, input, timeout, context });
    if (input?.startsWith("with fitted_proof_compact_value(proof) as materialized")) return JSON.stringify(retained);
    return native(args, input, timeout, context);
  };
  await originalThenFitted(h, async fitted => {
    await fitted.runWorker(fittedCohort);await fitted.runStatisticalWorker(fittedCohort);
    expect(await fitted.statisticalProof(fittedCohort)).toEqual(retained);
  });
  expect(h.current()).toEqual(original);
  const selected = observed.filter(row => row.context !== undefined);
  expect(selected).toHaveLength(1);
  const command = selected[0];
  expect(command).toMatchObject({ args: ["exec", "-i", "supabase_db_sequence", "psql", "-U", "postgres", "-d", "postgres", "-XAtq", "--set=ON_ERROR_STOP=1"],
    timeout: 10_000, context: "fitted-native-proof" });
  return { command, observed };
}
describe("exact fitted native proof diagnostic context", () => {
  it("tags only the existing complete proof while retaining exact successful output and original restoration", async () => {
    const { command, observed } = await fittedProofCommand();
    expect(isFittedNativeProofCommand(command.args, command.input, command.timeout!, command.context)).toBe(true);
    expect(command.input).toContain("private.embryo_test_fit_receipt_v1(j,e,c,m)");
    expect(command.input).toContain("convert_to(to_jsonb(s)::text,'UTF8')");
    expect(observed.filter(row => row.context !== undefined)).toHaveLength(1);
    for (const row of observed.filter(row => row.context === undefined))
      expect(isFittedNativeProofCommand(row.args, row.input, row.timeout ?? 10_000, row.context)).toBe(false);
  });
  it("refuses altered SQL, argv, cohort, context and deadline as diagnostic inputs without relaxing any command", async () => {
    const { command } = await fittedProofCommand();
    const matches = (args = command.args, input = command.input, timeout = command.timeout!, context: unknown = command.context) =>
      isFittedNativeProofCommand(args, input, timeout, context);
    for (const context of [undefined, null, "fitted-worker", { kind: "fitted-native-proof" }])
      expect(isFittedNativeProofCommand(command.args, command.input, 10_000, context)).toBe(false);
    for (const timeout of [9999, 10_001, 110_000]) expect(matches(command.args, command.input, timeout)).toBe(false);
    for (let index = 0; index < command.args.length; index++)
      expect(matches(command.args.map((value, ordinal) => ordinal === index ? "other" : value))).toBe(false);
    expect(matches([...command.args, "extra"])).toBe(false);
    for (const input of ["select true;", command.input! + "\nselect true;", command.input!.replace("'bindingsCurrent'", "'changed'"),
      command.input!.replaceAll(fittedCohort, "cccccccc-cccc-1ccc-8ccc-cccccccccccc")])
      expect(matches(command.args, input)).toBe(false);
    expect(isFittedNativeProofCommand(command.args, undefined, 10_000, command.context)).toBe(false);
  });
  it.each([
    { control: { code: "ERR_CHILD_PROCESS_STDIO_MAXBUFFER", killed: true, signal: "SIGKILL" }, outer: "COMMAND_OUTPUT_BOUND" },
    { control: { killed: true, signal: "SIGKILL" }, outer: "COMMAND_TIMEOUT" },
    { control: { code: 1 }, outer: "COMMAND_EXIT" },
    { control: { code: "ENOENT" }, outer: "COMMAND_SPAWN_REFUSED" },
    { control: { code: "EACCES" }, outer: "COMMAND_SPAWN_REFUSED" },
    { control: { code: "EAGAIN" }, outer: "COMMAND_SPAWN_REFUSED" },
    { control: { signal: "SIGTERM" }, outer: "COMMAND_SIGNAL" },
    { control: { code: "synthetic-private-proof-canary" }, outer: "COMMAND_REFUSED" },
    { control: { code: 0 }, outer: "COMMAND_REFUSED" },
    { control: {}, outer: "COMMAND_REFUSED" },
  ] as const)("retains proof failure with only its actual closed outer fields %#", async ({ control, outer }) => {
    const { command } = await fittedProofCommand();
    const error = Object.assign(new Error("synthetic-private-proof-canary"), control, {
      stdout: "synthetic-private-proof-canary", stderr: encodeFittedFailure({ outer: "COMMAND_EXIT", inner: "RPC_REFUSED", operation: "SAVE", code: "unavailable" }),
      sqlstate: "synthetic-private-proof-canary", payload: "synthetic-private-proof-canary" });
    const failure = embryoJourneyCommandFailure(command.args, command.input, command.timeout!, command.context, error);
    expect(failure).toBeInstanceOf(Error);
    expect(failure.message).toBe(`Embryo journey fitted native proof command failed; ${encodeFittedFailure({
      outer, inner: "NOT_OBSERVED", operation: "NOT_OBSERVED", code: "NOT_OBSERVED" })}`);
    expect(failure.message).not.toContain("synthetic-private-proof-canary");
    expect(failure.message).not.toMatch(/RPC_REFUSED|\|SAVE\||unavailable|sqlstate|payload/);
  });
  it("does not read error getters or forward unknown native text", async () => {
    const { command } = await fittedProofCommand(), getter = vi.fn(() => { throw new Error("synthetic-private-proof-canary"); }), error = {};
    for (const key of ["code", "killed", "signal", "stderr", "stdout", "message", "stack", "sqlstate"])
      Object.defineProperty(error, key, { get: getter });
    const refusal = embryoJourneyCommandFailure(command.args, command.input, 10_000, command.context, error);
    expect(refusal.message).toBe("Embryo journey fitted native proof command failed; EMBRYO_FITTED_FAILURE_V1|COMMAND_REFUSED|NOT_OBSERVED|NOT_OBSERVED|NOT_OBSERVED");
    expect(getter).not.toHaveBeenCalled();
  });
  it("retains opaque legacy proof errors and the original fitted-worker frame", async () => {
    const { command } = await fittedProofCommand(), error = { code: 1, stderr: "synthetic-private-proof-canary" };
    for (const context of [undefined, "wrong", {}])
      expect(embryoJourneyCommandFailure(command.args, command.input, 10_000, context, error).message)
        .toBe("Embryo journey fixed local command failed; diagnostics withheld");
    expect(embryoJourneyCommandFailure(command.args, command.input! + "\nselect true;", 10_000, command.context, error).message)
      .toBe("Embryo journey fixed local command failed; diagnostics withheld");
    const frame = encodeFittedFailure({ outer: "NOT_OBSERVED", inner: "WORK_EXIT", operation: "CLAIM", code: "invalid_response" });
    const args = ["exec", "-i", "--user", "1001:1001", "inherit-ci-browser-runtime", "node", "--import", "tsx", "/app/scripts/ci-browser/embryo-statistical-worker.mts"];
    expect(embryoJourneyCommandFailure(args, JSON.stringify({ kind: "fitted-test", environment: worker }) + "\n", 110_000, undefined,
      { code: 1, stderr: frame }).message)
      .toBe("Embryo journey fitted command failed; EMBRYO_FITTED_FAILURE_V1|COMMAND_EXIT|WORK_EXIT|CLAIM|invalid_response");
  });
});


const proofSizeFields = ["bindingsCurrent", "fitPackage", "wholeRowHashes", "jobs", "scores", "calls"] as const;
function proofSizeEnvelope() {
  const fieldBytes = { bindingsCurrent: 4, fitPackage: 2048, wholeRowHashes: 256, jobs: 24_000, scores: 12_000, calls: 2048 };
  return { version: "embryo-fitted-proof-size-v1", backendPid: 12345,
    byteCount: Object.values(fieldBytes).reduce((sum, size) => sum + size, 0)
      + proofSizeFields.reduce((sum, key) => sum + key.length + 6, 0), sha256: "a".repeat(64), fieldBytes };
}
describe("supplemental exact fitted proof buffer and size observations", () => {
  it.each([
    ["x".repeat(32_768), "", "STDOUT"], ["", "x".repeat(32_768), "STDERR"],
    ["x".repeat(32_768), "y".repeat(32_768), "BOTH"], ["small", "small", "UNKNOWN"],
    ["é".repeat(16_384), "", "STDOUT"], ["x".repeat(32_769), "", "UNKNOWN"],
  ] as const)("classifies only own primitive retained UTF8 byte lengths %#", (stdout, stderr, expected) => {
    expect(fittedProofOverflowPipe({ code: "ERR_CHILD_PROCESS_STDIO_MAXBUFFER", stdout, stderr })).toBe(expected);
  });
  it("never executes getters/coercion or adopts inherited/non-string/private output", () => {
    const getter = vi.fn(() => { throw new Error("synthetic-private-size-canary"); });
    const error = { code: "ERR_CHILD_PROCESS_STDIO_MAXBUFFER" };
    for (const key of ["stdout", "stderr", "message"]) Object.defineProperty(error, key, { get: getter });
    expect(fittedProofOverflowPipe(error)).toBe("UNKNOWN");expect(getter).not.toHaveBeenCalled();
    expect(fittedProofOverflowPipe(Object.create({ code: "ERR_CHILD_PROCESS_STDIO_MAXBUFFER", stdout: "x".repeat(32_768), stderr: "" }))).toBe("UNKNOWN");
    expect(fittedProofOverflowPipe({ code: 1, stdout: "x".repeat(32_768), stderr: "" })).toBe("UNKNOWN");
    expect(fittedProofOverflowPipe({ code: "ERR_CHILD_PROCESS_STDIO_MAXBUFFER", stdout: Buffer.alloc(32_768), stderr: "" })).toBe("UNKNOWN");
    expect(fittedProofOverflowPipe({ code: "ERR_CHILD_PROCESS_STDIO_MAXBUFFER", stdout: { toString: getter }, stderr: "" })).toBe("UNKNOWN");
    expect(getter).not.toHaveBeenCalled();
  });
  it("materializes the complete original proof and changes only finite final emission", async () => {
    const { command } = await fittedProofCommand(), diagnostic = fittedNativeProofSizeSql(command.args, command.input, 10_000, command.context)!;
    const prefix = "with fitted_proof_size_value(proof) as materialized(\n", boundary = "\n)\n    select jsonb_build_object";
    const compactPrefix = "with fitted_proof_compact_value(proof) as materialized(\n";
    const compactBoundary = "\n), fitted_proof_compact_text as materialized(";
    const originalValue = command.input!.slice(compactPrefix.length, command.input!.indexOf(compactBoundary));
    expect(diagnostic.slice(prefix.length, diagnostic.indexOf(boundary))).toBe(originalValue);
    expect(diagnostic.startsWith(prefix)).toBe(true);expect(diagnostic).toContain("'backendPid',pg_backend_pid()");
    expect(diagnostic).toContain("octet_length(convert_to(proof::text,'UTF8'))");
    expect(diagnostic).toContain("extensions.digest(convert_to(proof::text,'UTF8'),'sha256')");
    for (const key of proofSizeFields) expect(diagnostic).toContain(`'${key}',octet_length(convert_to((proof->'${key}')::text,'UTF8'))`);
    expect(diagnostic).not.toMatch(/begin|read only|insert into|update |delete from|create |truncate /i);
    expect(diagnostic).not.toContain("jsonb_each");
    for (const [args, input, timeout, context] of [
      [command.args, command.input! + "\nselect true;", 10_000, command.context],
      [[...command.args, "extra"], command.input, 10_000, command.context],
      [command.args, command.input, 10_001, command.context], [command.args, command.input, 10_000, undefined],
    ] as const) expect(fittedNativeProofSizeSql(args, input, timeout, context)).toBeNull();
  });
  it("accepts only exact bounded whole native sizes and a fresh physical PID, never content", () => {
    const row = proofSizeEnvelope(), frame = fittedNativeProofSizeFrame(JSON.stringify(row));
    expect(frame).toBe(["EMBRYO_FITTED_PROOF_SIZE_V1", "OBSERVED", row.backendPid, row.byteCount, row.sha256,
      ...proofSizeFields.map(key => row.fieldBytes[key])].join("|"));
    expect(frame!.length).toBeLessThanOrEqual(256);expect(frame).toMatch(/^[\x20-\x7e]+$/);
    const changed = [null, [], { ...row, extra: "synthetic-private-size-canary" }, { ...row, backendPid: 0 },
      { ...row, backendPid: 2_147_483_648 }, { ...row, byteCount: row.byteCount + 1 }, { ...row, sha256: "not-a-digest" },
      { ...row, fieldBytes: { ...row.fieldBytes, other: 1 } }, { ...row, fieldBytes: { ...row.fieldBytes, jobs: -1 } },
      { ...row, fieldBytes: { ...row.fieldBytes, jobs: 1.5 } }, { ...row, version: "other" }];
    for (const value of changed) expect(fittedNativeProofSizeFrame(JSON.stringify(value))).toBeNull();
    expect(fittedNativeProofSizeFrame(JSON.stringify(row) + "\nsynthetic-private-size-canary")).toBeNull();
    expect(fittedNativeProofSizeFrame("x".repeat(513))).toBeNull();
  });
  it("observes once only after the exact original buffer refusal and retains that Error identity", async () => {
    const { command } = await fittedProofCommand(), failure = embryoJourneyCommandFailure(command.args, command.input, 10_000, command.context,
      { code: "ERR_CHILD_PROCESS_STDIO_MAXBUFFER", stdout: "x".repeat(32_768), stderr: "" }), originalMessage = failure.message;
    const observe = vi.fn(async () => JSON.stringify(proofSizeEnvelope()));
    await observeFittedNativeProofSizeFailure(command.args, command.input, 10_000, command.context, failure, observe);
    expect(observe).toHaveBeenCalledTimes(1);
    expect(observe.mock.calls[0]).toEqual([command.args, fittedNativeProofSizeSql(command.args, command.input, 10_000, command.context), 10_000]);
    expect(failure.message.startsWith(originalMessage + "\n")).toBe(true);
    expect(failure.message).toContain("EMBRYO_FITTED_PROOF_OVERFLOW_V1|STDOUT");
    expect(failure.message).toContain("EMBRYO_FITTED_PROOF_SIZE_V1|OBSERVED|12345|");
    await observeFittedNativeProofSizeFailure(command.args, command.input, 10_000, command.context, failure, observe);
    expect(observe).toHaveBeenCalledTimes(1);expect(failure.message).not.toMatch(/success|complete/i);
  });
  it.each(["rejected", "malformed", "oversized"] as const)("keeps supplemental refusal opaque and preserves the original proof refusal %#", async kind => {
    const { command } = await fittedProofCommand(), failure = embryoJourneyCommandFailure(command.args, command.input, 10_000, command.context,
      { code: "ERR_CHILD_PROCESS_STDIO_MAXBUFFER" }), originalMessage = failure.message;
    const observe = vi.fn(async () => {
      if (kind === "rejected") throw new Error("synthetic-private-size-canary");
      return kind === "malformed" ? '{"raw":"synthetic-private-size-canary"}' : "x".repeat(513);
    });
    await observeFittedNativeProofSizeFailure(command.args, command.input, 10_000, command.context, failure, observe);
    expect(observe).toHaveBeenCalledTimes(1);expect(failure.message).toBe(originalMessage
      + "\nEMBRYO_FITTED_PROOF_OVERFLOW_V1|UNKNOWN\nEMBRYO_FITTED_PROOF_SIZE_V1|NOT_OBSERVED");
    expect(failure.message).not.toContain("synthetic-private-size-canary");
  });
  it("never probes another cause, changed context/argv/SQL/deadline or an unregistered private error", async () => {
    const { command } = await fittedProofCommand(), observe = vi.fn(async () => JSON.stringify(proofSizeEnvelope()));
    for (const error of [{ code: 1 }, { killed: true, signal: "SIGKILL" }, {}]) {
      const failure = embryoJourneyCommandFailure(command.args, command.input, 10_000, command.context, error), message = failure.message;
      await observeFittedNativeProofSizeFailure(command.args, command.input, 10_000, command.context, failure, observe);
      expect(failure.message).toBe(message);
    }
    const failure = embryoJourneyCommandFailure(command.args, command.input, 10_000, command.context,
      { code: "ERR_CHILD_PROCESS_STDIO_MAXBUFFER", stdout: "", stderr: "x".repeat(32_768) }), message = failure.message;
    for (const [args, input, timeout, context] of [
      [[...command.args, "extra"], command.input, 10_000, command.context],
      [command.args, command.input! + "\nselect true;", 10_000, command.context],
      [command.args, command.input, 9999, command.context], [command.args, command.input, 10_000, undefined],
    ] as const) await observeFittedNativeProofSizeFailure(args, input, timeout, context, failure, observe);
    await observeFittedNativeProofSizeFailure(command.args, command.input, 10_000, command.context,
      new Error("synthetic-private-size-canary"), observe);
    expect(observe).not.toHaveBeenCalled();expect(failure.message).toBe(message);
  });
  it("still rejects the real helper callback, preserves first history and restores configuration after a size observation", async () => {
    const h = fittedHarness(), native = h.io.execute, selected: Array<{ input?: string; timeout?: number; context?: string }> = [];
    let failure: Error | undefined;
    h.io.execute = async (args, input, timeout, context) => {
      selected.push({ input, timeout, context });
      if (context === "fitted-native-proof") {
        failure = embryoJourneyCommandFailure(args, input, timeout!, context,
          { code: "ERR_CHILD_PROCESS_STDIO_MAXBUFFER", stdout: "x".repeat(32_768), stderr: "" });
        throw failure;
      }
      if (input?.startsWith("with fitted_proof_size_value")) return JSON.stringify(proofSizeEnvelope());
      return native(args, input, timeout, context);
    };
    const result = await originalThenFitted(h, async fitted => {
      await fitted.runWorker(fittedCohort);await fitted.runStatisticalWorker(fittedCohort);
      await fitted.statisticalProof(fittedCohort);
    }).then(() => null, error => error);
    expect(result).toBe(failure);expect(result.message).toContain("COMMAND_OUTPUT_BOUND");
    const supplement = selected.filter(row => row.input?.startsWith("with fitted_proof_size_value"));
    expect(supplement).toHaveLength(1);expect(supplement[0]).toMatchObject({ timeout: 10_000, context: undefined });
    expect(h.current()).toEqual(original);expect(h.statements.filter(sql => sql.startsWith("-- embryo-first-completed-history")).length).toBeGreaterThan(0);
  });
});

describe("lossless fitted proof emission retains the whole native value", () => {
  it("materializes the complete original source body exactly once with native round-trip equality", async () => {
    const { command } = await fittedProofCommand();
    const code = readFileSync(new URL("./ci-embryo-journey.ts", import.meta.url), "utf8");
    const originalBody = /function fittedStatisticalProofValue\(cohort: string\): string \{\n  return `([\s\S]*?)`;\n\}/.exec(code)?.[1];
    expect(originalBody).toBeDefined();expect(originalBody!.endsWith(";")).toBe(true);
    const completeValue = originalBody!.replaceAll("${cohort}", `'${fittedCohort}'::uuid`).slice(0, -1);
    const prefix = "with fitted_proof_compact_value(proof) as materialized(\n";
    const boundary = "\n), fitted_proof_compact_text as materialized(";
    expect(command.input!.slice(prefix.length, command.input!.indexOf(boundary))).toBe(completeValue);
    expect(command.input!.split(completeValue)).toHaveLength(2);
    expect(command.input!.match(/regexp_replace/g)).toHaveLength(1);
    expect(command.input).toContain("proof is not null and compact_text::jsonb is not distinct from proof");
    expect(command.input).toContain("then compact_text else null end from fitted_proof_compact_text;");
    expect(command.args).toEqual(["exec", "-i", "supabase_db_sequence", "psql", "-U", "postgres", "-d", "postgres", "-XAtq", "--set=ON_ERROR_STOP=1"]);
    expect(command.timeout).toBe(10_000);
  });
  it("refuses the old emitter and altered materialization, regex, round-trip or final emission", async () => {
    const { command } = await fittedProofCommand();
    const prefix = "with fitted_proof_compact_value(proof) as materialized(\n";
    const boundary = "\n), fitted_proof_compact_text as materialized(";
    const originalValue = command.input!.slice(prefix.length, command.input!.indexOf(boundary));
    const changed = [originalValue + ";", command.input!.replace("as materialized(", "as ("),
      command.input!.replace("regexp_replace", "replace"), command.input!.replace("compact_text::jsonb is not distinct from proof", "true"),
      command.input!.replace("then compact_text else null", "then proof::text else null"), command.input! + "select true;"];
    for (const input of changed) expect(isFittedNativeProofCommand(command.args, input, 10_000, command.context)).toBe(false);
  });
  it("keeps later size observation on the entire original JSONB instead of compact text", async () => {
    const { command } = await fittedProofCommand();
    const diagnostic = fittedNativeProofSizeSql(command.args, command.input, 10_000, command.context)!;
    expect(diagnostic).not.toContain("regexp_replace");expect(diagnostic).not.toContain("compact_text");
    expect(diagnostic).not.toContain("fitted_proof_compact_value");
    expect(diagnostic).toContain("octet_length(convert_to(proof::text,'UTF8'))");
    expect(diagnostic).toContain("extensions.digest(convert_to(proof::text,'UTF8'),'sha256')");
    expect(diagnostic.match(/private\.capture_embryo_test_statistical_fit_v1/g)).toHaveLength(1);
    for (const key of proofSizeFields) expect(diagnostic).toContain(`'${key}',octet_length(convert_to((proof->'${key}')::text,'UTF8'))`);
  });
});
