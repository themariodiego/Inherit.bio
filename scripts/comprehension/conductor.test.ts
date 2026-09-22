import { afterEach, describe, expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { runInstrument, preflightQualifyingRun } from "./conductor";
import { environment, fixture, inputs, manifest } from "./conductor-fixtures";
import { computeInputDigest, createManifest, sha256, taskRubric } from "./conductor-inputs";
import type { BrowserAdapter, DryEnvironment, ProcessAdapter } from "./conductor-contract";

const resources: Awaited<ReturnType<typeof fixture>>[] = [];
async function setup(limit?: number) { const value = await fixture(limit); resources.push(value); return value; }
afterEach(async () => { vi.useRealTimers(); for (const resource of resources.splice(0)) await resource.cleanup(); });

describe("authored comprehension conductor checks", () => {
  it("executes all 300 independent sessions and exactly 30 blind independent regrades without producing qualifying evidence", async () => {
    const { journal, directory } = await setup(), env = environment(), pinned = manifest();
    const result = await runInstrument({ mode: "instrument-dry-run", manifest: pinned, inputs, environment: env.adapter, journal });
    expect(result).toMatchObject({ status: "completed", qualifyingEvidence: false, assessment: { clean: true } });
    expect(result.run.responses).toHaveLength(300);
    expect(new Set(env.browsers).size).toBe(300); expect(new Set(env.processes).size).toBe(630);
    expect(env.closedBrowsers).toEqual(env.browsers); expect(env.closedProcesses).toEqual(env.processes);
    expect(env.calls.filter(call => call.role === "regrader")).toHaveLength(30);
    for (const call of env.calls.filter(call => call.role !== "participant")) {
      expect(Object.keys(call.payload).sort()).toEqual(["answer", "rubric"]);
      if (!("rubric" in call.payload)) throw new Error("Wrong grading payload");
      expect(call.payload.answer).toBe("Authored instrument answer.");
      expect((call.payload.rubric.match(/^## T[0-9]+ —/gm) ?? [])).toHaveLength(1);
      expect(call.payload.rubric).not.toContain(inputs.personas[0].id);
      expect(Object.isFrozen(call.payload)).toBe(true);
    }
    for (const call of env.calls.filter(call => call.role === "participant")) {
      expect(Object.keys(call.payload).sort()).toEqual(["history", "persona", "task"]);
      if (!("history" in call.payload)) throw new Error("Wrong participant payload");
      expect(call.payload.history).toHaveLength(1);
      expect(call.payload.persona).not.toContain("rubric");
    }
    expect(pinned.qualifyingEvidence).toBe(false); expect(preflightQualifyingRun().allowed).toBe(false);
    expect(result.qualification.blockers).toContain("T7-real-fixture-unready");
    const lines = (await readFile(path.join(directory, "dry-history.jsonl"), "utf8")).trimEnd().split("\n").map(line => JSON.parse(line));
    expect(lines.filter(line => line.kind === "session")).toHaveLength(300);
    expect(lines.at(-1)).toMatchObject({ kind: "finish", status: "completed", instrumentClean: true });
  }, 60_000);

  it("pins immutable source digests, preserves the full task criteria, and rejects manifest drift before adapters open", async () => {
    const { journal } = await setup(), env = environment(), pinned = manifest();
    expect(Object.isFrozen(pinned.settings.price)).toBe(true); expect(Object.isFrozen(inputs.patterns.classes)).toBe(true);
    const shared = inputs.rubric.slice(0, inputs.rubric.indexOf("## T1 —"));
    for (const task of inputs.tasks) {
      const slice = taskRubric(inputs.rubric, task.id);
      expect(slice.startsWith(shared)).toBe(true);
      const header = new RegExp(`^## ${task.id} —`, "m");
      const start = inputs.rubric.search(header), next = inputs.rubric.slice(start + 1).search(/^## T[0-9]+ —/m);
      expect(slice.slice(shared.length)).toBe(inputs.rubric.slice(start, next < 0 ? undefined : start + 1 + next));
    }
    const changed = structuredClone(pinned); changed.settings.temperature = 1;
    await expect(runInstrument({ mode: "instrument-dry-run", manifest: changed, inputs, environment: env.adapter, journal })).rejects.toThrow("pinned");
    expect(env.calls).toEqual([]); expect(env.browsers).toEqual([]);
    expect(journal.history.events).toEqual([]);
  });

  it("refuses live mode and non-synthetic adapters before journaling or spending", async () => {
    const { journal } = await setup(), env = environment();
    for (const mode of ["qualifying", "production"]) {
      await expect(runInstrument({ mode: mode as "instrument-dry-run", manifest: manifest(), inputs,
        environment: env.adapter, journal })).rejects.toThrow("blocked");
    }
    await expect(runInstrument({ mode: "instrument-dry-run", manifest: manifest(), inputs,
      environment: { ...env.adapter, kind: "live" } as unknown as DryEnvironment, journal })).rejects.toThrow("blocked");
    expect(journal.budget.remaining).toBe(50_000_000); expect(env.processes).toEqual([]);
  });

  it("stops before a call exceeding the shared cap and retains the completed call's certain charge", async () => {
    const { journal } = await setup(2000), env = environment();
    const result = await runInstrument({ mode: "instrument-dry-run", manifest: manifest(), inputs, environment: env.adapter, journal });
    expect(result).toMatchObject({ status: "stopped", failure: "budget-refused", qualifyingEvidence: false });
    expect(env.processes).toHaveLength(1); expect(env.closedBrowsers).toHaveLength(1);
    expect(journal.budget.remaining).toBe(1998);
  });

  it("rejects reused browser objects instead of counting a renamed context as independent", async () => {
    const { journal } = await setup(), env = environment(), open = env.adapter.openBrowser;
    let reused: BrowserAdapter | undefined;
    env.adapter.openBrowser = async (input, signal) => {
      reused ??= await open(input, signal); reused.id = input.id; return reused;
    };
    const result = await runInstrument({ mode: "instrument-dry-run", manifest: manifest(), inputs, environment: env.adapter, journal });
    expect(result).toMatchObject({ status: "stopped", failure: "invalid-result" });
    expect(result.run.responses).toHaveLength(1);
  });

  it("rejects reused inference objects and still closes the acquired browser", async () => {
    const { journal } = await setup(), env = environment(), open = env.adapter.openProcess;
    let reused: ProcessAdapter | undefined;
    env.adapter.openProcess = async (input, signal) => {
      reused ??= await open(input, signal); reused.id = input.id; return reused;
    };
    const result = await runInstrument({ mode: "instrument-dry-run", manifest: manifest(), inputs, environment: env.adapter, journal });
    expect(result.status).toBe("stopped"); expect(env.calls).toHaveLength(1); expect(env.closedBrowsers).toHaveLength(1);
  });

  it("refuses invented confirmation exclusions", async () => {
    const { journal } = await setup(), env = environment(), open = env.adapter.openBrowser;
    env.adapter.openBrowser = async (input, signal) => {
      const browser = await open(input, signal);
      browser.record = async () => ({ completed: true, path: ["/overview"], actions: 0, entries: 0, confirmationExclusions: ["unregistered"] });
      return browser;
    };
    const result = await runInstrument({ mode: "instrument-dry-run", manifest: manifest(), inputs, environment: env.adapter, journal });
    expect(result).toMatchObject({ status: "stopped", failure: "invalid-result" });
    expect(env.calls.filter(call => call.role === "grader")).toEqual([]);
  });

  it("refuses self-reported completion metadata instead of sending it to the grader", async () => {
    const { journal } = await setup(), env = environment(), open = env.adapter.openProcess;
    env.adapter.openProcess = async (input, signal) => {
      const process = await open(input, signal);
      process.invoke = async () => ({ value: { kind: "finish", answer: "Authored answer.", completed: true },
        usage: { complete: true, inputTokens: 1, outputTokens: 1 } });
      return process;
    };
    const result = await runInstrument({ mode: "instrument-dry-run", manifest: manifest(), inputs, environment: env.adapter, journal });
    expect(result).toMatchObject({ status: "stopped", failure: "invalid-result" });
    expect(env.processes).toHaveLength(1); expect(env.closedBrowsers).toHaveLength(1);
  });

  it("bounds participant turns and preserves their partial trace without guessing an answer", async () => {
    const { journal } = await setup(), env = environment(), open = env.adapter.openProcess;
    env.adapter.openProcess = async (input, signal) => {
      const process = await open(input, signal);
      process.invoke = async () => ({ value: { kind: "click", target: "next" },
        usage: { complete: true, inputTokens: 1, outputTokens: 1 } });
      return process;
    };
    const result = await runInstrument({ mode: "instrument-dry-run", manifest: manifest("limited", "a".repeat(40), { maxSteps: 2 }),
      inputs, environment: env.adapter, journal });
    expect(result).toMatchObject({ status: "stopped", failure: "step-bound" });
    expect(result.run.responses).toEqual([]); expect(env.processes).toHaveLength(2); expect(env.closedBrowsers).toHaveLength(1);
    const traces = journal.history.events.filter(event => event.kind === "trace");
    expect(traces.filter(event => event.phase === "observed")).toHaveLength(2);
    expect(traces.filter(event => event.phase === "action")).toHaveLength(2);
    expect(traces.at(-1)).toMatchObject({ phase: "ended", value: { closed: true, answer: null } });
  });

  it("counts browser events separately from entry and does not let the answer override failed completion", async () => {
    const { journal } = await setup(), env = environment(), open = env.adapter.openBrowser;
    env.adapter.openBrowser = async (input, signal) => {
      const browser = await open(input, signal);
      browser.record = async () => ({ completed: input.taskId !== "T1", path: ["/overview"],
        actions: input.taskId === "T9" ? 7 : 6, entries: 25, confirmationExclusions: [] });
      return browser;
    };
    const result = await runInstrument({ mode: "instrument-dry-run", manifest: manifest(), inputs, environment: env.adapter, journal });
    expect(result).toMatchObject({ status: "completed", assessment: { clean: false, successes: { T1: 0, T9: 0 } } });
    expect(result.run.responses.every(response => response.entries === 25)).toBe(true);
    expect(env.calls.filter(call => call.role !== "participant").every(call => Object.keys(call.payload).length === 2)).toBe(true);
  }, 60_000);

  it("pins the detector used for assessment rather than reloading a mutable detector after the run", async () => {
    const { journal } = await setup(), env = environment();
    const planted = { ...structuredClone(inputs) };
    planted.patterns.classes.find(klass => klass.id === "T5")!.patterns = ["authored instrument answer"];
    // Explicit fabricated inputs remain instrument-only. The changed input pin
    // makes this a different instrument rather than silently changing a run.
    planted.pins.patterns = sha256(JSON.stringify(planted.patterns)); planted.inputDigest = computeInputDigest(planted);
    const pinned = createManifest(planted, { runId: "detector-check", revision: "a".repeat(40), samplingSeed: "b".repeat(64), settings: manifest().settings });
    const result = await runInstrument({ mode: "instrument-dry-run", manifest: pinned, inputs: planted, environment: env.adapter, journal });
    expect(result).toMatchObject({ status: "completed", qualifyingEvidence: false, assessment: { clean: false } });
    if ("assessment" in result) expect(result.assessment?.failures.filter(failure => failure.startsWith("T5/"))).toHaveLength(30);
  }, 60_000);
});
