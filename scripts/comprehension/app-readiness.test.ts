import type { ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import type { AppLauncherDiagnostic } from "../ci-browser/app-launcher-diagnostic";
import { afterEach, expect, it, vi } from "vitest";
import { OwnedAppReadinessFailure, waitForOwnedApp } from "./app-readiness";
import { refuseFreshSetup } from "./fresh-t6-browser";

const child = (exitCode: number | null = null, signalCode: NodeJS.Signals | null = null) =>
  Object.assign(new EventEmitter(), { exitCode, signalCode, stdout: null, stderr: null }) as ChildProcess;
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
it("requires the actual exact 200 response and retains the manual redirect and per-request limit", async () => {
  const fetch = vi.fn().mockResolvedValue(new Response(null, { status: 200 })); vi.stubGlobal("fetch", fetch);
  await expect(waitForOwnedApp(child(), 3100, new AbortController().signal, [])).resolves.toBeUndefined();
  expect(fetch).toHaveBeenCalledOnce();
  expect(fetch.mock.calls[0][0]).toBe("http://localhost:3100/");
  expect(fetch.mock.calls[0][1].redirect).toBe("manual");
  expect(fetch.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
});
it.each([307, 403, 500])("keeps the full 60-second deadline and reports response %s without accepting it", async status => {
  vi.useFakeTimers(); vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status })));
  const outcome = waitForOwnedApp(child(), 3105, new AbortController().signal, []).catch(error => error);
  await vi.advanceTimersByTimeAsync(59_900); let settled = false; void outcome.then(() => { settled = true; });
  await Promise.resolve(); expect(settled).toBe(false);
  await vi.advanceTimersByTimeAsync(100); const error = await outcome;
  expect(error).toBeInstanceOf(OwnedAppReadinessFailure);
  expect(error.observation).toEqual({ port: 3105, reason: "deadline", exitCode: null, signal: null, responseStatus: status, launcher: [] });
});
it("distinguishes an exited launcher from a no-response deadline", async () => {
  await expect(waitForOwnedApp(child(1), 3100, new AbortController().signal, [])).rejects.toMatchObject({
    observation: { reason: "child-exited", exitCode: 1, signal: null, responseStatus: null },
  });
  vi.useFakeTimers(); vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("private-token")));
  const outcome = waitForOwnedApp(child(), 3100, new AbortController().signal, []).catch(error => error);
  await vi.advanceTimersByTimeAsync(60_000); const error = await outcome;
  expect(error.observation.reason).toBe("deadline"); expect(error.observation.responseStatus).toBeNull();
  expect(JSON.stringify(error.observation)).not.toContain("private-token");
});
it("preserves caller cancellation instead of replacing it with a startup failure", async () => {
  const controller = new AbortController(), reason = new Error("caller cancellation"); controller.abort(reason);
  await expect(waitForOwnedApp(child(), 3100, controller.signal, [])).rejects.toBe(reason);
});
it("emits only closed startup facts after actual cleanup and still refuses the simulation", async () => {
  const safe = { mode: "inside" as const, port: 3100, stage: "fixture" as const, outcome: "child-exit" as const, exitCode: 1, signal: null };
  const failure = new OwnedAppReadinessFailure(child(1), 3100, "child-exited", null, [safe]);
  const close = vi.fn().mockResolvedValue(undefined), lines: string[] = [];
  await expect(refuseFreshSetup("main-app-ready", failure, close, line => lines.push(line))).rejects.toThrow("Fresh comprehension setup refused");
  expect(close).toHaveBeenCalledOnce();
  expect(JSON.parse(lines[0]).appReadiness).toEqual(failure.observation);
  expect(JSON.parse(lines[0]).cleanup).toBe("complete");
});
it("projects validated facts before later mutation or inherited serialization can expose private data", () => {
  const serialize = vi.fn(() => ({ secret: "private-token" }));
  const value = Object.assign(Object.create({ toJSON: serialize }), {
    mode: "inside", port: 3100, stage: "next-app", outcome: "child-exit", exitCode: 1, signal: null,
  });
  const error = new OwnedAppReadinessFailure(child(1), 3100, "child-exited", null, [value]);
  value.stage = "private-token";
  const output = JSON.stringify(error.observation);
  expect(serialize).not.toHaveBeenCalled(); expect(output).not.toContain("private-token");
  expect(error.observation.launcher[0].stage).toBe("next-app");
  expect(error.observation.launcher[0]).not.toBe(value);
});
it("refuses ports and reasons outside the closed startup observation contract", () => {
  expect(() => new OwnedAppReadinessFailure(child(), 443 as 3100, "deadline", null, [])).toThrow("Closed readiness port");
  expect(() => new OwnedAppReadinessFailure(child(), 3100, "private-token" as "deadline", null, [])).toThrow("Closed readiness port");
});
it("captures filtered final diagnostics after exit and before pipe close", async () => {
  vi.useFakeTimers(); const launcher: AppLauncherDiagnostic[] = [];
  const exiting = Object.assign(child(1), { stdout: new PassThrough(), stderr: new PassThrough() });
  const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
  const outcome = waitForOwnedApp(exiting, 3100, new AbortController().signal, launcher).catch(error => error);
  launcher.push({ mode: "host", port: 3100, stage: "mail-relay", outcome: "child-exit", exitCode: 1, signal: null });
  exiting.emit("close", 1, null); await vi.advanceTimersByTimeAsync(100);
  const error = await outcome;
  expect(error.observation.launcher).toEqual(launcher); expect(error.observation.reason).toBe("child-exited");
  expect(fetch).not.toHaveBeenCalled(); expect(exiting.listenerCount("close")).toBe(0);
  exiting.stdout.destroy(); exiting.stderr.destroy();
});
it("keeps the original 60-second limit when an exited child's pipes do not close", async () => {
  vi.useFakeTimers(); const exiting = Object.assign(child(1), { stdout: new PassThrough(), stderr: new PassThrough() });
  const outcome = waitForOwnedApp(exiting, 3100, new AbortController().signal, []).catch(error => error);
  await vi.advanceTimersByTimeAsync(59_900); let settled = false; void outcome.then(() => { settled = true; });
  await Promise.resolve(); expect(settled).toBe(false);
  await vi.advanceTimersByTimeAsync(100); const error = await outcome;
  expect(error.observation.reason).toBe("child-exited"); expect(error.observation.exitCode).toBe(1);
  expect(exiting.listenerCount("close")).toBe(0); exiting.stdout.destroy(); exiting.stderr.destroy();
});
it("preserves caller cancellation while collecting an exited child's final pipe facts", async () => {
  vi.useFakeTimers(); const exiting = Object.assign(child(1), { stdout: new PassThrough(), stderr: new PassThrough() });
  const controller = new AbortController(), reason = new Error("caller cancellation");
  const outcome = waitForOwnedApp(exiting, 3100, controller.signal, []).catch(error => error);
  controller.abort(reason); await vi.advanceTimersByTimeAsync(100);
  expect(await outcome).toBe(reason); expect(exiting.listenerCount("close")).toBe(0);
  exiting.stdout.destroy(); exiting.stderr.destroy();
});
