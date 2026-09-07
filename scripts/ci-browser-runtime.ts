import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, readFileSync, readdirSync, realpathSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { assertCiRuntime, checkedGateway, checkedPolicyCounters, CI_CONTROL_URL, CI_RUNTIME_CONTAINER, CI_RUNTIME_IMAGE, CI_RUNTIME_LABEL } from "./ci-browser-config";

function ownerFile() {
  const directory = process.env.RUNNER_TEMP;
  assert(typeof directory === "string" && path.isAbsolute(directory), "GitHub runner scratch directory required");
  return path.join(directory, "inherit-ci-browser-owner.json");
}
const docker = (args: string[]) => {
  try { return execFileSync("docker", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 60_000, maxBuffer: 1_048_576 }).trim(); }
  catch { throw new Error("Isolated CI Docker operation failed; credential-bearing diagnostics suppressed"); }
};
function buildIdentity() {
  assertCiRuntime(process.env);
  const head = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  assert(/^[0-9a-f]{40}$/.test(head), "Exact source revision required");
  assert(execFileSync("git", ["status", "--porcelain", "--untracked-files=no"], { encoding: "utf8" }).trim() === "",
    "CI build must use unchanged tracked source");
  const publicConfiguration = [process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    process.env.NEXT_PUBLIC_SITE_URL, process.env.NEXT_PUBLIC_APP_URL];
  assert(publicConfiguration.every(value => typeof value === "string" && value.length > 0), "Complete build configuration required");
  return { head, publicConfigurationSha256: createHash("sha256").update(JSON.stringify(publicConfiguration)).digest("hex"),
    buildId: readFileSync(".next/BUILD_ID", "utf8").trim(), nodeMajor: process.versions.node.split(".")[0] };
}
/** Called immediately after the successful workflow build; contains no keys. */
export function recordCiBuild() {
  writeFileSync(".next/inherit-ci-build.json", JSON.stringify(buildIdentity()) + "\n", { mode: 0o600 });
}
export async function startCiBrowserRuntime(): Promise<{ env: Record<string, string>; stop: () => void }> {
  assertCiRuntime(process.env);
  assert.deepEqual(JSON.parse(readFileSync(".next/inherit-ci-build.json", "utf8")), buildIdentity(), "CI build receipt must match source and public configuration");
  const root = realpathSync(process.cwd());
  assert(root === process.cwd() && !root.includes(",") && !root.includes("\n"), "Exact checkout mount required");
  assert(!readdirSync(root).some(name => /^\.env(?:\.|$)/.test(name) && !name.endsWith(".example")), "Do not expose local environment files to the CI runtime");
  // checkout must not persist its GitHub credential in the mounted repository.
  const gitConfig = execFileSync("git", ["config", "--local", "--name-only", "--list"], { encoding: "utf8" });
  assert(!/extraheader|credential\./i.test(gitConfig), "CI checkout credentials must not be persisted");
  const gateway = checkedGateway(JSON.parse(docker(["inspect", "--format", '{"name":{{json .Name}},"project":{{json (index .Config.Labels "com.supabase.cli.project")}},"running":{{json .State.Running}},"networks":{{json .NetworkSettings.Networks}}}', "supabase_kong_sequence"])));
  assert(docker(["network", "inspect", "--format", '{{index .Labels "com.supabase.cli.project"}}', gateway.network]) === "sequence", "Exact owned Supabase network required");
  assert(docker(["ps", "-aq", "--filter", `name=^/${CI_RUNTIME_CONTAINER}$`]) === "", "Never reuse or delete a preexisting runtime");
  const image = docker(["image", "inspect", "--format", '{{.Id}}', CI_RUNTIME_IMAGE]);
  assert(/^sha256:[0-9a-f]{64}$/.test(image), "Prepared runtime image required");
  assert(!existsSync(ownerFile()), "Never overwrite a prior runtime ownership receipt");
  const owner = randomUUID();
  const uid = process.getuid!(), gid = process.getgid!();
  assert(uid > 0 && gid > 0, "Host CI runner must be unprivileged");
  let stopped = false, receiptWritten = false;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    // Both name and unpredictable ownership label must match. No project stop,
    // image prune, volume prune, Docker reset, or unrelated process cleanup.
    try {
      const actual = docker(["inspect", "--format", `{{index .Config.Labels "${CI_RUNTIME_LABEL}"}}`, CI_RUNTIME_CONTAINER]);
      assert(actual === owner, "Refusing unrelated runtime cleanup");
      docker(["rm", "-f", CI_RUNTIME_CONTAINER]);
      if (receiptWritten) unlinkSync(ownerFile());
    } catch { throw new Error("Owned CI runtime cleanup failed; no unrelated container was removed"); }
  };
  let created = false;
  try {
    // No app environment, credential-bearing argv, Docker socket, host PID or
    // host network. TLS and writable scratch disappear with this container.
    const args = ["create", "--name", CI_RUNTIME_CONTAINER, "--label", `${CI_RUNTIME_LABEL}=${owner}`,
      "--network", gateway.network, "--read-only", "--cap-drop=ALL", "--cap-add=NET_ADMIN", "--security-opt=no-new-privileges",
      "--tmpfs", "/tmp:rw,nosuid,nodev,size=128m,mode=1777",
      "--tmpfs", `/tls:rw,nosuid,nodev,noexec,size=4m,mode=0700,uid=${uid},gid=${gid}`,
      "--mount", `type=bind,src=${root},dst=/app,readonly`,
      "--mount", `type=bind,src=${path.join(root, ".next")},dst=/app/.next`,
      ...[3100, 3101, 3102, 8130].flatMap(port => ["--publish", `127.0.0.1:${port}:${port}`]),
      image, "sh", "/app/scripts/ci-browser/namespace.sh", gateway.address];
    docker(args); created = true;
    writeFileSync(ownerFile(), JSON.stringify({ owner }), { mode: 0o600, flag: "wx" });
    receiptWritten = true;
    docker(["start", CI_RUNTIME_CONTAINER]);
    const deadline = Date.now() + 10_000;
    while (!docker(["logs", CI_RUNTIME_CONTAINER]).includes("ISOLATED_RUNTIME_READY")) {
      assert(Date.now() < deadline, "Runtime policy did not become ready");
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    const asUser = ["exec", "--user", `${uid}:${gid}`, CI_RUNTIME_CONTAINER];
    docker([...asUser, "sh", "/app/scripts/ci-browser/tls.sh"]);
    const proof = docker([...asUser, "env", "NODE_EXTRA_CA_CERTS=/tls/fixture/ca.crt", "node", "--import", "tsx",
      "/app/scripts/ci-browser/probe.mts", gateway.address]);
    assert(proof.includes("PASS isolated actual model policy, TLS, permission recheck and egress boundary"), "Mandatory runtime probe missing");
    checkedPolicyCounters(docker(["exec", CI_RUNTIME_CONTAINER, "iptables", "-L", "OUTPUT", "-v", "-n", "-x"]),
      docker(["exec", CI_RUNTIME_CONTAINER, "ip6tables", "-L", "OUTPUT", "-v", "-n", "-x"]));
    console.log(proof);
    console.log(`PASS disposable CI runtime image ${image}; source ${buildIdentity().head}; TLS keys stay in tmpfs.`);
    return { env: { INHERIT_CI_BROWSER_RUNTIME: "ready", CANONICAL_COPILOT_CONTROL_URL: CI_CONTROL_URL,
      INHERIT_CI_RUNTIME_UID: String(uid), INHERIT_CI_RUNTIME_GID: String(gid), INHERIT_CI_GATEWAY: gateway.address }, stop };
  } catch (error) {
    if (created) stop();
    throw error;
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
