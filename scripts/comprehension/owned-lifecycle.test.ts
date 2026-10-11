import { execFile, type ExecFileException } from "node:child_process";
import { EventEmitter } from "node:events";
import { chmodSync, chownSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { pathToFileURL } from "node:url";
import { afterEach, expect, it, vi } from "vitest";
import { createOwnedLifecycleObserver, openOwnedLifecycle, parseOwnedLifecycleSnapshot,
  readOwnedLifecycleSnapshot, type OwnedLifecycleObserver } from "./owned-lifecycle";
import { prepareFreshInvocation } from "./run-fresh-t6.mjs";
import { createResourceIO, freshRuntimeCommandFailure, freshRuntimeFailureClassification } from "./fresh-t6-resources";

const injected = vi.hoisted(() => ({ spawn: vi.fn() }));
vi.mock("node:child_process", async original => ({ ...await original<typeof import("node:child_process")>(), spawn: injected.spawn }));
const nonce = "9f2b4dd0-8d3b-4b44-84ba-40b3986aa138", bootId = "0e69d9bf-fb98-4675-b7b5-2d8e166b1209";
const header = { version: 1 as const, nonce, bootId, head: "a".repeat(40), uid: 1001, gid: 1001, createdAt: 10 };
const expected = { nonce, bootId, head: header.head, uid: 1001, gid: 1001 };
const resourceKeys = { NEXT_PUBLIC_SUPABASE_URL: "http://localhost:54321",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "EXAMPLE_PUBLIC_FIXTURE_ANON", SUPABASE_SERVICE_ROLE_KEY: "EXAMPLE_PUBLIC_FIXTURE_SERVICE" };
const canary = "PRIVATE_CANARY_NEVER_EMITTED";
const metadata = { classification: "exit-nonzero", exitCode: 7, signal: null };
const directories: string[] = [];
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); directories.splice(0).forEach(directory => rmSync(directory, { recursive: true, force: true })); });
const capture = (sink?: (bytes: Uint8Array) => void) => {
  const snapshots: Buffer[] = []; let now = 0;
  const observer = createOwnedLifecycleObserver(header, bytes => { snapshots.push(Buffer.from(bytes)); sink?.(bytes); }, () => now);
  const read = () => parseOwnedLifecycleSnapshot(snapshots.at(-1)!, expected, { startedAt: 0, endedAt: 100 });
  return { observer, snapshots, read, tick: (value: number) => { now = value; } };
};

it("records entry as an entry, retains the first actual refusal through cleanup, and never claims complete history", () => {
  const record = capture();
  record.observer.phase("production-build", "entered");
  expect(record.read().latest.event).toBe("entered"); expect(record.read().latest.firstRefusal).toBeNull();
  record.observer.phase("production-build", "refused", metadata);
  record.observer.phase("bootstrap-cleanup", "entered"); record.observer.phase("bootstrap-cleanup", "returned");
  expect(record.read().latest.firstRefusal).toEqual(["production-build", "exit-nonzero", 7, null]);
  expect(record.read().latest.phase).toBe("bootstrap-cleanup"); expect(record.read().latest.event).toBe("returned");
  expect(record.read().completeHistory).toBe(false); expect(record.read().qualifyingEvidence).toBe(false);
});
it("records the actual branded resource failure producer without forwarding any exception content", () => {
  const record = capture(), actual = freshRuntimeCommandFailure("timeout", null, "SIGKILL");
  record.observer.phase("production-build", "entered");
  record.observer.phase("production-build", "refused", freshRuntimeFailureClassification(actual));
  expect(record.read().latest.firstRefusal).toEqual(["production-build", "timeout", null, "SIGKILL"]);
  expect(Buffer.concat(record.snapshots).toString()).not.toContain(actual.message);
});
it("labels an error between returned operations without blaming the returned operation", () => {
  const record = capture(); record.observer.phase("isolation", "returned"); record.observer.failure(metadata);
  expect(record.read().latest.firstRefusal).toEqual(["between-operations", "exit-nonzero", 7, null]);
});
it.each(["guard-refused", "invalid-response"])("maps existing %s classification without forwarding extra metadata", classification => {
  const record = capture(); record.observer.phase("runtime-guard", "refused", {
    classification, exitCode: null, signal: null, runtimeStage: "runtime-policy", output: canary });
  expect(record.read().latest.classification).toBe("setup-refused");
  expect(Buffer.concat(record.snapshots).toString()).not.toContain(canary);
});
it("does not evaluate private getters, proxy exceptions or unknown classification/phase/signal strings", () => {
  const record = capture(); record.observer.phase("source-guard", "entered"); const count = record.snapshots.length;
  let called = 0;
  const accessor = { exitCode: null, signal: null };
  Object.defineProperty(accessor, "classification", { get() { called++; throw new Error(canary); } });
  record.observer.phase("source-guard", "refused", accessor);
  record.observer.phase("source-guard", "refused", new Proxy({}, { getOwnPropertyDescriptor() { throw new Error(canary); } }));
  record.observer.phase("source-guard", "refused", { ...metadata, classification: canary });
  record.observer.phase(canary as never, "entered"); record.observer.process("terminal", 7, canary);
  expect(called).toBe(0); expect(record.snapshots).toHaveLength(count);
  expect(Buffer.concat(record.snapshots).toString()).not.toContain(canary);
});
it.each(["bootstrap-acquisition", "production-build", "bootstrap-cleanup"] as const)("preserves original %s refusal and original cleanup with injected observation", async stage => {
  const record = capture(), failure = new Error(canary), events: string[] = [];
  const close = vi.fn(async () => { events.push("close"); if (stage === "bootstrap-cleanup") throw failure; });
  const acquire = vi.fn(async () => { events.push("acquire"); if (stage === "bootstrap-acquisition") throw failure;
    return { keys: resourceKeys, close }; });
  const build = vi.fn(async () => { events.push("build"); if (stage === "production-build") throw failure; });
  vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  await expect(prepareFreshInvocation({ environment: resourceKeys, bindObservedKeys: false, buildRequired: true,
    acquire, build, lifecycle: record.observer })).rejects.toBe(failure);
  expect(events).toEqual(stage === "bootstrap-acquisition" ? ["acquire"] : ["acquire", "build", "close"]);
  expect(close).toHaveBeenCalledTimes(stage === "bootstrap-acquisition" ? 0 : 1);
  expect(record.read().latest.firstRefusal?.[0]).toBe(stage);
  expect(Buffer.concat(record.snapshots).toString()).not.toContain(canary);
});
it("keeps original key equality refusal and real stack cleanup before any build", async () => {
  const record = capture(), close = vi.fn(async () => {}), build = vi.fn(async () => {});
  vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  await expect(prepareFreshInvocation({ environment: resourceKeys, bindObservedKeys: false, buildRequired: true,
    acquire: async () => ({ keys: { ...resourceKeys, NEXT_PUBLIC_SUPABASE_URL: "http://wrong.invalid" }, close }), build,
    lifecycle: record.observer })).rejects.toThrow("Fresh keys must match");
  expect(build).not.toHaveBeenCalled(); expect(close).toHaveBeenCalledTimes(1);
  expect(record.read().latest.firstRefusal?.[0]).toBe("bootstrap-keys");
});
it("keeps exact clean completion and cleanup when telemetry throws", async () => {
  const close = vi.fn(async () => {}), build = vi.fn(async () => {});
  const observer: OwnedLifecycleObserver = { phase() { throw new Error(canary); }, process() { throw new Error(canary); }, failure() { throw new Error(canary); } };
  await prepareFreshInvocation({ environment: resourceKeys, bindObservedKeys: false, buildRequired: true,
    acquire: async () => ({ keys: resourceKeys, close }), build, lifecycle: observer });
  expect(build).toHaveBeenCalledTimes(1); expect(close).toHaveBeenCalledTimes(1);
});
it("never substitutes sink I/O refusal for the original build refusal or skips cleanup", async () => {
  const failure = new Error(canary), close = vi.fn(async () => {}), record = capture(() => { throw new Error("sink"); });
  vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  await expect(prepareFreshInvocation({ environment: resourceKeys, bindObservedKeys: false, buildRequired: true,
    acquire: async () => ({ keys: resourceKeys, close }), build: async () => { throw failure; }, lifecycle: record.observer })).rejects.toBe(failure);
  expect(close).toHaveBeenCalledTimes(1);
});

const fakeChild = () => {
  const child = Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough(),
    kill: vi.fn((signal: string) => { child.emit("exit", null, signal); return true; }) });
  injected.spawn.mockReturnValue(child); return child;
};
it.each(["deadline", "output-limit"] as const)("records the actual injected %s sender and subsequent terminal without replacing command refusal", async reason => {
  vi.useFakeTimers(); const record = capture(), child = fakeChild();
  record.observer.phase("production-build", "entered");
  const outcome = createResourceIO(undefined, record.observer).command("fixed-public-child", [], { env: {}, timeout: 10 })
    .catch(error => error);
  expect(record.read().latest.process.event).toBe("requested"); child.emit("spawn");
  expect(record.read().latest.process.event).toBe("spawned"); record.tick(10);
  if (reason === "deadline") await vi.advanceTimersByTimeAsync(10);
  else child.stdout.write(Buffer.alloc(1_048_577, 65));
  expect(await outcome).toBeInstanceOf(Error);
  expect(child.kill).toHaveBeenCalledWith("SIGKILL");
  expect(record.read().latest.process).toEqual({ ordinal: 1, event: "terminal", exitCode: null,
    signal: "SIGKILL", durationMs: 10, sender: reason === "deadline" ? "command-deadline" : "command-output-limit" });
});
it("distinguishes actual injected command error from success and never forwards the error message", async () => {
  const record = capture(), child = fakeChild(); record.observer.phase("bootstrap-acquisition", "entered");
  const failed = createResourceIO(undefined, record.observer).command("fixed-public-child", [], { env: {} }).catch(error => error);
  child.emit("error", new Error(canary)); expect(await failed).toBeInstanceOf(Error);
  expect(record.read().latest.process.event).toBe("error"); expect(Buffer.concat(record.snapshots).toString()).not.toContain(canary);
  const good = fakeChild(); const passed = createResourceIO(undefined, record.observer).command("fixed-public-child", [], { env: {} });
  good.emit("spawn"); good.stdout.write("  ok  "); good.emit("exit", 0, null);
  await expect(passed).resolves.toBe("ok"); expect(record.read().latest.process.exitCode).toBe(0);
});
it.each(["extra", "duplicate", "partial", "non-ascii", "oversized", "foreign-nonce", "old-lifetime"])("refuses %s snapshot without accepting partial facts", kind => {
  const record = capture(); record.observer.phase("source-guard", "entered"); let raw = record.snapshots.at(-1)!;
  if (kind === "extra") raw = Buffer.from(raw.toString().replace('"sequence":2', '"private":"'+canary+'","sequence":2'));
  if (kind === "duplicate") raw = Buffer.from(raw.toString().replace('"sequence":2', '"sequence":1,"sequence":2'));
  if (kind === "partial") raw = raw.subarray(0, raw.length - 1);
  if (kind === "non-ascii") raw = Buffer.concat([raw, Buffer.from("é")]);
  if (kind === "oversized") raw = Buffer.alloc(1025, 65);
  const binding = kind === "foreign-nonce" ? { ...expected, nonce: bootId } : expected;
  const lifetime = kind === "old-lifetime" ? { startedAt: 11, endedAt: 100 } : { startedAt: 0, endedAt: 100 };
  expect(() => parseOwnedLifecycleSnapshot(raw, binding, lifetime)).toThrow();
});
it("refuses a forged native capability without opening a public snapshot", () => {
  expect(openOwnedLifecycle({ kind: "owned-linux", proof: header } as never)).toBeUndefined();
});
it("reads only exact owned public file identity/mode and refuses symlink or replaced content", () => {
  const directory = realpathSync(mkdtempSync(path.join(tmpdir(), "inherit-lifecycle-public-"))); directories.push(directory); chmodSync(directory, 0o700);
  const uid = process.getuid!(), gid = process.getgid!(), local = { ...header, uid, gid, createdAt: Date.now() };
  chownSync(directory, uid, gid);
  const snapshots: Uint8Array[] = []; const observer = createOwnedLifecycleObserver(local, bytes => snapshots.push(bytes));
  observer.phase("configuration", "entered"); const file = path.join(directory, `owned-lifecycle-${nonce}.jsonl`);
  writeFileSync(file, snapshots[0], { mode: 0o600, flag: "wx" });
  const input = { scratch: directory, nonce, bootId, head: header.head, uid, gid, startedAt: local.createdAt - 1000, endedAt: Date.now() + 1000 };
  expect(readOwnedLifecycleSnapshot(input).status).toBe("observed");
  expect(readOwnedLifecycleSnapshot({ ...input, gid: gid + 1 }).status).toBe("refused");
  chmodSync(file, 0o640); expect(readOwnedLifecycleSnapshot(input).status).toBe("refused");
  rmSync(file); symlinkSync(path.join(directory, "unopened-private-target"), file);
  expect(readOwnedLifecycleSnapshot(input).status).toBe("refused"); rmSync(file);
  expect(readOwnedLifecycleSnapshot(input).status).toBe("absent");
});
it("refuses a genuine symlink-parent scratch even when its target holds an otherwise valid public snapshot", () => {
  const directory = realpathSync(mkdtempSync(path.join(tmpdir(), "inherit-lifecycle-parent-")));
  directories.push(directory); chmodSync(directory, 0o700);
  const uid = process.getuid!(), gid = process.getgid!(); chownSync(directory, uid, gid);
  const local = { ...header, uid, gid, createdAt: Date.now() }, snapshots: Uint8Array[] = [];
  createOwnedLifecycleObserver(local, bytes => snapshots.push(bytes)).phase("configuration", "entered");
  writeFileSync(path.join(directory, `owned-lifecycle-${nonce}.jsonl`), snapshots[0], { mode: 0o600, flag: "wx" });
  const input = { scratch: directory, nonce, bootId, head: header.head, uid, gid,
    startedAt: local.createdAt - 1000, endedAt: Date.now() + 1000 };
  expect(readOwnedLifecycleSnapshot(input).status).toBe("observed");
  const alias = path.join(directory, "linked-scratch"); symlinkSync(directory, alias, "dir");
  expect(readOwnedLifecycleSnapshot({ ...input, scratch: alias }).status).toBe("refused");
});
it("retains actual synchronously written public observations after an intentionally killed bounded local fixture child", async () => {
  const directory = mkdtempSync(path.join(tmpdir(), "inherit-lifecycle-kill-")); directories.push(directory); chmodSync(directory, 0o700);
  const file = path.join(directory, "public-only.jsonl"), lifecycleModuleUrl = pathToFileURL(path.join(process.cwd(), "scripts/comprehension/owned-lifecycle.ts")).href;
  // This invokes only the pure recorder with invented public input, not a native
  // capability/stack. The actual FS flush and killed process are what is tested.
  const script = `(async()=>{const {openSync,writeSync,ftruncateSync,fsyncSync}=require('node:fs');
    const m=await import(${JSON.stringify(lifecycleModuleUrl)});const fd=openSync(${JSON.stringify(file)},'wx',0o600);
    const o=(m.createOwnedLifecycleObserver??m.default?.createOwnedLifecycleObserver)(${JSON.stringify(header)},b=>{writeSync(fd,b,0,b.length,0);ftruncateSync(fd,b.length);fsyncSync(fd);});
    o.phase('production-build','entered');process.kill(process.pid,'SIGKILL');})().catch(()=>process.exit(9));`;
  const original = await new Promise<ExecFileException | null>(resolve => {
    execFile(process.execPath, ["--import", "tsx", "-e", script], { timeout: 2000, maxBuffer: 8192,
      env: { PATH: process.env.PATH!, LANG: "C.UTF-8", TZ: "UTC", NODE_ENV: "test" } }, error => resolve(error));
  });
  expect(original).toMatchObject({ signal: "SIGKILL" });
  const parsed = parseOwnedLifecycleSnapshot(readFileSync(file), expected, { startedAt: 0, endedAt: 100 });
  expect(parsed.latest.phase).toBe("production-build"); expect(parsed.latest.event).toBe("entered");
  expect(parsed.latest.firstRefusal).toBeNull(); expect(parsed.qualifyingEvidence).toBe(false);
});
