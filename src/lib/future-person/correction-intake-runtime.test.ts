import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { CORRECTION_INTAKE_REQUEST_LIMIT_MS, createCorrectionIntakeRuntime } from "./correction-intake-runtime";
import { readCorrectionIntakeJson } from "./correction-intake-json";
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
async function flush() { for (let n = 0; n < 20; n++) await Promise.resolve(); }
function request(body: ReadableStream<Uint8Array>, signal?: AbortSignal) {
  return new Request("https://synthetic.invalid/api/future-person/claim/session/corrections", { method: "POST", body, signal, duplex: "half" } as RequestInit);
}
beforeEach(() => vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date", "performance"] }));
afterEach(() => vi.useRealTimers());
// SOURCE ONLY / UNRUN. Actual streams and the installed cold RPC builder use
// a synthetic fetch seam. These cases are not native transaction/cleanup ACKs.
describe("correction intake owns the original caller clock and mutable body", () => {
  it("reads a complete unique object and clears the consumed real chunk", async () => {
    const chunk = new TextEncoder().encode('{"field":"display-label","statement":"A complete synthetic correction statement.","nonce":"token"}');
    const body = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(chunk); controller.close(); } });
    const req = request(body), owner = createCorrectionIntakeRuntime(req.signal);
    expect(await readCorrectionIntakeJson(req, owner)).toMatchObject({ field: "display-label", nonce: "token" });
    await owner.finish(); expect(chunk.every(byte => byte === 0)).toBe(true);
    expect(body.locked).toBe(false); expect(owner.disposition().cleanupHeld).toBe(false);
  });
  it("accepts the exact 32 KiB reader boundary without increasing the correction schema", async () => {
    const text = `{"x":"${"a".repeat(32 * 1024 - 8)}"}`, bytes = new TextEncoder().encode(text);
    expect(bytes.length).toBe(32 * 1024);
    const req = request(new ReadableStream({ start(controller) { controller.enqueue(bytes); controller.close(); } })), owner = createCorrectionIntakeRuntime(req.signal);
    expect(await readCorrectionIntakeJson(req, owner)).toEqual({ x: "a".repeat(32 * 1024 - 8) }); await owner.finish();
    expect(bytes.every(byte => byte === 0)).toBe(true); expect(owner.disposition().cleanupHeld).toBe(false);
  });
  it.each(['{"field":"x","fie\\u006cd":"y"}', '{"statement":"\\ud800"}', '{"statement":"\\udfff"}'])("refuses duplicate or invalid Unicode body %s", async text => {
    const req = new Request("https://synthetic.invalid", { method: "POST", body: text }), owner = createCorrectionIntakeRuntime(req.signal);
    expect(await readCorrectionIntakeJson(req, owner)).toBeNull(); await owner.finish();
    expect(owner.disposition().ownedMutableBuffers).toBe(0);
  });
  it("refuses malformed UTF-8 without replacing its bytes", async () => {
    const bytes = new Uint8Array([0x7b, 0x22, 0x78, 0x22, 0x3a, 0x22, 0xc3, 0x28, 0x22, 0x7d]);
    const req = request(new ReadableStream({ start(controller) { controller.enqueue(bytes); controller.close(); } })), owner = createCorrectionIntakeRuntime(req.signal);
    expect(await readCorrectionIntakeJson(req, owner)).toBeNull(); await owner.finish(); expect(bytes.every(byte => byte === 0)).toBe(true);
  });
  it("clears the 32 KiB overflow before an unsettled real cancellation", async () => {
    const chunk = new Uint8Array(32 * 1024 + 1).fill(91), cancel = deferred<void>(); let cancelled = false;
    const body = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(chunk); }, cancel() { cancelled = true; return cancel.promise; } });
    const req = request(body), owner = createCorrectionIntakeRuntime(req.signal), actual = readCorrectionIntakeJson(req, owner).catch(() => null);
    await flush(); expect(cancelled).toBe(true); expect(chunk.every(byte => byte === 0)).toBe(true);
    await vi.advanceTimersByTimeAsync(CORRECTION_INTAKE_REQUEST_LIMIT_MS); await actual; await owner.finish();
    expect(owner.disposition().cleanupHeld).toBe(true); expect(body.locked).toBe(true);
    cancel.resolve(); await flush(); expect(body.locked).toBe(false); expect(owner.disposition().pendingActualTasks).toBe(0);
  });
  it("retains a rejecting real cancellation as HOLD after clearing the body", async () => {
    const chunk = new Uint8Array(32 * 1024 + 1).fill(92);
    const body = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(chunk); }, cancel() { return Promise.reject(new Error("synthetic_cancel")); } });
    const req = request(body), owner = createCorrectionIntakeRuntime(req.signal);
    await expect(readCorrectionIntakeJson(req, owner)).rejects.toThrow("correction_intake_body_held"); await owner.finish();
    expect(chunk.every(byte => byte === 0)).toBe(true); expect(body.locked).toBe(false); expect(owner.disposition().cleanupHeld).toBe(true);
  });
  it("bounds a never-EOF stream and observes actual read/cancel/release settlement", async () => {
    const body = new ReadableStream<Uint8Array>({ start() {} }), req = request(body), owner = createCorrectionIntakeRuntime(req.signal);
    const actual = readCorrectionIntakeJson(req, owner).catch(() => null); await flush();
    await vi.advanceTimersByTimeAsync(CORRECTION_INTAKE_REQUEST_LIMIT_MS); await actual; await owner.finish(); await flush();
    expect(owner.disposition().cleanupHeld).toBe(true); expect(owner.disposition().pendingActualTasks).toBe(0); expect(body.locked).toBe(false);
  });
  it("clears a real read that delivers after abort and keeps the late operation owned", async () => {
    let source!: ReadableStreamDefaultController<Uint8Array>;
    const body = new ReadableStream<Uint8Array>({ start(controller) { source = controller; } }), reader = body.getReader();
    const abort = new AbortController(), owner = createCorrectionIntakeRuntime(abort.signal), bytes = new Uint8Array(8).fill(93);
    const actual = owner.read(async () => { const result = await reader.read(); if (result.value) owner.own(result.value); return result; });
    const waiting = owner.wait(actual).catch(() => null); await flush(); abort.abort(); await waiting; await owner.finish();
    expect(owner.disposition().pendingActualTasks).toBe(1); source.enqueue(bytes); await actual; source.close(); reader.releaseLock(); await flush();
    expect(bytes.every(byte => byte === 0)).toBe(true); expect(owner.disposition().pendingActualTasks).toBe(0);
  });
  it("does not renew the native prepare deadline or execute a cold commit twice", async () => {
    const prepared = deferred<Response>(), committed = deferred<Response>(), calls: string[] = [], signals: (AbortSignal | null | undefined)[] = [];
    const client = createClient("https://synthetic.invalid", "synthetic-key", { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      global: { fetch: (input, init) => { const name = new URL(String(input)).pathname.split("/").at(-1)!; calls.push(name); signals.push(init?.signal);
        return name === "prepare_new_correction_v1" ? prepared.promise : committed.promise; } } });
    const owner = createCorrectionIntakeRuntime(new AbortController().signal), deadline = owner.originalDeadline;
    const prepare = owner.rpc("correction-prepare", () => client.rpc("prepare_new_correction_v1").retry(false).abortSignal(owner.signal));
    await flush(); await vi.advanceTimersByTimeAsync(20_000); prepared.resolve(Response.json({ synthetic: true })); await owner.wait(prepare);
    const commit = owner.rpc("correction-commit", () => client.rpc("commit_new_correction_v1").retry(false).abortSignal(owner.signal));
    const waiting = owner.wait(commit).catch(() => null); await flush();
    expect(owner.rpc("correction-commit", () => { throw new Error("second execution"); })).toBe(commit);
    expect(owner.originalDeadline).toBe(deadline); await vi.advanceTimersByTimeAsync(10_000); await waiting; await owner.finish();
    expect(owner.disposition()).toMatchObject({ nativePreparationHeld: true, lateCommitUncertain: true, pendingActualTasks: 1 });
    expect(() => owner.confirmNativeCommit()).toThrow("correction_intake_runtime_held");
    committed.resolve(Response.json({ status: "review_pending" })); await commit; await flush();
    expect(calls).toEqual(["prepare_new_correction_v1", "commit_new_correction_v1"]); expect(signals).toEqual([owner.signal, owner.signal]);
    expect(owner.disposition().nativePreparationHeld).toBe(true);
  });
  it("confirms only a caller-checked commit and leaves failed preparation cleanup held", async () => {
    const failed = createCorrectionIntakeRuntime(new AbortController().signal);
    await failed.wait(failed.rpc("correction-prepare", () => Promise.resolve(null))); await failed.finish();
    expect(failed.disposition().nativePreparationHeld).toBe(true);
    const confirmed = createCorrectionIntakeRuntime(new AbortController().signal);
    await confirmed.wait(confirmed.rpc("correction-prepare", () => Promise.resolve(null)));
    await confirmed.wait(confirmed.rpc("correction-commit", () => Promise.resolve(null))); confirmed.confirmNativeCommit(); await confirmed.finish();
    expect(confirmed.disposition()).toMatchObject({ nativePreparationHeld: false, lateCommitUncertain: false });
  });
  it("refuses an already aborted request before invoking a cold preparation", async () => {
    const abort = new AbortController(); abort.abort();
    const owner = createCorrectionIntakeRuntime(abort.signal), work = vi.fn();
    expect(() => owner.rpc("correction-prepare", work)).toThrow("correction_intake_runtime_held");
    await owner.finish(); expect(work).not.toHaveBeenCalled(); expect(owner.disposition().nativePreparationHeld).toBe(false);
  });
});
