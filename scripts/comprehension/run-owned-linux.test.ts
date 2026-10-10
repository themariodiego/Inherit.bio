import { describe, expect, it, vi } from "vitest";
import { ownedLinuxAppBootstrap, privateOperatorFrameSchema } from "./run-owned-linux.mjs";
import { freshComprehensionBuildEnvironment, prepareFreshInvocation } from "./run-fresh-t6.mjs";
import { infrastructureChildEnvironment } from "./fresh-t6-resources";
import { childEnvironment } from "./inference-isolation";
import { APP_ENV_NAMES } from "../ci-browser-config";
import { appServerEnvironment } from "../ci-browser-app-environment";
import { assertOperatorHostEnvironment } from "../owned-linux-runtime";

const configuration = { maximumInfrastructureCostPerStackMicroDollars: 100, run: {
  schemaVersion: 1, kind: "smoke", tasks: ["T6", "T7"], personas: 2,
  effortDirectory: "/tmp/operator-unit-effort", stubRecordRoot: "/tmp/operator-unit-records",
  samplingSeed: "d".repeat(64), limitMicroDollars: 10_000, otherCostsMicroDollars: 300,
  provider: { kind: "local-deterministic-stub" }, settings: { temperature: 0, maxSteps: 8,
    maxAttempts: 1, timeoutMs: 60_000, sessionSetupTimeoutMs: 900_000,
    maximumInputTokens: 32_000, maximumOutputTokens: 4_000,
    price: { inputMicroDollarsPerMillion: 1, outputMicroDollarsPerMillion: 1 } } } };

describe("trusted owned-operator build heap only", () => {
  const host = { PATH: "/usr/bin:/bin", HOME: "/home/operator", LANG: "C.UTF-8", NODE_ENV: "production" };
  const ambient = { ...host, NODE_OPTIONS: "--require=untrusted-unit-module",
    ...Object.fromEntries(APP_ENV_NAMES.map(name => [name, `synthetic-${name.toLowerCase()}`])) };
  it("selects only the authored heap for an owned build and retains parent-option refusal", () => {
    expect(() => assertOperatorHostEnvironment({ ...host, NODE_OPTIONS: ambient.NODE_OPTIONS })).toThrow();
    const infrastructure = infrastructureChildEnvironment(ambient);
    expect(infrastructure).not.toHaveProperty("NODE_OPTIONS");
    expect(freshComprehensionBuildEnvironment(infrastructure, ambient, true).NODE_OPTIONS)
      .toBe("--max-old-space-size=4096");
    expect(freshComprehensionBuildEnvironment(infrastructure, ambient, false)).not.toHaveProperty("NODE_OPTIONS");
    expect(() => freshComprehensionBuildEnvironment({ ...infrastructure, NODE_OPTIONS: "--max-old-space-size=8192" }, ambient, true))
      .toThrow("Ambient Node options");
  });
  it("does not change the parent or leak the trusted build setting to infrastructure, app or inference children", () => {
    const infrastructure = infrastructureChildEnvironment(ambient);
    const build = freshComprehensionBuildEnvironment(infrastructure, ambient, true);
    expect(ambient.NODE_OPTIONS).toBe("--require=untrusted-unit-module");
    expect(infrastructure).not.toHaveProperty("NODE_OPTIONS");
    expect(infrastructureChildEnvironment(build)).not.toHaveProperty("NODE_OPTIONS");
    expect(appServerEnvironment(build, 3100)).not.toHaveProperty("NODE_OPTIONS");
    expect(childEnvironment({ kind: "local-deterministic-stub" }, build)).toEqual({ PATH: host.PATH, LANG: "C.UTF-8" });
  });
});

describe("owner anonymous input contract, never a runtime or model call", () => {
  it("generates fresh disposable app keys without introducing model or hosted identity", () => {
    const first = ownedLinuxAppBootstrap(), second = ownedLinuxAppBootstrap();
    for (const name of ["BYOK_ENCRYPTION_KEY", "JOBS_SECRET", "CRON_SECRET"]) {
      expect(first[name]).not.toEqual(second[name]);
      expect(Buffer.from(first[name], name === "BYOK_ENCRYPTION_KEY" ? "base64" : "hex")).toHaveLength(32);
    }
    expect(first.RESEND_BASE_URL).toBe("http://127.0.0.1:8124");
    expect(first.NEXT_PUBLIC_SITE_URL).toBe("http://localhost:3100");
    expect(first).not.toHaveProperty("COMPREHENSION_MODEL_API_KEY");
    expect(first).not.toHaveProperty("GITHUB_JOB");
    expect(first).not.toHaveProperty("CI");
  });
  it("admits a key-free stub and refuses a credential in that branch", () => {
    expect(privateOperatorFrameSchema.safeParse({ configuration }).success).toBe(true);
    expect(privateOperatorFrameSchema.safeParse({ configuration, credential: "EXAMPLE_NO_REAL_CREDENTIAL" }).success).toBe(false);
  });
  it("requires the exact isolated credential name for a real provider", () => {
    const real = { ...configuration, run: { ...configuration.run, provider: { kind: "openai-compatible-chat",
      label: "external/fixture", endpoint: "https://example.invalid/chat", modelIdentifier: "unitmodel123",
      apiKeyVariable: "COMPREHENSION_MODEL_API_KEY" } } };
    expect(privateOperatorFrameSchema.safeParse({ configuration: real }).success).toBe(false);
    expect(privateOperatorFrameSchema.safeParse({ configuration: real, credential: "EXAMPLE_NO_REAL_CREDENTIAL" }).success).toBe(true);
    expect(privateOperatorFrameSchema.safeParse({ configuration: { ...real, run: { ...real.run,
      provider: { ...real.run.provider, apiKeyVariable: "JOBS_SECRET" } } }, credential: "EXAMPLE_NO_REAL_CREDENTIAL" }).success).toBe(false);
  });
  it("rejects multiline/control/oversized input and automatic inference retry", () => {
    const real = { ...configuration, run: { ...configuration.run, provider: { kind: "openai-compatible-chat",
      label: "external/fixture", endpoint: "https://example.invalid/chat", modelIdentifier: "unitmodel123",
      apiKeyVariable: "COMPREHENSION_MODEL_API_KEY" } } };
    for (const credential of ["", "synthetic\nvalue", "synthetic\0value", "x".repeat(8193)])
      expect(privateOperatorFrameSchema.safeParse({ configuration: real, credential }).success).toBe(false);
    expect(privateOperatorFrameSchema.safeParse({ configuration: { ...configuration,
      run: { ...configuration.run, settings: { ...configuration.run.settings, maxAttempts: 2 } } } }).success).toBe(false);
  });
});

describe("per-invocation native bootstrap with synthetic IO only", () => {
  const keys = { NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "EXAMPLE_NO_REAL_ANON_CREDENTIAL",
    SUPABASE_SERVICE_ROLE_KEY: "EXAMPLE_NO_REAL_SERVICE_CREDENTIAL" };
  it("observes and closes two distinct bootstraps while building executable bytes only once", async () => {
    const environment: Record<string, string | undefined> = {}, firstClose = vi.fn(async () => {}), secondClose = vi.fn(async () => {});
    const changedKeys = { ...keys, NEXT_PUBLIC_SUPABASE_ANON_KEY: "EXAMPLE_DIFFERENT_OBSERVED_ANON" };
    const acquire = vi.fn().mockResolvedValueOnce({ keys, close: firstClose })
      .mockResolvedValueOnce({ keys: changedKeys, close: secondClose });
    const build = vi.fn(async () => { expect(environment).toEqual(keys); });
    await prepareFreshInvocation({ environment, acquire, build, bindObservedKeys: true, buildRequired: true });
    // A fresh operator process starts with no Supabase keys. Reuse must still
    // observe the second stack, not invent or retain the first stack's keys.
    const nextEnvironment: Record<string, string | undefined> = {};
    await prepareFreshInvocation({ environment: nextEnvironment, acquire, build, bindObservedKeys: true, buildRequired: false });
    expect(acquire).toHaveBeenCalledTimes(2); expect(build).toHaveBeenCalledTimes(1);
    expect(firstClose).toHaveBeenCalledTimes(1); expect(secondClose).toHaveBeenCalledTimes(1);
    expect(nextEnvironment).toEqual(changedKeys);
  });
  it("preserves configured GitHub key equality and closes on mismatch or build failure", async () => {
    const close = vi.fn(async () => {}), build = vi.fn(async () => {}), acquire = async () => ({ keys, close });
    await expect(prepareFreshInvocation({ environment: {}, acquire, build, bindObservedKeys: false, buildRequired: true }))
      .rejects.toThrow("Fresh keys must match");
    expect(build).not.toHaveBeenCalled(); expect(close).toHaveBeenCalledTimes(1);
    await expect(prepareFreshInvocation({ environment: { ...keys }, acquire, bindObservedKeys: false, buildRequired: true,
      build: async () => { throw new Error("synthetic build failure"); } })).rejects.toThrow("synthetic build failure");
    expect(close).toHaveBeenCalledTimes(2);
  });
});

it("reports a closed build failure while retaining the original exception and actual cleanup", async () => {
  const failure = new Error("synthetic-private-build-canary"), close = vi.fn(async () => {}), lines: string[] = [];
  const stderr = vi.spyOn(process.stderr, "write").mockImplementation(chunk => { lines.push(String(chunk)); return true; });
  try {
    await expect(prepareFreshInvocation({ environment: {}, bindObservedKeys: true, buildRequired: true,
      acquire: async () => ({ keys: { NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321", NEXT_PUBLIC_SUPABASE_ANON_KEY: "EXAMPLE_NO_REAL_ANON_CREDENTIAL", SUPABASE_SERVICE_ROLE_KEY: "EXAMPLE_NO_REAL_SERVICE_CREDENTIAL" }, close }), build: async () => { throw failure; } })).rejects.toBe(failure);
    expect(close).toHaveBeenCalledTimes(1);
    expect(lines).toEqual(['OWNED_BOOTSTRAP_FAILURE_V1|{"stage":"production-build","classification":"setup-refused","exitCode":null,"signal":null,"cleanup":"unreturned"}\n']);
    expect(lines.join("")).not.toContain("synthetic-private-build-canary");
  } finally { stderr.mockRestore(); }
});
it("retains an uncertain cleanup error instead of treating its bootstrap as success", async () => {
  const failure = new Error("synthetic-private-cleanup-canary"), lines: string[] = [];
  const stderr = vi.spyOn(process.stderr, "write").mockImplementation(chunk => { lines.push(String(chunk)); return true; });
  try {
    await expect(prepareFreshInvocation({ environment: {}, bindObservedKeys: true, buildRequired: false,
      acquire: async () => ({ keys: { NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321", NEXT_PUBLIC_SUPABASE_ANON_KEY: "EXAMPLE_NO_REAL_ANON_CREDENTIAL", SUPABASE_SERVICE_ROLE_KEY: "EXAMPLE_NO_REAL_SERVICE_CREDENTIAL" }, close: async () => { throw failure; } }), build: async () => {} })).rejects.toBe(failure);
    expect(lines).toEqual(['OWNED_BOOTSTRAP_FAILURE_V1|{"stage":"bootstrap-cleanup","classification":"setup-refused","exitCode":null,"signal":null,"cleanup":"uncertain"}\n']);
    expect(lines.join("")).not.toContain("synthetic-private-cleanup-canary");
  } finally { stderr.mockRestore(); }
});


import { freshRuntimeCommandFailure } from "./fresh-t6-resources";
import { createHostedBootstrapDiagnostics } from "./hosted-owned-diagnostics";

it.each(["spawn-refused", "exit-nonzero", "signal", "timeout", "output-limit"] as const)(
  "reports the actual acquisition %s producer and rethrows its identical refusal", async kind => {
    const failure = freshRuntimeCommandFailure(kind, kind === "exit-nonzero" ? 7 : null,
      kind === "signal" ? "SIGTERM" : null);
    const environment = { SYNTHETIC_SCOPE: "unchanged" }, build = vi.fn(async () => {});
    const acquire = vi.fn(async () => { throw failure; });
    const capture = createHostedBootstrapDiagnostics(), lines: string[] = [];
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(chunk => {
      const line = String(chunk); lines.push(line); capture.push(Buffer.from(line)); return true;
    });
    try {
      await expect(prepareFreshInvocation({ environment, acquire, build,
        bindObservedKeys: true, buildRequired: true })).rejects.toBe(failure);
      expect(acquire).toHaveBeenCalledTimes(1); expect(build).not.toHaveBeenCalled();
      expect(environment).toEqual({ SYNTHETIC_SCOPE: "unchanged" });
      expect(capture.finish()).toEqual([{ stage: "bootstrap-stack-acquisition", classification: kind,
        exitCode: kind === "exit-nonzero" ? 7 : null, signal: kind === "signal" ? "SIGTERM" : null,
        cleanup: "unreturned" }]);
      expect(lines).toHaveLength(1); expect(Buffer.byteLength(lines[0])).toBeLessThanOrEqual(513);
      expect(lines.join("")).not.toMatch(/"(?:message|stack|argv|stderr|credential|configuration)"\s*:/);
    } finally { stderr.mockRestore(); }
  });

it("classifies an unknown acquisition refusal without reading its private or hostile getters", async () => {
  const getter = vi.fn(() => { throw new Error("synthetic-private-acquisition-canary"); });
  const failure = Object.defineProperties({}, Object.fromEntries(
    ["message", "stack", "code", "signal", "credential", "role", "context"].map(name =>
      [name, { enumerable: true, get: getter }])));
  const lines: string[] = [], capture = createHostedBootstrapDiagnostics(), build = vi.fn(async () => {});
  const stderr = vi.spyOn(process.stderr, "write").mockImplementation(chunk => {
    const line = String(chunk); lines.push(line); capture.push(Buffer.from(line)); return true;
  });
  try {
    await expect(prepareFreshInvocation({ environment: {}, acquire: async () => { throw failure; }, build,
      bindObservedKeys: true, buildRequired: true })).rejects.toBe(failure);
    expect(getter).not.toHaveBeenCalled(); expect(build).not.toHaveBeenCalled();
    expect(capture.finish()).toEqual([{ stage: "bootstrap-stack-acquisition", classification: "setup-refused",
      exitCode: null, signal: null, cleanup: "unreturned" }]);
    expect(lines.join("")).not.toMatch(/synthetic-private-acquisition-canary|message|credential|role|context/);
  } finally { stderr.mockRestore(); }
});

it("retains a synchronously thrown acquisition guard and does not enter build or key binding", async () => {
  const failure = new Error("synthetic-private-lock-guard"), environment = { SYNTHETIC_SCOPE: "unchanged" };
  const build = vi.fn(async () => {}), lines: string[] = [];
  const stderr = vi.spyOn(process.stderr, "write").mockImplementation(chunk => { lines.push(String(chunk)); return true; });
  try {
    await expect(prepareFreshInvocation({ environment, acquire: () => { throw failure; }, build,
      bindObservedKeys: true, buildRequired: true })).rejects.toBe(failure);
    expect(build).not.toHaveBeenCalled(); expect(environment).toEqual({ SYNTHETIC_SCOPE: "unchanged" });
    expect(lines).toEqual(['OWNED_BOOTSTRAP_FAILURE_V1|{"stage":"bootstrap-stack-acquisition","classification":"setup-refused","exitCode":null,"signal":null,"cleanup":"unreturned"}\n']);
    expect(lines.join("")).not.toContain("synthetic-private-lock-guard");
  } finally { stderr.mockRestore(); }
});

it("does not replace the original acquisition error when public diagnostic output refuses", async () => {
  const failure = freshRuntimeCommandFailure("exit-nonzero", 3), build = vi.fn(async () => {});
  const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => { throw new Error("synthetic-private-output-canary"); });
  try {
    await expect(prepareFreshInvocation({ environment: {}, acquire: async () => { throw failure; }, build,
      bindObservedKeys: true, buildRequired: true })).rejects.toBe(failure);
    expect(build).not.toHaveBeenCalled(); expect(stderr).toHaveBeenCalledTimes(1);
  } finally { stderr.mockRestore(); }
});

it("preserves successful acquisition, key binding, build and actual close order without a failure frame", async () => {
  const keys = { NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321", NEXT_PUBLIC_SUPABASE_ANON_KEY: "EXAMPLE_NO_REAL_ANON_CREDENTIAL",
    SUPABASE_SERVICE_ROLE_KEY: "EXAMPLE_NO_REAL_SERVICE_CREDENTIAL" };
  const environment: Record<string, string | undefined> = {}, order: string[] = [], lines: string[] = [];
  const stderr = vi.spyOn(process.stderr, "write").mockImplementation(chunk => { lines.push(String(chunk)); return true; });
  try {
    await prepareFreshInvocation({ environment, bindObservedKeys: true, buildRequired: true,
      acquire: async () => { order.push("acquire"); return { keys, close: async () => { order.push("close"); } }; },
      build: async () => { order.push("build"); expect(environment).toEqual(keys); } });
    expect(order).toEqual(["acquire", "build", "close"]); expect(lines).toEqual([]);
  } finally { stderr.mockRestore(); }
});
