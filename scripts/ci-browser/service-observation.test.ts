import { describe, expect, it } from "vitest";
import { PassThrough } from "node:stream";
import { ChildProcess } from "node:child_process";
import path from "node:path";
import { APP_PORTS, admittedAppEnvironmentNames, EMBRYO_APP_ENV, LOCAL_MODEL_ENV, PREPARED_APP_ENV } from "../ci-browser-config";
import { APP_SERVICE_OBSERVATION_BYTES, APP_SERVICE_OBSERVATION_OPTION, APP_SERVICE_OBSERVATION_PREFIX,
  appConfigurationSha256, appServiceObservationLine, checkedAppServiceObservation, collectAppServiceObservation,
  readAppServiceObservationLine, scopedAppConfiguration } from "./service-observation";
import { ownedDensityServiceObservers } from "../density-owned-service-observer";
import { ACTIVE_APP_PROCESS_OBSERVATION, ACTIVE_NATIVE_DATABASE_OBSERVATION } from "./active-service-probe";

function environment(port: number) {
  const env = Object.fromEntries(admittedAppEnvironmentNames(port).map(name => [name, "synthetic-private-canary"]));
  Object.assign(env, { NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321", RESEND_BASE_URL: "http://127.0.0.1:8124",
    NEXT_PUBLIC_APP_URL: `http://localhost:${port}`, NEXT_PUBLIC_SITE_URL: `http://localhost:${port}`,
    INHERIT_TEST_JURISDICTION: port === 3101 ? "" : "1", INHERIT_TEST_REQUESTER_STATEMENTS: port === 3102 ? "1" : "",
    INHERIT_CANONICAL_UPLOADS_PAUSED: port === 3102 ? "true" : "false" });
  if (port === 3103) Object.assign(env, LOCAL_MODEL_ENV);
  if (port === 3104) Object.assign(env, PREPARED_APP_ENV);
  if (port === 3105) Object.assign(env, EMBRYO_APP_ENV, { RESEND_WEBHOOK_SECRET: `whsec_${"A".repeat(43)}=` });
  return env;
}
function observation(port: typeof APP_PORTS[number] = 3100) {
  return { version: 1 as const, port, appOrigin: `http://localhost:${port}`,
    appConfigurationSha256: appConfigurationSha256(environment(port), port), buildId: "public-fixture-build",
    appPid: 1234, appStartTicks: "987654", bootId: "11111111-1111-4111-8111-111111111111", uid: 1001, gid: 1001 };
}
function pipe() {
  const stream = new PassThrough(), received: unknown[] = []; let failures = 0;
  const close = collectAppServiceObservation(stream, value => received.push(value), () => { failures++; });
  return { stream, received, close, failures: () => failures };
}
function context(port: typeof APP_PORTS[number] = 3100) {
  // Pure metadata stand-in only: no process is spawned and no native proof is
  // claimed. The genuine runtime observation is a counted unit dependency.
  const child = new ChildProcess(), stderr = new PassThrough(), calls: unknown[] = [];
  const root = "/public-unit-source";
  Object.defineProperties(child, { pid: { value: 4321 }, spawnfile: { value: process.execPath },
    spawnargs: { value: [process.execPath, "--import", "tsx", path.join(root, "scripts/ci-browser/server.mts"), "host", String(port), APP_SERVICE_OBSERVATION_OPTION] },
    stderr: { value: stderr } });
  const source = { head: "a".repeat(40), tree: "b".repeat(40), registerSha256: "c".repeat(64) };
  const runtime = { version: 1 as const, scope: "disposable-synthetic-native" as const, source,
    appOrigin: `http://localhost:${port}`, buildId: "public-fixture-build", ownerNonce: "22222222-2222-4222-8222-222222222222",
    bootId: observation(port).bootId, systemIdentifier: "123456789", databaseOid: 5, databaseName: "postgres" as const,
    daemonSha256: "d".repeat(64), fixtureSourceSha256: "e".repeat(64) };
  const env = environment(port);
  const observer = ownedDensityServiceObservers({ child, root, origin: runtime.appOrigin, fixtureSourcePath: "e2e/unit-source.ts",
    launchConfiguration: env, runtime: { observeActiveService: (ack, fixture) => { calls.push([ack, fixture]); return runtime; } } });
  return { child, stderr, observer, env, runtime, calls };
}

describe("same-owned-pipe actual service configuration observations", () => {
  it.each(APP_PORTS)("binds every original exact variant %i without credential output", port => {
    const line = appServiceObservationLine(observation(port));
    expect(Buffer.byteLength(line)).toBeLessThan(APP_SERVICE_OBSERVATION_BYTES);
    expect(readAppServiceObservationLine(line)).toEqual(observation(port));
    expect(line).not.toContain("synthetic-private-canary"); expect(line).not.toContain("SUPABASE_SERVICE_ROLE_KEY");
    if (port !== 3100) expect(observation(port).appConfigurationSha256).not.toBe(appConfigurationSha256(environment(3100), 3100));
  });
  it("copies the exact scoped dictionary before later caller mutation", () => {
    const env = environment(3102), copied = scopedAppConfiguration(env, 3102), originalDigest = appConfigurationSha256(copied, 3102);
    env.JOBS_SECRET = "EXAMPLE-changed-after-original-launch";
    expect(copied.JOBS_SECRET).toBe("synthetic-private-canary"); expect(appConfigurationSha256(env, 3102)).not.toBe(originalDigest);
    expect(() => scopedAppConfiguration(environment(3100), 3102)).toThrow("Actual scoped app configuration refused");
  });
  it("refuses configuration and public-frame getters/proxies without invoking them", () => {
    let reads = 0;
    const getter = Object.defineProperty(environment(3100), "JOBS_SECRET", { enumerable: true, get() { reads++; return "private-canary"; } });
    const proxy = new Proxy(observation(), { ownKeys() { reads++; throw new Error("private-canary"); } });
    expect(() => scopedAppConfiguration(getter, 3100)).toThrow("Actual scoped app configuration refused");
    expect(() => checkedAppServiceObservation(proxy)).toThrow("Complete public app service observation refused");
    expect(reads).toBe(0);
  });
  it("refuses extra/missing/foreign/privileged/lifetime/build public metadata", () => {
    for (const bad of [{ ...observation(), privateError: "private-canary" }, { ...observation(), uid: 0 },
      { ...observation(), gid: 0 }, { ...observation(), appPid: 0 }, { ...observation(), appStartTicks: "" },
      { ...observation(), bootId: "unknown" }, { ...observation(), buildId: "" }, { ...observation(), buildId: "x\nprivate-canary" },
      { ...observation(), appOrigin: "http://localhost:3101" }, { ...observation(), version: 2 }])
      expect(() => checkedAppServiceObservation(bad)).toThrow("Complete public app service observation refused");
  });
  it("requires canonical complete bounded ASCII frames rather than generic logs", () => {
    expect(readAppServiceObservationLine("private-canary ordinary app log")).toBeNull();
    const line = appServiceObservationLine(observation());
    for (const bad of [line + " ", line.replace('"version":1', '"version": 1'), APP_SERVICE_OBSERVATION_PREFIX + "{private-canary}",
      APP_SERVICE_OBSERVATION_PREFIX + "x".repeat(APP_SERVICE_OBSERVATION_BYTES), line + "\u00ff"])
      expect(() => readAppServiceObservationLine(bad)).toThrow("Public app service observation frame refused");
  });
  it("keeps full chunked bytes and ignores ordinary unknown output without forwarding it", () => {
    const x = pipe(), line = appServiceObservationLine(observation());
    x.stream.write("private-canary unrelated log\n");
    for (const byte of Buffer.from(line + "\n")) x.stream.write(Buffer.from([byte]));
    expect(x.received).toEqual([observation()]); expect(x.failures()).toBe(0); x.close();
  });
  it("refuses duplicate frames and any later malformed observation without exposing bytes", () => {
    for (const bad of [appServiceObservationLine(observation()), APP_SERVICE_OBSERVATION_PREFIX + "{private-canary}"] ) {
      const x = pipe(); x.stream.write(appServiceObservationLine(observation()) + "\n" + bad + "\n");
      expect(x.failures()).toBe(1); expect(x.received).toEqual([observation()]); x.close();
    }
  });
  it("refuses oversize and unterminated observation prefixes; no partial acknowledgment", async () => {
    for (const value of [APP_SERVICE_OBSERVATION_PREFIX + "x".repeat(APP_SERVICE_OBSERVATION_BYTES) + "\n",
      appServiceObservationLine(observation()).slice(0, -1)]) {
      const x = pipe(); const ended = new Promise<void>(resolve => x.stream.once("end", resolve));
      x.stream.end(value); await ended; expect(x.received).toEqual([]); expect(x.failures()).toBe(1); x.close();
    }
  });
  it("does not adopt an acknowledgment after the observation reader is closed", () => {
    const x = pipe(); x.close(); x.stream.write(appServiceObservationLine(observation()) + "\n");
    expect(x.received).toEqual([]); expect(x.failures()).toBe(0);
  });
  it("refuses missing actual acknowledgment and calls only the admitted live native handle", async () => {
    const x = context(3102);
    await expect(x.observer.readActualAppEnvironment(x.runtime.appOrigin)).rejects.toThrow("Actual owned density app configuration refused");
    await expect(x.observer.observeRuntime(x.runtime.appOrigin, x.runtime.fixtureSourceSha256)).rejects.toThrow("Actual owned density runtime observation refused");
    expect(x.calls).toEqual([]);
    x.stderr.write(appServiceObservationLine(observation(3102)) + "\n");
    expect(await x.observer.observeRuntime(x.runtime.appOrigin, x.runtime.fixtureSourceSha256)).toEqual(x.runtime);
    expect(x.calls).toEqual([[observation(3102), "e2e/unit-source.ts"]]);
    x.env.JOBS_SECRET = "EXAMPLE-mutated-after-spawn";
    expect((await x.observer.readActualAppEnvironment(x.runtime.appOrigin)).JOBS_SECRET).toBe("synthetic-private-canary"); x.observer.close();
  });
  it("refuses exact-origin/configuration mismatch, fixture hash echo and later channel failure", async () => {
    const x = context(3101);
    x.stderr.write(appServiceObservationLine(observation(3100)) + "\n");
    await expect(x.observer.readActualAppEnvironment(x.runtime.appOrigin)).rejects.toThrow(); expect(x.calls).toEqual([]); x.observer.close();
    const y = context(); y.stderr.write(appServiceObservationLine(observation()) + "\n");
    await expect(y.observer.observeRuntime("http://localhost:3101", y.runtime.fixtureSourceSha256)).rejects.toThrow();
    await expect(y.observer.observeRuntime(y.runtime.appOrigin, "f".repeat(64))).rejects.toThrow();
    y.stderr.write(APP_SERVICE_OBSERVATION_PREFIX + "{private-canary}\n");
    await expect(y.observer.readActualAppEnvironment(y.runtime.appOrigin)).rejects.toThrow(); y.observer.close();
  });
  it("revokes configuration on exit, error, close and explicit cleanup", async () => {
    for (const event of ["exit", "close", "error", "cleanup"]) {
      const x = context(); x.stderr.write(appServiceObservationLine(observation()) + "\n");
      if (event === "cleanup") x.observer.close(); else x.child.emit(event, event === "error" ? new Error("private-canary") : 1);
      await expect(x.observer.readActualAppEnvironment(x.runtime.appOrigin)).rejects.toThrow("Actual owned density app configuration refused");
      await expect(x.observer.observeRuntime(x.runtime.appOrigin, x.runtime.fixtureSourceSha256)).rejects.toThrow("Actual owned density runtime observation refused");
      expect(x.calls).toEqual([]); x.observer.close();
    }
  });
  it("keeps probes metadata-only, exact-lifetime/listener-bound and one read-only transaction", () => {
    expect(ACTIVE_APP_PROCESS_OBSERVATION).toContain('socketInodes.has(columns[9])');
    expect(ACTIVE_APP_PROCESS_OBSERVATION).toContain('fields[19]');
    expect(ACTIVE_APP_PROCESS_OBSERVATION).not.toMatch(/environ|Config\.Env|fetch\(|http\.request|INSERT|UPDATE|DELETE/);
    expect(ACTIVE_NATIVE_DATABASE_OBSERVATION).toContain("begin isolation level repeatable read read only;");
    expect(ACTIVE_NATIVE_DATABASE_OBSERVATION).toContain("pg_catalog.pg_control_system()");
    expect(ACTIVE_NATIVE_DATABASE_OBSERVATION).toContain("statement_timeout='45s'");
    expect(ACTIVE_NATIVE_DATABASE_OBSERVATION).toContain("lock_timeout='250ms'");
    expect(ACTIVE_NATIVE_DATABASE_OBSERVATION).toContain("rollback;");
    expect(ACTIVE_NATIVE_DATABASE_OBSERVATION).not.toMatch(/insert|update|delete|private\.|public\.|auth\./i);
  });
});
