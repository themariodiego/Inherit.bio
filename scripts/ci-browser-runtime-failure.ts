import assert, { AssertionError } from "node:assert/strict";

/** These name existing setup boundaries, never commands, identities or output. */
export const CI_RUNTIME_SETUP_STAGES = [
  "runtime-policy", "build-identity", "build-receipt", "checkout-location", "checkout-environment",
  "build-cache", "git-credentials", "gateway-inspection", "network-ownership", "runtime-absence",
  "runtime-image", "owner-receipt", "runner-identity", "container-create", "owner-write", "container-start",
  "namespace-logs", "namespace-state", "namespace-running", "namespace-ready", "tls-bootstrap",
  "isolated-probe-command", "isolated-probe-proof", "policy-ipv4-read", "policy-ipv6-read", "policy-counters",
  "statistical-reference-admission", "final-source-identity", "cleanup-ownership", "cleanup-remove", "cleanup-receipt", "runtime-setup",
  "storage-provider-ready", "storage-proxy-listen", "storage-gateway-options", "storage-provider-denial",
  "storage-gateway-policy", "storage-cors-preserved", "storage-browser-transport", "storage-proxy-cleanup",
  "transport-listen", "transport-cleanup", "transport-browser-launch", "transport-browser-page", "transport-browser-fetch", "transport-browser-headers",
  "transport-api-request", "transport-api-headers", "transport-route-fetch", "transport-route-headers",
  "transport-standalone-request", "transport-standalone-headers",
] as const;
type RuntimeStage = typeof CI_RUNTIME_SETUP_STAGES[number];
type Classification = "guard-refused" | "invalid-response" | "setup-refused" | "spawn-refused"
  | "exit-nonzero" | "signal" | "timeout" | "output-limit";
type CommandResult = { classification: Classification; exitCode: number | null; signal: string | null };
const namespacePhases = ["initialization", "loopback-address", "ipv4-policy", "ipv6-policy", "policy-verification"] as const;
type Failure = CommandResult & { runtimeStage: RuntimeStage; namespacePhase?: typeof namespacePhases[number];
  cleanupFailure?: CommandResult & { runtimeStage: RuntimeStage } };
const signals = new Set(["SIGABRT", "SIGALRM", "SIGBUS", "SIGHUP", "SIGINT", "SIGKILL", "SIGPIPE",
  "SIGQUIT", "SIGSEGV", "SIGTERM", "SIGXCPU", "SIGXFSZ"]);
const commands = new WeakMap<Error, CommandResult>();
const failures = new WeakMap<Error, Failure>();
const exitCode = (value: unknown) => Number.isInteger(value) && (value as number) >= 0 && (value as number) <= 255 ? value as number : null;

/** Called only at the owned synchronous Docker boundary. Read only plain
 * process metadata; accessors, native messages and stdout/stderr are ignored. */
export function ciRuntimeDockerFailure(error: unknown): Error {
  const descriptor = (key: string): unknown => {
    try { return error !== null && typeof error === "object" ? Object.getOwnPropertyDescriptor(error, key)?.value : undefined; }
    catch { return undefined; }
  };
  const code = descriptor("code"), status = exitCode(descriptor("status"));
  const rawSignal = descriptor("signal"), signal = typeof rawSignal === "string" && signals.has(rawSignal) ? rawSignal : null;
  const classification: Classification = code === "ETIMEDOUT" ? "timeout" : code === "ENOBUFS" ? "output-limit"
    : signal ? "signal" : status !== null && status > 0 ? "exit-nonzero"
      : code === "ENOENT" || code === "EACCES" ? "spawn-refused" : "setup-refused";
  const safe = new Error("Isolated CI Docker operation refused; diagnostics suppressed");
  commands.set(safe, { classification, exitCode: status, signal });
  return safe;
}

function remember(value: Failure): Error {
  const safe = new Error(`Isolated CI runtime refused; stage=${value.runtimeStage}; classification=${value.classification}`
    + (value.namespacePhase ? `; namespace-phase=${value.namespacePhase}` : "")
    + (value.cleanupFailure ? `; cleanup-stage=${value.cleanupFailure.runtimeStage}; cleanup-classification=${value.cleanupFailure.classification}` : ""));
  failures.set(safe, value);
  return safe;
}
export function ciRuntimeSetupFailure(stage: RuntimeStage, error: unknown, nativeExitCode?: number): Error {
  assert(CI_RUNTIME_SETUP_STAGES.includes(stage), "Unregistered runtime stage");
  const key = error !== null && typeof error === "object" ? error as Error : undefined;
  if (key && failures.has(key)) return key;
  const command = key ? commands.get(key) : undefined;
  let classification: Classification = "setup-refused";
  try { if (error instanceof AssertionError) classification = "guard-refused";
    else if (error instanceof SyntaxError) classification = "invalid-response"; } catch { /* No proxy exception survives. */ }
  return remember({ runtimeStage: stage, ...(command ?? {
    classification,
    exitCode: exitCode(nativeExitCode), signal: null,
  }) });
}
export function ciRuntimeStep<T>(stage: RuntimeStage, operation: () => T, nativeExitCode?: number): T {
  try { return operation(); } catch (error) { throw ciRuntimeSetupFailure(stage, error, nativeExitCode); }
}
/** Only the fixed pre-TLS shell failure marker may supply a phase. A lone
 * exact marker must agree with the bounded actual process exit code. */
export function ciRuntimeNamespaceStep<T>(operation: () => T, logs: string, nativeExitCode: number): T {
  try { return operation(); } catch (error) {
    const failure = ciRuntimeSetupFailure("namespace-running", error, nativeExitCode);
    const markers = logs.split(/\r?\n/).filter(line => line.includes("ISOLATED_RUNTIME_FAILED"));
    const match = markers.length === 1 ? /^ISOLATED_RUNTIME_FAILED phase=([a-z0-9-]+) exit=([1-9][0-9]{0,2})$/.exec(markers[0]) : null;
    const phase = namespacePhases.find(phase => phase === match?.[1]);
    if (phase && match && exitCode(nativeExitCode) !== null && Number(match[2]) === nativeExitCode)
      throw remember({ ...ciRuntimeFailureDiagnostic(failure)!, namespacePhase: phase });
    throw failure;
  }
}
/** Retain the original safe operation diagnosis, but do not hide uncertain
 * cleanup or turn it into success. Neither original exception is retained. */
export function ciRuntimeCleanupFailure(operation: unknown, cleanup: unknown): Error {
  const original = ciRuntimeFailureDiagnostic(ciRuntimeSetupFailure("runtime-setup", operation))!;
  const failedCleanup = ciRuntimeFailureDiagnostic(ciRuntimeSetupFailure("cleanup-ownership", cleanup))!;
  return remember({ ...original, cleanupFailure: { runtimeStage: failedCleanup.runtimeStage,
    classification: failedCleanup.classification, exitCode: failedCleanup.exitCode, signal: failedCleanup.signal } });
}
/** A shaped exception cannot impersonate an error created by these boundaries. */
export function ciRuntimeFailureDiagnostic(error: unknown): Failure | undefined {
  const value = error !== null && typeof error === "object" ? failures.get(error as Error) : undefined;
  return value ? { ...value, ...(value.cleanupFailure ? { cleanupFailure: { ...value.cleanupFailure } } : {}) } : undefined;
}
