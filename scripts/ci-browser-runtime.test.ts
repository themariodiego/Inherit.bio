import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ files: new Map<string, string>(), commands: [] as string[][],
  owner: "", probeFails: false, wrongOwner: false, running: true, exitCode: 0, logs: "ISOLATED_RUNTIME_READY" }));
vi.mock("./ci-browser-config", async importOriginal => ({
  ...await importOriginal<typeof import("./ci-browser-config")>(),
  // Pure environment/platform refusal is tested separately. These lifecycle
  // tests exercise the real orchestration with a simulated Docker CLI only.
  assertCiRuntime: () => {},
}));
vi.mock("node:fs", () => ({
  existsSync: (file: string) => state.files.has(file),
  realpathSync: (file: string) => file,
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
  if (program === "git") return args[0] === "rev-parse" ? "a".repeat(40) : "";
  if (args[0] === "create") { state.owner = args[args.indexOf("--label") + 1].split("=")[1]; return "container-id"; }
  if (args[0] === "ps") return "";
  if (args[0] === "image") return `sha256:${"b".repeat(64)}`;
  if (args[0] === "network") return "sequence";
  if (args[0] === "logs") return state.logs;
  if (args[0] === "inspect") {
    if (args[2]?.includes(".State.ExitCode")) return JSON.stringify({ running: state.running, exitCode: state.exitCode });
    if (args.at(-1) === "supabase_kong_sequence") return JSON.stringify({ name: "/supabase_kong_sequence", project: "sequence", running: true,
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
beforeEach(() => {
  state.files.clear(); state.commands.length = 0; state.owner = ""; state.probeFails = false; state.wrongOwner = false; state.running = true; state.exitCode = 0; state.logs = "ISOLATED_RUNTIME_READY";
  state.files.set(".next/BUILD_ID", "synthetic-build");
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
  it("starts only after build/policy/TLS proof and removes only its own container once", async () => {
    const runtime = await startCiBrowserRuntime();
    const creation = state.commands.find(command => command[1] === "create")!;
    expect(creation).toContain("--read-only"); expect(creation).toContain("--cap-drop=ALL");
    expect(creation).toContain("--cap-add=NET_ADMIN"); expect(creation).toContain("--security-opt=no-new-privileges");
    expect(creation.filter(value => value.startsWith("127.0.0.1:"))).toEqual(["127.0.0.1:3100:3100", "127.0.0.1:3101:3101", "127.0.0.1:3102:3102", "127.0.0.1:8130:8130"]);
    expect(creation.join(" ")).not.toMatch(/--privileged|docker\.sock|--network=host|--env/);
    const values = (flag: string) => creation.flatMap((value, index) => value === flag ? [creation[index + 1]] : []);
    expect(values("--add-host")).toEqual(["model.copilot.test:203.0.114.10"]);
    expect(values("--dns")).toEqual(["127.0.0.1"]);
    expect(values("--dns-option")).toEqual(["attempts:1", "timeout:1"]);
    expect(values("--dns-search")).toEqual(["."]);
    expect(values("--tmpfs").map(value => value.split(":")[0])).toEqual(["/tmp", "/tls"]);
    expect(runtime.env.CANONICAL_COPILOT_CONTROL_URL).toBe("http://127.0.0.1:8130");
    runtime.stop(); runtime.stop();
    expect(state.commands.filter(command => command[1] === "rm")).toEqual([["docker", "rm", "-f", "inherit-ci-browser-runtime"]]);
    expect(state.files.has("/synthetic-ci-tmp/inherit-ci-browser-owner.json")).toBe(false);
  });
  it("reports an exited namespace immediately, retains phase diagnostics and never starts TLS or the app", async () => {
    state.running = false; state.exitCode = 4;
    state.logs = "iptables: Read-only file system\nISOLATED_RUNTIME_FAILED phase=ipv4-policy exit=4";
    await expect(startCiBrowserRuntime()).rejects.toThrow("exited before readiness (exit 4). Namespace diagnostics:\n" + state.logs);
    expect(state.commands.filter(command => command[1] === "logs")).toHaveLength(1);
    expect(state.commands.filter(command => command[1] === "rm")).toHaveLength(1);
    expect(state.commands.some(command => command[1] === "exec")).toBe(false);
  });
  it("refuses an exited process even when its log contains an earlier ready marker", async () => {
    state.running = false;
    await expect(startCiBrowserRuntime()).rejects.toThrow("exited before readiness (exit 0)");
    expect(state.commands.some(command => command[1] === "exec")).toBe(false);
  });
  it("keeps the ten-second deadline and bounds diagnostics while setup remains running", async () => {
    state.logs = "x".repeat(9000) + "\nISOLATED_RUNTIME_FAILED phase=resolver-file exit=1";
    vi.spyOn(Date, "now").mockReturnValueOnce(0).mockReturnValue(10_000);
    await expect(startCiBrowserRuntime()).rejects.toThrow("Runtime policy did not become ready. Namespace diagnostics:\n" + state.logs.slice(-8192));
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
  it("leaves a preexisting ownership receipt untouched without creating a container", async () => {
    state.files.set("/synthetic-ci-tmp/inherit-ci-browser-owner.json", "unrelated-receipt");
    await expect(startCiBrowserRuntime()).rejects.toThrow("prior runtime ownership receipt");
    expect(state.commands.some(command => command[1] === "create" || command[1] === "rm")).toBe(false);
    expect(state.files.get("/synthetic-ci-tmp/inherit-ci-browser-owner.json")).toBe("unrelated-receipt");
  });
  it("cleans up on failed mandatory probe without starting or returning an app", async () => {
    state.probeFails = true;
    await expect(startCiBrowserRuntime()).rejects.toThrow("Docker operation failed");
    expect(state.commands.filter(command => command[1] === "rm")).toHaveLength(1);
    expect(state.commands.some(command => command.some(arg => arg.endsWith("server.mts")))).toBe(false);
  });
  it("refuses stale build configuration before Docker and refuses changed ownership on cleanup", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "other-synthetic-public");
    await expect(startCiBrowserRuntime()).rejects.toThrow("build receipt");
    expect(state.commands.some(command => command[0] === "docker")).toBe(false);
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "synthetic-public");
    const runtime = await startCiBrowserRuntime(); state.wrongOwner = true;
    expect(() => runtime.stop()).toThrow("no unrelated container was removed");
    expect(state.commands.some(command => command[1] === "rm")).toBe(false);
  });
});
