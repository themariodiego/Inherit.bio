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
  if (kind === "unknown-cleanup") input.cleanup = "complete";
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
