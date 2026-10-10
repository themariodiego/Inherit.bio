import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { chmod, lstat, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createLiveManifest } from "./conductor-inputs";
import { inputs, settings } from "./conductor-fixtures";
import { InstrumentJournal } from "./instrument-journal";
import { reconcileKeyFreeDryJournal } from "./manual-reconciliation";
import type { OwnedLinuxCapability } from "../owned-linux-runtime";

const native = vi.hoisted(() => ({ cleanup: vi.fn(), olderCleanup: vi.fn() }));
const fileIO = vi.hoisted(() => ({ failHistoryClose: false, opened: [] as string[] }));
vi.mock("../owned-linux-runtime", async importOriginal => ({
  ...await importOriginal<typeof import("../owned-linux-runtime")>(), assertOwnedLinuxManualCleanup: native.cleanup, assertOwnedLinuxOlderBootManualCleanup: native.olderCleanup,
}));
vi.mock("node:fs/promises", async importOriginal => {
  const original = await importOriginal<typeof import("node:fs/promises")>();
  return { ...original, open: async (...args: Parameters<typeof original.open>) => {
    const handle = await original.open(...args); fileIO.opened.push(String(args[0]));
    if (fileIO.failHistoryClose && String(args[0]).endsWith("/dry-history.jsonl")) {
      fileIO.failHistoryClose = false;
      vi.spyOn(handle, "close").mockRejectedValueOnce(new Error("MUST_NOT_PRINT_SYNTHETIC_CANARY"));
    }
    return handle;
  } };
});
const directories: string[] = [];
const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
beforeEach(() => { native.cleanup.mockReset().mockReturnValue("2".repeat(64)); native.olderCleanup.mockReset().mockReturnValue("4".repeat(64)); fileIO.failHistoryClose = false; fileIO.opened = []; });
afterEach(async () => { for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true }); });

/** Only synthetic local journal bytes. Native authority is explicitly mocked;
 * these unit controls never establish a Linux capability or recover real data. */
async function fixture(options: { unfinished?: boolean; provider?: "local-deterministic-stub" | "openai-compatible-chat";
  inference?: "pending" | "unknown"; unresolved?: boolean; answered?: boolean } = {}) {
  const directory = await realpath(await mkdtemp(path.join(tmpdir(), "manual-dry-unit-"))); directories.push(directory);
  const previousOwner = { version: 1 as const, nonce: "00000000-0000-4000-8000-000000000001",
    bootId: "00000000-0000-4000-8000-000000000002", head: "a".repeat(40), root: process.cwd(), scratch: directory,
    dockerSocket: "/run/synthetic.sock", uid: process.getuid!(), gid: process.getgid!(), pid: 100001,
    processStart: "1", daemonId: "synthetic-empty-daemon", createdAt: 1, publicKey: "synthetic-public-key" };
  const owner = { kind: "owned-linux", proof: { ...previousOwner, nonce: "00000000-0000-4000-8000-000000000003", createdAt: 2 } } as OwnedLinuxCapability;
  const journal = await InstrumentJournal.open(directory, 1000, 0);
  for (const id of ["fresh-build-one", "fresh-build-two", "fresh-stack-one", "fresh-stack-two"]) await journal.budget.reserve(id, 80);
  const manifest = createLiveManifest(inputs, { kind: "smoke", runId: "failed-native", revision: previousOwner.head,
    samplingSeed: "b".repeat(64), settings, taskIds: ["T6", "T7"], personaIds: [inputs.personas[0].id],
    inference: { label: "local/deterministic-stub", provider: options.provider ?? "local-deterministic-stub" }, modelIdentity: "unit-only",
    build: { baseUrl: "http://localhost:3100", buildId: "synthetic-build", jurisdiction: "TEST-LOCAL" }, skipped: [], blockers: [] });
  await journal.append({ kind: "start", manifest });
  await journal.append({ kind: "session-open", runId: manifest.runId, sessionId: "failed-session", personaId: manifest.personaIds[0], taskId: "T6" });
  if (options.inference) {
    await journal.budget.reserve("uncertain-model", 20);
    await journal.append({ kind: "attempt", runId: manifest.runId, id: "uncertain-model", slot: "participant-slot",
      processId: "uncertain-process", role: "participant", attempt: 1, maximum: 20 });
    if (options.inference === "unknown") await journal.append({ kind: "usage", runId: manifest.runId, id: "uncertain-model", certain: false, actual: null });
  }
  if (options.answered) await journal.append({ kind: "trace", runId: manifest.runId, sessionId: "failed-session", phase: "answer", value: "unit-only answer" });
  if (options.unresolved !== false) await journal.append({ kind: "resource-unresolved", runId: manifest.runId, id: "failed-session", resource: "browser" });
  await journal.append({ kind: "trace", runId: manifest.runId, sessionId: "failed-session", phase: "ended",
    value: { closed: false, privateCanary: "MUST_NOT_PRINT_SYNTHETIC_CANARY" } });
  if (!options.unfinished) await journal.append({ kind: "finish", runId: manifest.runId, status: "stopped", instrumentClean: false, failure: "resource-unresolved" });
  await journal.close();
  const historyFile = path.join(directory, "dry-history.jsonl"), spendFile = path.join(directory, "dry-spend.jsonl");
  const before = await readFile(historyFile), spend = await readFile(spendFile);
  return { directory, owner, journal, historyFile, spendFile, before, spend,
    request: { version: 1, ledger: "dry", directory, runId: manifest.runId, sessionId: "failed-session",
      historyPrefixSha256: hash(before), publicCleanupSha256: "3".repeat(64), previousOwner } };
}

function olderBootRequest(request: Awaited<ReturnType<typeof fixture>>["request"]) {
  const { previousOwner, ...base } = request;
  return { ...base, previousChallenge: { kind: "older-boot-challenge", scratch: previousOwner.scratch,
    challenge: { version: 1, nonce: previousOwner.nonce, bootId: previousOwner.bootId, head: previousOwner.head,
      uid: previousOwner.uid, createdAt: previousOwner.createdAt } } };
}

describe("explicit manual key-free dry journal reconciliation", () => {
  it("does not expose reconciliation through ordinary journal append", async () => {
    const value = await fixture();
    await expect(value.journal.append({ kind: "resource-reconciled", runId: value.request.runId, id: value.request.sessionId,
      resource: "browser", reason: "manual-key-free-native-cleanup", historyPrefixSha256: hash(value.before),
      previousOwnerSha256: "2".repeat(64), publicCleanupSha256: "3".repeat(64), ownerNonce: value.owner.proof.nonce,
      bootId: value.owner.proof.bootId, daemonId: value.owner.proof.daemonId })).rejects.toThrow("Explicit manual");
    expect(await readFile(value.historyFile)).toEqual(value.before);
  });

  it("appends exactly one closure, preserves all failed bytes/reservations and permits a new independent run", async () => {
    const value = await fixture(); fileIO.opened = [];
    expect(await reconcileKeyFreeDryJournal(value.owner, value.request)).toEqual({ status: "reconciled", qualifyingEvidence: false, spendChanged: false });
    expect(fileIO.opened).not.toContain(value.spendFile);
    const after = await readFile(value.historyFile);
    expect(after.subarray(0, value.before.length)).toEqual(value.before);
    const appended = after.subarray(value.before.length).toString("utf8");
    expect(appended.split("\n")).toHaveLength(2);
    expect(JSON.parse(appended)).toMatchObject({ kind: "resource-reconciled", runId: "failed-native", id: "failed-session",
      historyPrefixSha256: hash(value.before), previousOwnerSha256: "2".repeat(64) });
    expect(appended).not.toContain("MUST_NOT_PRINT_SYNTHETIC_CANARY");
    expect(await readFile(value.spendFile)).toEqual(value.spend);
    const reopened = await InstrumentJournal.open(value.directory, 1000, 0);
    expect(reopened.budget.remaining).toBe(680); expect(reopened.history.resourceStopRequired).toBe(false);
    await reopened.close();
    await expect(reconcileKeyFreeDryJournal(value.owner, value.request)).rejects.toThrow("refused");
    expect(await readFile(value.historyFile)).toEqual(after);
  });

  it("uses the explicit older-boot path and names its retained-challenge digest honestly", async () => {
    const value = await fixture(), request = olderBootRequest(value.request);
    fileIO.opened = [];
    expect(await reconcileKeyFreeDryJournal(value.owner, request)).toMatchObject({ status: "reconciled", spendChanged: false });
    expect(native.cleanup).not.toHaveBeenCalled(); expect(native.olderCleanup).toHaveBeenCalledTimes(3);
    const after = await readFile(value.historyFile); expect(after.subarray(0, value.before.length)).toEqual(value.before);
    const closure = JSON.parse(after.subarray(value.before.length).toString());
    expect(closure.previousChallengeSha256).toBe("4".repeat(64)); expect(closure).not.toHaveProperty("previousOwnerSha256");
    expect(fileIO.opened).not.toContain(value.spendFile); expect(await readFile(value.spendFile)).toEqual(value.spend);
    const reopened = await InstrumentJournal.open(value.directory, 1000, 0);
    expect(reopened.budget.remaining).toBe(680); expect(reopened.history.resourceStopRequired).toBe(false); await reopened.close();
  });

  it("refuses ambiguous or unbound old ownership and retains locks on older-boot cleanup uncertainty", async () => {
    const value = await fixture(), request = olderBootRequest(value.request);
    const previousChallenge = request.previousChallenge, base = { ...request, previousChallenge: undefined };
    for (const request of [base, { ...value.request, previousChallenge },
      { ...base, previousChallenge: { ...previousChallenge, challenge: { ...previousChallenge.challenge, head: "b".repeat(40) } } }])
      await expect(reconcileKeyFreeDryJournal(value.owner, request)).rejects.toThrow("refused");
    expect(await readFile(value.historyFile)).toEqual(value.before);
    native.olderCleanup.mockReturnValueOnce("4".repeat(64)).mockReturnValueOnce("4".repeat(64))
      .mockImplementationOnce(() => { throw new Error("MUST_NOT_PRINT_SYNTHETIC_CANARY"); });
    await expect(reconcileKeyFreeDryJournal(value.owner, { ...base, previousChallenge })).rejects.toThrow("refused");
    for (const name of ["dry-history.lock", "dry-history.lock.manual"])
      expect((await lstat(path.join(value.directory, name))).isDirectory()).toBe(true);
    expect(await readFile(value.spendFile)).toEqual(value.spend);
  });

  it.each([{ unfinished: true }, { provider: "openai-compatible-chat" as const },
    { inference: "pending" as const }, { inference: "unknown" as const }, { unresolved: false }, { answered: true }])(
    "refuses unfinished, live-provider or inferred cleanup histories: %j", async options => {
      for (const legacy of [false, true]) {
        const value = await fixture(options);
        await expect(reconcileKeyFreeDryJournal(value.owner, legacy ? olderBootRequest(value.request) : value.request)).rejects.toThrow("refused");
        expect(await readFile(value.historyFile)).toEqual(value.before); expect(await readFile(value.spendFile)).toEqual(value.spend);
      }
    });

  it("requires exact public prefix/run/session/source bindings and refuses a live ledger input", async () => {
    const value = await fixture();
    for (const changed of [{ historyPrefixSha256: "0".repeat(64) }, { runId: "another-run" }, { sessionId: "another-session" },
      { previousOwner: { ...value.request.previousOwner, head: "c".repeat(40) } }, { ledger: "live" }, { credential: "MUST_NOT_PRINT_SYNTHETIC_CANARY" }]) {
      await expect(reconcileKeyFreeDryJournal(value.owner, { ...value.request, ...changed })).rejects.toThrow("refused");
      expect(await readFile(value.historyFile)).toEqual(value.before); expect(await readFile(value.spendFile)).toEqual(value.spend);
    }
    expect((await lstat(path.join(value.directory, "dry-history.lock"))).isDirectory()).toBe(true);
  });

  it("refuses active/unknown native cleanup without leaking raw errors or changing a journal", async () => {
    const value = await fixture(); native.cleanup.mockImplementationOnce(() => { throw new Error("MUST_NOT_PRINT_SYNTHETIC_CANARY"); });
    try { await reconcileKeyFreeDryJournal(value.owner, value.request); throw new Error("Unexpected acceptance"); }
    catch (error) { expect(String(error)).toContain("refused"); expect(String(error)).not.toContain("MUST_NOT_PRINT_SYNTHETIC_CANARY"); }
    expect(await readFile(value.historyFile)).toEqual(value.before); expect(await readFile(value.spendFile)).toEqual(value.spend);
  });

  it("never steals an existing recovery or spending lock", async () => {
    const value = await fixture(), manual = path.join(value.directory, "dry-history.lock.manual");
    await mkdir(manual, { mode: 0o700 }); await writeFile(path.join(manual, "owner-sentinel"), "unit-only");
    await expect(reconcileKeyFreeDryJournal(value.owner, value.request)).rejects.toThrow("refused");
    expect(await readFile(path.join(manual, "owner-sentinel"), "utf8")).toBe("unit-only");
    await rm(manual, { recursive: true }); await mkdir(`${value.spendFile}.lock`, { mode: 0o700 });
    await expect(reconcileKeyFreeDryJournal(value.owner, value.request)).rejects.toThrow("refused");
    expect((await lstat(`${value.spendFile}.lock`)).isDirectory()).toBe(true);
    expect(await readFile(value.historyFile)).toEqual(value.before);
  });

  it("keeps both recovery locks if native certainty is lost after the durable append", async () => {
    const value = await fixture(); native.cleanup.mockReturnValueOnce("2".repeat(64)).mockReturnValueOnce("2".repeat(64))
      .mockImplementationOnce(() => { throw new Error("synthetic native uncertainty"); });
    await expect(reconcileKeyFreeDryJournal(value.owner, value.request)).rejects.toThrow("refused");
    expect((await lstat(path.join(value.directory, "dry-history.lock"))).isDirectory()).toBe(true);
    expect((await lstat(path.join(value.directory, "dry-history.lock.manual"))).isDirectory()).toBe(true);
    await expect(InstrumentJournal.open(value.directory, 1000, 0)).rejects.toThrow("Manual reconciliation");
    expect(await readFile(value.spendFile)).toEqual(value.spend);
  });

  it("retains both locks and the durable original if history descriptor closure is uncertain", async () => {
    const value = await fixture(); fileIO.failHistoryClose = true;
    await expect(reconcileKeyFreeDryJournal(value.owner, value.request)).rejects.toThrow("refused");
    const after = await readFile(value.historyFile);
    expect(after.subarray(0, value.before.length)).toEqual(value.before);
    expect(JSON.parse(after.subarray(value.before.length).toString("utf8"))).toMatchObject({ kind: "resource-reconciled" });
    for (const name of ["dry-history.lock", "dry-history.lock.manual"])
      expect((await lstat(path.join(value.directory, name))).isDirectory()).toBe(true);
    await expect(InstrumentJournal.open(value.directory, 1000, 0)).rejects.toThrow("Manual reconciliation");
    expect(await readFile(value.spendFile)).toEqual(value.spend);
  });

  it("refuses linked or insufficiently protected history and spend without reading their targets", async () => {
    for (const name of ["dry-history.jsonl", "dry-spend.jsonl"]) {
      const value = await fixture(), file = path.join(value.directory, name), target = path.join(value.directory, "untouched-unit-canary");
      await writeFile(target, "MUST_NOT_PRINT_SYNTHETIC_CANARY"); await rm(file); await symlink(target, file);
      await expect(reconcileKeyFreeDryJournal(value.owner, value.request)).rejects.toThrow("refused");
      expect(await readFile(target, "utf8")).toBe("MUST_NOT_PRINT_SYNTHETIC_CANARY");
      await rm(file); await writeFile(file, name.startsWith("dry-history") ? value.before : value.spend, { mode: 0o600 }); await chmod(file, 0o644);
      await expect(reconcileKeyFreeDryJournal(value.owner, value.request)).rejects.toThrow("refused");
    }
  });
});
