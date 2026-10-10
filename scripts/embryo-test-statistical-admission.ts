import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstatSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import path from "node:path";
import { assertCiRuntime, CI_RUNTIME_CONTAINER, CI_RUNTIME_LABEL } from "./ci-browser-config";
import { assertOwnedLinuxSource, ownedLinuxSourceIdentity, type OwnedLinuxCapability } from "./owned-linux-runtime";
import panel from "../data/embryo/test-statistical-score-panel.json";
import fitArtifact from "../data/embryo/test-statistical-fit-population.json";
import { canonicalStatisticalFitPackage, statisticalFitPackageDigest } from "../src/lib/embryos/statistical-fit-contract";

const PANEL_SHA256 = "c08fcfea75896e134cfc68ac844bedc0f5aa3b7a4b5623d97806297978df984f";
const FIT_ARTIFACT_SHA256 = "5355327cfe90cda24ca2d27cd3afab2e53d26b5d6995b69cb296d3b975c6d408";
const hash = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
const literal = (value: unknown) => `'${JSON.stringify(value).replaceAll("'", "''")}'::jsonb`;

/** Called only after the existing actual isolated runtime/TLS/policy probe,
 * before a browser child. No arbitrary DB URL, key, source or panel input. It
 * writes reference admission only; users, grants, jobs and results stay empty. */
export function installEmbryoTestStatisticalAdmission(owner: string, network: string,
  environment?: Record<string, string>, operator?: OwnedLinuxCapability): void {
  assertCiRuntime(process.env, process.platform, operator);
  assert(operator || process.env.GITHUB_JOB === "browser", "Only the actual disposable browser job installs this reference");
  assert(process.env.INHERIT_TEST_JURISDICTION === "1", "TEST app configuration required");
  const execute = (command: string, args: string[], input?: string, timeout = 10_000) => {
    try { return execFileSync(command, args, { input, encoding: "utf8", timeout,
      maxBuffer: 1_048_576, stdio: [input === undefined ? "ignore" : "pipe", "pipe", "pipe"],
      env: environment as NodeJS.ProcessEnv | undefined }).trim(); }
    catch { throw new Error("Synthetic statistical reference admission refused; diagnostics withheld"); }
  };
  const docker = (args: string[], input?: string) => execute("docker", args, input);
  const root = realpathSync(process.cwd());
  assert(root === process.cwd(), "Exact source checkout required");
  const head = execute("git", ["rev-parse", "HEAD"]);
  assert(/^[0-9a-f]{40}$/.test(head), "Exact current source required");
  if (operator) assertOwnedLinuxSource(operator, environment);
  else assert(execute("git", ["status", "--porcelain", "--untracked-files=all"]) === "", "Complete nonignored source must be clean");
  const receiptPath = path.join(process.env.RUNNER_TEMP!, "inherit-ci-browser-owner.json"), stat = lstatSync(receiptPath);
  assert(stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1 && stat.uid === process.getuid!()
    && (stat.mode & 0o077) === 0 && stat.size < 1024, "Protected current runtime receipt required");
  assert.deepEqual(JSON.parse(readFileSync(receiptPath, "utf8")), { owner });
  const files = readdirSync("supabase/migrations").filter(file => /^\d{14}_.+\.sql$/.test(file)).sort();
  assert(files.length > 0 && new Set(files.map(file => file.slice(0, 14))).size === files.length, "Complete unique migration source required");
  const migrationHash = createHash("sha256");
  for (const file of files) { const bytes = readFileSync(path.join("supabase/migrations", file));
    migrationHash.update(file).update("\0").update(bytes).update("\0"); }
  const config = readFileSync("supabase/config.toml");
  assert(/^project_id = "sequence"$/m.test(config.toString()), "Exact disposable project source required");
  assert(hash(readFileSync("data/embryo/test-statistical-score-panel.json")) === PANEL_SHA256, "Fixed entire panel bytes required");
  assert(hash(readFileSync("data/embryo/test-statistical-fit-population.json")) === FIT_ARTIFACT_SHA256,
    "Fixed entire invented fitting population bytes required");
  const fittedPackage = canonicalStatisticalFitPackage();
  const fittedDigest = statisticalFitPackageDigest(fittedPackage);
  // Select public identity fields only. Docker Config.Env may contain local
  // bootstrap credentials and must never be fetched by this installer.
  const identityFormat = '{"id":{{json .Id}},"name":{{json .Name}},"running":{{json .State.Running}},'
    + '"project":{{json (index .Config.Labels "com.supabase.cli.project")}},'
    + `"owner":{{json (index .Config.Labels "${CI_RUNTIME_LABEL}")}},`
    + '"network":{{json .HostConfig.NetworkMode}},"networks":{{json .NetworkSettings.Networks}},"mounts":{{json .Mounts}}}';
  const inspect = (name: string) => JSON.parse(docker(["inspect", "--format", identityFormat, name]));
  const db = inspect("supabase_db_sequence"), runtime = inspect(CI_RUNTIME_CONTAINER), storage = inspect("supabase_storage_sequence");
  const net = JSON.parse(docker(["network", "inspect", network]))[0];
  const daemonId = docker(["info", "--format", "{{.ID}}"]);
  assert(network === "supabase_network_sequence" && net.Labels?.["com.supabase.cli.project"] === "sequence"
    && /^[0-9a-f]{64}$/.test(net.Id) && daemonId.length > 0, "Actual owned local network/daemon required");
  for (const [name, item] of [["supabase_db_sequence", db], ["supabase_storage_sequence", storage], [CI_RUNTIME_CONTAINER, runtime]] as const) {
    assert(item.name === `/${name}` && /^[0-9a-f]{64}$/.test(item.id) && item.running === true
      && item.network === network && Object.keys(item.networks).length === 1,
    "Exact actual disposable namespace required");
    if (name === CI_RUNTIME_CONTAINER) assert(item.owner === owner
      && item.mounts.some((mount: { Source: string; Destination: string; RW: boolean }) =>
        mount.Source === root && mount.Destination === "/app" && mount.RW === false), "Exact protected runtime/source required");
    else assert(item.project === "sequence", "Exact local project required");
  }
  const ciIdentity = {
    runId: process.env.GITHUB_RUN_ID, runAttempt: process.env.GITHUB_RUN_ATTEMPT, job: process.env.GITHUB_JOB,
    source: process.env.GITHUB_SHA, runner: process.env.RUNNER_ENVIRONMENT, uid: process.getuid!(), gid: process.getgid!(),
  };
  const runtimeIdentity = operator ? ownedLinuxSourceIdentity(operator) : ciIdentity;
  if (operator) assert(ownedLinuxSourceIdentity(operator).daemonId === daemonId, "Exact capability daemon required");
  else assert(/^\d+$/.test(ciIdentity.runId ?? "") && /^\d+$/.test(ciIdentity.runAttempt ?? "")
    && ciIdentity.source === head, "Current actual CI run/attempt/source required");
  const binding = { kind: operator ? "owned-linux" : "github-browser", head,
    migrationSha256: migrationHash.digest("hex"), configSha256: hash(config), daemonId,
    dbContainerId: db.id, networkId: net.Id, project: "sequence", owner, runtimeIdentity };
  const sql = `begin;
set local statement_timeout='45s';set local lock_timeout='250ms';
lock table private.embryo_test_statistical_admission in exclusive mode;
lock table private.embryo_split_config,private.embryo_ingest_object_config,public.worker_jobs,
 auth.users,public.subjects,public.embryo_cohorts,public.genome_files,public.purpose_grants in share mode;
do $install$ begin
 if session_user is distinct from 'postgres'
  or exists(select 1 from private.embryo_test_statistical_admission)
  or not exists(select 1 from private.embryo_split_config where singleton and not enabled)
  or not exists(select 1 from private.embryo_ingest_object_config where singleton and provider is null and r2_bucket is null)
  or exists(select 1 from auth.users) or exists(select 1 from public.subjects)
  or exists(select 1 from public.embryo_cohorts) or exists(select 1 from public.genome_files)
  or exists(select 1 from public.purpose_grants) or exists(select 1 from public.worker_jobs)
  or exists(select 1 from private.embryo_split_ordinals) or exists(select 1 from private.embryo_split_variants)
  or exists(select 1 from private.embryo_ingest_write_intents) or exists(select 1 from private.embryo_canonical_parts)
  or (select coalesce(jsonb_agg(version order by version),'[]'::jsonb) from supabase_migrations.schema_migrations)
   is distinct from ${literal(files.map(file => file.slice(0, 14)))}
  or private.embryo_test_statistical_panel_v1() is distinct from ${literal(panel)}
  or private.embryo_test_fit_artifact_v1() is distinct from ${literal(fitArtifact)}
  or private.embryo_test_fit_package_v1(private.embryo_test_fit_artifact_v1()) is distinct from ${literal(fittedPackage)}
  or private.embryo_test_fit_package_digest_v1(private.embryo_test_fit_package_v1(private.embryo_test_fit_artifact_v1()))
   is distinct from '${fittedDigest}' then
  raise exception using errcode='42501',message='embryo_test_statistical_install_refused';end if;
 insert into private.embryo_test_statistical_admission(singleton,version,panel_sha256,panel,system_identifier,
  database_name,database_oid,server_version,runtime_binding,fit_artifact_sha256,fit_artifact,fit_package,fit_package_digest)
 select true,1,'${PANEL_SHA256}',private.embryo_test_statistical_panel_v1(),s.system_identifier::text,
  current_database(),d.oid,current_setting('server_version_num')::integer,${literal(binding)},
  '${FIT_ARTIFACT_SHA256}',private.embryo_test_fit_artifact_v1(),
  private.embryo_test_fit_package_v1(private.embryo_test_fit_artifact_v1()),'${fittedDigest}'
 from pg_catalog.pg_control_system() s join pg_catalog.pg_database d on d.datname=current_database();
 if private.current_embryo_test_statistical_admission_v1() is null or private.current_embryo_test_fit_admission_v1() is null
  then raise exception 'admission unavailable';end if;
end $install$;
commit;
select 'EMBRYO_TEST_STATISTICAL_REFERENCE_INSTALLED';`;
  const result = execute("docker", ["exec", "-i", "supabase_db_sequence", "psql", "-XAtq", "-U", "postgres",
    "-d", "postgres", "--set=ON_ERROR_STOP=1"], sql, 60_000);
  assert(result === "EMBRYO_TEST_STATISTICAL_REFERENCE_INSTALLED", "Native reference installation must settle exactly once");
  assert.deepEqual(inspect("supabase_db_sequence"), db, "DB container identity changed during admission");
  // Dynamic runtime counters may change; retain identity and immutable source.
  assert(inspect(CI_RUNTIME_CONTAINER).id === runtime.id && docker(["info", "--format", "{{.ID}}"] ) === daemonId,
    "Owned runtime identity changed during admission");
  if (operator) assertOwnedLinuxSource(operator, environment);
  else assert(execute("git", ["status", "--porcelain", "--untracked-files=all"]) === ""
    && execute("git", ["rev-parse", "HEAD"]) === head, "Source changed during admission");
}
