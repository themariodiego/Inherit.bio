import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { types } from "node:util";
import { admittedAppEnvironmentNames, APP_PORTS, checkedAppEnvironment } from "./ci-browser-config";
import { densityRuntimeSchema, densitySourceSchema, type DensitySource } from "./density-capture-plan";

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

/** These are the original six services. A provider's origin is never rewritten. */
export function densityServicePort(origin: string): typeof APP_PORTS[number] {
  const port = APP_PORTS.find(value => origin === `http://localhost:${value}`);
  assert(port !== undefined, "Exact registered disposable app origin required");
  return port;
}

/** Inspect data properties without invoking accessors, proxies or toJSON. */
function plainData(value: unknown, depth = 0): unknown {
  assert(depth <= 3 && value !== null && typeof value === "object" && !Array.isArray(value)
    && !types.isProxy(value), "Ordinary complete service observation required");
  const prototype = Object.getPrototypeOf(value);
  assert(prototype === Object.prototype || prototype === null, "Ordinary service data required");
  const result: Record<string, unknown> = Object.create(null);
  for (const key of Reflect.ownKeys(value)) {
    assert(typeof key === "string", "String service data keys required");
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    assert(descriptor?.enumerable && Object.hasOwn(descriptor, "value"), "Service accessors are refused");
    const item: unknown = descriptor.value;
    result[key] = item !== null && typeof item === "object" ? plainData(item, depth + 1) : item;
  }
  return result;
}

/** App values exist only in memory. Save their complete ordered digest, never
 * their credential values. This adds no credential acquisition or launcher. */
export function checkedDensityServiceBinding(origin: string, source: DensitySource,
  fixtureSourceSha256: string, runtimeInput: unknown, appEnvironmentInput: unknown) {
  try {
    const port = densityServicePort(origin);
    const runtime = densityRuntimeSchema.parse(plainData(runtimeInput));
    const expectedSource = densitySourceSchema.parse(plainData(source));
    assert(runtime.appOrigin === origin && JSON.stringify(runtime.source) === JSON.stringify(expectedSource)
      && runtime.fixtureSourceSha256 === fixtureSourceSha256, "Current exact service, fixture and source required");
    const appEnvironment = checkedAppEnvironment(plainData(appEnvironmentInput), port);
    const appConfigurationSha256 = sha256(JSON.stringify(admittedAppEnvironmentNames(port)
      .map(name => [name, appEnvironment[name]])));
    // The existing state-proof ABI retains the complete runtime's exact hash.
    const runtimeSha256 = sha256(JSON.stringify(runtime));
    return { version: 1 as const, port, runtime, runtimeSha256, appConfigurationSha256 };
  } catch {
    throw new Error("Current complete density service binding refused");
  }
}
export type DensityServiceBinding = ReturnType<typeof checkedDensityServiceBinding>;

/** Observe only while the actual provider's runtime is alive. The second
 * actual runtime observation rejects an owner/build change during the AppEnv
 * read; a later call rejects any change during the screenshot/measurement. */
export async function observeDensityServiceBinding(input: {
  origin: string; source: DensitySource; fixtureSourceSha256: string;
  observeRuntime: (origin: string, fixtureSourceSha256: string) => Promise<unknown>;
  readActualAppEnvironment: (origin: string) => Promise<unknown>;
}): Promise<DensityServiceBinding> {
  try {
    densityServicePort(input.origin);
    assert(typeof input.observeRuntime === "function" && typeof input.readActualAppEnvironment === "function",
      "Actual service observers required");
    // Snapshot every ordinary data descriptor before the next await; the
    // producer may return a shared object that changes during configuration.
    const before = densityRuntimeSchema.parse(plainData(
      await input.observeRuntime(input.origin, input.fixtureSourceSha256)));
    const environment = await input.readActualAppEnvironment(input.origin);
    const first = checkedDensityServiceBinding(input.origin, input.source, input.fixtureSourceSha256, before, environment);
    const after = await input.observeRuntime(input.origin, input.fixtureSourceSha256);
    const second = checkedDensityServiceBinding(input.origin, input.source, input.fixtureSourceSha256, after, environment);
    assert(JSON.stringify(first) === JSON.stringify(second), "Actual service changed during observation");
    return first;
  } catch {
    // Never forward arbitrary private observer errors or schema input text.
    throw new Error("Current complete density service observation refused");
  }
}

export function assertDensityServiceUnchanged(before: DensityServiceBinding, after: DensityServiceBinding) {
  assert(JSON.stringify(before) === JSON.stringify(after), "Density service/configuration bookend changed");
}
