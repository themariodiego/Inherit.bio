import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { closeSync, constants, existsSync, fstatSync, lstatSync, openSync, readFileSync, readdirSync, realpathSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { assertCiRuntime, checkedGateway, checkedPolicyCounters, CI_CONTROL_URL, CI_RUNTIME_CONTAINER, CI_RUNTIME_IMAGE, CI_RUNTIME_LABEL, APP_PORTS } from "./ci-browser-config";
import { assertOwnedLinuxSource, ownedLinuxSourceIdentity, type OwnedLinuxCapability } from "./owned-linux-runtime";
import { ciRuntimeCleanupFailure, ciRuntimeDockerFailure, ciRuntimeNamespaceStep, ciRuntimeSetupFailure, ciRuntimeStep } from "./ci-browser-runtime-failure";
import { installEmbryoTestStatisticalAdmission } from "./embryo-test-statistical-admission";
import { ACTIVE_APP_PROCESS_OBSERVATION, ACTIVE_NATIVE_DATABASE_OBSERVATION } from "./ci-browser/active-service-probe";
import { checkedAppServiceObservation } from "./ci-browser/service-observation";

function ownerFile() {
  const directory = process.env.RUNNER_TEMP;
  assert(typeof directory === "string" && path.isAbsolute(directory), "GitHub runner scratch directory required");
  return path.join(directory, "inherit-ci-browser-owner.json");
}
const docker = (args: string[], environment?: Record<string, string>) => {
  try { return execFileSync("docker", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 60_000, maxBuffer: 1_048_576, env: environment as NodeJS.ProcessEnv | undefined }).trim(); }
  catch (error) { throw ciRuntimeDockerFailure(error); }
};
function buildIdentity(environment?: Record<string, string>, operator?: OwnedLinuxCapability) {
  assertCiRuntime(process.env, process.platform, operator);
  const head = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8", env: environment as NodeJS.ProcessEnv | undefined }).trim();
  assert(/^[0-9a-f]{40}$/.test(head), "Exact source revision required");
  if (operator) assertOwnedLinuxSource(operator, environment);
  else assert(execFileSync("git", ["status", "--porcelain", "--untracked-files=no"], { encoding: "utf8", env: environment as NodeJS.ProcessEnv | undefined }).trim() === "",
    "CI build must use unchanged tracked source");
  const publicConfiguration = [process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    process.env.NEXT_PUBLIC_SITE_URL, process.env.NEXT_PUBLIC_APP_URL];
  assert(publicConfiguration.every(value => typeof value === "string" && value.length > 0), "Complete build configuration required");
  return { head, publicConfigurationSha256: createHash("sha256").update(JSON.stringify(publicConfiguration)).digest("hex"),
    buildId: readFileSync(".next/BUILD_ID", "utf8").trim(), nodeMajor: process.versions.node.split(".")[0] };
}
/** Called immediately after the successful workflow build; contains no keys. */
export function recordCiBuild(environment?: Record<string, string>, operator?: OwnedLinuxCapability) {
  writeFileSync(".next/inherit-ci-build.json", JSON.stringify(buildIdentity(environment, operator)) + "\n", { mode: 0o600 });
}
export async function startCiBrowserRuntime(environment?: Record<string, string>, disposableBuildCache = false, operator?: OwnedLinuxCapability): Promise<{ env: Record<string, string>; stop: () => void; observeActiveService: (acknowledgment: unknown, fixtureSourcePath: string) => import("./density-capture-plan").DensityRuntime }> {
  ciRuntimeStep("runtime-policy", () => assertCiRuntime(process.env, process.platform, operator));
  const runDocker = (args: string[]) => docker(args, environment);
  ciRuntimeStep("build-receipt", () => assert.deepEqual(JSON.parse(readFileSync(".next/inherit-ci-build.json", "utf8")),
    ciRuntimeStep("build-identity", () => buildIdentity(environment, operator)), "CI build receipt must match source and public configuration"));
  const root = ciRuntimeStep("checkout-location", () => {
    const value = realpathSync(process.cwd());
    assert(value === process.cwd() && !value.includes(",") && !value.includes("\n"), "Exact checkout mount required");
    return value;
  });
  ciRuntimeStep("checkout-environment", () => assert(!readdirSync(root).some(name => /^\.env(?:\.|$)/.test(name) && !name.endsWith(".example")), "Do not expose local environment files to the CI runtime"));
  if (disposableBuildCache) {
    ciRuntimeStep("build-cache", () => {
      const cache = path.join(root, ".next/cache");
      const cacheIdentity = existsSync(cache) ? lstatSync(cache) : undefined;
      assert(cacheIdentity?.isDirectory() && !cacheIdentity.isSymbolicLink(),
        "Disposable build cache requires the genuine build cache directory");
    });
  }
  // checkout must not persist its GitHub credential in the mounted repository.
  ciRuntimeStep("git-credentials", () => {
    const gitConfig = execFileSync("git", ["config", "--local", "--name-only", "--list"], { encoding: "utf8", env: environment as NodeJS.ProcessEnv | undefined });
    assert(!/extraheader|credential\./i.test(gitConfig), "CI checkout credentials must not be persisted");
  });
  const gateway = ciRuntimeStep("gateway-inspection", () => checkedGateway(JSON.parse(runDocker(["inspect", "--format", '{"name":{{json .Name}},"project":{{json (index .Config.Labels "com.supabase.cli.project")}},"running":{{json .State.Running}},"networks":{{json .NetworkSettings.Networks}}}', "supabase_kong_sequence"]))));
  ciRuntimeStep("network-ownership", () => assert(runDocker(["network", "inspect", "--format", '{{index .Labels "com.supabase.cli.project"}}', gateway.network]) === "sequence", "Exact owned Supabase network required"));
  ciRuntimeStep("runtime-absence", () => assert(runDocker(["ps", "-aq", "--filter", `name=^/${CI_RUNTIME_CONTAINER}$`]) === "", "Never reuse or delete a preexisting runtime"));
  const image = ciRuntimeStep("runtime-image", () => {
    const value = runDocker(["image", "inspect", "--format", '{{.Id}}', CI_RUNTIME_IMAGE]);
    assert(/^sha256:[0-9a-f]{64}$/.test(value), "Prepared runtime image required");
    return value;
  });
  ciRuntimeStep("owner-receipt", () => assert(!existsSync(ownerFile()), "Never overwrite a prior runtime ownership receipt"));
  const { owner, uid, gid } = ciRuntimeStep("runner-identity", () => {
    const owner = randomUUID(), uid = process.getuid!(), gid = process.getgid!();
    assert(uid > 0 && gid > 0, "Host CI runner must be unprivileged");
    return { owner, uid, gid };
  });
  let stopped = false, receiptWritten = false;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    // Both name and unpredictable ownership label must match. No project stop,
    // image prune, volume prune, Docker reset, or unrelated process cleanup.
    try {
      ciRuntimeStep("cleanup-ownership", () => {
        const actual = runDocker(["inspect", "--format", `{{index .Config.Labels "${CI_RUNTIME_LABEL}"}}`, CI_RUNTIME_CONTAINER]);
        assert(actual === owner, "Refusing unrelated runtime cleanup");
      });
      ciRuntimeStep("cleanup-remove", () => runDocker(["rm", "-f", CI_RUNTIME_CONTAINER]));
      if (receiptWritten) ciRuntimeStep("cleanup-receipt", () => unlinkSync(ownerFile()));
    } catch (error) { throw ciRuntimeSetupFailure("cleanup-ownership", error); }
  };
  let created = false, createdId = "";
  try {
    // No app environment, credential-bearing argv, Docker socket, host PID or
    // host network. TLS and writable scratch disappear with this container.
    const args = ["create", "--name", CI_RUNTIME_CONTAINER, "--label", `${CI_RUNTIME_LABEL}=${owner}`,
      "--network", gateway.network,
      "--add-host", "model.copilot.test:203.0.114.10",
      "--add-host", "prepared.artifacts.test:203.0.114.11",
      "--add-host", "embryo.fragments.test:203.0.114.12",
      "--dns", "127.0.0.1", "--dns-option", "attempts:1", "--dns-option", "timeout:1", "--dns-search", ".",
      "--read-only", "--cap-drop=ALL", "--cap-add=NET_ADMIN", "--security-opt=no-new-privileges",
      "--tmpfs", "/tmp:rw,nosuid,nodev,size=128m,mode=1777",
      "--tmpfs", `/tls:rw,nosuid,nodev,noexec,size=4m,mode=0700,uid=${uid},gid=${gid}`,
      "--mount", `type=bind,src=${root},dst=/app,readonly`,
      "--mount", `type=bind,src=${path.join(root, ".next")},dst=/app/.next${disposableBuildCache ? ",readonly" : ""}`,
      // This container alone owns the mutable cache; container removal discards
      // it. The exclusive launcher reuses built executable bytes readonly.
      ...(disposableBuildCache ? ["--tmpfs", `/app/.next/cache:rw,nosuid,nodev,noexec,size=128m,mode=0700,uid=${uid},gid=${gid}`] : []),
      ...[...APP_PORTS, 8130].flatMap(port => ["--publish", `127.0.0.1:${port}:${port}`]),
      image, "sh", "/app/scripts/ci-browser/namespace.sh", gateway.address];
    createdId = ciRuntimeStep("container-create", () => runDocker(args)); created = true;
    ciRuntimeStep("owner-write", () => writeFileSync(ownerFile(), JSON.stringify({ owner }), { mode: 0o600, flag: "wx" }));
    receiptWritten = true;
    ciRuntimeStep("container-start", () => runDocker(["start", CI_RUNTIME_CONTAINER]));
    const deadline = Date.now() + 10_000;
    while (true) {
      // Only the credential-free namespace process has run at this point. Its
      // fixed-command stderr is redirected into this bounded setup log. Never
      // collect container logs here after TLS/probe/application execution.
      const logs = ciRuntimeStep("namespace-logs", () => runDocker(["logs", "--tail", "80", CI_RUNTIME_CONTAINER]));
      const status = ciRuntimeStep("namespace-state", () => {
        const value = JSON.parse(runDocker(["inspect", "--format",
          '{"running":{{json .State.Running}},"exitCode":{{json .State.ExitCode}}}', CI_RUNTIME_CONTAINER]));
        assert(typeof value.running === "boolean" && Number.isInteger(value.exitCode), "Invalid namespace process state");
        return value;
      });
      ciRuntimeNamespaceStep(() => assert(status.running, "Runtime policy exited before readiness"), logs, status.exitCode);
      if (logs.split(/\r?\n/).includes("ISOLATED_RUNTIME_READY")) break;
      ciRuntimeStep("namespace-ready", () => assert(Date.now() < deadline, "Runtime policy did not become ready"));
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    const asUser = ["exec", "--user", `${uid}:${gid}`, CI_RUNTIME_CONTAINER];
    ciRuntimeStep("tls-bootstrap", () => runDocker([...asUser, "sh", "/app/scripts/ci-browser/tls.sh"]));
    const proof = ciRuntimeStep("isolated-probe-command", () => runDocker([...asUser, "env", "NODE_EXTRA_CA_CERTS=/tls/fixture/ca.crt", "node", "--import", "tsx",
      "/app/scripts/ci-browser/probe.mts", gateway.address]));
    ciRuntimeStep("isolated-probe-proof", () => assert(proof.includes("PASS isolated actual model policy, TLS, permission recheck and egress boundary"), "Mandatory runtime probe missing"));
    const ipv4 = ciRuntimeStep("policy-ipv4-read", () => runDocker(["exec", CI_RUNTIME_CONTAINER, "iptables", "-L", "OUTPUT", "-v", "-n", "-x"]));
    const ipv6 = ciRuntimeStep("policy-ipv6-read", () => runDocker(["exec", CI_RUNTIME_CONTAINER, "ip6tables", "-L", "OUTPUT", "-v", "-n", "-x"]));
    ciRuntimeStep("policy-counters", () => checkedPolicyCounters(ipv4, ipv6));
    if (operator || process.env.GITHUB_JOB === "browser") ciRuntimeStep("statistical-reference-admission", () =>
      installEmbryoTestStatisticalAdmission(owner, gateway.network, environment, operator));
    console.log(proof);
    console.log(`PASS disposable ${operator ? "owned Linux" : "CI"} runtime image ${image}; source ${ciRuntimeStep("final-source-identity", () => buildIdentity(environment, operator)).head}; TLS keys stay in tmpfs.`);

    // Opt-in observers never read Config.Env, /proc/*/environ, logs, credentials
    // or completed fixture state. They recheck the actual active owner each time.
    let observationAnchor: string | undefined;
    const observeActiveService = (input: unknown, fixtureSourcePath: string) => {
      try {
        assert(!stopped && created && receiptWritten, "Active owned runtime required");
        assertCiRuntime(process.env, process.platform, operator);
        const receipt = lstatSync(ownerFile());
        assert(receipt.isFile() && !receipt.isSymbolicLink() && receipt.nlink === 1
          && receipt.uid === uid && (receipt.mode & 0o077) === 0 && receipt.size < 1024);
        assert.deepEqual(JSON.parse(readFileSync(ownerFile(), "utf8")), { owner });
        const ack = checkedAppServiceObservation(input);
        assert(ack.uid === uid && ack.gid === gid, "Actual unprivileged app identity required");
        const bytes = (relative: string) => {
          assert(/^(?:docs|e2e|scripts)\/[a-zA-Z0-9_./-]+\.(?:json|[cm]?ts|tsx)$/.test(relative)
            && !relative.split("/").some(part => part === ".." || part === "."), "Public source path required");
          const file = path.join(root, relative); assert(realpathSync(file) === file);
          const fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW);
          try {
            const before = fstatSync(fd); assert(before.isFile() && before.nlink === 1 && before.size <= 16_777_216);
            const value = readFileSync(fd), after = fstatSync(fd);
            assert(value.length === before.size && before.dev === after.dev && before.ino === after.ino
              && before.size === after.size && before.mtimeMs === after.mtimeMs && before.ctimeMs === after.ctimeMs);
            return value;
          } finally { closeSync(fd); }
        };
        const build = buildIdentity(environment, operator);
        assert.deepEqual(JSON.parse(readFileSync(".next/inherit-ci-build.json", "utf8")), build);
        assert(build.buildId === ack.buildId && process.versions.node.split(".")[0] === "22");
        const tree = execFileSync("git", ["rev-parse", "HEAD^{tree}"], { encoding: "utf8", timeout: 10_000,
          maxBuffer: 8192, stdio: ["ignore", "pipe", "pipe"], env: environment as NodeJS.ProcessEnv | undefined }).trim();
        assert(/^[0-9a-f]{40}$/.test(tree));
        const source = { head: build.head, tree, registerSha256: createHash("sha256").update(bytes("docs/route-register.json")).digest("hex") };
        const fixtureSourceSha256 = createHash("sha256").update(bytes(fixtureSourcePath)).digest("hex");
        const bootId = readFileSync("/proc/sys/kernel/random/boot_id", "utf8").trim();
        assert(bootId === ack.bootId);
        const format = '{"id":{{json .Id}},"name":{{json .Name}},"running":{{json .State.Running}},'
          + '"project":{{json (index .Config.Labels "com.supabase.cli.project")}},'
          + `"owner":{{json (index .Config.Labels "${CI_RUNTIME_LABEL}")}},`
          + '"image":{{json .Image}},"network":{{json .HostConfig.NetworkMode}},"networks":{{json .NetworkSettings.Networks}},"mounts":{{json .Mounts}}}';
        const inspect = (name: string) => JSON.parse(runDocker(["inspect", "--format", format, name]));
        const runtime = inspect(CI_RUNTIME_CONTAINER), db = inspect("supabase_db_sequence"), storage = inspect("supabase_storage_sequence");
        for (const [name, value] of [[CI_RUNTIME_CONTAINER, runtime], ["supabase_db_sequence", db], ["supabase_storage_sequence", storage]] as const) {
          assert(value.name === `/${name}` && /^[0-9a-f]{64}$/.test(value.id) && value.running === true
            && value.network === gateway.network && Object.keys(value.networks).length === 1 && Object.hasOwn(value.networks, gateway.network));
          if (name === CI_RUNTIME_CONTAINER) assert(value.id === createdId && value.owner === owner && value.image === image
            && value.mounts.some((mount: { Source: string; Destination: string; RW: boolean }) =>
              mount.Source === root && mount.Destination === "/app" && mount.RW === false));
          else assert(value.project === "sequence");
        }
        assert.deepEqual(checkedGateway(JSON.parse(runDocker(["inspect", "--format", '{"name":{{json .Name}},"project":{{json (index .Config.Labels "com.supabase.cli.project")}},"running":{{json .State.Running}},"networks":{{json .NetworkSettings.Networks}}}', "supabase_kong_sequence"]))), gateway);
        const network = JSON.parse(runDocker(["network", "inspect", "--format", '{"id":{{json .Id}},"project":{{json (index .Labels "com.supabase.cli.project")}}', gateway.network]));
        assert(/^[0-9a-f]{64}$/.test(network.id) && network.project === "sequence");
        const daemonId = runDocker(["info", "--format", "{{.ID}}"]); assert(daemonId.length > 0 && daemonId.length <= 256);
        if (operator) assert(ownedLinuxSourceIdentity(operator).daemonId === daemonId);
        const anchor = JSON.stringify({ source, build, owner, bootId, daemonId, runtimeId: runtime.id, dbId: db.id, storageId: storage.id, networkId: network.id, gateway });
        assert(observationAnchor === undefined || observationAnchor === anchor, "Actual native/source owner changed");
        const actual = JSON.parse(runDocker(["exec", "--user", `${uid}:${gid}`, CI_RUNTIME_CONTAINER, "node", "--input-type=module", "-e", ACTIVE_APP_PROCESS_OBSERVATION, String(ack.appPid), String(ack.port)]));
        assert.deepEqual(actual, { appPid: ack.appPid, appStartTicks: ack.appStartTicks, bootId,
          uid, gid, cwd: "/app", executable: "/usr/local/bin/node", listening: true });
        const native = JSON.parse(runDocker(["exec", "supabase_db_sequence", "psql", "-XAtq", "-U", "postgres", "-d", "postgres", "--set=ON_ERROR_STOP=1", "-c", ACTIVE_NATIVE_DATABASE_OBSERVATION]));
        assert(Object.keys(native).sort().join(",") === "databaseName,databaseOid,readOnly,systemIdentifier"
          && native.databaseName === "postgres" && Number.isSafeInteger(native.databaseOid) && native.databaseOid > 0
          && /^[1-9][0-9]{0,19}$/.test(native.systemIdentifier) && native.readOnly === true);
        const result = { version: 1 as const, scope: "disposable-synthetic-native" as const, source,
          appOrigin: ack.appOrigin, buildId: build.buildId, ownerNonce: owner, bootId,
          systemIdentifier: native.systemIdentifier as string, databaseOid: native.databaseOid as number,
          databaseName: "postgres" as const, daemonSha256: createHash("sha256").update(daemonId).digest("hex"), fixtureSourceSha256 };
        // Reobserve immutable public namespace/source and actual PID after the
        // one read-only metadata transaction, so a mid-read replacement refuses.
        assert(JSON.stringify(inspect(CI_RUNTIME_CONTAINER)) === JSON.stringify(runtime)
          && JSON.stringify(inspect("supabase_db_sequence")) === JSON.stringify(db)
          && JSON.stringify(inspect("supabase_storage_sequence")) === JSON.stringify(storage)
          && runDocker(["info", "--format", "{{.ID}}"] ) === daemonId);
        assert.deepEqual(JSON.parse(runDocker(["exec", "--user", `${uid}:${gid}`, CI_RUNTIME_CONTAINER, "node", "--input-type=module", "-e", ACTIVE_APP_PROCESS_OBSERVATION, String(ack.appPid), String(ack.port)])), actual);
        assert.deepEqual(buildIdentity(environment, operator), build);
        assert(createHash("sha256").update(bytes("docs/route-register.json")).digest("hex") === source.registerSha256
          && createHash("sha256").update(bytes(fixtureSourcePath)).digest("hex") === fixtureSourceSha256 && !stopped);
        observationAnchor = anchor;
        return result;
      } catch { throw new Error("Active owned app/native observation refused"); }
    };

    return { env: { INHERIT_CI_BROWSER_RUNTIME: "ready", CANONICAL_COPILOT_CONTROL_URL: CI_CONTROL_URL,
      INHERIT_CI_RUNTIME_UID: String(uid), INHERIT_CI_RUNTIME_GID: String(gid), INHERIT_CI_GATEWAY: gateway.address }, stop, observeActiveService };
  } catch (error) {
    const failure = ciRuntimeSetupFailure("runtime-setup", error);
    if (created) {
      try { stop(); } catch (cleanup) { throw ciRuntimeCleanupFailure(failure, cleanup); }
    }
    throw failure;
  }
}
/** Workflow fallback when the owning Node process is killed. Fresh job only. */
export function cleanupCiBrowserRuntime() {
  assertCiRuntime(process.env);
  if (!docker(["ps", "-aq", "--filter", `name=^/${CI_RUNTIME_CONTAINER}$`])) return;
  const label = docker(["inspect", "--format", `{{index .Config.Labels "${CI_RUNTIME_LABEL}"}}`, CI_RUNTIME_CONTAINER]);
  const recorded = JSON.parse(readFileSync(ownerFile(), "utf8")) as { owner?: string };
  assert(/^[0-9a-f-]{36}$/.test(label) && label === recorded.owner, "Refusing cleanup of an unowned container");
  docker(["rm", "-f", CI_RUNTIME_CONTAINER]);
  unlinkSync(ownerFile());
}
