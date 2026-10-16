import { describe, expect, it } from "vitest";
import { AssertionError } from "node:assert/strict";
import { emitDensityAcquisitionFailure, refuseFreshDensityAcquisition, sequentialDensityCleanup } from "./density-fresh-runtime";
import { CI_RUNTIME_SETUP_STAGES, ciRuntimeCleanupFailure, ciRuntimeDockerFailure, ciRuntimeSetupFailure } from "./ci-browser-runtime-failure";
import { freshRuntimeCommandFailure } from "./comprehension/fresh-t6-resources";
import { createHostedBootstrapDiagnostics } from "./comprehension/hosted-owned-diagnostics";

function output() {
  const lines: string[] = [], collector = createHostedBootstrapDiagnostics();
  return { lines, emit: (line: string) => { lines.push(line); collector.push(Buffer.from(line + "\n")); },
    finish: () => collector.finish() };
}
const generic = "Fresh density resource acquisition refused; no capture was accepted";

describe("closed owned Density acquisition refusal observations", () => {
  it.each(CI_RUNTIME_SETUP_STAGES)("retains the actual branded inner boundary %s without messages or optional metadata", stage => {
    const out = output();
    const error = ciRuntimeSetupFailure(stage, new Error("private URL token and body must not escape"));
    Object.assign(error, { runtimeStage: "forged-private-stage", message: "private-token", stack: "private-stack" });
    emitDensityAcquisitionFailure("density-runtime-preflight", error, "unreturned", out.emit);
    expect(out.finish()).toEqual([{ stage: `density-runtime-${stage}`, classification: "setup-refused",
      exitCode: null, signal: null, cleanup: "unreturned" }]);
    expect(out.lines.join("")).not.toMatch(/private|forged|token|body|URL|stack/);
    expect(Buffer.byteLength(out.lines[0])).toBeLessThanOrEqual(512);
  });
  it.each(["spawn-refused", "exit-nonzero", "signal", "timeout", "output-limit"] as const)("preserves %s as failure while awaiting the actual ordered cleanup", async classification => {
    const out = output(), events: string[] = []; let release!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; });
    const close = sequentialDensityCleanup([async () => { events.push("browser"); await held; },
      async () => { events.push("apps"); }, async () => { events.push("stack"); }]);
    const refusal = refuseFreshDensityAcquisition("density-app-readiness", freshRuntimeCommandFailure(classification), close, true, out.emit);
    const checked = expect(refusal).rejects.toThrow(generic);
    expect(events).toEqual(["browser"]); expect(close()).toBe(close());
    release(); await checked; expect(events).toEqual(["browser", "apps", "stack"]);
    expect(out.finish()).toEqual([{ stage: "density-app-readiness", classification,
      exitCode: null, signal: null, cleanup: "unreturned" }]);
  });
  it("projects actual Docker metadata and maps the actual guard and invalid-response classifications without raw stderr", () => {
    const out = output();
    const docker = ciRuntimeDockerFailure({ status: 3, signal: null, stderr: "private-native-output", message: "private" });
    emitDensityAcquisitionFailure("density-runtime-preflight", ciRuntimeSetupFailure("isolated-probe-command", docker), "unreturned", out.emit);
    emitDensityAcquisitionFailure("density-runtime-preflight", ciRuntimeSetupFailure("build-receipt", new AssertionError({ message: "private build" })), "unreturned", out.emit);
    emitDensityAcquisitionFailure("density-runtime-preflight", ciRuntimeSetupFailure("build-receipt", new SyntaxError("private parse")), "unreturned", out.emit);
    expect(out.finish()).toEqual([
      { stage: "density-runtime-isolated-probe-command", classification: "exit-nonzero", exitCode: 3, signal: null, cleanup: "unreturned" },
      { stage: "density-runtime-build-receipt", classification: "setup-refused", exitCode: null, signal: null, cleanup: "unreturned" },
      { stage: "density-runtime-build-receipt", classification: "setup-refused", exitCode: null, signal: null, cleanup: "unreturned" },
    ]);
    expect(out.lines.join("")).not.toContain("private");
  });
  it("retains the actual branded inner cleanup uncertainty without forwarding the composite error", () => {
    const out = output();
    const operation = ciRuntimeSetupFailure("isolated-probe-command", ciRuntimeDockerFailure({ status: 3, stderr: "private operation" }));
    const cleanup = ciRuntimeSetupFailure("cleanup-remove", ciRuntimeDockerFailure({ code: "ETIMEDOUT", stderr: "private cleanup" }));
    emitDensityAcquisitionFailure("density-runtime-preflight", ciRuntimeCleanupFailure(operation, cleanup), "unreturned", out.emit);
    expect(out.finish()).toEqual([
      { stage: "density-runtime-isolated-probe-command", classification: "exit-nonzero", exitCode: 3, signal: null, cleanup: "unreturned" },
      { stage: "density-runtime-cleanup-remove", classification: "timeout", exitCode: null, signal: null, cleanup: "uncertain" },
    ]);
    expect(out.lines.join("")).not.toContain("private");
  });
  it("cannot accept a shaped or accessor exception as inner runtime authority", () => {
    const out = output(); let accessed = false;
    const shaped = Object.create(null);
    for (const key of ["runtimeStage", "classification", "exitCode", "signal", "message", "stack"])
      Object.defineProperty(shaped, key, { get() { accessed = true; throw new Error("private accessor"); } });
    emitDensityAcquisitionFailure("density-runtime-preflight", shaped, "unreturned", out.emit);
    expect(accessed).toBe(false);
    expect(out.finish()).toEqual([{ stage: "density-runtime-preflight", classification: "setup-refused", exitCode: null, signal: null, cleanup: "unreturned" }]);
  });
  it("preserves the exact cleanup exception and stops every later closer after uncertainty", async () => {
    const out = output(), cleanup = new Error("private cleanup cause"), events: string[] = [];
    const close = sequentialDensityCleanup([async () => { events.push("browser"); throw cleanup; }, async () => { events.push("stack"); }]);
    const failure = refuseFreshDensityAcquisition("density-mail-capture", new Error("private original"), close, true, out.emit);
    await expect(failure).rejects.toBe(cleanup);
    expect(close()).toBe(close()); await expect(close()).rejects.toBe(cleanup); expect(events).toEqual(["browser"]);
    expect(out.finish()).toEqual([
      { stage: "density-mail-capture", classification: "setup-refused", exitCode: null, signal: null, cleanup: "unreturned" },
      { stage: "density-acquisition-cleanup", classification: "setup-refused", exitCode: null, signal: null, cleanup: "uncertain" },
    ]);
    expect(out.lines.join("")).not.toContain("private");
  });
  it("keeps the unowned default silent and never changes the generic refusal", async () => {
    const out = output(); let closes = 0;
    await expect(refuseFreshDensityAcquisition("density-app-launch", new Error("private"), async () => { closes++; }, false, out.emit)).rejects.toThrow(generic);
    expect(closes).toBe(1); expect(out.lines).toEqual([]); expect(out.finish()).toEqual([]);
  });
  it("cannot replace the original generic or cleanup error when diagnostic output itself throws", async () => {
    const emit = () => { throw new Error("private emitter" ); };
    await expect(refuseFreshDensityAcquisition("density-chromium-launch", new Error("private browser"), async () => {}, true, emit)).rejects.toThrow(generic);
    const cleanup = new Error("private cleanup");
    await expect(refuseFreshDensityAcquisition("density-chromium-launch", new Error("private browser"), async () => { throw cleanup; }, true, emit)).rejects.toBe(cleanup);
  });
  it("drops unknown stage and unfinished frames while retaining the original sixteen-record collector bound", () => {
    const out = output();
    emitDensityAcquisitionFailure("private-unknown" as never, new Error("private"), "unreturned", out.emit);
    expect(out.lines).toEqual([]);
    for (let index = 0; index < 20; index++) emitDensityAcquisitionFailure("density-app-readiness", new Error("private"), "unreturned", out.emit);
    expect(out.finish()).toHaveLength(16);
    const partial = createHostedBootstrapDiagnostics(); partial.push(Buffer.from(out.lines[0])); expect(partial.finish()).toEqual([]);
  });
});
