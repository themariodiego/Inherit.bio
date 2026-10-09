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
