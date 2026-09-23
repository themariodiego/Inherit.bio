import assert from "node:assert/strict";
import { execFile, spawn, type ChildProcess } from "node:child_process";
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { assertCiRuntime, CI_RUNTIME_CONTAINER, PREPARED_APP_ENV } from "./ci-browser-config";
import { checkedPreparedArtifactProof } from "./ci-browser/prepared-artifact-proof";

type Environment = Readonly<Record<string, string | undefined>>;
type Config = { singleton: true; enabled: boolean; artifact_provider: "supabase"; r2_bucket: null;
  max_artifact_bytes: number; max_job_seconds: number; monthly_admission_limit: number };
type Execute = (args: string[], input?: string, timeout?: number) => Promise<string>;
export type JourneyIo = { execute: Execute; owner: () => unknown; root: () => string };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const DB = "supabase_db_sequence";
const CONFIG = "private.own_preparation_config";
const JOBS = "private.own_preparation_jobs";
const CLEANUPS = "private.own_prepared_cleanups";
const identityFormat = '{"name":{{json .Name}},"running":{{json .State.Running}},"project":{{json (index .Config.Labels "com.supabase.cli.project")}},"owner":{{json (index .Config.Labels "inherit.ci-browser-runtime")}},"network":{{json .HostConfig.NetworkMode}},"mounts":{{json .Mounts}}}';
/** Only these credentials enter the already isolated namespace, over stdin. */
export function checkedPreparedWorkerEnvironment(value: unknown): Record<string, string> {
  assert(value && typeof value === "object" && !Array.isArray(value), "Missing fixed worker configuration");
  const env = value as Record<string, unknown>;
  const credential = env.SUPABASE_SERVICE_ROLE_KEY;
  const names = ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "INHERIT_PREPARED_WGS_ENABLED"];
  const r2 = Object.hasOwn(env, "INHERIT_PREPARED_R2_ORIGIN");
  if (r2) names.push("INHERIT_PREPARED_R2_ORIGIN", "INHERIT_PREPARED_R2_BUCKET", "INHERIT_UPLOAD_SIGNING_JWK");
  assert(Object.keys(env).length === names.length && Object.keys(env).every(name => names.includes(name))
    && env.NEXT_PUBLIC_SUPABASE_URL === "http://127.0.0.1:54321" && env.INHERIT_PREPARED_WGS_ENABLED === "true"
    && typeof credential === "string" && credential.length > 0
    && credential.length < 8192, "Worker scope differs from fixed local configuration");
  if (r2) assert(env.INHERIT_PREPARED_R2_ORIGIN === PREPARED_APP_ENV.INHERIT_PREPARED_R2_ORIGIN
    && env.INHERIT_PREPARED_R2_BUCKET === PREPARED_APP_ENV.INHERIT_PREPARED_R2_BUCKET
    && typeof env.INHERIT_UPLOAD_SIGNING_JWK === "string" && env.INHERIT_UPLOAD_SIGNING_JWK.length > 0
    && env.INHERIT_UPLOAD_SIGNING_JWK.length < 4096, "Fixed synthetic artifact gateway required");
  return { ...env } as Record<string, string>;
}
export const PREPARED_WORKER_ARGS = Object.freeze(["--conditions=react-server", "--import", "/app/scripts/server-only-shim.mjs",
  "--import", "tsx", "/app/scripts/prepared-worker.run.mts", "--once"]);
export const PREPARED_WORKER_LIMIT_MS = 90_000;

/** Fixed production entrypoint with its cleanup-first --once semantics. Its
 * own namespace timer survives a lost host docker-exec connection. Uncertain
 * exit, truncated output or timeout never becomes a successful preparation. */
export async function runPreparedWorkerInside(value: unknown, signal: AbortSignal, dependencies = {
  spawn: (env: Record<string, string>) => spawn("node", [...PREPARED_WORKER_ARGS], {
    cwd: "/app", env: { NODE_ENV: "production", PATH: "/usr/local/bin:/usr/bin:/bin", ...env,
      ...(env.INHERIT_PREPARED_R2_ORIGIN ? { NODE_EXTRA_CA_CERTS: "/tls/fixture/ca.crt" } : {}) },
    detached: true, stdio: ["ignore", "pipe", "pipe"],
  }) as ChildProcess,
  kill: (pid: number, kind: NodeJS.Signals) => process.kill(-pid, kind),
}): Promise<void> {
  const env = checkedPreparedWorkerEnvironment(value);
  assert(!signal.aborted, "Prepared worker was cancelled before launch");
  const child = dependencies.spawn(env);
  let output = "", stopped = false, escalation: NodeJS.Timeout | undefined, terminal: NodeJS.Timeout | undefined;
  await new Promise<void>((resolve, reject) => {
    let finished = false;
    const finish = (okay = false) => {
      if (finished) return;
      finished = true; clearTimeout(deadline); clearTimeout(escalation); clearTimeout(terminal);
      signal.removeEventListener("abort", stop);
      if (okay) resolve(); else reject(new Error("Prepared worker outcome was not a clean completion"));
    };
    const kill = (kind: NodeJS.Signals) => {
      if (child.pid) { try { dependencies.kill(child.pid, kind); } catch { /* exit remains authoritative */ } }
    };
    const stop = () => {
      if (stopped || finished) return;
      stopped = true; kill("SIGTERM");
      escalation = setTimeout(() => { kill("SIGKILL"); terminal = setTimeout(() => finish(), 1000); }, 5000);
    };
    const deadline = setTimeout(stop, PREPARED_WORKER_LIMIT_MS);
    signal.addEventListener("abort", stop, { once: true });
    child.stdout?.on("data", chunk => {
      if (stopped) return;
      output += chunk.toString();
      if (output.length > 512) { output = ""; stop(); }
    });
    child.stderr?.resume();
    child.once("error", stop);
    child.once("close", code => finish(!stopped && code === 0
      && output === "cleanup_idle\npreparation_prepared\n"));
    if (signal.aborted) stop();
  });
}

function checkedConfig(value: unknown): Config {
  assert(value && typeof value === "object" && !Array.isArray(value), "Preparation configuration missing");
  const c = value as Config;
  assert(Object.keys(c).sort().join(",") === "artifact_provider,enabled,max_artifact_bytes,max_job_seconds,monthly_admission_limit,r2_bucket,singleton"
    && c.singleton === true && typeof c.enabled === "boolean" && c.artifact_provider === "supabase" && c.r2_bucket === null
    && Number.isSafeInteger(c.max_artifact_bytes) && c.max_artifact_bytes > 0
    && Number.isSafeInteger(c.max_job_seconds) && c.max_job_seconds > 0
    && Number.isSafeInteger(c.monthly_admission_limit) && c.monthly_admission_limit > 0,
  "Only the existing local preparation configuration is supported");
  return Object.freeze({ ...c });
}
function jsonLiteral(value: Config) { return `'${JSON.stringify(value)}'::jsonb`; }
function fileLiteral(fileId: string) { assert(UUID.test(fileId), "Exact synthetic file required"); return `'${fileId}'::uuid`; }

function defaultIo(env: Environment): JourneyIo {
  return {
    execute: async (args, input, timeout = 10_000) => {
      try {
        const child = promisify(execFile)("docker", args, { timeout, killSignal: "SIGKILL", maxBuffer: 32_768 });
        child.child.stdin?.on("error", () => {});
        child.child.stdin?.end(input);
        return (await child).stdout.trim();
      } catch { throw new Error("Prepared journey fixed local command failed; diagnostics withheld"); }
    },
    root: () => realpathSync(process.cwd()),
    owner: () => {
      assert(env.RUNNER_TEMP && path.isAbsolute(env.RUNNER_TEMP), "Runner ownership directory required");
      const file = path.join(env.RUNNER_TEMP, "inherit-ci-browser-owner.json"), stat = lstatSync(file);
      assert(stat.isFile() && !stat.isSymbolicLink() && stat.size < 1024
        && (stat.mode & 0o077) === 0 && stat.uid === process.getuid!(), "Protected runtime ownership receipt required");
      return JSON.parse(readFileSync(file, "utf8"));
    },
  };
}
/** Not a SQL/command interface: callers can only enter this exact fixture,
 * run its one queued job, and read its aggregate proof. The original config is
 * captured before activation and restored even if activation's response is lost.
 * No budget, source, grant or completed result is inserted by this fixture. */
export async function withPreparedJourney<T>(env: Environment, work: (fixture: {
  runWorker: (fileId: string) => Promise<void>;
  proof: (fileId: string) => Promise<unknown>;
}) => Promise<T>, io = defaultIo(env), platform = process.platform): Promise<T> {
  return withPreparedFixture(env, work, false, io, platform);
}

/** Complete deletion uses the production gateway and bounded synthetic R2
 * binding. The original Supabase fixture and its unresolved-cleanup refusal
 * remain available; no hosted storage or physical-erasure claim is made. */
export async function withPreparedR2Journey<T>(env: Environment, work: (fixture: {
  runWorker: (fileId: string) => Promise<void>;
  proof: (fileId: string) => Promise<unknown>;
  artifactProof: () => Promise<ReturnType<typeof checkedPreparedArtifactProof>>;
}) => Promise<T>, io = defaultIo(env), platform = process.platform): Promise<T> {
  return withPreparedFixture(env, work, true, io, platform);
}

async function withPreparedFixture<T>(env: Environment, work: (fixture: {
  runWorker: (fileId: string) => Promise<void>;
  proof: (fileId: string) => Promise<unknown>;
  artifactProof: () => Promise<ReturnType<typeof checkedPreparedArtifactProof>>;
}) => Promise<T>, r2: boolean, io: JourneyIo, platform: NodeJS.Platform): Promise<T> {
  assertCiRuntime(env, platform);
  assert(env.INHERIT_CI_BROWSER_RUNTIME === "ready", "Isolated runtime preflight required");
  const owner = io.owner() as { owner?: unknown };
  assert(owner && Object.keys(owner).length === 1 && typeof owner.owner === "string" && UUID.test(owner.owner), "Exact runtime owner required");
  const user = `${env.INHERIT_CI_RUNTIME_UID}:${env.INHERIT_CI_RUNTIME_GID}`;
  assert(/^[1-9][0-9]*:[1-9][0-9]*$/.test(user), "Unprivileged runtime identity required");
  const worker = checkedPreparedWorkerEnvironment({ NEXT_PUBLIC_SUPABASE_URL: env.NEXT_PUBLIC_SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY: env.SUPABASE_SERVICE_ROLE_KEY, INHERIT_PREPARED_WGS_ENABLED: "true",
    ...(r2 ? { ...PREPARED_APP_ENV, INHERIT_UPLOAD_SIGNING_JWK: env.INHERIT_UPLOAD_SIGNING_JWK } : {}) });
  const root = io.root();
  assert(path.isAbsolute(root) && path.resolve(root) === root, "Exact checkout mount required");
  const checkIdentity = async () => {
    for (const name of [DB, "supabase_storage_sequence", CI_RUNTIME_CONTAINER]) {
      const item = JSON.parse(await io.execute(["inspect", "--format", identityFormat, name]));
      assert(item.name === `/${name}` && item.running === true && item.network === "supabase_network_sequence",
        "Exact running local namespace required");
      if (name === CI_RUNTIME_CONTAINER) {
        assert(item.owner === owner.owner && Array.isArray(item.mounts)
          && item.mounts.some((mount: { Source?: string; Destination?: string; RW?: boolean }) =>
            mount.Source === root && mount.Destination === "/app" && mount.RW === false), "Exact owned checkout runtime required");
      } else assert(item.project === "sequence", "Exact local project required");
    }
  };
  const sql = async (statement: string) => {
    await checkIdentity();
    return io.execute(["exec", "-i", DB, "psql", "-U", "postgres", "-d", "postgres", "-XAtq", "--set=ON_ERROR_STOP=1"], statement);
  };
  const original = checkedConfig(JSON.parse(await sql(`select to_jsonb(c) from ${CONFIG} c where singleton;`)));
  assert(original.enabled === false, "Never take over an enabled preparation worker");
  // Refuse every stale job, including frozen work that still needs cleanup.
  assert(await sql(`select (not exists(select 1 from ${JOBS}) and not exists(select 1 from ${CLEANUPS}))::text;`) === "true",
    "Prepared journey requires an empty preparation and cleanup queue");
  let workerAttempted = false;
  try {
    const activation = r2 ? `enabled=true,artifact_provider='r2',r2_bucket='${PREPARED_APP_ENV.INHERIT_PREPARED_R2_BUCKET}'` : "enabled=true";
    const activated = await sql(`with changed as (update ${CONFIG} c set ${activation} where singleton and to_jsonb(c)=${jsonLiteral(original)} returning 1) select count(*) from changed;`);
    assert(activated === "1", "Preparation configuration changed before activation");
    return await work({
      runWorker: async fileId => {
        const file = fileLiteral(fileId);
        assert(!workerAttempted, "No duplicate or uncertain worker attempt is permitted");
        assert(await sql(`select ((select count(*) from ${JOBS})=1 and exists(select 1 from ${JOBS} where file_id=${file} and state='queued' and attempts=0) and not exists(select 1 from ${CLEANUPS} where state<>'complete'))::text;`) === "true",
          "Refusing unrelated or previously attempted preparation work");
        workerAttempted = true;
        await checkIdentity();
        const output = await io.execute(["exec", "-i", "--user", user, CI_RUNTIME_CONTAINER,
          "node", "--import", "tsx", "/app/scripts/ci-browser/prepared-worker.mts"], JSON.stringify(worker) + "\n", PREPARED_WORKER_LIMIT_MS + 20_000);
        assert(output === "PREPARED_JOURNEY_WORKER_COMPLETE", "Worker did not prove one clean preparation");
      },
      proof: async fileId => JSON.parse(await sql(preparedProof(fileLiteral(fileId), r2))),
      artifactProof: async () => {
        assert(r2, "Artifact evidence requires the fixed synthetic gateway");
        await checkIdentity();
        const output = await io.execute(["exec", "--user", user, CI_RUNTIME_CONTAINER,
          "node", "--import", "tsx", "/app/scripts/ci-browser/read-prepared-artifact-proof.mts"]);
        return checkedPreparedArtifactProof(JSON.parse(output));
      },
    });
  } finally {
    // Restore only the field we changed, then compare the whole captured row.
    // Any concurrent change remains an explicit failure, never silently reset.
    const restoration = r2
      ? `enabled=false,artifact_provider='supabase',r2_bucket=null where singleton and enabled=true and artifact_provider='r2' and r2_bucket='${PREPARED_APP_ENV.INHERIT_PREPARED_R2_BUCKET}'`
      : "enabled=false where singleton";
    const restored = await sql(`update ${CONFIG} set ${restoration}; select to_jsonb(c) from ${CONFIG} c where singleton;`);
    assert.deepEqual(checkedConfig(JSON.parse(restored)), original, "Preparation configuration did not restore exactly");
  }
}

function preparedProof(file: string, r2: boolean): string {
  const provider = r2
    ? `a.provider='r2' and a.provider_bucket='${PREPARED_APP_ENV.INHERIT_PREPARED_R2_BUCKET}' and a.provider_version ~ '^[0-9a-f]{32}$' and a.provider_etag ~ '^[0-9a-f]{32}$'`
    : "a.provider='supabase' and a.provider_bucket='genomes'";
  const artifacts = r2 ? `
    'artifacts',(select count(*) from private.own_preparation_artifacts a join ${JOBS} j on j.id=a.job_id where j.file_id=${file}),
    'allArtifactsCurrent',coalesce((select bool_and(a.state='acknowledged' and a.observed_sha256=a.sha256 and ${provider})
      from private.own_preparation_artifacts a join ${JOBS} j on j.id=a.job_id where j.file_id=${file}),false),` : "";
  return `select json_build_object(
    ${artifacts}
    'jobs',(select count(*) from ${JOBS} where file_id=${file} and state='published'),
    'manifests',(select count(*) from private.own_prepared_manifests where file_id=${file}),
    'membersCurrent',coalesce((select m.member_count=count(mm.artifact_id) and bool_and(a.state='acknowledged' and a.observed_sha256=a.sha256 and ${provider})
      from private.own_prepared_manifests m join private.own_prepared_manifest_members mm on mm.manifest_id=m.id
      join private.own_preparation_artifacts a on a.id=mm.artifact_id where m.file_id=${file} group by m.id),false),
    'normalizations',(select count(*) from private.own_normalization_runs where file_id=${file}),
    'observedCalls',(select count(*) from public.report_observed_calls where file_id=${file}),
    'analysisRuns',(select count(*) from private.own_analysis_runs where file_id=${file}));`;
}
