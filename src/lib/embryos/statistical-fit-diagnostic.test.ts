import { describe, expect, it, vi } from "vitest";
import { attachFittedFailure, decodeFittedFailure, encodeFittedFailure, fittedCommandFailure, fittedFailureFrom,
  isFittedJourneyCommand, type FittedFailure } from "./statistical-fit-diagnostic";
const privateText = "synthetic-private-diagnostic-canary";
const value: FittedFailure = { outer: "NOT_OBSERVED", inner: "RPC_REFUSED", operation: "READ", code: "unavailable" };
describe("closed fitted failure diagnostic", () => {
  it.each([
    [{ code: "ERR_CHILD_PROCESS_STDIO_MAXBUFFER", killed: true, signal: "SIGKILL" }, "COMMAND_OUTPUT_BOUND"],
    [{ killed: true, signal: "SIGKILL" }, "COMMAND_TIMEOUT"], [{ code: 1 }, "COMMAND_EXIT"],
    [{ code: "ENOENT" }, "COMMAND_SPAWN_REFUSED"], [{ code: "EACCES" }, "COMMAND_SPAWN_REFUSED"],
    [{ code: "EAGAIN" }, "COMMAND_SPAWN_REFUSED"], [{ signal: "SIGTERM" }, "COMMAND_SIGNAL"],
    [{ code: privateText }, "COMMAND_REFUSED"], [{ code: 0 }, "COMMAND_REFUSED"], [null, "COMMAND_REFUSED"],
  ] as const)("reports only fixed public command classification %#", (control, outer) => {
    const error = Object.assign(new Error(privateText), control, { stderr: privateText, stdout: privateText });
    const diagnostic = fittedCommandFailure(error);
    expect(diagnostic).toEqual({ outer, inner: "NOT_OBSERVED", operation: "NOT_OBSERVED", code: "NOT_OBSERVED" });
    expect(encodeFittedFailure(diagnostic)).not.toContain(privateText);
    expect(encodeFittedFailure(diagnostic)).not.toMatch(/success|complete/i);
  });
  it("passes only an entire validated frame and never partial or appended stderr", () => {
    const packet = encodeFittedFailure(value);
    expect(decodeFittedFailure(packet + "\n")).toEqual(value);
    expect(fittedCommandFailure({ code: 1, stderr: packet + "\n" })).toEqual({ ...value, outer: "COMMAND_EXIT" });
    for (const bad of [privateText + packet, packet + privateText, packet + "\n" + privateText,
      packet + "\n\n", packet.replace("READ", privateText), packet.replace("unavailable", privateText), "x".repeat(513)]) {
      expect(decodeFittedFailure(bad)).toBeNull();
      expect(fittedCommandFailure({ code: 1, stderr: bad })).toEqual({ outer: "COMMAND_EXIT", inner: "NOT_OBSERVED",
        operation: "NOT_OBSERVED", code: "NOT_OBSERVED" });
    }
    expect(() => encodeFittedFailure({ ...value, operation: privateText } as unknown as FittedFailure)).toThrow("Invalid closed");
  });
  it("does not execute error getters or leak hostile own-property traps", () => {
    const getter = vi.fn(() => { throw new Error(privateText); }), hostile = {};
    for (const key of ["code", "killed", "signal", "stderr", "message", "stack", "embryoFittedFailure"])
      Object.defineProperty(hostile, key, { get: getter });
    expect(encodeFittedFailure(fittedCommandFailure(hostile))).not.toContain(privateText);
    expect(encodeFittedFailure(fittedFailureFrom(hostile))).not.toContain(privateText);expect(getter).not.toHaveBeenCalled();
    const proxy = new Proxy({}, { getOwnPropertyDescriptor: () => { throw new Error(privateText); } });
    expect(fittedCommandFailure(proxy).outer).toBe("COMMAND_REFUSED");
    expect(() => encodeFittedFailure(hostile as FittedFailure)).toThrow("Invalid closed fitted diagnostic");
    expect(() => encodeFittedFailure(proxy as FittedFailure)).toThrow("Invalid closed fitted diagnostic");
    expect(getter).not.toHaveBeenCalled();
  });
  it("adds only non-enumerable failure metadata and never supplies a completion", () => {
    const error = attachFittedFailure(new Error(privateText), value);
    expect(fittedFailureFrom(error)).toEqual(value);expect(Object.keys(error)).toEqual([]);
    const failed = attachFittedFailure({ status: "failed" as const }, { ...value, inner: "WORK_RETURNED_FAILURE", operation: "FAIL" });
    expect(failed).toEqual({ status: "failed" });expect(JSON.stringify(failed)).toBe('{"status":"failed"}');
    expect(fittedFailureFrom({ code: privateText, message: privateText }).code).toBe("NOT_OBSERVED");
  });
  it("selects diagnostics only for the exact fitted journey command and closed frame", () => {
    const args = ["exec", "-i", "--user", "1001:1001", "fixed-container", "node", "--import", "tsx",
      "/app/scripts/ci-browser/embryo-statistical-worker.mts"];
    const input = JSON.stringify({ kind: "fitted-test", environment: { secret: privateText } }) + "\n";
    expect(isFittedJourneyCommand(args, input, "fixed-container")).toBe(true);
    for (const bad of [JSON.stringify({ secret: privateText }), JSON.stringify({ kind: "fitted-test", environment: {}, extra: true }),
      JSON.stringify({ kind: "coverage-test", environment: {} }), privateText])
      expect(isFittedJourneyCommand(args, bad, "fixed-container")).toBe(false);
    expect(isFittedJourneyCommand([...args, "extra"], input, "fixed-container")).toBe(false);
    expect(isFittedJourneyCommand(args, input, "foreign-container")).toBe(false);
    expect(isFittedJourneyCommand(args.map(v => v === "1001:1001" ? privateText : v), input, "fixed-container")).toBe(false);
  });
});
