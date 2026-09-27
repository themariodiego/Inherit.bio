import { afterEach, describe, expect, it, vi } from "vitest";
import { lstat, readFile } from "node:fs/promises";
import path from "node:path";
import { runInstrument } from "./conductor";
import { environment, fixture, inputs, manifest } from "./conductor-fixtures";
import type { BrowserAdapter } from "./conductor-contract";
import { InstrumentJournal } from "./instrument-journal";
import { RunHistory } from "./run-history";

const resources: Awaited<ReturnType<typeof fixture>>[] = [];
afterEach(async () => { for (const resource of resources.splice(0)) await resource.cleanup(); });

describe("unresolved resource history", () => {
  it.each(["browser-acquisition", "browser-close", "process-close"] as const)("keeps %s uncertainty across finish, close and replay", async failure => {
    const resource = await fixture(); resources.push(resource);
    const { journal, directory } = resource, env = environment(), openBrowser = env.adapter.openBrowser;
    let deliverLate: (() => Promise<void>) | undefined;
    const lateClose = vi.fn(async () => {}), lateObserve = vi.fn();
    if (failure === "browser-acquisition") {
      env.adapter.openBrowser = async ({ id }) => new Promise<BrowserAdapter>(resolve => {
        deliverLate = async () => {
          resolve({ id, close: lateClose, observe: lateObserve, async act() {}, async record() {} });
          await vi.waitFor(() => expect(lateClose).toHaveBeenCalledOnce());
        };
      });
    } else if (failure === "browser-close") {
      env.adapter.openBrowser = async (input, signal) => {
        const browser = await openBrowser(input, signal);
        browser.close = async () => { throw new Error("authored close failure"); }; return browser;
      };
    } else {
      const open = env.adapter.openProcess;
      env.adapter.openProcess = async (input, signal) => {
        const process = await open(input, signal);
        process.close = async () => { throw new Error("authored close failure"); }; return process;
      };
    }
    const result = await runInstrument({ mode: "instrument-dry-run", manifest: manifest("uncertain", "a".repeat(40), { timeoutMs: 20 }),
      inputs, environment: env.adapter, journal });
    expect(result).toMatchObject({ status: "stopped", failure: "resource-unresolved", qualifyingEvidence: false });
    expect(journal.history.unfinished).toBe(false); expect(journal.history.resourceStopRequired).toBe(true);
    const next = environment();
    await expect(runInstrument({ mode: "instrument-dry-run", manifest: manifest("next-run"), inputs, environment: next.adapter, journal })).rejects.toThrow("refuses");
    expect(next.browsers).toEqual([]); expect(next.processes).toEqual([]);
    await journal.close();
    expect((await lstat(path.join(directory, "dry-history.lock"))).isDirectory()).toBe(true);
    await expect(InstrumentJournal.open(directory, 50_000_000, 0)).rejects.toThrow();
    const events = (await readFile(path.join(directory, "dry-history.jsonl"), "utf8")).trimEnd().split("\n").slice(1).map(line => JSON.parse(line));
    const replay = new RunHistory(); events.forEach(event => replay.apply(event));
    expect(replay.resourceStopRequired).toBe(true);
    expect(() => replay.apply({ kind: "start", manifest: manifest("next-run") })).toThrow("refuses");
    if (deliverLate) {
      await deliverLate();
      expect(lateObserve).not.toHaveBeenCalled(); expect(journal.history.resourceStopRequired).toBe(true);
      expect(env.calls).toEqual([]);
    }
  });
});
