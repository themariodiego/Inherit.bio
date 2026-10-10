import assert from "node:assert/strict";
import { execFile, spawn, type ChildProcess } from "node:child_process";
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { assertCiRuntime, CI_RUNTIME_CONTAINER } from "./ci-browser-config";
import { ownedLinuxEnvironment, type OwnedLinuxCapability } from "./owned-linux-runtime";

type Environment = Readonly<Record<string, string | undefined>>;
type Execute = (args: string[], input?: string, timeout?: number) => Promise<string>;
export type EmbryoJourneyIo = { execute: Execute; owner: () => unknown; root: () => string };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const DB = "supabase_db_sequence";
const SPLIT = "private.embryo_split_config";
const OBJECTS = "private.embryo_ingest_object_config";
const identityFormat = '{"name":{{json .Name}},"running":{{json .State.Running}},"project":{{json (index .Config.Labels "com.supabase.cli.project")}},"owner":{{json (index .Config.Labels "inherit.ci-browser-runtime")}},"network":{{json .HostConfig.NetworkMode}},"mounts":{{json .Mounts}}}';
export const EMBRYO_JOURNEY_ENV = Object.freeze({
  INHERIT_EMBRYO_R2_ORIGIN: "https://embryo.fragments.test:8141",
  INHERIT_EMBRYO_R2_BUCKET: "inherit-embryo-ci",
});
/** A closed synthetic namespace, never arbitrary commands, origins or env. */
export function checkedEmbryoWorkerEnvironment(value: unknown): Record<string, string> {
  assert(value && typeof value === "object" && !Array.isArray(value), "Missing fixed worker configuration");
  const env = value as Record<string, unknown>;
  const names = ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "INHERIT_TEST_JURISDICTION",
    "INHERIT_EMBRYO_R2_ORIGIN", "INHERIT_EMBRYO_R2_BUCKET", "INHERIT_UPLOAD_SIGNING_JWK"];
  assert(Object.keys(env).length === names.length && Object.keys(env).every(name => names.includes(name))
    && env.NEXT_PUBLIC_SUPABASE_URL === "http://127.0.0.1:54321" && env.INHERIT_TEST_JURISDICTION === "1"
    && env.INHERIT_EMBRYO_R2_ORIGIN === EMBRYO_JOURNEY_ENV.INHERIT_EMBRYO_R2_ORIGIN
    && env.INHERIT_EMBRYO_R2_BUCKET === EMBRYO_JOURNEY_ENV.INHERIT_EMBRYO_R2_BUCKET
    && typeof env.SUPABASE_SERVICE_ROLE_KEY === "string" && env.SUPABASE_SERVICE_ROLE_KEY.length > 0
    && env.SUPABASE_SERVICE_ROLE_KEY.length < 8192
    && typeof env.INHERIT_UPLOAD_SIGNING_JWK === "string" && env.INHERIT_UPLOAD_SIGNING_JWK.length > 0
    && env.INHERIT_UPLOAD_SIGNING_JWK.length < 4096, "Worker scope differs from fixed local configuration");
  return { ...env } as Record<string, string>;
}
export const EMBRYO_WORKER_ARGS = Object.freeze(["--conditions=react-server", "--import", "/app/scripts/server-only-shim.mjs",
  "--import", "tsx", "/app/scripts/embryo-split-worker.run.mts", "--once"]);
export const EMBRYO_WORKER_LIMIT_MS = 90_000;

/** Fixed production split entrypoint with its one-iteration semantics. Its
 * own namespace timer survives a lost host docker-exec connection. Uncertain
 * exit, truncated output or timeout never becomes a successful preparation. */
export async function runEmbryoWorkerInside(value: unknown, signal: AbortSignal, dependencies = {
  spawn: (env: Record<string, string>) => spawn("node", [...EMBRYO_WORKER_ARGS], {
    cwd: "/app", env: { NODE_ENV: "production", PATH: "/usr/local/bin:/usr/bin:/bin", ...env,
      NODE_EXTRA_CA_CERTS: "/tls/fixture/ca.crt" },
    detached: true, stdio: ["ignore", "pipe", "pipe"],
  }) as ChildProcess,
  kill: (pid: number, kind: NodeJS.Signals) => process.kill(-pid, kind),
}): Promise<void> {
  const env = checkedEmbryoWorkerEnvironment(value);
  assert(!signal.aborted, "Embryo worker was cancelled before launch");
  const child = dependencies.spawn(env);
  let output = "", stopped = false, escalation: NodeJS.Timeout | undefined, terminal: NodeJS.Timeout | undefined;
  await new Promise<void>((resolve, reject) => {
    let finished = false;
    const finish = (okay = false) => {
      if (finished) return;
      finished = true; clearTimeout(deadline); clearTimeout(escalation); clearTimeout(terminal);
      signal.removeEventListener("abort", stop);
      if (okay) resolve(); else reject(new Error("Embryo worker outcome was not a clean completion"));
    };
    const kill = (kind: NodeJS.Signals) => {
      if (child.pid) { try { dependencies.kill(child.pid, kind); } catch { /* exit remains authoritative */ } }
    };
    const stop = () => {
      if (stopped || finished) return;
      stopped = true; kill("SIGTERM");
      escalation = setTimeout(() => { kill("SIGKILL"); terminal = setTimeout(() => finish(), 1000); }, 5000);
    };
    const deadline = setTimeout(stop, EMBRYO_WORKER_LIMIT_MS);
    signal.addEventListener("abort", stop, { once: true });
    child.stdout?.on("data", chunk => {
      if (stopped) return;
      output += chunk.toString();
      if (output.length > 512) { output = ""; stop(); }
    });
    child.stderr?.resume();
    child.once("error", stop);
    child.once("close", code => finish(!stopped && code === 0
      && output === "split_published\n"));
    if (signal.aborted) stop();
  });
}

export const EMBRYO_STATISTICAL_WORKER_ARGS = Object.freeze(["--conditions=react-server", "--import", "/app/scripts/server-only-shim.mjs",
  "--import", "tsx", "/app/scripts/embryo-statistical-worker.run.mts", "--once"]);

export async function runEmbryoStatisticalWorkerInside(value: unknown, signal: AbortSignal, dependencies = {
  spawn: (env: Record<string, string>) => spawn("node", [...EMBRYO_STATISTICAL_WORKER_ARGS], {
    cwd: "/app", env: { NODE_ENV: "production", PATH: "/usr/local/bin:/usr/bin:/bin", ...env,
      NODE_EXTRA_CA_CERTS: "/tls/fixture/ca.crt" },
    detached: true, stdio: ["ignore", "pipe", "pipe"],
  }) as ChildProcess,
  kill: (pid: number, kind: NodeJS.Signals) => process.kill(-pid, kind),
}): Promise<void> {
  const env = checkedEmbryoWorkerEnvironment(value);
  assert(!signal.aborted, "Embryo worker was cancelled before launch");
  const child = dependencies.spawn(env);
  let output = "", stopped = false, escalation: NodeJS.Timeout | undefined, terminal: NodeJS.Timeout | undefined;
  await new Promise<void>((resolve, reject) => {
    let finished = false;
    const finish = (okay = false) => {
      if (finished) return;
      finished = true; clearTimeout(deadline); clearTimeout(escalation); clearTimeout(terminal);
      signal.removeEventListener("abort", stop);
      if (okay) resolve(); else reject(new Error("Embryo worker outcome was not a clean completion"));
    };
    const kill = (kind: NodeJS.Signals) => {
      if (child.pid) { try { dependencies.kill(child.pid, kind); } catch { /* exit remains authoritative */ } }
    };
    const stop = () => {
      if (stopped || finished) return;
      stopped = true; kill("SIGTERM");
      escalation = setTimeout(() => { kill("SIGKILL"); terminal = setTimeout(() => finish(), 1000); }, 5000);
    };
    const deadline = setTimeout(stop, EMBRYO_WORKER_LIMIT_MS);
    signal.addEventListener("abort", stop, { once: true });
    child.stdout?.on("data", chunk => {
      if (stopped) return;
      output += chunk.toString();
      if (output.length > 512) { output = ""; stop(); }
    });
    child.stderr?.resume();
    child.once("error", stop);
    child.once("close", code => finish(!stopped && code === 0
      && output === "coverage_saved\n"));
    if (signal.aborted) stop();
  });
}

function defaultIo(env: Environment, operator?: OwnedLinuxCapability): EmbryoJourneyIo {
  return {
    execute: async (args, input, timeout = 10_000) => {
      try {
        const child = promisify(execFile)("docker", args, { timeout, killSignal: "SIGKILL", maxBuffer: 32_768,
          env: { NODE_ENV: "production", PATH: env.PATH ?? "/usr/bin:/bin", HOME: env.HOME ?? "/home/runner", LANG: "C.UTF-8",
            ...(operator ? ownedLinuxEnvironment(operator) : {}) } });
        child.child.stdin?.on("error", () => {});
        child.child.stdin?.end(input);
        return (await child).stdout.trim();
      } catch { throw new Error("Embryo journey fixed local command failed; diagnostics withheld"); }
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

const ORIGINAL = { split: { singleton: true, enabled: false },
  objects: { singleton: true, provider: null, r2_bucket: null } };
const configuration = `select jsonb_build_object('split',(select to_jsonb(c) from ${SPLIT} c where singleton),
  'objects',(select to_jsonb(c) from ${OBJECTS} c where singleton));`;
const originalCondition = `exists(select 1 from ${SPLIT} where singleton and not enabled)
  and exists(select 1 from ${OBJECTS} where singleton and provider is null and r2_bucket is null)`;
const activeCondition = `exists(select 1 from ${SPLIT} where singleton and enabled)
  and exists(select 1 from ${OBJECTS} where singleton and provider='r2' and r2_bucket='inherit-embryo-ci')`;
const configLocks = `perform 1 from ${SPLIT} where singleton for update;
  perform 1 from ${OBJECTS} where singleton for update;`;
function cohortLiteral(cohortId: string) {
  assert(UUID.test(cohortId), "Exact synthetic cohort required");
  return `'${cohortId}'::uuid`;
}

/** One fresh synthetic journey on the exact disposable CI database. The
 * fixture changes only two existing configuration rows and restores them.
 * Browser mutations and the real worker create all authority and results;
 * this helper cannot insert data, grant permission, advance a job or publish. */
export async function withEmbryoJourney<T>(env: Environment, work: (fixture: {
  runtimeOwner: string;
  runWorker: (cohortId: string) => Promise<void>;
  runStatisticalWorker: (cohortId: string) => Promise<void>;
  statisticalProof: (cohortId: string) => Promise<unknown>;
  proof: (cohortId: string) => Promise<unknown>;
}) => Promise<T>, io?: EmbryoJourneyIo, platform = process.platform, operator?: OwnedLinuxCapability): Promise<T> {
  assertCiRuntime(env, platform, operator);
  io ??= defaultIo(env, operator);
  assert(env.INHERIT_CI_BROWSER_RUNTIME === "ready", "Isolated runtime preflight required");
  const owner = io.owner() as { owner?: unknown };
  assert(owner && Object.keys(owner).length === 1 && typeof owner.owner === "string" && UUID.test(owner.owner),
    "Exact runtime owner required");
  const user = `${env.INHERIT_CI_RUNTIME_UID}:${env.INHERIT_CI_RUNTIME_GID}`;
  assert(/^[1-9][0-9]*:[1-9][0-9]*$/.test(user), "Unprivileged runtime identity required");
  const worker = checkedEmbryoWorkerEnvironment({ NEXT_PUBLIC_SUPABASE_URL: env.NEXT_PUBLIC_SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY: env.SUPABASE_SERVICE_ROLE_KEY, INHERIT_TEST_JURISDICTION: "1",
    ...EMBRYO_JOURNEY_ENV, INHERIT_UPLOAD_SIGNING_JWK: env.INHERIT_UPLOAD_SIGNING_JWK });
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
            mount.Source === root && mount.Destination === "/app" && mount.RW === false),
        "Exact owned checkout runtime required");
      } else assert(item.project === "sequence", "Exact local project required");
    }
  };
  const sql = async (statement: string) => {
    await checkIdentity();
    return io.execute(["exec", "-i", DB, "psql", "-U", "postgres", "-d", "postgres", "-XAtq", "--set=ON_ERROR_STOP=1"], statement);
  };
  assert.deepEqual(JSON.parse(await sql(configuration)), ORIGINAL, "Never take over an enabled or configured embryo worker");
  assert(await sql(`select (not exists(select 1 from public.worker_jobs where kind='split_cohort_vcf')
    and not exists(select 1 from private.embryo_split_ordinals)
    and not exists(select 1 from private.embryo_split_variants)
    and not exists(select 1 from private.embryo_ingest_write_intents)
    and not exists(select 1 from private.embryo_canonical_parts))::text;`) === "true",
  "Embryo journey requires an empty split and fragment queue");
  let attempted = false, statisticalAttempted = false;
  try {
    assert(await sql(`-- embryo-fixture-activate
      do $$ begin ${configLocks}
        if not (${originalCondition}) then raise exception 'embryo fixture configuration changed'; end if;
        update ${OBJECTS} set provider='r2',r2_bucket='inherit-embryo-ci' where singleton;
        update ${SPLIT} set enabled=true where singleton;
      end $$; select 'true';`) === "true", "Embryo fixture activation was uncertain");
    return await work({
      runtimeOwner: owner.owner,
      runWorker: async cohortId => {
        const cohort = cohortLiteral(cohortId);
        assert(!attempted, "No duplicate or uncertain embryo worker attempt is permitted");
        assert(await sql(`select ((select count(*) from public.worker_jobs where kind='split_cohort_vcf')=1
          and exists(select 1 from public.worker_jobs w join public.embryo_ingest_sessions s
            on s.id=w.source_binding_id and s.worker_job_id=w.id
            join public.embryo_cohorts c on c.id=s.cohort_id
            join auth.users u on u.id=c.owner_account_id
            where w.kind='split_cohort_vcf' and w.cohort_id=${cohort} and s.cohort_id=${cohort}
              and w.status='queued' and w.attempts=0 and s.status='sanitization_pending'
              and c.status='ingesting' and u.email like '%@e2e.local')
          and not exists(select 1 from private.embryo_split_ordinals)
          and not exists(select 1 from private.embryo_split_variants))::text;`) === "true",
        "Refusing unrelated or previously attempted embryo work");
        attempted = true;
        await checkIdentity();
        const output = await io.execute(["exec", "-i", "--user", user, CI_RUNTIME_CONTAINER,
          "node", "--import", "tsx", "/app/scripts/ci-browser/embryo-worker.mts"],
        JSON.stringify(worker) + "\n", EMBRYO_WORKER_LIMIT_MS + 20_000);
        assert(output === "EMBRYO_JOURNEY_WORKER_COMPLETE", "Worker did not prove one clean publication");
      },
      runStatisticalWorker: async cohortId => {
        const cohort = cohortLiteral(cohortId);
        assert(!statisticalAttempted, "No duplicate or uncertain statistical worker attempt is permitted");
        assert(await sql(`select (exists(select 1 from private.embryo_test_statistical_admission)
          and (select count(*) from public.worker_jobs where output_kind='embryo.statistical-estimate')=0
          and exists(select 1 from public.worker_jobs where cohort_id=${cohort} and kind='split_cohort_vcf'
            and status='done' and attempts=1)
          and exists(select 1 from public.embryo_cohorts where id=${cohort} and status='active' and publication_revision=1))::text;`) === "true",
        "Only the actual fresh published cohort can enter synthetic statistical work");
        statisticalAttempted = true;
        const queued = JSON.parse(await sql(`select public.enqueue_embryo_test_statistical_v1(${cohort},true);`));
        assert(queued.status === "queued" && typeof queued.jobId === "string", "Native statistical admission refused");
        await checkIdentity();
        const output = await io.execute(["exec", "-i", "--user", user, CI_RUNTIME_CONTAINER,
          "node", "--import", "tsx", "/app/scripts/ci-browser/embryo-statistical-worker.mts"],
        JSON.stringify(worker) + "\n", EMBRYO_WORKER_LIMIT_MS + 20_000);
        assert(output === "EMBRYO_STATISTICAL_JOURNEY_WORKER_COMPLETE", "Statistical worker must settle one complete native save");
      },
      statisticalProof: async cohortId => JSON.parse(await sql(`select jsonb_build_object(
        'jobs',(select jsonb_agg(to_jsonb(j) order by j.id) from public.worker_jobs j
          where j.cohort_id=${cohortLiteral(cohortId)} and j.output_kind='embryo.statistical-estimate'),
        'scores',(select jsonb_agg(to_jsonb(s) order by e.sample_ordinal) from public.embryo_scores s
          join public.embryos e on e.id=s.embryo_id where e.cohort_id=${cohortLiteral(cohortId)}
          and s.computation_receipt->>'producer'='embryo-test-score-coverage-v1'));`)),
      proof: async cohortId => JSON.parse(await sql(embryoProof(cohortLiteral(cohortId)))) ,
    });
  } finally {
    const restored = await sql(`-- embryo-fixture-restore
      do $$ begin ${configLocks}
        if ${originalCondition} then null;
        elsif ${activeCondition} then
          update ${SPLIT} set enabled=false where singleton;
          update ${OBJECTS} set provider=null,r2_bucket=null where singleton;
        else raise exception 'embryo fixture configuration drift'; end if;
      end $$; ${configuration}`);
    assert.deepEqual(JSON.parse(restored), ORIGINAL, "Embryo fixture configuration did not restore exactly");
  }
}

function embryoProof(cohort: string): string {
  return `select json_build_object(
    'jobs',(select count(*) from public.worker_jobs where kind='split_cohort_vcf' and cohort_id=${cohort} and status='done' and attempts=1),
    'sessions',(select count(*) from public.embryo_ingest_sessions where cohort_id=${cohort} and status='published'),
    'cohorts',(select count(*) from public.embryo_cohorts where id=${cohort} and status='active' and publication_revision=1),
    'sources',(select count(*) from private.embryo_canonical_sources where cohort_id=${cohort}),
    'parts',(select count(*) from private.embryo_canonical_parts p join public.embryo_ingest_sessions s on s.id=p.session_id where s.cohort_id=${cohort}),
    'allPartsCurrent',coalesce((select bool_and(p.state='landed' and p.observed_sha256=p.sha256
      and p.provider_bucket='inherit-embryo-ci' and p.provider_version ~ '^[0-9a-f]{32}$' and p.provider_etag ~ '^[0-9a-f]{32}$')
      from private.embryo_canonical_parts p join public.embryo_ingest_sessions s on s.id=p.session_id where s.cohort_id=${cohort}),false),
    'scores',(select count(*) from public.embryo_scores x join public.embryos e on e.id=x.embryo_id where e.cohort_id=${cohort}),
    'ordinals',(select jsonb_agg(jsonb_build_object('ordinal',e.sample_ordinal,'status',e.status,
      'sources',(select count(*) from private.embryo_canonical_sources x where x.embryo_id=e.id and x.cohort_id=e.cohort_id),
      'parts',(select count(*) from private.embryo_canonical_parts p join public.embryo_ingest_sessions s on s.id=p.session_id
        where s.cohort_id=e.cohort_id and p.sample_ordinal=e.sample_ordinal)) order by e.sample_ordinal)
      from public.embryos e where e.cohort_id=${cohort}),
    'pendingOrdinals',(select count(*) from private.embryo_split_ordinals o join public.embryo_ingest_sessions s on s.id=o.session_id where s.cohort_id=${cohort}),
    'pendingVariants',(select count(*) from private.embryo_split_variants v join public.embryo_ingest_sessions s on s.id=v.session_id where s.cohort_id=${cohort}));`;
}
