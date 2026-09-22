import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import type { ChildProcess } from "node:child_process";
import { afterEach, describe, expect, it, vi } from "vitest";
import { checkedPreparedWorkerEnvironment, PREPARED_WORKER_ARGS, PREPARED_WORKER_LIMIT_MS,
  runPreparedWorkerInside, withPreparedJourney, type JourneyIo } from "./ci-prepared-journey";

const owner = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", file = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const worker = { NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
  SUPABASE_SERVICE_ROLE_KEY: "EXAMPLE_SYNTHETIC_SERVICE", INHERIT_PREPARED_WGS_ENABLED: "true" };
const env = { ...worker, CI: "true", GITHUB_ACTIONS: "true", RUNNER_ENVIRONMENT: "github-hosted",
  INHERIT_DISPOSABLE_LOCAL_E2E: "true", INHERIT_CI_BROWSER_RUNTIME: "ready",
  INHERIT_CI_RUNTIME_UID: "1001", INHERIT_CI_RUNTIME_GID: "1001" };
const config = { singleton: true, enabled: false, artifact_provider: "supabase", r2_bucket: null,
  max_artifact_bytes: 104857600, max_job_seconds: 900, monthly_admission_limit: 100 };
function harness() {
  const statements: string[] = [], commands: Array<{ args: string[]; input?: string; timeout?: number }> = [];
  let current = { ...config }, identity: Record<string, unknown> = {}, empty = true, exact = true;
  let activationLoss = false, workerLoss = false;
  const io: JourneyIo = {
    root: () => "/synthetic/checkout", owner: () => ({ owner }),
    execute: async (args, input, timeout) => {
      commands.push({ args, input, timeout });
      if (args[0] === "inspect") return JSON.stringify({ name: `/${args.at(-1)}`, running: true,
        project: "sequence", owner, network: "supabase_network_sequence",
        mounts: [{ Source: "/synthetic/checkout", Destination: "/app", RW: false }], ...identity });
      if (args.includes("psql")) {
        statements.push(input!);
        if (input!.startsWith("select to_jsonb")) return JSON.stringify(current);
        if (input!.startsWith("select (not exists")) return String(empty);
        if (input!.startsWith("with changed")) { current.enabled = true; if (activationLoss) throw new Error("uncertain activation"); return "1"; }
        if (input!.startsWith("update private")) { current.enabled = false; return JSON.stringify(current); }
        if (input!.startsWith("select ((select count")) return String(exact);
        if (input!.startsWith("select json_build_object")) return '{"jobs":1}';
        throw new Error("Unexpected SQL");
      }
      if (workerLoss) throw new Error("uncertain worker");
      return "PREPARED_JOURNEY_WORKER_COMPLETE";
    },
  };
  return { io, statements, commands, current: () => current,
    identity: (value: Record<string, unknown>) => { identity = value; },
    configure: (value: Partial<typeof config>) => { current = { ...current, ...value }; },
    stale: () => { empty = false; }, wrongJob: () => { exact = false; },
    loseActivation: () => { activationLoss = true; }, loseWorker: () => { workerLoss = true; } };
}
describe("prepared journey exact disposable CI setup", () => {
  it("activates only the gate, runs one fixed worker and restores the full original config", async () => {
    const h = harness();
    await withPreparedJourney(env, async fixture => {
      expect(h.current()).toEqual({ ...config, enabled: true });
      await fixture.runWorker(file);
      expect(await fixture.proof(file)).toEqual({ jobs: 1 });
      await expect(fixture.runWorker(file)).rejects.toThrow("duplicate");
    }, h.io, "linux");
    expect(h.current()).toEqual(config);
    const launched = h.commands.filter(call => call.args.includes("/app/scripts/ci-browser/prepared-worker.mts"));
    expect(launched).toEqual([{ args: ["exec", "-i", "--user", "1001:1001", "inherit-ci-browser-runtime",
      "node", "--import", "tsx", "/app/scripts/ci-browser/prepared-worker.mts"], input: JSON.stringify(worker) + "\n", timeout: 110_000 }]);
    expect(h.statements.filter(sql => /update /i.test(sql))).toHaveLength(2);
    expect(h.statements.join("\n")).not.toMatch(/insert into|delete from|set max_|set monthly_|set artifact_provider/i);
  });
  it.each([
    { CI: "" }, { RUNNER_ENVIRONMENT: "self-hosted" }, { VERCEL: "1" },
    { NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co" }, { INHERIT_LOCAL_E2E_PROJECT: "production" },
    { INHERIT_CI_BROWSER_RUNTIME: "" }, { INHERIT_CI_RUNTIME_UID: "0" }, { DEBUG: "*" },
  ])("rejects a mismatched environment before commands: %j", async change => {
    const h = harness();
    await expect(withPreparedJourney({ ...env, ...change }, async () => {}, h.io, "linux")).rejects.toThrow();
    expect(h.commands).toEqual([]);
  });
  it.each([{ owner: "unrelated" }, { running: false }, { network: "host" }, { project: "production" },
    { mounts: [{ Source: "/unrelated", Destination: "/app", RW: false }] },
    { mounts: [{ Source: "/synthetic/checkout", Destination: "/app", RW: true }] }])(
    "refuses wrong process/namespace/mount identity before SQL: %j", async identity => {
      const h = harness(); h.identity(identity);
      await expect(withPreparedJourney(env, async () => {}, h.io, "linux")).rejects.toThrow();
      expect(h.statements).toEqual([]);
    });
  it("refuses stale cleanup, enabled workers, and nonlocal artifact providers", async () => {
    for (const setup of [(h: ReturnType<typeof harness>) => h.stale(),
      (h: ReturnType<typeof harness>) => h.configure({ enabled: true }),
      (h: ReturnType<typeof harness>) => h.configure({ artifact_provider: "r2" })]) {
      const h = harness(); setup(h);
      await expect(withPreparedJourney(env, async () => {}, h.io, "linux")).rejects.toThrow();
      expect(h.statements.some(sql => sql.startsWith("with changed"))).toBe(false);
    }
  });
  it("restores exact captured config after work failure or lost activation response", async () => {
    for (const loss of [false, true]) {
      const h = harness(); if (loss) h.loseActivation();
      await expect(withPreparedJourney(env, async () => { throw new Error("work failed"); }, h.io, "linux")).rejects.toThrow();
      expect(h.current()).toEqual(config);
      expect(h.statements.at(-1)).toMatch(/^update .* set enabled=false/);
    }
  });
  it("rejects unrelated queued jobs and injection before worker launch", async () => {
    const h = harness(); h.wrongJob();
    await withPreparedJourney(env, async fixture => {
      await expect(fixture.runWorker(file)).rejects.toThrow("unrelated");
      await expect(fixture.runWorker(file + "'; select 1;")).rejects.toThrow("Exact synthetic");
      await expect(fixture.proof("not-a-file")).rejects.toThrow("Exact synthetic");
    }, h.io, "linux");
    expect(h.commands.some(call => call.args.includes("/app/scripts/ci-browser/prepared-worker.mts"))).toBe(false);
  });
  it("does not retry an uncertain worker call, and does not overwrite concurrent limit drift", async () => {
    const h = harness(); h.loseWorker();
    await expect(withPreparedJourney(env, async fixture => {
      await expect(fixture.runWorker(file)).rejects.toThrow("uncertain worker");
      await expect(fixture.runWorker(file)).rejects.toThrow("duplicate");
      h.configure({ max_job_seconds: 901 });
    }, h.io, "linux")).rejects.toThrow("restore exactly");
    expect(h.current()).toEqual({ ...config, max_job_seconds: 901 });
  });
});
describe("bounded fixed worker execution", () => {
  afterEach(() => vi.useRealTimers());
  function childFixture() {
    const child = Object.assign(new EventEmitter(), { pid: 12345, stdout: new PassThrough(), stderr: new PassThrough() });
    const dependencies = { spawn: vi.fn(() => child as unknown as ChildProcess), kill: vi.fn() };
    return { child, dependencies };
  }
  it("fixes the production cleanup-first entry and refuses every extra environment surface", () => {
    expect(PREPARED_WORKER_ARGS).toEqual(["--conditions=react-server", "--import", "/app/scripts/server-only-shim.mjs",
      "--import", "tsx", "/app/scripts/prepared-worker.run.mts", "--once"]);
    expect(checkedPreparedWorkerEnvironment(worker)).toEqual(worker);
    for (const value of [{ ...worker, NODE_OPTIONS: "--inspect" }, { ...worker, COMMAND: "other" },
      { ...worker, NEXT_PUBLIC_SUPABASE_URL: "http://localhost:54321" }, { ...worker, INHERIT_PREPARED_WGS_ENABLED: "false" },
      { ...worker, SUPABASE_SERVICE_ROLE_KEY: "" }, { ...worker, R2_BUCKET: "other" }])
      expect(() => checkedPreparedWorkerEnvironment(value)).toThrow();
  });
  it("accepts only cleanup-idle then one prepared result and a successful process close", async () => {
    const h = childFixture();
    const result = runPreparedWorkerInside(worker, new AbortController().signal, h.dependencies);
    h.child.stdout.write("cleanup_idle\npreparation_"); h.child.stdout.write("prepared\n"); h.child.emit("close", 0);
    await result; expect(h.dependencies.spawn).toHaveBeenCalledWith(worker); expect(h.dependencies.kill).not.toHaveBeenCalled();
  });
  it.each(["preparation_prepared\n", "cleanup_deferred\n", "cleanup_idle\npreparation_idle\n", "secret diagnostic\n"])(
    "rejects incomplete or unexpected worker output without exposing it: %s", async output => {
      const h = childFixture(), result = runPreparedWorkerInside(worker, new AbortController().signal, h.dependencies);
      h.child.stdout.write(output); h.child.emit("close", 0);
      await expect(result).rejects.toThrow("not a clean completion");
    });
  it("bounds an unresponsive child with TERM then KILL, never treating uncertain exit as success", async () => {
    vi.useFakeTimers();
    const h = childFixture(), result = runPreparedWorkerInside(worker, new AbortController().signal, h.dependencies);
    const failure = expect(result).rejects.toThrow("not a clean completion");
    await vi.advanceTimersByTimeAsync(PREPARED_WORKER_LIMIT_MS);
    expect(h.dependencies.kill.mock.calls).toEqual([[12345, "SIGTERM"]]);
    await vi.advanceTimersByTimeAsync(5000);
    expect(h.dependencies.kill.mock.calls).toEqual([[12345, "SIGTERM"], [12345, "SIGKILL"]]);
    await vi.advanceTimersByTimeAsync(1000); await failure;
    expect(vi.getTimerCount()).toBe(0);
  });
  it("terminates on output overflow or cancellation, and refuses pre-aborted starts", async () => {
    for (const overflow of [false, true]) {
      const h = childFixture(), controller = new AbortController();
      const result = runPreparedWorkerInside(worker, controller.signal, h.dependencies);
      if (overflow) h.child.stdout.write("x".repeat(513)); else controller.abort();
      h.child.emit("close", 0);
      await expect(result).rejects.toThrow();
      expect(h.dependencies.kill).toHaveBeenCalledWith(12345, "SIGTERM");
    }
    const h = childFixture();
    await expect(runPreparedWorkerInside(worker, AbortSignal.abort(), h.dependencies)).rejects.toThrow("cancelled");
    expect(h.dependencies.spawn).not.toHaveBeenCalled();
  });
});
