import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import bindings from "./bindings.json";
import { runLive } from "./conductor";
import { browserRecordSchema } from "./conductor-contract";
import { environment, fixture, inputs, manifest } from "./conductor-fixtures";
import { createLiveManifest } from "./conductor-inputs";
import { currentNativeReadSession, freshComprehensionSessions, type FreshComprehensionSimulation, type ParticipantCInput } from "./fresh-native-session";
import type { LiveSession } from "./live-browser";
import { refuseFreshSetup } from "./fresh-t6-browser";
import { freshRuntimeCommandFailure } from "./fresh-t6-resources";
import { ciRuntimeCleanupFailure, ciRuntimeDockerFailure, ciRuntimeSetupFailure } from "../ci-browser-runtime-failure";

// Pure injected lifetime controls only. No browser, Supabase, provider or model
// is launched, and no synthetic answer is participant evidence.
const signal = () => new AbortController().signal;
describe("closed setup diagnosis preserves failed ownership outcomes", () => {
  const canary = "PRIVATE_CANARY_NEVER_PRINT";
  it("reports the exact refused stage after successful cleanup without leaking raw failure values", async () => {
    const close = vi.fn(async () => {}), lines: string[] = [];
    await expect(refuseFreshSetup("bootstrap-keys", new Error(canary), close, line => lines.push(line)))
      .rejects.toThrow("setup refused");
    expect(close).toHaveBeenCalledTimes(1);
    expect(lines.map(line => JSON.parse(line))).toEqual([{ kind: "fresh-native-setup-failure", stage: "bootstrap-keys",
      classification: "setup-refused", exitCode: null, signal: null, cleanup: "complete" }]);
    expect(lines.join()).not.toContain(canary);
  });
  it("retains command exit classification and cleanup uncertainty as separate facts", async () => {
    const cleanupError = new Error(canary), lines: string[] = [];
    await expect(refuseFreshSetup("reference-seed", freshRuntimeCommandFailure("exit-nonzero", 7),
      async () => { throw cleanupError; }, line => lines.push(line))).rejects.toBe(cleanupError);
    expect(lines.map(line => JSON.parse(line))).toEqual([{ kind: "fresh-native-setup-failure", stage: "reference-seed",
      classification: "exit-nonzero", exitCode: 7, signal: null, cleanup: "uncertain" }]);
    expect(lines.join()).not.toContain(canary);
    expect(lines[0].length).toBeLessThan(256);
  });
  it("serializes the precise runtime failure and separate uncertain cleanup without raw exceptions", async () => {
    const operation = ciRuntimeSetupFailure("tls-bootstrap", ciRuntimeDockerFailure(Object.assign(new Error(canary), { status: 7, stderr: canary })));
    const cleanup = ciRuntimeSetupFailure("cleanup-ownership", new Error(canary));
    const lines: string[] = [];
    await expect(refuseFreshSetup("runtime-preflight", ciRuntimeCleanupFailure(operation, cleanup),
      async () => { throw cleanup; }, line => lines.push(line))).rejects.toBe(cleanup);
    expect(lines.map(line => JSON.parse(line))).toEqual([{ kind: "fresh-native-setup-failure", stage: "runtime-preflight",
      runtimeStage: "tls-bootstrap", classification: "exit-nonzero", exitCode: 7, signal: null,
      cleanupFailure: { runtimeStage: "cleanup-ownership", classification: "setup-refused", exitCode: null, signal: null }, cleanup: "uncertain" }]);
    expect(lines.join()).not.toContain(canary);
  });
  it("still yields resource-unresolved, zero responses and no inference when fresh setup fails", async () => {
    const resource = await fixture();
    try {
      const original = environment(), lines: string[] = [];
      const pinned = manifest();
      const live = createLiveManifest(inputs, { ...pinned, kind: "smoke", taskIds: ["T6"], personaIds: pinned.personaIds.slice(0, 1),
        build: { baseUrl: "http://localhost:3100", buildId: "synthetic-control-build", jurisdiction: "TEST-LOCAL" },
        inference: { label: "local/deterministic-stub", provider: "local-deterministic-stub" }, modelIdentity: "synthetic-control",
        skipped: [], blockers: ["synthetic-lifecycle-control"] });
      const result = await runLive({ inputs, manifest: live, journal: resource.journal, modelIdentity: "synthetic-control",
        environment: { ...original.adapter, kind: "live-local-build", openBrowser: () => refuseFreshSetup("runtime-preflight",
          new Error(canary), async () => {}, line => lines.push(line)) } });
      expect(result).toMatchObject({ status: "stopped", failure: "resource-unresolved", qualifyingEvidence: false });
      expect(result.run.responses).toEqual([]); expect(original.calls).toEqual([]);
      expect(resource.journal.history.resourceStopRequired).toBe(true);
      expect(lines.join()).not.toContain(canary);
    } finally { await resource.cleanup(); }
  });
});
const input = (taskId: ParticipantCInput["taskId"] = "T6"): ParticipantCInput => {
  const task = bindings.tasks.find(task => task.id === taskId)!;
  return { id: randomUUID(), taskId, account: task.account, fixtures: task.fixtures };
};
function session(id: string, events: string[] = []): LiveSession {
  return { id,
    observe: vi.fn(async () => { events.push("observe"); return { path: "/embryos/compare", visibleText: "Synthetic control", controls: [] }; }),
    act: vi.fn(async () => { events.push("act"); }),
    record: vi.fn(async () => { events.push("record"); return { completed: true, path: ["/overview", "/embryos/compare"], actions: 1, entries: 0, confirmationExclusions: [] }; }),
    close: vi.fn(async () => { events.push("session-close"); }),
    diagnostics: () => ({ entryChannels: [], failedActions: 0, refusedValues: 0, typedEmails: [] }),
    paths: () => ["/overview", "/embryos/compare"],
  };
}
function simulation(value: ParticipantCInput, events: string[] = []): FreshComprehensionSimulation {
  return { ...(value.account === "participant-c" ? { publication: { ownerId: randomUUID(), cohortId: randomUUID() } } : {}),
    openReadSession: vi.fn(async () => session(value.id, events)),
    close: vi.fn(async () => { events.push("stack-close"); }),
  };
}

describe("exclusive complete-round lifetimes", () => {
  it("conducts all 300 original pairs with distinct native accounts/publications and blind 30 regrades", async () => {
    const resource = await fixture();
    try {
      const original = environment(), owned: FreshComprehensionSimulation[] = [];
      const open = freshComprehensionSessions(async value => {
        const prepared = simulation(value); owned.push(prepared);
        const browser = await original.adapter.openBrowser(value, signal());
        prepared.openReadSession = async () => ({ ...browser, record: async () => browserRecordSchema.parse(await browser.record()), diagnostics: session(value.id).diagnostics, paths: () => ["/overview"] });
        return prepared;
      });
      const pinned = manifest();
      const live = createLiveManifest(inputs, { ...pinned, kind: "live-run", taskIds: inputs.tasks.map(task => task.id),
        build: { baseUrl: "http://localhost:3100", buildId: "synthetic-control-build", jurisdiction: "TEST-LOCAL" },
        inference: { label: "local/deterministic-stub", provider: "local-deterministic-stub" }, modelIdentity: "synthetic-control",
        skipped: [], blockers: ["synthetic-lifecycle-control"] });
      const result = await runLive({ inputs, manifest: live, journal: resource.journal, modelIdentity: "synthetic-control",
        environment: { ...original.adapter, kind: "live-local-build", openBrowser: open } });
      expect(result).toMatchObject({ status: "completed", qualifyingEvidence: false });
      expect(result.run.responses).toHaveLength(300);
      expect(new Set(result.run.responses.map(row => row.sessionId)).size).toBe(300);
      expect(owned).toHaveLength(300);
      expect(owned.every(owner => vi.mocked(owner.close).mock.calls.length === 1)).toBe(true);
      const native = owned.flatMap(owner => owner.publication ? [owner.publication] : []);
      expect(native).toHaveLength(60);
      expect(new Set(native.map(row => row.ownerId)).size).toBe(60);
      expect(new Set(native.map(row => row.cohortId)).size).toBe(60);
      expect(original.calls.filter(call => call.role === "regrader")).toHaveLength(30);
      for (const call of original.calls.filter(call => call.role !== "participant")) {
        expect(Object.keys(call.payload).sort()).toEqual(["answer", "rubric"]);
      }
      expect(original.closedBrowsers).toEqual(original.browsers);
    } finally { await resource.cleanup(); }
  }, 60_000);

  it("closes the independent read context before the stack, once even with concurrent close requests", async () => {
    const events: string[] = [], value = input();
    const prepared = simulation(value, events), acquire = vi.fn(async () => prepared);
    const open = freshComprehensionSessions(acquire), first = await open(value, signal());
    await expect(open(input("T7"), signal())).rejects.toThrow("overlaps");
    expect(acquire).toHaveBeenCalledTimes(1);
    await Promise.all([first.close(), first.close()]);
    expect(events).toEqual(["session-close", "stack-close"]);
    await expect(open(value, signal())).rejects.toThrow("reuses");
  });

  it.each(["ownerId", "cohortId"] as const)("refuses a reused native %s rather than a fresh browser over old authority", async field => {
    const first = input(), second = input("T7"), original = simulation(first), next = simulation(second);
    next.publication![field] = original.publication![field];
    const owners = [original, next], open = freshComprehensionSessions(async () => owners.shift()!);
    await (await open(first, signal())).close();
    await expect(open(second, signal())).rejects.toThrow("identity reused");
    expect(next.openReadSession).not.toHaveBeenCalled(); expect(next.close).toHaveBeenCalledTimes(1);
  });

  it.each(["session", "stack"])("retains exclusivity after uncertain %s cleanup", async failed => {
    const value = input(), prepared = simulation(value), reader = session(value.id);
    prepared.openReadSession = async () => reader;
    if (failed === "session") reader.close = vi.fn(async () => { throw new Error("uncertain session"); });
    else prepared.close = vi.fn(async () => { throw new Error("uncertain stack"); });
    const acquire = vi.fn(async () => prepared), open = freshComprehensionSessions(acquire);
    const actual = await open(value, signal());
    await expect(actual.close()).rejects.toThrow("uncertain");
    await expect(open(input("T7"), signal())).rejects.toThrow("overlaps");
    expect(acquire).toHaveBeenCalledTimes(1);
  });

  it("does not open a read/model session after cancellation and closes any returned owner", async () => {
    const controller = new AbortController(), value = input("T7"), prepared = simulation(value);
    const open = freshComprehensionSessions(async () => { controller.abort(); return prepared; });
    await expect(open(value, controller.signal)).rejects.toThrow();
    expect(prepared.openReadSession).not.toHaveBeenCalled(); expect(prepared.close).toHaveBeenCalledTimes(1);
  });

  it("refuses unbound account/fixture/identity before resource acquisition, and an unreturned owner remains unresolved", async () => {
    const acquire = vi.fn(async () => { throw new Error("uncertain acquisition"); }), open = freshComprehensionSessions(acquire);
    for (const changed of [{ ...input(), account: "participant-a" }, { ...input(), fixtures: [] }, { ...input(), id: "unbound" }])
      await expect(open(changed, signal())).rejects.toThrow("Exact bound");
    expect(acquire).not.toHaveBeenCalled();
    await expect(open(input(), signal())).rejects.toThrow("uncertain acquisition");
    await expect(open(input("T7"), signal())).rejects.toThrow("overlaps");
    expect(acquire).toHaveBeenCalledTimes(1);
  });
});

describe("native currentness around every real read/action", () => {
  it.each(["observe", "act", "record"] as const)("surrounds %s with current reads and still permits cleanup after drift", async method => {
    const events: string[] = [], reader = session(randomUUID(), events), current = vi.fn(async () => { events.push("current"); });
    const wrapped = currentNativeReadSession(reader, current);
    if (method === "act") await wrapped.act({ kind: "click", target: "c1" }); else await wrapped[method]();
    expect(events).toEqual(["current", method, "current"]);
    current.mockRejectedValueOnce(new Error("native publication changed"));
    if (method === "act") await expect(wrapped.act({ kind: "click", target: "c1" })).rejects.toThrow("changed");
    else await expect(wrapped[method]()).rejects.toThrow("changed");
    expect(reader[method]).toHaveBeenCalledTimes(1);
    await wrapped.close(); expect(reader.close).toHaveBeenCalledTimes(1);
  });
  it("refuses a completed record when publication changes during its actual read", async () => {
    const reader = session(randomUUID()), current = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("native drift"));
    await expect(currentNativeReadSession(reader, current).record()).rejects.toThrow("native drift");
    expect(reader.record).toHaveBeenCalledTimes(1);
  });
});
