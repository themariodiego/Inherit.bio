import { describe, expect, it, vi } from "vitest";
import { ownedLinuxAppBootstrap, privateOperatorFrameSchema } from "./run-owned-linux.mjs";
import { prepareFreshInvocation } from "./run-fresh-t6.mjs";

const configuration = { maximumInfrastructureCostPerStackMicroDollars: 100, run: {
  schemaVersion: 1, kind: "smoke", tasks: ["T6", "T7"], personas: 2,
  effortDirectory: "/tmp/operator-unit-effort", stubRecordRoot: "/tmp/operator-unit-records",
  samplingSeed: "d".repeat(64), limitMicroDollars: 10_000, otherCostsMicroDollars: 300,
  provider: { kind: "local-deterministic-stub" }, settings: { temperature: 0, maxSteps: 8,
    maxAttempts: 1, timeoutMs: 60_000, sessionSetupTimeoutMs: 900_000,
    maximumInputTokens: 32_000, maximumOutputTokens: 4_000,
    price: { inputMicroDollarsPerMillion: 1, outputMicroDollarsPerMillion: 1 } } } };

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
