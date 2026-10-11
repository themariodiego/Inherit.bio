import type { FreshDensityRuntime } from "./density-fresh-runtime";
import { createRootDensityNativeObservers } from "./density-root-native-observers";
import { createDensityPublicObservationSink } from "./density-root-native-observation-sink";

/** Additive argument factory for the existing runOwnedDensityCapture call.
 * The Root admission/entrypoint owns source, build, operator, signal, output,
 * fontManifestPath and observeSource. It must not call this until those exact
 * prerequisites are admitted; this module supplies no defaults or launcher.
 * Every invocation still receives the actual NEW per-capture ownership. */
export function densityRootNativeObserverFactory(input: {
  root: string; signal: AbortSignal; freshPublicObservationDirectory: string;
}) {
  const savePublicObservation = createDensityPublicObservationSink(input.freshPublicObservationDirectory);
  return (ownership: FreshDensityRuntime) => createRootDensityNativeObservers(ownership,
    { root: input.root, signal: input.signal, savePublicObservation });
}
