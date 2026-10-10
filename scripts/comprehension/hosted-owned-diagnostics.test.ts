import { expect, it, vi } from "vitest";
import { createHostedBootstrapDiagnostics, emitHostedBootstrapFailure, hostedBootstrapDiagnosticLine,
  HOSTED_BOOTSTRAP_PREFIX } from "./hosted-owned-diagnostics";
const value = { stage: "native-start", classification: "exit-nonzero", exitCode: 1, signal: null, cleanup: "retained" } as const;
const line = hostedBootstrapDiagnosticLine(value)!;
it("captures one closed record across real byte fragmentation and discards unrelated output", () => {
  const capture = createHostedBootstrapDiagnostics();
  capture.push(Buffer.from("unknown synthetic-private-canary\n"));
  for (const byte of Buffer.from(line + "\n")) capture.push(Uint8Array.of(byte));
  expect(capture.finish()).toEqual([value]);
});
it.each(["unknown-stage", "message", "key", "invalid-code", "invalid-signal", "unknown-cleanup", "unknown-class"])("refuses %s instead of forwarding private values", kind => {
  const input: Record<string, unknown> = { ...value };
  if (kind === "unknown-stage") input.stage = "synthetic-private-canary";
  if (kind === "message") input.message = "synthetic-private-canary";
  if (kind === "key") input.credential = "synthetic-private-canary";
  if (kind === "invalid-code") input.exitCode = 256;
  if (kind === "invalid-signal") input.signal = "synthetic-private-canary";
  if (kind === "unknown-cleanup") input.cleanup = "completed";
  if (kind === "unknown-class") input.classification = "synthetic-private-canary";
  expect(hostedBootstrapDiagnosticLine(input)).toBeNull();
  const capture = createHostedBootstrapDiagnostics();capture.push(Buffer.from(HOSTED_BOOTSTRAP_PREFIX + JSON.stringify(input) + "\n"));
  expect(capture.finish()).toEqual([]);
});
it.each(["incomplete", "oversize", "non-ascii", "malformed"])("discards %s physical frames and resumes only at the next LF", kind => {
  const capture = createHostedBootstrapDiagnostics();
  const input = kind === "incomplete" ? line : kind === "oversize" ? "x".repeat(513) + line + "\n"
    : kind === "non-ascii" ? "é" + line + "\n" : HOSTED_BOOTSTRAP_PREFIX + "{\n";
  capture.push(Buffer.from(input));
  if (kind === "incomplete") expect(capture.finish()).toEqual([]);
  else { capture.push(Buffer.from(line + "\n"));expect(capture.finish()).toEqual([value]); }
});
it("bounds the entire selection at sixteen records and returns an independent copy", () => {
  const capture = createHostedBootstrapDiagnostics();capture.push(Buffer.from((line + "\n").repeat(1000)));
  const first = capture.finish();expect(first).toHaveLength(16);first[0].exitCode = 2;
  expect(capture.finish()[0].exitCode).toBe(1);
});
it("never accepts later bytes after physical EOF settlement", () => {
  const capture = createHostedBootstrapDiagnostics();expect(capture.finish()).toEqual([]);
  capture.push(Buffer.from(line + "\n"));expect(capture.finish()).toEqual([]);
});
it("uses only normalized process metadata and leaves original refusal unchanged if diagnostic I/O fails", () => {
  const emit = vi.fn();emitHostedBootstrapFailure("production-build", { classification: "signal", exitCode: null, signal: "SIGTERM" }, "unreturned", emit);
  expect(emit).toHaveBeenCalledWith(hostedBootstrapDiagnosticLine({ ...value, stage: "production-build", classification: "signal", exitCode: null, signal: "SIGTERM", cleanup: "unreturned" }));
  expect(() => emitHostedBootstrapFailure("native-start", value, "retained", () => { throw new Error("synthetic-private-canary"); })).not.toThrow();
});


import assert from "node:assert/strict";
import { freshRuntimeCommandFailure, freshRuntimeFailureClassification } from "./fresh-t6-resources";
import { ciRuntimeCleanupFailure, ciRuntimeDockerFailure, ciRuntimeNamespaceStep,
  ciRuntimeSetupFailure, ciRuntimeStep } from "../ci-browser-runtime-failure";

it.each(["guard-refused", "invalid-response"] as const)("projects the actual %s runtime classifier through the emitter and collector", kind => {
  let original: unknown;
  try {
    ciRuntimeStep("build-cache", () => {
      if (kind === "guard-refused") assert.fail("synthetic-private-canary");
      throw new SyntaxError("synthetic-private-canary");
    });
  } catch (error) { original = error; }
  const metadata = freshRuntimeFailureClassification(original);
  expect(metadata).toMatchObject({ runtimeStage: "build-cache", classification: kind, exitCode: null, signal: null });
  const capture = createHostedBootstrapDiagnostics(), emitted: string[] = [];
  expect(() => {
    emitHostedBootstrapFailure("production-build", metadata, "unreturned", line => {
      emitted.push(line);capture.push(Buffer.from(line + "\n"));
    });
    throw original;
  }).toThrow(original as Error);
  expect(capture.finish()).toEqual([{ stage: "production-build", classification: "setup-refused",
    exitCode: null, signal: null, cleanup: "unreturned" }]);
  expect(emitted.join("\n")).not.toMatch(/runtimeStage|synthetic-private-canary|stack|message/);
});

it("drops actual optional namespace and cleanup metadata without changing its native exit refusal", () => {
  let original: unknown;
  try {
    ciRuntimeNamespaceStep(() => { throw ciRuntimeDockerFailure({ status: 7,
      stdout: "synthetic-private-canary", stderr: "synthetic-private-canary" }); },
    "ISOLATED_RUNTIME_FAILED phase=initialization exit=7", 7);
  } catch (error) { original = error; }
  const cleanup = ciRuntimeSetupFailure("cleanup-remove", new SyntaxError("synthetic-private-canary"));
  const refusal = ciRuntimeCleanupFailure(original, cleanup);
  const metadata = freshRuntimeFailureClassification(refusal);
  expect(metadata).toMatchObject({ runtimeStage: "namespace-running", namespacePhase: "initialization",
    classification: "exit-nonzero", exitCode: 7, signal: null,
    cleanupFailure: { runtimeStage: "cleanup-remove", classification: "invalid-response" } });
  const capture = createHostedBootstrapDiagnostics(), emitted: string[] = [];
  emitHostedBootstrapFailure("bootstrap-cleanup", metadata, "uncertain", line => {
    emitted.push(line);capture.push(Buffer.from(line + "\n"));
  });
  expect(capture.finish()).toEqual([{ stage: "bootstrap-cleanup", classification: "exit-nonzero",
    exitCode: 7, signal: null, cleanup: "uncertain" }]);
  expect(emitted.join("\n")).not.toMatch(/runtimeStage|namespacePhase|cleanupFailure|synthetic-private-canary|stdout|stderr/);
  expect(() => { throw refusal; }).toThrow(refusal);
});

it.each(["spawn-refused", "exit-nonzero", "signal", "timeout", "output-limit"] as const)("retains the actual %s process classifier and failure outcome", kind => {
  const original = freshRuntimeCommandFailure(kind, kind === "exit-nonzero" ? 9 : null,
    kind === "signal" ? "SIGTERM" : null);
  const metadata = freshRuntimeFailureClassification(original), capture = createHostedBootstrapDiagnostics();
  emitHostedBootstrapFailure("native-start", metadata, "retained", line => capture.push(Buffer.from(line + "\n")));
  expect(capture.finish()).toEqual([{ stage: "native-start", ...metadata, cleanup: "retained" }]);
  expect(() => { throw original; }).toThrow(original);
});

it("does not invoke accessors or forward arbitrary private extra fields in metadata", () => {
  const getter = vi.fn(() => { throw new Error("synthetic-private-canary"); });
  const accessor = Object.defineProperty({ exitCode: null, signal: null }, "classification", { enumerable: true, get: getter });
  const emit = vi.fn();
  expect(() => emitHostedBootstrapFailure("native-start", accessor as Parameters<typeof emitHostedBootstrapFailure>[1], "retained", emit)).not.toThrow();
  expect(getter).not.toHaveBeenCalled();expect(emit).not.toHaveBeenCalled();
  const actual = freshRuntimeFailureClassification(freshRuntimeCommandFailure("exit-nonzero", 1));
  const extras = Object.defineProperty({ ...actual, raw: "synthetic-private-canary", credential: "synthetic-private-canary" },
    "message", { enumerable: true, get: getter });
  const capture = createHostedBootstrapDiagnostics();
  emitHostedBootstrapFailure("native-start", extras, "retained", line => {
    expect(line).not.toMatch(/synthetic-private-canary|raw|credential|message/);capture.push(Buffer.from(line + "\n"));
  });
  expect(capture.finish()).toEqual([value]);expect(getter).not.toHaveBeenCalled();
});

it("refuses unknown data and hostile descriptor traps without a diagnostic frame", () => {
  const emit = vi.fn();
  const hostile = new Proxy({ classification: "exit-nonzero", exitCode: 1, signal: null }, {
    getOwnPropertyDescriptor() { throw new Error("synthetic-private-canary"); },
  });
  for (const metadata of [hostile, { classification: "synthetic-private-canary", exitCode: 1, signal: null },
    Object.create({ classification: "exit-nonzero", exitCode: 1, signal: null })])
    expect(() => emitHostedBootstrapFailure("native-start", metadata, "retained", emit)).not.toThrow();
  expect(emit).not.toHaveBeenCalled();
});
