import { afterEach, describe, expect, it, vi } from "vitest";
import { lstat, readFile } from "node:fs/promises";
import path from "node:path";
import { invokeInstrument } from "./conductor-call";
import { environment, fixture, manifest, settings } from "./conductor-fixtures";
import { InstrumentJournal } from "./instrument-journal";
import type { ProcessAdapter, Settings } from "./conductor-contract";
import { RunHistory } from "./run-history";

const resources: Awaited<ReturnType<typeof fixture>>[] = [];
async function setup(limit = 50_000_000, overrides: Partial<Settings> = { maxAttempts: 2 }) {
  const value = await fixture(limit); resources.push(value);
  await value.journal.append({ kind: "start", manifest: manifest("instrument-a", "a".repeat(40), overrides) });
  return value;
}
afterEach(async () => { vi.useRealTimers(); for (const resource of resources.splice(0)) await resource.cleanup(); });
const payload = { rubric: "Authored instrument rubric.", answer: "Authored instrument answer." };
const input = (journal: InstrumentJournal, env = environment()) => ({ runId: "instrument-a", slot: "call-slot", role: "grader" as const,
  payload, settings: journal.history.settingsFor("instrument-a"), environment: env.adapter, journal });

async function assertResourceStop(journal: InstrumentJournal, directory: string) {
  await journal.append({ kind: "finish", runId: "instrument-a", status: "stopped", instrumentClean: false, failure: "resource-unresolved" });
  const replay = new RunHistory();
  journal.history.events.forEach(event => replay.apply(event));
  expect(replay.unfinished).toBe(false); expect(replay.resourceStopRequired).toBe(true);
  expect(() => replay.apply({ kind: "start", manifest: manifest("next-run") })).toThrow("refuses");
  await journal.close();
  expect((await lstat(path.join(directory, "dry-history.lock"))).isDirectory()).toBe(true);
  await expect(InstrumentJournal.open(directory, 5000, 0)).rejects.toThrow();
}

describe("reservation, retry and process boundaries", () => {
  it("persists maximum spend and attempt identity before an adapter is acquired", async () => {
    const { journal, directory } = await setup(), env = environment(), open = env.adapter.openProcess;
    let priorSpend = "", priorHistory = "";
    env.adapter.openProcess = async (value, signal) => {
      priorSpend = await readFile(path.join(directory, "dry-spend.jsonl"), "utf8");
      priorHistory = await readFile(path.join(directory, "dry-history.jsonl"), "utf8");
      return open(value, signal);
    };
    await invokeInstrument(input(journal, env));
    const reservation = priorSpend.trimEnd().split("\n").map(line => JSON.parse(line)).at(-1);
    const attempt = priorHistory.trimEnd().split("\n").map(line => JSON.parse(line)).at(-1);
    expect(reservation).toMatchObject({ kind: "reserve", maximum: 2000 });
    expect(attempt).toMatchObject({ kind: "attempt", id: reservation.id, maximum: 2000, attempt: 1 });
    expect(journal.budget.remaining).toBe(49_999_998);
  });

  it("holds unknown outcomes at maximum, retries with new IDs, and preserves accounting across reopen", async () => {
    const { journal, directory } = await setup(5000), env = environment(), open = env.adapter.openProcess;
    let first = true;
    env.adapter.openProcess = async (value, signal) => {
      const process = await open(value, signal);
      if (first) { first = false; process.invoke = async () => { throw new Error("simulated uncertain outcome"); }; }
      return process;
    };
    await invokeInstrument(input(journal, env));
    const attempts = journal.history.events.filter(event => event.kind === "attempt");
    expect(attempts).toHaveLength(2); expect(attempts[0].id).not.toBe(attempts[1].id);
    expect(attempts[0].processId).not.toBe(attempts[1].processId);
    expect(journal.budget.remaining).toBe(2998);
    await journal.append({ kind: "finish", runId: "instrument-a", status: "stopped", instrumentClean: false, failure: "adapter-failed" });
    await journal.close();
    const reopened = await InstrumentJournal.open(directory, 5000, 0);
    try {
      expect(reopened.budget.remaining).toBe(2998);
      await expect(reopened.append({ kind: "start", manifest: manifest() })).rejects.toThrow("refuses");
    } finally { await reopened.close(); }
  });

  it("does not refund unknown usage or exceed the cap to retry", async () => {
    const { journal } = await setup(2000), env = environment(), open = env.adapter.openProcess;
    env.adapter.openProcess = async (value, signal) => {
      const process = await open(value, signal); process.invoke = async () => { throw new Error("lost reply"); }; return process;
    };
    await expect(invokeInstrument(input(journal, env))).rejects.toThrow("budget-refused");
    expect(env.processes).toHaveLength(1); expect(journal.budget.remaining).toBe(0);
  });

  it("keeps maximum reserve and stops on incomplete or out-of-bounds usage", async () => {
    for (const usage of [{ complete: false, inputTokens: 1, outputTokens: 1 },
      { complete: true, inputTokens: 1001, outputTokens: 1 }, { complete: true, inputTokens: 1, outputTokens: 1001 }]) {
      const { journal } = await setup(5000), env = environment(), open = env.adapter.openProcess;
      env.adapter.openProcess = async (value, signal) => {
        const process = await open(value, signal); process.invoke = async () => ({ value: {}, usage }); return process;
      };
      await expect(invokeInstrument(input(journal, env))).rejects.toThrow("invalid-result");
      expect(env.processes).toHaveLength(1); expect(journal.budget.remaining).toBe(3000);
    }
  });

  it("does not acquire a process if the durable attempt write fails after reservation", async () => {
    const { journal } = await setup(5000), env = environment();
    vi.spyOn(journal, "append").mockRejectedValueOnce(new Error("simulated disk failure"));
    await expect(invokeInstrument(input(journal, env))).rejects.toThrow("persistence-failed");
    expect(env.processes).toEqual([]); expect(journal.budget.remaining).toBe(3000);
  });

  it("refuses changes to pinned settings before reserving or acquiring a process", async () => {
    const { journal } = await setup(5000), env = environment();
    await expect(invokeInstrument({ ...input(journal, env), settings: { ...settings, maxAttempts: 3 } })).rejects.toThrow("invalid-result");
    expect(journal.budget.remaining).toBe(5000); expect(env.processes).toEqual([]);
    expect(journal.history.events).toHaveLength(1);
  });

  it("stops on unresolved acquisition and disposes a late handle without invoking or retrying it", async () => {
    const { journal, directory } = await setup(5000, { maxAttempts: 3, timeoutMs: 20 }), env = environment();
    let resolve!: (value: ProcessAdapter) => void;
    let requestedId = "";
    env.adapter.openProcess = async ({ id }) => { requestedId = id; return new Promise<ProcessAdapter>(done => { resolve = done; }); };
    const invoke = vi.fn(), close = vi.fn(async () => {});
    const promise = invokeInstrument(input(journal, env));
    await expect(promise).rejects.toThrow("resource-unresolved");
    await assertResourceStop(journal, directory);
    resolve({ id: requestedId, invoke, close });
    await vi.waitFor(() => expect(close).toHaveBeenCalledOnce());
    expect(invoke).not.toHaveBeenCalled(); expect(journal.history.events.filter(event => event.kind === "attempt")).toHaveLength(1);
    expect(journal.budget.remaining).toBe(3000);
    expect(journal.history.resourceStopRequired).toBe(true);
  });

  it("does not retry alongside an unclosed inference process", async () => {
    const { journal, directory } = await setup(5000, { maxAttempts: 3, timeoutMs: 20 }), env = environment(), open = env.adapter.openProcess;
    env.adapter.openProcess = async (value, signal) => {
      const process = await open(value, signal);
      process.invoke = async () => new Promise(() => {}); process.close = async () => new Promise(() => {});
      return process;
    };
    await expect(invokeInstrument(input(journal, env))).rejects.toThrow("resource-unresolved");
    expect(env.processes).toHaveLength(1); expect(journal.budget.remaining).toBe(3000);
    await assertResourceStop(journal, directory);
  });
});
