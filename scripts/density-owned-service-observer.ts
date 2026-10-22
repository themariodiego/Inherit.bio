import assert from "node:assert/strict";
import { ChildProcess } from "node:child_process";
import path from "node:path";
import { APP_SERVICE_OBSERVATION_OPTION, appConfigurationSha256, collectAppServiceObservation,
  scopedAppConfiguration, type AppServiceObservation } from "./ci-browser/service-observation";
import { densityServicePort } from "./density-service-binding";
import { densityRuntimeSchema, type DensityRuntime } from "./density-capture-plan";

/** Attach before the actual host child emits its inside-launcher acknowledgment.
 * launchConfiguration is the exact in-memory dictionary passed to THAT spawn;
 * it is never reconstructed from the observer's ambient process.env. */
export function ownedDensityServiceObservers(input: {
  child: ChildProcess; root: string; origin: string; fixtureSourcePath: string; launchConfiguration: unknown;
  runtime: { observeActiveService: (acknowledgment: unknown, fixtureSourcePath: string) => DensityRuntime };
}) {
  const port = densityServicePort(input.origin), child = input.child;
  assert(child instanceof ChildProcess && child.pid && child.exitCode === null && child.signalCode === null && !child.killed);
  assert(child.spawnfile === process.execPath && JSON.stringify(child.spawnargs) === JSON.stringify([
    process.execPath, "--import", "tsx", path.join(input.root, "scripts/ci-browser/server.mts"), "host", String(port), APP_SERVICE_OBSERVATION_OPTION]));
  let configuration: Record<string, string> | undefined = scopedAppConfiguration(input.launchConfiguration, port);
  const digest = appConfigurationSha256(configuration, port);
  let acknowledgment: AppServiceObservation | undefined, refused = false, closed = false;
  const revoke = () => { closed = true; configuration = undefined; acknowledgment = undefined; };
  const detach = collectAppServiceObservation(child.stderr!, value => {
    if (closed || value.port !== port || value.appOrigin !== input.origin || value.appConfigurationSha256 !== digest) {
      refused = true; acknowledgment = undefined; return;
    }
    acknowledgment = { ...value };
  }, () => { refused = true; acknowledgment = undefined; });
  child.once("exit", revoke); child.once("close", revoke); child.once("error", revoke);
  const live = () => {
    assert(!closed && !refused && configuration && acknowledgment && child.pid && child.exitCode === null
      && child.signalCode === null && !child.killed, "Actual owned configuration acknowledgment required");
    return { configuration: { ...configuration }, acknowledgment: { ...acknowledgment } };
  };
  return {
    observeRuntime: async (origin: string, fixtureSourceSha256: string) => {
      try {
        assert(origin === input.origin);
        const current = live();
        const value = densityRuntimeSchema.parse(input.runtime.observeActiveService(current.acknowledgment, input.fixtureSourcePath));
        assert(value.appOrigin === origin && value.fixtureSourceSha256 === fixtureSourceSha256);
        // A close or later invalid frame cannot become success after native read.
        assert(JSON.stringify(live().acknowledgment) === JSON.stringify(current.acknowledgment));
        return value;
      } catch { throw new Error("Actual owned density runtime observation refused"); }
    },
    readActualAppEnvironment: async (origin: string) => {
      try { assert(origin === input.origin); return live().configuration; }
      catch { throw new Error("Actual owned density app configuration refused"); }
    },
    close: () => { revoke(); detach(); child.off("exit", revoke); child.off("close", revoke); child.off("error", revoke); },
  };
}
