import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createManifest, loadConductorInputs } from "./conductor-inputs";
import { InstrumentJournal } from "./instrument-journal";
import type { DryEnvironment, Payload, Role, Settings } from "./conductor-contract";

/** Authored local test doubles only; none of these answers are participant evidence. */
export const inputs = loadConductorInputs();
export const settings: Settings = { temperature: 0, maxSteps: 3, maxAttempts: 1, timeoutMs: 1000,
  maximumInputTokens: 1000, maximumOutputTokens: 1000,
  price: { inputMicroDollarsPerMillion: 1_000_000, outputMicroDollarsPerMillion: 1_000_000 } };
export const manifest = (runId = "instrument-a", revision = "a".repeat(40), overrides: Partial<Settings> = {}) =>
  createManifest(inputs, { runId, revision, samplingSeed: "b".repeat(64), settings: { ...settings, ...overrides } });

export async function fixture(limit = 50_000_000, otherCosts = 0) {
  const directory = await mkdtemp(path.join(tmpdir(), "inherit-comprehension-instrument-"));
  const journal = await InstrumentJournal.open(directory, limit, otherCosts);
  return { directory, journal, async cleanup() { await journal.close(); await rm(directory, { recursive: true, force: true }); } };
}

export function environment() {
  const calls: { id: string; role: Role; payload: Payload }[] = [];
  const browsers: string[] = [], processes: string[] = [], closedBrowsers: string[] = [], closedProcesses: string[] = [];
  const adapter: DryEnvironment = {
    kind: "synthetic-local-adapter",
    async openBrowser({ id }) {
      browsers.push(id);
      return { id, async observe() { return { path: "/overview", visibleText: "Authored synthetic view.", controls: ["next"] }; },
        async act() {}, async record() { return { completed: true, path: ["/overview"], actions: 6, entries: 1, confirmationExclusions: [] }; },
        async close() { closedBrowsers.push(id); } };
    },
    async openProcess({ id, role }) {
      processes.push(id);
      return { id, async invoke(payload) {
        calls.push({ id, role, payload });
        return { value: role === "participant" ? { kind: "finish", answer: "Authored instrument answer." }
          : { passed: true, prohibited: false, noRouteFound: false }, usage: { complete: true, inputTokens: 1, outputTokens: 1 } };
      }, async close() { closedProcesses.push(id); } };
    },
  };
  return { adapter, calls, browsers, processes, closedBrowsers, closedProcesses };
}
