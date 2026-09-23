import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import type { ChildProcess } from "node:child_process";
import { afterEach, describe, expect, it, vi } from "vitest";
import { checkedPreparedWorkerEnvironment, PREPARED_WORKER_ARGS, PREPARED_WORKER_LIMIT_MS,
  runPreparedWorkerInside, withPreparedJourney, withPreparedR2Journey, type JourneyIo } from "./ci-prepared-journey";

const owner = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", file = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const worker = { NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
  SUPABASE_SERVICE_ROLE_KEY: "EXAMPLE_SYNTHETIC_SERVICE", INHERIT_PREPARED_WGS_ENABLED: "true" };
const env = { ...worker, CI: "true", GITHUB_ACTIONS: "true", RUNNER_ENVIRONMENT: "github-hosted",
  INHERIT_DISPOSABLE_LOCAL_E2E: "true", INHERIT_CI_BROWSER_RUNTIME: "ready",
  INHERIT_CI_RUNTIME_UID: "1001", INHERIT_CI_RUNTIME_GID: "1001" };
const config = { singleton: true, enabled: false, artifact_provider: "supabase", r2_bucket: null,
  max_artifact_bytes: 104857600, max_job_seconds: 900, monthly_admission_limit: 100 };
const r2Worker = { ...worker, INHERIT_PREPARED_R2_ORIGIN: "https://prepared.artifacts.test:8140",
  INHERIT_PREPARED_R2_BUCKET: "inherit-prepared-ci", INHERIT_UPLOAD_SIGNING_JWK: "EXAMPLE_SYNTHETIC_SIGNER" };
const r2Env = { ...env, INHERIT_UPLOAD_SIGNING_JWK: r2Worker.INHERIT_UPLOAD_SIGNING_JWK };
const artifactSnapshot = { requests: 0, rejected: 0, activeRequests: 0, receivedBytes: 0, objects: 0, payloadBytes: 0,
  payloadObjects: 0, tombstones: 0, putCommits: 0, tombstoneCommits: 0, getReads: 0, allPayloadsEmpty: false };
type FixtureConfig = Omit<typeof config, "r2_bucket"> & { r2_bucket: string | null };
function harness() {
  const statements: string[] = [], commands: Array<{ args: string[]; input?: string; timeout?: number }> = [];
  let current: FixtureConfig = { ...config }, identity: Record<string, unknown> = {}, empty = true, exact = true;
  let activationLoss = false, workerLoss = false;
  let beforeActivation: Partial<FixtureConfig> = {}, proof: unknown = artifactSnapshot;
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
        if (input!.startsWith("with changed")) {
          current = { ...current, ...beforeActivation };
          const captured = JSON.parse(input!.match(/to_jsonb\(c\)='([^']+)'::jsonb/)![1]);
          if (JSON.stringify(current) !== JSON.stringify(captured)) return "0";
          current.enabled = true;
          if (input!.includes("artifact_provider='r2'")) Object.assign(current, { artifact_provider: "r2", r2_bucket: "inherit-prepared-ci" });
          if (activationLoss) throw new Error("uncertain activation");
          return "1";
        }
        if (input!.startsWith("update private")) {
          if (input!.includes("artifact_provider='supabase'")) {
            if (current.enabled && current.artifact_provider === "r2" && current.r2_bucket === "inherit-prepared-ci")
              Object.assign(current, { enabled: false, artifact_provider: "supabase", r2_bucket: null });
          } else current.enabled = false;
          return JSON.stringify(current);
        }
        if (input!.startsWith("select ((select count")) return String(exact);
        if (input!.startsWith("select json_build_object")) return '{"jobs":1}';
        throw new Error("Unexpected SQL");
      }
      if (args.includes("/app/scripts/ci-browser/read-prepared-artifact-proof.mts")) return JSON.stringify(proof);
      if (workerLoss) throw new Error("uncertain worker");
      return "PREPARED_JOURNEY_WORKER_COMPLETE";
    },
  };
  return { io, statements, commands, current: () => current,
    identity: (value: Record<string, unknown>) => { identity = value; },
    configure: (value: Partial<FixtureConfig>) => { current = { ...current, ...value }; },
    driftBeforeActivation: (value: Partial<FixtureConfig>) => { beforeActivation = value; },
    artifactProof: (value: unknown) => { proof = value; },
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
describe("prepared journey fixed synthetic R2 setup", () => {
  it("captures the full config, changes only its admitted fields, runs one worker and restores the captured limits", async () => {
    const h = harness();
    await withPreparedR2Journey(r2Env, async fixture => {
      expect(h.current()).toEqual({ ...config, enabled: true, artifact_provider: "r2", r2_bucket: "inherit-prepared-ci" });
      await fixture.runWorker(file);
      await expect(fixture.runWorker(file)).rejects.toThrow("duplicate");
      expect(await fixture.proof(file)).toEqual({ jobs: 1 });
      expect(await fixture.artifactProof()).toEqual(artifactSnapshot);
    }, h.io, "linux");
    expect(h.current()).toEqual(config);
    const launched = h.commands.filter(call => call.args.includes("/app/scripts/ci-browser/prepared-worker.mts"));
    expect(launched).toEqual([{ args: ["exec", "-i", "--user", "1001:1001", "inherit-ci-browser-runtime",
      "node", "--import", "tsx", "/app/scripts/ci-browser/prepared-worker.mts"], input: JSON.stringify(r2Worker) + "\n", timeout: 110_000 }]);
    const activation = h.statements.find(sql => sql.startsWith("with changed"))!;
    expect(activation).toContain("set enabled=true,artifact_provider='r2',r2_bucket='inherit-prepared-ci'");
    expect(activation).toContain(`where singleton and to_jsonb(c)='${JSON.stringify(config)}'::jsonb`);
    expect(h.statements.at(-1)).toContain("set enabled=false,artifact_provider='supabase',r2_bucket=null where singleton and enabled=true and artifact_provider='r2' and r2_bucket='inherit-prepared-ci'");
    expect(h.statements.filter(sql => /update /i.test(sql))).toHaveLength(2);
    expect(h.statements.join("\n")).not.toMatch(/insert into|delete from|set max_|set monthly_/i);
  });
  it("requires actual R2 identity and hashes for all artifacts as well as published manifest members", async () => {
    const h = harness();
    await withPreparedR2Journey(r2Env, async fixture => { await fixture.proof(file); }, h.io, "linux");
    const proof = h.statements.find(sql => sql.startsWith("select json_build_object"))!;
    expect(proof).toContain("'artifacts',(select count(*) from private.own_preparation_artifacts a join private.own_preparation_jobs j on j.id=a.job_id");
    expect(proof).toContain("'allArtifactsCurrent',coalesce((select bool_and(a.state='acknowledged' and a.observed_sha256=a.sha256");
    expect(proof).toContain("'membersCurrent',coalesce((select m.member_count=count(mm.artifact_id) and bool_and(a.state='acknowledged' and a.observed_sha256=a.sha256");
    expect(proof.match(/a.provider='r2' and a.provider_bucket='inherit-prepared-ci'/g)).toHaveLength(2);
    expect(proof.match(/a.provider_version ~ '\^\[0-9a-f\]\{32\}\$' and a.provider_etag ~ '\^\[0-9a-f\]\{32\}\$'/g)).toHaveLength(2);
    expect(proof).not.toContain("a.provider='supabase'");
    expect(proof).toContain(`where j.file_id='${file}'::uuid`);
  });
  it("reads only the fixed protected proof entry after fresh identity checks and rejects malformed evidence", async () => {
    const h = harness();
    await withPreparedR2Journey(r2Env, async fixture => {
      expect(await fixture.artifactProof()).toEqual(artifactSnapshot);
      const command = h.commands.at(-1)!;
      expect(command).toEqual({ args: ["exec", "--user", "1001:1001", "inherit-ci-browser-runtime",
        "node", "--import", "tsx", "/app/scripts/ci-browser/read-prepared-artifact-proof.mts"], input: undefined, timeout: undefined });
      expect(h.commands.slice(-4, -1).map(call => call.args.at(-1)))
        .toEqual(["supabase_db_sequence", "supabase_storage_sequence", "inherit-ci-browser-runtime"]);
      h.artifactProof({ ...artifactSnapshot, payload: "not aggregate evidence" });
      await expect(fixture.artifactProof()).rejects.toThrow("proof unavailable");
      h.artifactProof({ ...artifactSnapshot, allPayloadsEmpty: true });
      await expect(fixture.artifactProof()).rejects.toThrow("proof unavailable");
    }, h.io, "linux");
    expect(h.current()).toEqual(config);
  });
  it.each([
    { artifact_provider: "other" }, { r2_bucket: "inherit-prepared-unrelated" }, { enabled: false },
  ])("refuses to overwrite concurrent provider selection drift: %j", async change => {
    const h = harness();
    await expect(withPreparedR2Journey(r2Env, async () => { h.configure(change); }, h.io, "linux")).rejects.toThrow();
    expect(h.current()).toEqual({ ...config, enabled: true, artifact_provider: "r2", r2_bucket: "inherit-prepared-ci", ...change });
  });
  it("restores only its three changed fields while preserving and reporting unrelated limit drift", async () => {
    const h = harness();
    await expect(withPreparedR2Journey(r2Env, async () => {
      h.configure({ max_job_seconds: 901, monthly_admission_limit: 101 });
    }, h.io, "linux")).rejects.toThrow("restore exactly");
    expect(h.current()).toEqual({ ...config, max_job_seconds: 901, monthly_admission_limit: 101 });
  });
  it("restores after work failure and lost activation acknowledgement without relaunching an uncertain worker", async () => {
    for (const loss of [false, true]) {
      const h = harness(); if (loss) h.loseActivation();
      await expect(withPreparedR2Journey(r2Env, async () => { throw new Error("synthetic failure"); }, h.io, "linux")).rejects.toThrow();
      expect(h.current()).toEqual(config);
    }
    const h = harness(); h.loseWorker();
    await withPreparedR2Journey(r2Env, async fixture => {
      await expect(fixture.runWorker(file)).rejects.toThrow("uncertain worker");
      await expect(fixture.runWorker(file)).rejects.toThrow("duplicate");
    }, h.io, "linux");
    expect(h.current()).toEqual(config);
    expect(h.commands.filter(call => call.args.includes("/app/scripts/ci-browser/prepared-worker.mts"))).toHaveLength(1);
  });
  it("does not activate or run work when captured configuration changes before compare-and-set", async () => {
    const h = harness(), work = vi.fn(); h.driftBeforeActivation({ max_artifact_bytes: 104857601 });
    await expect(withPreparedR2Journey(r2Env, work, h.io, "linux")).rejects.toThrow();
    expect(work).not.toHaveBeenCalled();
    expect(h.current()).toEqual({ ...config, max_artifact_bytes: 104857601 });
    expect(h.commands.some(call => call.args.includes("/app/scripts/ci-browser/prepared-worker.mts"))).toBe(false);
  });
  it("admits exactly the six fixed worker fields and rejects arbitrary origins, buckets or extra environment", () => {
    expect(checkedPreparedWorkerEnvironment(r2Worker)).toEqual(r2Worker);
    expect(Object.keys(checkedPreparedWorkerEnvironment(r2Worker))).toHaveLength(6);
    for (const value of [{ ...r2Worker, INHERIT_PREPARED_R2_ORIGIN: "https://external.invalid" },
      { ...r2Worker, INHERIT_PREPARED_R2_ORIGIN: "http://prepared.artifacts.test:8140" },
      { ...r2Worker, INHERIT_PREPARED_R2_BUCKET: "inherit-prepared-other" },
      { ...r2Worker, INHERIT_UPLOAD_SIGNING_JWK: "" }, { ...r2Worker, NODE_EXTRA_CA_CERTS: "/unrelated" },
      { ...r2Worker, NODE_OPTIONS: "--inspect" }, { ...r2Worker, R2_BUCKET: "other" },
      { ...r2Worker, INHERIT_PREPARED_R2_ORIGIN: undefined }])
      expect(() => checkedPreparedWorkerEnvironment(value)).toThrow();
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
