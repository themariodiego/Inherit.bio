import assert from "node:assert/strict";
import { describe, expect, it } from "vitest";
import { CI_RUNTIME_SETUP_STAGES, ciRuntimeCleanupFailure, ciRuntimeDockerFailure,
  ciRuntimeFailureDiagnostic, ciRuntimeNamespaceStep, ciRuntimeSetupFailure, ciRuntimeStep } from "./ci-browser-runtime-failure";
import { freshRuntimeFailureClassification } from "./comprehension/fresh-t6-resources";

describe("closed isolated-runtime diagnostics", () => {
  const canary = "PRIVATE_CANARY_NEVER_PRINT";
  it.each([
    [{ status: 17 }, "exit-nonzero", 17, null],
    [{ status: 99999, signal: "SIGTERM" }, "signal", null, "SIGTERM"],
    [{ code: "ETIMEDOUT", signal: "SIGKILL" }, "timeout", null, "SIGKILL"],
    [{ code: "ENOBUFS" }, "output-limit", null, null],
    [{ code: "ENOENT" }, "spawn-refused", null, null],
    [{ code: "EACCES" }, "spawn-refused", null, null],
    [{ code: canary, status: -1, signal: canary }, "setup-refused", null, null],
  ])("keeps only bounded command metadata for %j", (fields, classification, exitCode, signal) => {
    const native = Object.assign(new Error(canary), fields, { stdout: canary, stderr: canary, path: canary, spawnargs: [canary], env: { private: canary } });
    const failure = ciRuntimeSetupFailure("tls-bootstrap", ciRuntimeDockerFailure(native));
    expect(freshRuntimeFailureClassification(failure)).toEqual({ runtimeStage: "tls-bootstrap", classification, exitCode, signal });
    expect(String(failure)).not.toContain(canary);
    expect(failure.cause).toBeUndefined();
    expect(Object.keys(failure)).toEqual([]);
  });
  it("does not invoke native metadata getters or allow shaped exceptions to forge stages", () => {
    let reads = 0;
    const native = new Error(canary);
    for (const name of ["code", "status", "signal", "runtimeStage", "classification", "stdout", "stderr", "cause"])
      Object.defineProperty(native, name, { get() { reads++; throw new Error(canary); } });
    expect(ciRuntimeFailureDiagnostic(native)).toBeUndefined();
    expect(freshRuntimeFailureClassification(native)).toEqual({ classification: "setup-refused", exitCode: null, signal: null });
    const failure = ciRuntimeSetupFailure("container-start", ciRuntimeDockerFailure(native));
    expect(ciRuntimeFailureDiagnostic(failure)).toEqual({ runtimeStage: "container-start", classification: "setup-refused", exitCode: null, signal: null });
    expect(reads).toBe(0);
    const proxy = new Proxy({}, { getOwnPropertyDescriptor() { throw new Error(canary); }, getPrototypeOf() { throw new Error(canary); } });
    expect(ciRuntimeFailureDiagnostic(ciRuntimeSetupFailure("container-create", ciRuntimeDockerFailure(proxy))))
      .toEqual({ runtimeStage: "container-create", classification: "setup-refused", exitCode: null, signal: null });
    expect(freshRuntimeFailureClassification(proxy)).toEqual({ classification: "setup-refused", exitCode: null, signal: null });
  });
  it("distinguishes assertion and malformed-response boundaries without retaining their original values", () => {
    let guard: unknown;
    try { assert.equal(canary, "expected"); } catch (error) { guard = error; }
    const failure = ciRuntimeSetupFailure("build-receipt", guard);
    expect(ciRuntimeFailureDiagnostic(failure)).toEqual({ runtimeStage: "build-receipt", classification: "guard-refused", exitCode: null, signal: null });
    expect(String(failure)).not.toContain(canary);
    expect(ciRuntimeFailureDiagnostic(ciRuntimeSetupFailure("gateway-inspection", new SyntaxError(canary))))
      .toEqual({ runtimeStage: "gateway-inspection", classification: "invalid-response", exitCode: null, signal: null });
  });
  it("keeps nested precise stages and returns copies of operation and cleanup metadata", () => {
    const operation = ciRuntimeSetupFailure("isolated-probe-command", ciRuntimeDockerFailure({ status: 7 }));
    expect(() => ciRuntimeStep("runtime-setup", () => { throw operation; })).toThrow(operation);
    const cleanup = ciRuntimeSetupFailure("cleanup-remove", ciRuntimeDockerFailure({ status: 19 }));
    const failure = ciRuntimeCleanupFailure(operation, cleanup);
    const expected = { runtimeStage: "isolated-probe-command", classification: "exit-nonzero", exitCode: 7, signal: null,
      cleanupFailure: { runtimeStage: "cleanup-remove", classification: "exit-nonzero", exitCode: 19, signal: null } };
    expect(ciRuntimeFailureDiagnostic(failure)).toEqual(expected);
    const copy = ciRuntimeFailureDiagnostic(failure)!;
    copy.exitCode = 99; copy.cleanupFailure!.exitCode = 99;
    expect(ciRuntimeFailureDiagnostic(failure)).toEqual(expected);
    expect(failure.cause).toBeUndefined();
  });
  it("refuses an unregistered stage rather than serializing arbitrary input", () => {
    expect(new Set(CI_RUNTIME_SETUP_STAGES).size).toBe(CI_RUNTIME_SETUP_STAGES.length);
    expect(() => ciRuntimeSetupFailure(canary as typeof CI_RUNTIME_SETUP_STAGES[number], new Error(canary)))
      .toThrow("Unregistered runtime stage");
  });
  it.each(["initialization", "loopback-address", "ipv4-policy", "ipv6-policy", "policy-verification"])("retains only exact namespace phase %s with its actual exit", phase => {
    let failure: unknown;
    try { ciRuntimeNamespaceStep(() => assert(false, canary), `${canary}\nISOLATED_RUNTIME_FAILED phase=${phase} exit=17`, 17); }
    catch (error) { failure = error; }
    expect(ciRuntimeFailureDiagnostic(failure)).toEqual({ runtimeStage: "namespace-running", classification: "guard-refused", exitCode: 17, signal: null, namespacePhase: phase });
    expect(String(failure)).not.toContain(canary);
  });
  it.each([
    ["ISOLATED_RUNTIME_FAILED phase=ipv4-policy exit=017", 17],
    ["ISOLATED_RUNTIME_FAILED phase=ipv4-policy exit=256", 256],
    ["ISOLATED_RUNTIME_FAILED phase=ipv4-policy exit=0", 0],
    ["ISOLATED_RUNTIME_FAILED phase=ipv4-policy exit=17\nISOLATED_RUNTIME_FAILED phase=ipv4-policy exit=17", 17],
    ["prefix ISOLATED_RUNTIME_FAILED phase=ipv4-policy exit=17", 17],
    ["ISOLATED_RUNTIME_FAILED phase=unknown exit=17", 17],
    ["ISOLATED_RUNTIME_FAILED phase=ipv4-policy exit=17", 19],
  ])("does not adopt malformed namespace marker %s", (logs, nativeExit) => {
    let failure: unknown;
    try { ciRuntimeNamespaceStep(() => assert(false, canary), logs as string, nativeExit as number); } catch (error) { failure = error; }
    expect(ciRuntimeFailureDiagnostic(failure)?.namespacePhase).toBeUndefined();
    expect(String(failure)).not.toContain(canary);
  });
});
