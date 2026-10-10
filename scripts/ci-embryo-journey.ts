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

export async function runEmbryoFittedStatisticalWorkerInside(value: unknown, signal: AbortSignal, dependencies = {
  spawn: (env: Record<string, string>) => spawn("node", [...EMBRYO_STATISTICAL_WORKER_ARGS.slice(0, -1), "--fit", "--once"], {
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
      && output === "fitted_saved\n"));
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
  withFittedJourney: <U>(firstCohortId: string, work: (fixture: FittedEmbryoJourney) => Promise<U>) => Promise<U>;
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
  let fittedJourneyAttempted = false;
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
      withFittedJourney: async (firstCohortId, fittedWork) => {
        const first = cohortLiteral(firstCohortId);
        assert(attempted && statisticalAttempted && !fittedJourneyAttempted,
          "Fitted journey requires this callback's completed original split and coverage attempts");
        fittedJourneyAttempted = true;
        const readFirst = async () => {
          const value = JSON.parse(await sql(completedJourneyHistory(first))) as { complete: unknown; sha256: unknown };
          assert(value.complete === true && typeof value.sha256 === "string" && /^[0-9a-f]{64}$/.test(value.sha256),
            "Only the complete original owned terminal publication can precede fitted work");
          return value.sha256;
        };
        const unchanged = await readFirst();
        const checkFirst = async () => assert(await readFirst() === unchanged, "Original whole journey history changed");
        const settledQueues = `not exists(select 1 from private.embryo_split_ordinals)
          and not exists(select 1 from private.embryo_split_variants)
          and not exists(select 1 from private.embryo_ingest_write_intents where state<>'landed')
          and not exists(select 1 from private.embryo_canonical_parts where state<>'landed')`;
        assert(await sql(`-- embryo-fitted-empty-queue
          select (${settledQueues}
          and not exists(select 1 from public.worker_jobs where cohort_id is distinct from ${first}
            and kind in('split_cohort_vcf','score_embryo')))::text;`) === "true", "No unrelated or pending embryo work permitted");
        let second: string | undefined, splitAttempted = false, fitAttempted = false;
        let splitCompleted = false, fitCompleted = false;
        try {
          const result = await fittedWork({
            runWorker: async cohortId => {
              const cohort = cohortLiteral(cohortId);
              assert(cohort !== first && !splitAttempted, "One distinct fresh fitted cohort is required");
              await checkFirst();
              assert(await sql(`-- embryo-fitted-fresh-cohort
                select (${settledQueues}
                and (select count(*) from public.worker_jobs where kind='split_cohort_vcf')=2
                and not exists(select 1 from public.worker_jobs where cohort_id not in(${first},${cohort})
                  and kind in('split_cohort_vcf','score_embryo'))
                and (select count(*) from public.worker_jobs where cohort_id=${cohort})=1
                and exists(select 1 from public.worker_jobs w join public.embryo_ingest_sessions i
                  on i.id=w.source_binding_id and i.worker_job_id=w.id
                  join public.embryo_cohorts c on c.id=i.cohort_id join auth.users u on u.id=c.owner_account_id
                  where w.cohort_id=${cohort} and i.cohort_id=${cohort} and w.kind='split_cohort_vcf'
                    and w.status='queued' and w.attempts=0 and i.status='sanitization_pending'
                    and c.status='ingesting' and u.email='fitted-test@e2e.local')
                and not exists(select 1 from private.embryo_canonical_sources where cohort_id=${cohort})
                and not exists(select 1 from public.embryo_scores s join public.embryos e on e.id=s.embryo_id
                  where e.cohort_id=${cohort}))::text;`) === "true", "Only the untouched second signed-parent cohort may run");
              second = cohort;splitAttempted = true;
              await checkIdentity();
              const output = await io.execute(["exec", "-i", "--user", user, CI_RUNTIME_CONTAINER,
                "node", "--import", "tsx", "/app/scripts/ci-browser/embryo-worker.mts"],
              JSON.stringify(worker) + "\n", EMBRYO_WORKER_LIMIT_MS + 20_000);
              assert(output === "EMBRYO_JOURNEY_WORKER_COMPLETE", "Second split must settle one complete publication");
              await checkFirst();
              splitCompleted = true;
            },
            proof: async cohortId => {
              const cohort = cohortLiteral(cohortId);assert(cohort === second && splitAttempted, "Exact second publication required");
              await checkFirst();return JSON.parse(await sql(embryoProof(cohort)));
            },
            runStatisticalWorker: async cohortId => {
              const cohort = cohortLiteral(cohortId);assert(cohort === second && splitAttempted && !fitAttempted,
                "One fitted worker attempt on the exact second publication required");
              await checkFirst();
              assert(await sql(`-- embryo-fitted-current-publication
                select (${settledQueues}
                and exists(select 1 from private.embryo_test_statistical_admission)
                and not exists(select 1 from public.worker_jobs where computation_revision='embryo-test-statistical-fit-v1')
                and (select count(*) from public.worker_jobs where cohort_id=${cohort})=1
                and exists(select 1 from public.worker_jobs where cohort_id=${cohort} and kind='split_cohort_vcf'
                  and status='done' and attempts=1)
                and exists(select 1 from public.embryo_cohorts where id=${cohort} and status='active' and publication_revision=1))::text;`) === "true",
                "Only the actual new publication can enter the separate fitted native door");
              fitAttempted = true;
              const queued = JSON.parse(await sql(`select public.enqueue_embryo_test_statistical_fit_v1(${cohort},true);`));
              assert(queued.status === "queued" && typeof queued.jobId === "string" && UUID.test(queued.jobId),
                "Separate native fitted admission refused");
              await checkIdentity();
              const output = await io.execute(["exec", "-i", "--user", user, CI_RUNTIME_CONTAINER,
                "node", "--import", "tsx", "/app/scripts/ci-browser/embryo-statistical-worker.mts"],
              JSON.stringify({ kind: "fitted-test", environment: worker }) + "\n", EMBRYO_WORKER_LIMIT_MS + 20_000);
              assert(output === "EMBRYO_STATISTICAL_FITTED_JOURNEY_WORKER_COMPLETE", "Fitted native save must settle completely");
              await checkFirst();
              fitCompleted = true;
            },
            statisticalProof: async cohortId => {
              const cohort = cohortLiteral(cohortId);assert(cohort === second && fitAttempted, "Exact second fitted proof required");
              await checkFirst();
              return JSON.parse(await sql(fittedStatisticalProof(cohort)));
            },
          });
          assert(second !== undefined && splitCompleted && fitCompleted,
            "The distinct fitted journey must complete both actual worker attempts");
          assert(await sql(`-- embryo-fitted-settled-queue
            select (${settledQueues})::text;`) === "true", "The fitted journey left pending fragment work");
          return result;
        } finally { await checkFirst(); }
      },
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

export type FittedEmbryoJourney = {
  runWorker: (cohortId: string) => Promise<void>;
  proof: (cohortId: string) => Promise<unknown>;
  runStatisticalWorker: (cohortId: string) => Promise<void>;
  statisticalProof: (cohortId: string) => Promise<unknown>;
};

/** Hash the complete native rows before projecting only repeated, independently
 * checked invented artifact/package literals. The full package travels once;
 * all authority, source, result, runtime and receipt metadata stays visible.
 * The original proof and its transport bound are unchanged. */
function fittedStatisticalProof(cohort: string): string {
  return `with capture as materialized(select private.capture_embryo_test_statistical_fit_v1(${cohort},true) a),
    admission as materialized(select private.current_embryo_test_fit_admission_v1() a),
    jobs as materialized(select j from public.worker_jobs j where j.cohort_id=${cohort}
      and j.computation_revision='embryo-test-statistical-fit-v1'),
    scores as materialized(select s,e.sample_ordinal from public.embryo_scores s
      join public.embryos e on e.id=s.embryo_id where e.cohort_id=${cohort}
      and s.computation_receipt->>'producer'='embryo-test-statistical-fit-v1'),
    expected as materialized(select (j).id job_id,e,c,private.expected_embryo_test_fit_measurement_v1(e,c) m
      from jobs cross join capture cross join lateral jsonb_array_elements(a->'embryos') embryos(e)
      cross join lateral jsonb_array_elements(a->'conditions') conditions(c))
    select jsonb_build_object('bindingsCurrent',coalesce(
      (select count(*) from jobs)=1 and (select count(*) from scores)=2
      and (select count(*) from expected)=2
      and (select count(*) from public.embryo_scores s join public.embryos e on e.id=s.embryo_id
        where e.cohort_id=${cohort})=2
      and (select count(*) from scores join expected on (s).embryo_id=(e->>'embryoId')::uuid
        and (s).condition_id=c->>'condition_id')=2
      and (select a is not null and a->'fit_artifact'=private.embryo_test_fit_artifact_v1()
        and a->'fit_package'=private.embryo_test_fit_package_v1(private.embryo_test_fit_artifact_v1())
        and a->>'fit_package_digest'=private.embryo_test_fit_package_digest_v1(a->'fit_package') from admission)
      and (select capture.a->'fitArtifact'=admission.a->'fit_artifact'
        and capture.a->'fitPackage'=admission.a->'fit_package'
        and capture.a->'fitPackageDigest'=admission.a->'fit_package_digest'
        and capture.a#>'{conditions,0,reference_receipt}'=admission.a from capture,admission)
      and (select bool_and((j).payload=jsonb_build_object('capture',a)
        and (j).file_sha256=encode(extensions.digest(convert_to(a::text,'UTF8'),'sha256'),'hex')
        and (j).status='done' and (j).attempts=1 and (j).kind='score_embryo'
        and (j).output_kind='embryo.statistical-estimate'
        and (j).source_binding_kind='cohort-source-set' and (j).source_binding_id=${cohort}
        and (j).source_binding_revision=(a->>'publicationRevision')::bigint
        and (j).user_id=(a#>>'{authority,cohort,owner_account_id}')::uuid
        and (j).subject_id is null and (j).file_id is null
        and (j).claim_token_hash is null and (j).claim_expires_at is null and (j).claimed_by is null)
        from jobs,capture)
      and (select bool_and(private.valid_embryo_test_fit_receipt_v1((s).computation_receipt)
        and (s).computation_receipt=private.embryo_test_fit_receipt_v1(j,e,c,m)
        and (s).computation_receipt->'reference_receipt'=admission.a
        and (s).source_binding_fingerprint=(j).file_sha256
        and (s).finding is not distinct from nullif(m->'finding','null'::jsonb)
        and (s).not_covered_reason is not distinct from m->>'reason'
        and (s).coverage_state=private.embryo_test_statistical_coverage_v1(m)
        and (s).condition_name='Synthetic score coverage' and (s).model_id is null
        and (s).model_version is null and (s).evidence_label='preliminary' and (s).citation_ids='{}'::text[])
        from scores join expected on (s).embryo_id=(e->>'embryoId')::uuid
          and (s).condition_id=c->>'condition_id' join jobs on (j).id=expected.job_id cross join admission),false),
      'fitPackage',(select a->'fit_package' from admission),
      'wholeRowHashes',jsonb_build_object(
        'jobs',(select jsonb_agg(jsonb_build_object('id',(j).id,
          'sha256',encode(extensions.digest(convert_to(to_jsonb(j)::text,'UTF8'),'sha256'),'hex')) order by (j).id) from jobs),
        'scores',(select jsonb_agg(jsonb_build_object('id',(s).id,
          'sha256',encode(extensions.digest(convert_to(to_jsonb(s)::text,'UTF8'),'sha256'),'hex')) order by sample_ordinal) from scores)),
      'jobs',(select jsonb_agg(to_jsonb(j)#-'{payload,capture,fitArtifact}'#-'{payload,capture,fitPackage}'
        #-'{payload,capture,conditions,0,reference_receipt,fit_artifact}'
        #-'{payload,capture,conditions,0,reference_receipt,fit_package}' order by (j).id) from jobs),
      'scores',(select jsonb_agg(to_jsonb(s)#-'{computation_receipt,fitPackage}'
        #-'{computation_receipt,reference_receipt,fit_artifact}'
        #-'{computation_receipt,reference_receipt,fit_package}' order by sample_ordinal) from scores),
      'calls',(select jsonb_agg(jsonb_build_object('embryoId',e->'embryoId','qc',e->'qc',
        'calls',private.embryo_test_statistical_calls_v1(e)) order by (e->>'sampleOrdinal')::integer)
        from capture cross join lateral jsonb_array_elements(a->'embryos') embryos(e)));`;
}

/** Complete existing first-cohort values, hashed natively rather than exposed.
 * No table is reset or adopted; the first terminal graph must stay exact for
 * every second-cohort operation and the enclosing callback's final bookend. */
function completedJourneyHistory(cohort: string): string {
  return `-- embryo-first-completed-history
    select jsonb_build_object('complete',
    (select count(*) from public.worker_jobs where cohort_id=${cohort})=2
    and exists(select 1 from public.worker_jobs where cohort_id=${cohort} and kind='split_cohort_vcf'
      and status='done' and attempts=1 and claim_token_hash is null and claim_expires_at is null and claimed_by is null)
    and exists(select 1 from public.worker_jobs where cohort_id=${cohort} and output_kind='embryo.statistical-estimate'
      and computation_revision='embryo-test-score-coverage-v1' and status='done' and attempts=1
      and claim_token_hash is null and claim_expires_at is null and claimed_by is null)
    and exists(select 1 from public.embryo_cohorts c join auth.users u on u.id=c.owner_account_id
      where c.id=${cohort} and c.publication_revision=1 and u.email='participant-c@e2e.local')
    and (select count(*) from private.embryo_canonical_sources where cohort_id=${cohort})=2
    and (select count(*) from public.embryo_scores s join public.embryos e on e.id=s.embryo_id
      where e.cohort_id=${cohort} and s.computation_receipt->>'producer'='embryo-test-score-coverage-v1')=2,
    'sha256',encode(extensions.digest(convert_to(jsonb_build_object(
      'jobs',(select jsonb_agg(to_jsonb(j) order by j.id) from public.worker_jobs j where j.cohort_id=${cohort}),
      'cohort',(select to_jsonb(c) from public.embryo_cohorts c where c.id=${cohort}),
      'embryos',(select jsonb_agg(to_jsonb(e) order by e.id) from public.embryos e where e.cohort_id=${cohort}),
      'subjects',(select jsonb_agg(to_jsonb(s) order by s.id) from public.subjects s where s.cohort_id=${cohort}),
      'files',(select jsonb_agg(to_jsonb(f) order by f.id) from public.genome_files f
        where f.subject_id in(select subject_id from public.embryos where cohort_id=${cohort})),
      'qc',(select jsonb_agg(to_jsonb(q) order by q.embryo_id) from public.embryo_qc q
        join public.embryos e on e.id=q.embryo_id where e.cohort_id=${cohort}),
      'scores',(select jsonb_agg(to_jsonb(s) order by s.id) from public.embryo_scores s
        join public.embryos e on e.id=s.embryo_id where e.cohort_id=${cohort}),
      'variants',(select jsonb_agg(to_jsonb(v) order by v.id) from public.embryo_variants v
        join public.embryos e on e.id=v.embryo_id where e.cohort_id=${cohort}),
      'sources',(select jsonb_agg(to_jsonb(s) order by s.file_id) from private.embryo_canonical_sources s where s.cohort_id=${cohort}),
      'parts',(select jsonb_agg(to_jsonb(p) order by p.id) from private.embryo_canonical_parts p
        join public.embryo_ingest_sessions i on i.id=p.session_id where i.cohort_id=${cohort}),
      'memberships',(select jsonb_agg(to_jsonb(m) order by m.file_id,m.part_id) from private.embryo_canonical_source_parts m
        join private.embryo_canonical_sources s on s.file_id=m.file_id where s.cohort_id=${cohort}),
      'sessions',(select jsonb_agg(to_jsonb(i) order by i.id) from public.embryo_ingest_sessions i where i.cohort_id=${cohort}),
      'basis',(select to_jsonb(b) from public.embryo_basis_bindings b where b.cohort_id=${cohort}),
      'participants',(select jsonb_agg(to_jsonb(p) order by p.set_kind,p.principal_id) from public.embryo_participant_sets p where p.cohort_id=${cohort}),
      'parentHistory',(select jsonb_agg(to_jsonb(s) order by s.id) from public.consent_signatures s
        where (s.target_kind='cohort' and s.target_id=${cohort}) or (s.target_kind='cohort_draft'
          and s.target_id=(select draft_id from public.embryo_cohorts where id=${cohort}))),
      'grants',(select jsonb_agg(to_jsonb(g) order by g.grant_id) from public.purpose_grants g
        where g.target_kind='cohort' and g.target_id=${cohort}),
      'attestations',(select jsonb_agg(to_jsonb(a) order by a.id) from public.attestations a
        where a.target_kind='cohort_draft' and a.target_id=(select draft_id from public.embryo_cohorts where id=${cohort})),
      'operationHistory',(select jsonb_agg(to_jsonb(n) order by n.nonce_hash) from public.embryo_operation_nonces n
        where (n.target_kind='cohort' and n.target_id=${cohort}) or (n.target_kind='embryo'
          and n.target_id in(select id from public.embryos where cohort_id=${cohort}))),
      'futurePersonProfiles',(select jsonb_agg(to_jsonb(i) order by i.id) from public.future_person_identity i
        where i.embryo_id in(select id from public.embryos where cohort_id=${cohort}))
    )::text,'UTF8'),'sha256'),'hex'));`;
}
