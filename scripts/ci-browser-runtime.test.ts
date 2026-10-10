import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ files: new Map<string, string>(), commands: [] as string[][],
  cacheKind: "directory", owner: "", probeFails: false, wrongOwner: false, running: true, exitCode: 0, logs: "ISOLATED_RUNTIME_READY",
  failCommand: "", failError: undefined as unknown, gateway: "", namespaceState: "", removeFails: false,
  statisticalCalls: 0, statisticalFails: false }));
vi.mock("./embryo-test-statistical-admission", () => ({ installEmbryoTestStatisticalAdmission: () => {
  state.statisticalCalls++;
  expect(state.commands.some(command => command.includes("iptables"))).toBe(true);
  expect(state.commands.some(command => command.includes("ip6tables"))).toBe(true);
  if (state.statisticalFails) throw new Error("synthetic-private-admission-canary");
} }));
vi.mock("./ci-browser-config", async importOriginal => ({
  ...await importOriginal<typeof import("./ci-browser-config")>(),
  // Pure environment/platform refusal is tested separately. These lifecycle
  // tests exercise the real orchestration with a simulated Docker CLI only.
  assertCiRuntime: () => {},
}));
vi.mock("node:fs", () => ({
  existsSync: (file: string) => state.files.has(file),
  realpathSync: (file: string) => file,
  lstatSync: () => ({ isDirectory: () => state.cacheKind === "directory", isSymbolicLink: () => state.cacheKind === "symlink" }),
  readdirSync: () => ["package.json", ".git"],
  readFileSync: (file: string) => {
    if (!state.files.has(file)) throw new Error("missing test file");
    return state.files.get(file)!;
  },
  writeFileSync: (file: string, bytes: string) => state.files.set(file, bytes),
  unlinkSync: (file: string) => state.files.delete(file),
}));
vi.mock("node:child_process", () => ({ execFileSync: (program: string, args: string[]) => {
  state.commands.push([program, ...args]);
  if (state.failCommand && args.includes(state.failCommand)) throw state.failError;
  if (state.removeFails && args[0] === "rm") throw Object.assign(new Error("synthetic cleanup private material"), { status: 23 });
  if (program === "git") return args[0] === "rev-parse" ? "a".repeat(40) : "";
  if (args[0] === "create") { state.owner = args[args.indexOf("--label") + 1].split("=")[1]; return "container-id"; }
  if (args[0] === "ps") return "";
  if (args[0] === "image") return `sha256:${"b".repeat(64)}`;
  if (args[0] === "network") return "sequence";
  if (args[0] === "logs") return state.logs;
  if (args[0] === "inspect") {
    if (args[2]?.includes(".State.ExitCode")) return state.namespaceState || JSON.stringify({ running: state.running, exitCode: state.exitCode });
    if (args.at(-1) === "supabase_kong_sequence") return state.gateway || JSON.stringify({ name: "/supabase_kong_sequence", project: "sequence", running: true,
      networks: { supabase_network_sequence: { IPAddress: "172.19.0.3" } } });
    return state.wrongOwner ? "different-owner" : state.owner;
  }
  if (args.includes("iptables")) return "Chain OUTPUT (policy DROP 3 packets, 180 bytes)\n1 60 DROP all -- * * 0.0.0.0/0 127.0.0.11\n";
  if (args.includes("ip6tables")) return "Chain OUTPUT (policy DROP 0 packets, 0 bytes)";
  if (args.some(arg => arg.endsWith("probe.mts"))) {
    if (state.probeFails) throw new Error("synthetic transport rejection");
    return "PASS isolated actual model policy, TLS, permission recheck and egress boundary";
  }
  return "";
} }));
import { recordCiBuild, startCiBrowserRuntime } from "./ci-browser-runtime";
import { ciRuntimeFailureDiagnostic } from "./ci-browser-runtime-failure";
beforeEach(() => {
  state.files.clear(); state.commands.length = 0; state.cacheKind = "directory"; state.owner = ""; state.probeFails = false; state.wrongOwner = false; state.running = true; state.exitCode = 0; state.logs = "ISOLATED_RUNTIME_READY";
  state.failCommand = ""; state.failError = undefined; state.gateway = ""; state.namespaceState = ""; state.removeFails = false;
  state.statisticalCalls = 0; state.statisticalFails = false;
  state.files.set(".next/BUILD_ID", "synthetic-build");
  state.files.set(`${process.cwd()}/.next/cache`, "synthetic-cache-directory");
  vi.stubEnv("RUNNER_TEMP", "/synthetic-ci-tmp");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:54321");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "synthetic-public");
  vi.stubEnv("NEXT_PUBLIC_SITE_URL", "http://localhost:3100");
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "http://localhost:3100");
  vi.spyOn(console, "log").mockImplementation(() => {});
  recordCiBuild();
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });
describe("owned isolated CI runtime lifecycle", () => {
  it("admits the fixed reference only for the actual browser phase after policy proof", async () => {
    vi.stubEnv("GITHUB_JOB", "browser");
    const runtime = await startCiBrowserRuntime();
    expect(state.statisticalCalls).toBe(1);expect(runtime.env.INHERIT_CI_BROWSER_RUNTIME).toBe("ready");runtime.stop();
  });
  it("never returns readiness after reference failure and keeps raw diagnostics suppressed", async () => {
    vi.stubEnv("GITHUB_JOB", "browser");state.statisticalFails = true;
    let failure: unknown;try { await startCiBrowserRuntime(); } catch (error) { failure = error; }
    expect(state.statisticalCalls).toBe(1);
    expect(ciRuntimeFailureDiagnostic(failure)).toMatchObject({ runtimeStage: "statistical-reference-admission" });
    expect(JSON.stringify(ciRuntimeFailureDiagnostic(failure))).not.toContain("synthetic-private-admission-canary");
    expect(state.commands.filter(command => command[1] === "rm")).toHaveLength(1);
  });
  it("starts only after build/policy/TLS proof and removes only its own container once", async () => {
    const runtime = await startCiBrowserRuntime();
    const creation = state.commands.find(command => command[1] === "create")!;
    expect(creation).toContain("--read-only"); expect(creation).toContain("--cap-drop=ALL");
    expect(creation).toContain("--cap-add=NET_ADMIN"); expect(creation).toContain("--security-opt=no-new-privileges");
    expect(creation.filter(value => value.startsWith("127.0.0.1:"))).toEqual(["127.0.0.1:3100:3100", "127.0.0.1:3101:3101", "127.0.0.1:3102:3102", "127.0.0.1:3103:3103", "127.0.0.1:3104:3104", "127.0.0.1:3105:3105", "127.0.0.1:8130:8130"]);
    expect(creation.join(" ")).not.toMatch(/--privileged|docker\.sock|--network=host|--env/);
    const values = (flag: string) => creation.flatMap((value, index) => value === flag ? [creation[index + 1]] : []);
    expect(values("--add-host")).toEqual(["model.copilot.test:203.0.114.10", "prepared.artifacts.test:203.0.114.11", "embryo.fragments.test:203.0.114.12"]);
    expect(values("--dns")).toEqual(["127.0.0.1"]);
    expect(values("--dns-option")).toEqual(["attempts:1", "timeout:1"]);
    expect(values("--dns-search")).toEqual(["."]);
    expect(values("--tmpfs").map(value => value.split(":")[0])).toEqual(["/tmp", "/tls"]);
    expect(runtime.env.CANONICAL_COPILOT_CONTROL_URL).toBe("http://127.0.0.1:8130");
    runtime.stop(); runtime.stop();
    expect(state.commands.filter(command => command[1] === "rm")).toEqual([["docker", "rm", "-f", "inherit-ci-browser-runtime"]]);
    expect(state.files.has("/synthetic-ci-tmp/inherit-ci-browser-owner.json")).toBe(false);
  });
  it("reuses readonly build bytes while owning a bounded cache for this simulation only", async () => {
    const runtime = await startCiBrowserRuntime(undefined, true);
    const creation = state.commands.find(command => command[1] === "create")!;
    const values = (flag: string) => creation.flatMap((value, index) => value === flag ? [creation[index + 1]] : []);
    expect(values("--mount")).toEqual([`type=bind,src=${process.cwd()},dst=/app,readonly`,
      `type=bind,src=${process.cwd()}/.next,dst=/app/.next,readonly`]);
    expect(values("--tmpfs").map(value => value.split(":")[0])).toEqual(["/tmp", "/tls", "/app/.next/cache"]);
    expect(values("--tmpfs")[2]).toBe(`/app/.next/cache:rw,nosuid,nodev,noexec,size=128m,mode=0700,uid=${process.getuid!()},gid=${process.getgid!()}`);
    runtime.stop(); expect(state.commands.filter(command => command[1] === "rm")).toHaveLength(1);
  });
  it.each(["missing", "symlink", "file"])("refuses a %s cache route before creating any native container", async kind => {
    state.cacheKind = kind;
    if (kind === "missing") state.files.delete(`${process.cwd()}/.next/cache`);
    await expect(startCiBrowserRuntime(undefined, true)).rejects.toThrow("stage=build-cache; classification=guard-refused");
    expect(state.commands.some(command => command[1] === "create")).toBe(false);
  });
  it("reports an exited namespace immediately with only stage and exit code, and never starts TLS or the app", async () => {
    state.running = false; state.exitCode = 4;
    state.logs = "iptables: Read-only file system\nISOLATED_RUNTIME_FAILED phase=ipv4-policy exit=4";
    const error = await startCiBrowserRuntime().catch(error => error);
    expect(ciRuntimeFailureDiagnostic(error)).toEqual({ runtimeStage: "namespace-running", classification: "guard-refused", exitCode: 4, signal: null, namespacePhase: "ipv4-policy" });
    expect(error.message).not.toContain(state.logs);
    expect(state.commands.filter(command => command[1] === "logs")).toHaveLength(1);
    expect(state.commands.filter(command => command[1] === "rm")).toHaveLength(1);
    expect(state.commands.some(command => command[1] === "exec")).toBe(false);
  });
  it.each([
    "ISOLATED_RUNTIME_FAILED phase=resolver-file exit=4",
    "ISOLATED_RUNTIME_FAILED phase=ipv4-policy exit=7",
    "ISOLATED_RUNTIME_FAILED phase=ipv4-policy exit=4\nISOLATED_RUNTIME_FAILED phase=ipv6-policy exit=4",
    "ISOLATED_RUNTIME_FAILED phase=ipv4-policy exit=4 private-canary",
  ])("refuses a stopped namespace without trusting the unknown, mismatched or ambiguous marker %s", async marker => {
    state.running = false; state.exitCode = 4; state.logs = marker;
    const error = await startCiBrowserRuntime().catch(error => error);
    expect(ciRuntimeFailureDiagnostic(error)).toEqual({ runtimeStage: "namespace-running", classification: "guard-refused", exitCode: 4, signal: null });
    expect(error.message).not.toMatch(/resolver-file|private-canary|ipv4-policy|ipv6-policy/);
    expect(state.commands.some(command => command[1] === "exec")).toBe(false);
    expect(state.commands.filter(command => command[1] === "rm")).toHaveLength(1);
  });
  it("refuses an exited process even when its log contains an earlier ready marker", async () => {
    state.running = false;
    const error = await startCiBrowserRuntime().catch(error => error);
    expect(ciRuntimeFailureDiagnostic(error)).toEqual({ runtimeStage: "namespace-running", classification: "guard-refused", exitCode: 0, signal: null });
    expect(state.commands.some(command => command[1] === "exec")).toBe(false);
  });
  it("keeps the ten-second deadline and suppresses namespace output while setup remains running", async () => {
    state.logs = "x".repeat(9000) + "\nISOLATED_RUNTIME_FAILED phase=resolver-file exit=1";
    vi.spyOn(Date, "now").mockReturnValueOnce(0).mockReturnValue(10_000);
    const error = await startCiBrowserRuntime().catch(error => error);
    expect(ciRuntimeFailureDiagnostic(error)).toEqual({ runtimeStage: "namespace-ready", classification: "guard-refused", exitCode: null, signal: null });
    expect(error.message).not.toMatch(/x{20}|resolver-file/);
    expect(state.commands.some(command => command[1] === "exec")).toBe(false);
    expect(state.commands.filter(command => command[1] === "rm")).toHaveLength(1);
  });
  it("captures actual shell failure stderr and a fixed phase without running later namespace commands", async () => {
    const fs = await vi.importActual<typeof import("node:fs")>("node:fs");
    const child = await vi.importActual<typeof import("node:child_process")>("node:child_process");
    const os = await import("node:os"), path = await import("node:path");
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "inherit-namespace-test-"));
    try {
      fs.writeFileSync(path.join(directory, "ip"), "#!/bin/sh\nprintf 'synthetic ip refusal\n' >&2\nexit 17\n", { mode: 0o700 });
      const result = child.spawnSync("/bin/sh", ["scripts/ci-browser/namespace.sh", "172.19.0.3"], {
        env: { PATH: directory, NODE_ENV: "test" }, encoding: "utf8",
      });
      expect(result.status).toBe(17);
      expect(result.stderr).toBe("");
      expect(result.stdout).toBe("synthetic ip refusal\nISOLATED_RUNTIME_FAILED phase=loopback-address exit=17\n");
    } finally { fs.rmSync(directory, { recursive: true, force: true }); }
  });
  it("reaches the existing firewall phase without writing Docker-managed host or resolver files", async () => {
    const fs = await vi.importActual<typeof import("node:fs")>("node:fs");
    const child = await vi.importActual<typeof import("node:child_process")>("node:child_process");
    const os = await import("node:os"), path = await import("node:path");
    const script = fs.readFileSync("scripts/ci-browser/namespace.sh", "utf8");
    expect(script).not.toMatch(/(?:>|tee|sed|cp|mv)\s*[^\n]*\/etc\/(?:hosts|resolv\.conf)/);
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "inherit-namespace-policy-test-"));
    try {
      fs.writeFileSync(path.join(directory, "ip"), "#!/bin/sh\nexit 0\n", { mode: 0o700 });
      fs.writeFileSync(path.join(directory, "iptables"), "#!/bin/sh\nprintf 'synthetic firewall refusal\n' >&2\nexit 19\n", { mode: 0o700 });
      const result = child.spawnSync("/bin/sh", ["scripts/ci-browser/namespace.sh", "172.19.0.3"], {
        env: { PATH: directory, NODE_ENV: "test" }, encoding: "utf8",
      });
      expect(result.status).toBe(19); expect(result.stderr).toBe("");
      expect(result.stdout).toBe("synthetic firewall refusal\nISOLATED_RUNTIME_FAILED phase=ipv4-policy exit=19\n");
    } finally { fs.rmSync(directory, { recursive: true, force: true }); }
  });
  it("keeps all three synthetic TLS destinations on loopback without widening the firewall", async () => {
    const fs = await vi.importActual<typeof import("node:fs")>("node:fs");
    const namespace = fs.readFileSync("scripts/ci-browser/namespace.sh", "utf8");
    expect(namespace.split("\n").filter(line => line.startsWith("ip address add "))).toEqual([
      "ip address add 203.0.114.10/32 dev lo", "ip address add 203.0.114.11/32 dev lo",
      "ip address add 203.0.114.12/32 dev lo",
    ]);
    expect(namespace.split("\n").filter(line => line.startsWith("ip route get "))).toEqual([
      "ip route get 203.0.114.10 | grep -q 'dev lo'", "ip route get 203.0.114.11 | grep -q 'dev lo'",
      "ip route get 203.0.114.12 | grep -q 'dev lo'",
    ]);
    expect(namespace.split("\n").filter(line => /^ip6?tables -A /.test(line))).toEqual([
      "iptables -A OUTPUT -d 127.0.0.11 -j DROP", "iptables -A OUTPUT -p udp --dport 53 -j DROP",
      "iptables -A OUTPUT -p tcp --dport 53 -j DROP", "iptables -A OUTPUT -o lo -j ACCEPT",
      "iptables -A OUTPUT -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT",
      'iptables -A OUTPUT -d "$gateway" -p tcp --dport 8000 -j ACCEPT',
      "ip6tables -A OUTPUT -p udp --dport 53 -j DROP", "ip6tables -A OUTPUT -p tcp --dport 53 -j DROP",
      "ip6tables -A OUTPUT -o lo -j ACCEPT", "ip6tables -A OUTPUT -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT",
    ]);
    const tls = fs.readFileSync("scripts/ci-browser/tls.sh", "utf8");
    expect(tls.match(/subjectAltName=[^\\]+/g)).toEqual([
      "subjectAltName=DNS:model.copilot.test,DNS:prepared.artifacts.test,DNS:embryo.fragments.test",
    ]);
  });
  it("leaves a preexisting ownership receipt untouched without creating a container", async () => {
    state.files.set("/synthetic-ci-tmp/inherit-ci-browser-owner.json", "unrelated-receipt");
    await expect(startCiBrowserRuntime()).rejects.toThrow("stage=owner-receipt; classification=guard-refused");
    expect(state.commands.some(command => command[1] === "create" || command[1] === "rm")).toBe(false);
    expect(state.files.get("/synthetic-ci-tmp/inherit-ci-browser-owner.json")).toBe("unrelated-receipt");
  });
  it("cleans up on failed mandatory probe without starting or returning an app", async () => {
    state.probeFails = true;
    await expect(startCiBrowserRuntime()).rejects.toThrow("stage=isolated-probe-command; classification=setup-refused");
    expect(state.commands.filter(command => command[1] === "rm")).toHaveLength(1);
    expect(state.commands.some(command => command.some(arg => arg.endsWith("server.mts")))).toBe(false);
  });
  it("refuses stale build configuration before Docker and refuses changed ownership on cleanup", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "other-synthetic-public");
    await expect(startCiBrowserRuntime()).rejects.toThrow("stage=build-receipt; classification=guard-refused");
    expect(state.commands.some(command => command[0] === "docker")).toBe(false);
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "synthetic-public");
    const runtime = await startCiBrowserRuntime(); state.wrongOwner = true;
    expect(() => runtime.stop()).toThrow("stage=cleanup-ownership; classification=guard-refused");
    expect(state.commands.some(command => command[1] === "rm")).toBe(false);
  });
  it.each([
    ["create", "container-create", false], ["start", "container-start", true], ["logs", "namespace-logs", true],
    ["/app/scripts/ci-browser/tls.sh", "tls-bootstrap", true], ["iptables", "policy-ipv4-read", true],
    ["ip6tables", "policy-ipv6-read", true],
  ])("keeps the exact %s failure boundary and cleans up only after creation", async (command, stage, created) => {
    state.failCommand = command as string;
    state.failError = Object.assign(new Error("private argv/env/stdout/stderr canary"), { status: 17, stdout: "private stdout", stderr: "private stderr" });
    const error = await startCiBrowserRuntime().catch(error => error);
    expect(ciRuntimeFailureDiagnostic(error)).toEqual({ runtimeStage: stage, classification: "exit-nonzero", exitCode: 17, signal: null });
    expect(error.message).not.toMatch(/private|canary|argv|stdout|stderr/);
    expect(error.cause).toBeUndefined();
    expect(state.commands.filter(command => command[1] === "rm")).toHaveLength(created ? 1 : 0);
    expect(state.files.has("/synthetic-ci-tmp/inherit-ci-browser-owner.json")).toBe(false);
  });
  it.each([["gateway", "gateway-inspection"], ["namespace", "namespace-state"]])("labels malformed %s responses without returning their bytes", async (response, stage) => {
    if (response === "gateway") state.gateway = "private malformed canary";
    else state.namespaceState = "private malformed canary";
    const error = await startCiBrowserRuntime().catch(error => error);
    expect(ciRuntimeFailureDiagnostic(error)).toEqual({ runtimeStage: stage, classification: "invalid-response", exitCode: null, signal: null });
    expect(error.message).not.toMatch(/private|canary/);
  });
  it("preserves the original probe failure alongside cleanup refusal and retains its ownership receipt", async () => {
    state.probeFails = true; state.removeFails = true;
    const error = await startCiBrowserRuntime().catch(error => error);
    expect(ciRuntimeFailureDiagnostic(error)).toEqual({ runtimeStage: "isolated-probe-command", classification: "setup-refused", exitCode: null, signal: null,
      cleanupFailure: { runtimeStage: "cleanup-remove", classification: "exit-nonzero", exitCode: 23, signal: null } });
    expect(state.files.has("/synthetic-ci-tmp/inherit-ci-browser-owner.json")).toBe(true);
    expect(state.commands.filter(command => command[1] === "rm")).toHaveLength(1);
    expect(error.message).not.toMatch(/private|transport/);
    expect(error.cause).toBeUndefined();
  });
});
