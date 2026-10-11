import { describe, expect, it } from "vitest";
import { admittedAppEnvironmentNames, APP_PORTS, EMBRYO_APP_ENV, LOCAL_MODEL_ENV, PREPARED_APP_ENV } from "./ci-browser-config";
import { assertDensityServiceUnchanged, checkedDensityServiceBinding, densityServicePort, observeDensityServiceBinding } from "./density-service-binding";

const source = { head: "a".repeat(40), tree: "b".repeat(40), registerSha256: "c".repeat(64) };
const fixtureSourceSha256 = "d".repeat(64);
function runtime(port: number) {
  return { version: 1, scope: "disposable-synthetic-native", source,
    appOrigin: `http://localhost:${port}`, buildId: "actual-public-fixture-build",
    ownerNonce: "11111111-1111-4111-8111-111111111111", bootId: "22222222-2222-4222-8222-222222222222",
    systemIdentifier: "123456789", databaseOid: 5, databaseName: "postgres", daemonSha256: "e".repeat(64), fixtureSourceSha256 };
}
function environment(port: number) {
  const env: Record<string, string> = Object.fromEntries(admittedAppEnvironmentNames(port).map(name => [name, "public-synthetic-value"]));
  Object.assign(env, { NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321", RESEND_BASE_URL: "http://127.0.0.1:8124",
    NEXT_PUBLIC_APP_URL: `http://localhost:${port}`, NEXT_PUBLIC_SITE_URL: `http://localhost:${port}`,
    INHERIT_TEST_JURISDICTION: port === 3101 ? "" : "1",
    INHERIT_TEST_REQUESTER_STATEMENTS: port === 3102 ? "1" : "",
    INHERIT_CANONICAL_UPLOADS_PAUSED: port === 3102 ? "true" : "false" });
  if (port === 3103) Object.assign(env, LOCAL_MODEL_ENV);
  if (port === 3104) Object.assign(env, PREPARED_APP_ENV);
  if (port === 3105) Object.assign(env, EMBRYO_APP_ENV, { RESEND_WEBHOOK_SECRET: `whsec_${"A".repeat(43)}=` });
  return env;
}
function binding(port = 3100) {
  return checkedDensityServiceBinding(`http://localhost:${port}`, source, fixtureSourceSha256, runtime(port), environment(port));
}

describe("actual per-capture disposable density service binding", () => {
  it.each(APP_PORTS)("retains the exact original service/configuration at port %i", port => {
    const value = binding(port);
    expect(value.port).toBe(port);
    expect(value.runtime.appOrigin).toBe(`http://localhost:${port}`);
    expect(value.runtime.source).toEqual(source);
    expect(value.runtime.fixtureSourceSha256).toBe(fixtureSourceSha256);
    expect(value.runtimeSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(value.appConfigurationSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(value)).not.toContain("public-synthetic-value");
    expect(JSON.stringify(value)).not.toContain("SUPABASE_SERVICE_ROLE_KEY");
  });
  it("does not normalize localhost aliases, paths, credentials or unregistered ports", () => {
    for (const origin of ["http://127.0.0.1:3100", "http://localhost:3100/", "http://localhost:3100/x",
      "http://localhost:3100?x=1", "http://localhost:3100#x", "http://EXAMPLE:PLACEHOLDER@localhost:3100", "https://localhost:3100", "http://localhost:3106"])
      expect(() => densityServicePort(origin)).toThrow();
  });
  it("refuses another service's actual configuration rather than rewriting it", () => {
    expect(() => checkedDensityServiceBinding("http://localhost:3101", source, fixtureSourceSha256, runtime(3101), environment(3100))).toThrow();
    expect(() => checkedDensityServiceBinding("http://localhost:3102", source, fixtureSourceSha256, runtime(3100), environment(3102))).toThrow();
    expect(() => checkedDensityServiceBinding("http://localhost:3103", source, fixtureSourceSha256, runtime(3103), environment(3100))).toThrow();
  });
  it("retains full source, native, build and fixture currentness rather than URL alone", () => {
    for (const changed of [{ ...runtime(3100), source: { ...source, head: "f".repeat(40) } },
      { ...runtime(3100), source: { ...source, tree: "f".repeat(40) } },
      { ...runtime(3100), source: { ...source, registerSha256: "f".repeat(64) } },
      { ...runtime(3100), fixtureSourceSha256: "f".repeat(64) }, { ...runtime(3100), buildId: "" },
      { ...runtime(3100), systemIdentifier: "0" }, { ...runtime(3100), daemonSha256: "bad" },
      { ...runtime(3100), databaseName: "production" }, { ...runtime(3100), scope: "production" },
      { ...runtime(3100), unknown: true }])
      expect(() => checkedDensityServiceBinding("http://localhost:3100", source, fixtureSourceSha256, changed, environment(3100))).toThrow();
  });
  it("refuses incomplete, extra, wrong-type and non-ephemeral configurations", () => {
    const missing = environment(3100); delete missing.JOBS_SECRET;
    for (const changed of [missing, { ...environment(3100), UNKNOWN_PRIVATE_INPUT: "private-canary" },
      { ...environment(3100), JOBS_SECRET: null }, { ...environment(3100), NEXT_PUBLIC_SUPABASE_URL: "https://production.invalid" },
      { ...environment(3103), INHERIT_LOCAL_MODEL_HOST_ATTESTATION: "invented" }])
      expect(() => checkedDensityServiceBinding("http://localhost:3100", source, fixtureSourceSha256, runtime(3100), changed)).toThrow();
    expect(() => checkedDensityServiceBinding("http://localhost:3105", source, fixtureSourceSha256, runtime(3105),
      { ...environment(3105), RESEND_WEBHOOK_SECRET: "EXAMPLE-not-synthetic" })).toThrow();
    expect(() => checkedDensityServiceBinding("http://localhost:3103", source, fixtureSourceSha256, runtime(3103),
      { ...environment(3103), INHERIT_LOCAL_MODEL_HOST_ATTESTATION: "invented" })).toThrow();
  });
  it("hashes all values in fixed admitted order, independent of object insertion order", () => {
    const env = environment(3100), reversed = Object.fromEntries(Object.entries(env).reverse());
    expect(checkedDensityServiceBinding("http://localhost:3100", source, fixtureSourceSha256, runtime(3100), reversed)).toEqual(binding());
    for (const name of admittedAppEnvironmentNames(3100)) {
      if (["NEXT_PUBLIC_SUPABASE_URL", "RESEND_BASE_URL", "NEXT_PUBLIC_APP_URL", "NEXT_PUBLIC_SITE_URL",
        "INHERIT_TEST_JURISDICTION", "INHERIT_TEST_REQUESTER_STATEMENTS", "INHERIT_CANONICAL_UPLOADS_PAUSED"].includes(name)) continue;
      const changed = checkedDensityServiceBinding("http://localhost:3100", source, fixtureSourceSha256, runtime(3100), { ...env, [name]: "changed-public-value" });
      expect(changed.appConfigurationSha256).not.toBe(binding().appConfigurationSha256);
      expect(changed.runtimeSha256).toBe(binding().runtimeSha256);
    }
  });
  it("refuses accessors, proxies, hidden/symbol properties without reading their values", () => {
    let touched = 0;
    const accessor = Object.defineProperty(environment(3100), "JOBS_SECRET", { enumerable: true, get() { touched++; throw new Error("private-canary"); } });
    const hidden = Object.defineProperty(environment(3100), "hidden", { value: "private-canary" });
    const symbol = { ...environment(3100), [Symbol("private-canary")]: "secret" };
    const proxy = new Proxy(environment(3100), { ownKeys() { touched++; throw new Error("private-canary"); } });
    for (const changed of [accessor, hidden, symbol, proxy]) {
      expect(() => checkedDensityServiceBinding("http://localhost:3100", source, fixtureSourceSha256, runtime(3100), changed)).toThrow("Current complete density service binding refused");
    }
    expect(touched).toBe(0);
    const nested = { ...runtime(3100), source: Object.defineProperty({ ...source }, "head", { enumerable: true, get() { touched++; return source.head; } }) };
    expect(() => checkedDensityServiceBinding("http://localhost:3100", source, fixtureSourceSha256, nested, environment(3100))).toThrow();
    expect(touched).toBe(0);
  });
  it("refuses every changed native/build/configuration bookend during one capture", () => {
    const before = binding();
    for (const changed of [{ ...runtime(3100), ownerNonce: "33333333-3333-4333-8333-333333333333" },
      { ...runtime(3100), bootId: "33333333-3333-4333-8333-333333333333" }, { ...runtime(3100), buildId: "different-build" },
      { ...runtime(3100), systemIdentifier: "123456788" }, { ...runtime(3100), databaseOid: 6 },
      { ...runtime(3100), daemonSha256: "f".repeat(64) }]) {
      const after = checkedDensityServiceBinding("http://localhost:3100", source, fixtureSourceSha256, changed, environment(3100));
      expect(() => assertDensityServiceUnchanged(before, after)).toThrow();
    }
    const changedConfig = checkedDensityServiceBinding("http://localhost:3100", source, fixtureSourceSha256, runtime(3100),
      { ...environment(3100), JOBS_SECRET: "EXAMPLE-changed-public-value" });
    expect(() => assertDensityServiceUnchanged(before, changedConfig)).toThrow();
    expect(() => assertDensityServiceUnchanged(before, binding())).not.toThrow();
  });
  it("allows different genuinely fresh owners between captures, with exact bookends within each", () => {
    const first = binding(3102);
    const next = checkedDensityServiceBinding("http://localhost:3105", source, fixtureSourceSha256,
      { ...runtime(3105), ownerNonce: "33333333-3333-4333-8333-333333333333", systemIdentifier: "987654321" }, environment(3105));
    expect(first.runtimeSha256).not.toBe(next.runtimeSha256);
    expect(() => assertDensityServiceUnchanged(first, first)).not.toThrow();
    expect(() => assertDensityServiceUnchanged(next, next)).not.toThrow();
    expect(() => assertDensityServiceUnchanged(first, next)).toThrow();
  });
  it("reads the actual runtime around the actual selected AppEnv and suppresses arbitrary errors", async () => {
    const calls: string[] = [];
    const value = await observeDensityServiceBinding({ origin: "http://localhost:3102", source, fixtureSourceSha256,
      observeRuntime: async (origin, fixture) => { calls.push(`runtime:${origin}:${fixture}`); return runtime(3102); },
      readActualAppEnvironment: async origin => { calls.push(`configuration:${origin}`); return environment(3102); } });
    expect(calls).toEqual([`runtime:http://localhost:3102:${fixtureSourceSha256}`, "configuration:http://localhost:3102", `runtime:http://localhost:3102:${fixtureSourceSha256}`]);
    expect(value).toEqual(binding(3102));
    await expect(observeDensityServiceBinding({ origin: "http://localhost:3102", source, fixtureSourceSha256,
      observeRuntime: async () => { throw new Error("private-canary"); }, readActualAppEnvironment: async () => environment(3102) }))
      .rejects.toThrow("Current complete density service observation refused");
    await expect(observeDensityServiceBinding({ origin: "http://localhost:3102", source, fixtureSourceSha256,
      observeRuntime: async () => runtime(3102), readActualAppEnvironment: async () => { throw new Error("private-canary"); } }))
      .rejects.toThrow("Current complete density service observation refused");
  });
  it("refuses a runtime change during the configuration read", async () => {
    let count = 0;
    await expect(observeDensityServiceBinding({ origin: "http://localhost:3100", source, fixtureSourceSha256,
      observeRuntime: async () => ++count === 1 ? runtime(3100) : { ...runtime(3100), buildId: "different-build" },
      readActualAppEnvironment: async () => environment(3100) })).rejects.toThrow("Current complete density service observation refused");
    expect(count).toBe(2);
  });
  it("snapshots the complete first returned object before awaiting configuration", async () => {
    const shared = runtime(3100); let observations = 0;
    await expect(observeDensityServiceBinding({ origin: "http://localhost:3100", source, fixtureSourceSha256,
      observeRuntime: async () => { observations++; return shared; },
      readActualAppEnvironment: async () => {
        shared.buildId = "changed-during-actual-config-read";
        shared.ownerNonce = "33333333-3333-4333-8333-333333333333";
        return environment(3100);
      } })).rejects.toThrow("Current complete density service observation refused");
    expect(observations).toBe(2);
  });
});
