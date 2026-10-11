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
  it("retains the exact Storage or browser transport boundary without exposing assertion values", async () => {
    const lines: string[] = [];
    const operation = ciRuntimeSetupFailure("transport-api-headers", new SyntaxError(canary));
    await expect(refuseFreshSetup("storage-proxy", ciRuntimeSetupFailure("storage-browser-transport", operation),
      async () => {}, line => lines.push(line))).rejects.toThrow("setup refused");
    expect(lines.map(line => JSON.parse(line))).toEqual([{ kind: "fresh-native-setup-failure", stage: "storage-proxy",
      runtimeStage: "transport-api-headers", classification: "invalid-response", exitCode: null, signal: null, cleanup: "complete" }]);
    expect(lines.join()).not.toContain(canary);
  });
  it("preserves both a refused provider check and uncertain proxy cleanup", async () => {
    const operation = ciRuntimeSetupFailure("storage-provider-denial", new Error(canary));
    const cleanup = ciRuntimeSetupFailure("storage-proxy-cleanup", new Error(canary));
    const lines: string[] = [];
    await expect(refuseFreshSetup("storage-proxy", ciRuntimeCleanupFailure(operation, cleanup),
      async () => {}, line => lines.push(line))).rejects.toThrow("setup refused");
    expect(lines.map(line => JSON.parse(line))).toEqual([{ kind: "fresh-native-setup-failure", stage: "storage-proxy",
      runtimeStage: "storage-provider-denial", classification: "setup-refused", exitCode: null, signal: null,
      cleanupFailure: { runtimeStage: "storage-proxy-cleanup", classification: "setup-refused", exitCode: null, signal: null }, cleanup: "complete" }]);
    expect(lines.join()).not.toContain(canary);
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


import { emitOwnedFreshSetupFailure } from "./fresh-t6-browser";
import { createHostedBootstrapDiagnostics, HOSTED_BOOTSTRAP_PREFIX } from "./hosted-owned-diagnostics";

// These observe the real closed refusal producer with injected lifetime only.
// No native/browser/model process or synthetic participant evidence is created.
describe("owned later setup diagnostics remain separate from the original refusal", () => {
  const stages = ["stack-acquisition", "bootstrap-keys", "reference-seed", "upload-capacity", "runtime-preflight",
    "storage-proxy", "app-configuration", "mail-capture", "main-app-ready", "embryo-app-ready", "chromium-launch",
    "build-jurisdiction", "native-embryo-publication"] as const;
  it.each(stages)("selects only the registered %s stage through physical fragmented frames", stage => {
    const capture = createHostedBootstrapDiagnostics(), lines: string[] = [];
    const original = freshRuntimeCommandFailure("exit-nonzero", 7);
    emitOwnedFreshSetupFailure(stage, original, "unreturned", line => {
      lines.push(line);
      for (const byte of Buffer.from(line + "\n")) capture.push(Uint8Array.of(byte));
    });
    expect(lines).toHaveLength(1);expect(Buffer.byteLength(lines[0])).toBeLessThanOrEqual(512);
    expect(capture.finish()).toEqual([{ stage: `session-${stage}`, classification: "exit-nonzero", exitCode: 7,
      signal: null, cleanup: "unreturned" }]);
    expect(() => { throw original; }).toThrow(original);
  });
  it("retains exact legacy setup output and failed outcome after actual injected cleanup completes", async () => {
    const legacy: string[] = [], closed: string[] = [], capture = createHostedBootstrapDiagnostics();
    const close = vi.fn(async () => {});
    await expect(refuseFreshSetup("native-embryo-publication", new Error("synthetic-private-canary"), close,
      line => legacy.push(line), line => { closed.push(line);capture.push(Buffer.from(line + "\n")); }))
      .rejects.toThrow("Fresh comprehension setup refused; no inference was started");
    expect(close).toHaveBeenCalledTimes(1);
    expect(legacy.map(line => JSON.parse(line))).toEqual([{ kind: "fresh-native-setup-failure", stage: "native-embryo-publication",
      classification: "setup-refused", exitCode: null, signal: null, cleanup: "complete" }]);
    expect(closed).toHaveLength(1);
    expect(capture.finish()).toEqual([{ stage: "session-native-embryo-publication", classification: "setup-refused",
      exitCode: null, signal: null, cleanup: "complete" }]);
    expect(closed.join()).not.toContain("synthetic-private-canary");
  });
  it("keeps the actual cleanup refusal identity while projecting only the original operation's closed fields", async () => {
    const legacy: string[] = [], capture = createHostedBootstrapDiagnostics();
    const operation = ciRuntimeSetupFailure("transport-api-headers", new SyntaxError("synthetic-private-canary"));
    const cleanup = ciRuntimeSetupFailure("cleanup-ownership", new Error("synthetic-private-canary"));
    const original = ciRuntimeCleanupFailure(operation, cleanup);
    await expect(refuseFreshSetup("storage-proxy", original, async () => { throw cleanup; }, line => legacy.push(line),
      line => { expect(line).not.toMatch(/runtimeStage|cleanupFailure|synthetic-private-canary/);capture.push(Buffer.from(line + "\n")); }))
      .rejects.toBe(cleanup);
    expect(legacy.map(line => JSON.parse(line))).toEqual([{ kind: "fresh-native-setup-failure", stage: "storage-proxy",
      runtimeStage: "transport-api-headers", classification: "invalid-response", exitCode: null, signal: null,
      cleanupFailure: { runtimeStage: "cleanup-ownership", classification: "setup-refused", exitCode: null, signal: null }, cleanup: "uncertain" }]);
    expect(capture.finish()).toEqual([{ stage: "session-storage-proxy", classification: "setup-refused",
      exitCode: null, signal: null, cleanup: "uncertain" }]);
  });
  it.each([false, true])("never substitutes failed diagnostic I/O for original cleanup outcome %s", async uncertain => {
    const cleanup = new Error("actual-cleanup-control");
    const result = refuseFreshSetup("mail-capture", freshRuntimeCommandFailure("exit-nonzero", 9),
      async () => { if (uncertain) throw cleanup; }, () => {}, () => { throw new Error("synthetic-private-canary"); });
    if (uncertain) await expect(result).rejects.toBe(cleanup);
    else await expect(result).rejects.toThrow("Fresh comprehension setup refused; no inference was started");
  });
  it("does not read arbitrary exception fields or admit an unknown stage", () => {
    const getter = vi.fn(() => { throw new Error("synthetic-private-canary"); }), original = {};
    for (const key of ["message", "stack", "stdout", "stderr", "classification", "exitCode", "signal", "observation"])
      Object.defineProperty(original, key, { get: getter });
    const capture = createHostedBootstrapDiagnostics(), emit = vi.fn((line: string) => capture.push(Buffer.from(line + "\n")));
    emitOwnedFreshSetupFailure("reference-seed", original, "complete", emit);
    expect(capture.finish()).toEqual([{ stage: "session-reference-seed", classification: "setup-refused",
      exitCode: null, signal: null, cleanup: "complete" }]);
    expect(getter).not.toHaveBeenCalled();emit.mockClear();
    emitOwnedFreshSetupFailure("synthetic-private-canary" as Parameters<typeof emitOwnedFreshSetupFailure>[0], original, "complete", emit);
    expect(emit).not.toHaveBeenCalled();expect(getter).not.toHaveBeenCalled();
  });
  it("never selects plain setup JSON, unknown expanded fields or later bytes after EOF", () => {
    const capture = createHostedBootstrapDiagnostics();
    capture.push(Buffer.from(JSON.stringify({ kind: "fresh-native-setup-failure", stage: "mail-capture",
      classification: "setup-refused", exitCode: null, signal: null, cleanup: "complete" }) + "\n"));
    capture.push(Buffer.from(HOSTED_BOOTSTRAP_PREFIX + JSON.stringify({ stage: "session-mail-capture",
      classification: "setup-refused", exitCode: null, signal: null, cleanup: "complete", observation: "synthetic-private-canary" }) + "\n"));
    expect(capture.finish()).toEqual([]);
    emitOwnedFreshSetupFailure("mail-capture", new Error("synthetic-private-canary"), "complete",
      line => capture.push(Buffer.from(line + "\n")));
    expect(capture.finish()).toEqual([]);
  });
});


import { OwnedAppReadinessFailure } from "./app-readiness";
it("projects a genuine closed readiness refusal without forwarding its nested observation", async () => {
  const failure = new OwnedAppReadinessFailure({ exitCode: 1, signalCode: null }, 3100, "child-exited", null, []);
  const legacy: string[] = [], capture = createHostedBootstrapDiagnostics();
  await expect(refuseFreshSetup("main-app-ready", failure, async () => {}, line => legacy.push(line),
    line => { expect(line).not.toMatch(/appReadiness|launcher|port|reason|responseStatus/);capture.push(Buffer.from(line + "\n")); }))
    .rejects.toThrow("Fresh comprehension setup refused; no inference was started");
  expect(legacy.map(line => JSON.parse(line))).toEqual([{ kind: "fresh-native-setup-failure", stage: "main-app-ready",
    classification: "setup-refused", exitCode: null, signal: null, cleanup: "complete", appReadiness: failure.observation }]);
  expect(capture.finish()).toEqual([{ stage: "session-main-app-ready", classification: "setup-refused",
    exitCode: null, signal: null, cleanup: "complete" }]);
});

// Pure real-wrapper controls: no native/browser/provider/model execution.
import { emitHostedBootstrapFailure } from "./hosted-owned-diagnostics";
import { freshRuntimeFailureClassification } from "./fresh-t6-resources";
import type { FreshSessionSetupDiagnostic } from "./fresh-native-session";
const boundaryStages = ["session-binding", "session-exclusivity", "session-cancellation", "session-acquisition",
  "session-publication-binding", "session-read-open", "session-read-identity", "session-cleanup"] as const;
function boundaryCapture(events: string[] = []) {
  const capture = createHostedBootstrapDiagnostics();
  const report: FreshSessionSetupDiagnostic = (stage, error, cleanup) => {
    events.push(`report:${stage}`);
    emitHostedBootstrapFailure(stage, freshRuntimeFailureClassification(error), cleanup, line => {
      expect(Buffer.byteLength(line)).toBeLessThanOrEqual(512);
      expect(line).not.toContain("synthetic-private-boundary-canary");
      for (const byte of Buffer.from("\n" + line + "\n")) capture.push(Uint8Array.of(byte));
    });
  };
  return { report, finish: () => capture.finish() };
}
describe("closed actual session wrapper refusal boundaries", () => {
  it.each(boundaryStages)("accepts only the fixed %s metadata in fragmented physical frames", stage => {
    const recorded = boundaryCapture();
    recorded.report(stage, freshRuntimeCommandFailure("exit-nonzero", 7), "unreturned");
    expect(recorded.finish()).toEqual([{ stage, classification: "exit-nonzero", exitCode: 7, signal: null, cleanup: "unreturned" }]);
  });
  it.each(["account", "fixtures", "identity"] as const)("retains genuine %s refusal before any acquisition", async mode => {
    const recorded = boundaryCapture(), acquire = vi.fn(async (value: ParticipantCInput) => simulation(value));
    const original = input();
    const value = { ...original, ...(mode === "account" ? { account: "participant-a" } : {}),
      ...(mode === "fixtures" ? { fixtures: [] } : {}), ...(mode === "identity" ? { id: "unbound" } : {}) };
    await expect(freshComprehensionSessions(acquire, recorded.report)(value, signal())).rejects.toThrow("Exact bound");
    expect(acquire).not.toHaveBeenCalled();
    expect(recorded.finish()).toEqual([{ stage: "session-binding", classification: "setup-refused", exitCode: null, signal: null, cleanup: "not-started" }]);
  });
  it("retains actual overlapping-session refusal without closing or reacquiring the first owner", async () => {
    const value = input(), prepared = simulation(value), recorded = boundaryCapture();
    const acquire = vi.fn(async () => prepared), open = freshComprehensionSessions(acquire, recorded.report);
    const actual = await open(value, signal());
    await expect(open(input("T7"), signal())).rejects.toThrow("overlaps");
    expect(acquire).toHaveBeenCalledTimes(1); expect(prepared.close).not.toHaveBeenCalled();
    expect(recorded.finish()).toEqual([{ stage: "session-exclusivity", classification: "setup-refused", exitCode: null, signal: null, cleanup: "not-started" }]);
    await actual.close(); expect(prepared.close).toHaveBeenCalledTimes(1);
  });
  it("records an initially cancelled signal without acquiring any resource", async () => {
    const controller = new AbortController(), original = new Error("synthetic-private-boundary-canary");
    controller.abort(original);
    const recorded = boundaryCapture(), acquire = vi.fn(async (value: ParticipantCInput) => simulation(value));
    await expect(freshComprehensionSessions(acquire, recorded.report)(input(), controller.signal)).rejects.toBe(original);
    expect(acquire).not.toHaveBeenCalled();
    expect(recorded.finish()).toEqual([{ stage: "session-cancellation", classification: "setup-refused", exitCode: null, signal: null, cleanup: "not-started" }]);
  });
  it("retains an unreturned acquisition and its exact command classification without adopting or retrying it", async () => {
    const original = freshRuntimeCommandFailure("exit-nonzero", 11), recorded = boundaryCapture();
    const acquire = vi.fn(async () => { throw original; }), open = freshComprehensionSessions(acquire, recorded.report);
    await expect(open(input(), signal())).rejects.toBe(original);
    await expect(open(input("T7"), signal())).rejects.toThrow("overlaps");
    expect(acquire).toHaveBeenCalledTimes(1);
    expect(recorded.finish()).toEqual([
      { stage: "session-acquisition", classification: "exit-nonzero", exitCode: 11, signal: null, cleanup: "unreturned" },
      { stage: "session-exclusivity", classification: "setup-refused", exitCode: null, signal: null, cleanup: "not-started" },
    ]);
  });
  it("retains the exact publication authority refusal before a read session can open", async () => {
    const value = input(), prepared = simulation(value), recorded = boundaryCapture();
    prepared.publication = undefined;
    await expect(freshComprehensionSessions(async () => prepared, recorded.report)(value, signal())).rejects.toThrow("identity reused");
    expect(prepared.openReadSession).not.toHaveBeenCalled(); expect(prepared.close).toHaveBeenCalledTimes(1);
    expect(recorded.finish()).toEqual([{ stage: "session-publication-binding", classification: "setup-refused", exitCode: null, signal: null, cleanup: "unreturned" }]);
  });
  it("records the actual read-open refusal before cleanup and preserves its original rejection", async () => {
    const value = input(), events: string[] = [], prepared = simulation(value, events), recorded = boundaryCapture(events);
    const original = new Error("synthetic-private-boundary-canary");
    prepared.openReadSession = vi.fn(async () => { throw original; });
    await expect(freshComprehensionSessions(async () => prepared, recorded.report)(value, signal())).rejects.toBe(original);
    expect(events).toEqual(["report:session-read-open", "stack-close"]);
    expect(prepared.openReadSession).toHaveBeenCalledTimes(1); expect(prepared.close).toHaveBeenCalledTimes(1);
    expect(recorded.finish()).toEqual([{ stage: "session-read-open", classification: "setup-refused", exitCode: null, signal: null, cleanup: "unreturned" }]);
  });
  it("keeps original operation metadata separate when cleanup replaces the existing rejection", async () => {
    const value = input(), events: string[] = [], prepared = simulation(value), recorded = boundaryCapture(events);
    const operation = freshRuntimeCommandFailure("exit-nonzero", 7), cleanup = freshRuntimeCommandFailure("exit-nonzero", 9);
    prepared.openReadSession = vi.fn(async () => { throw operation; });
    prepared.close = vi.fn(async () => { events.push("stack-close"); throw cleanup; });
    const acquire = vi.fn(async () => prepared), open = freshComprehensionSessions(acquire, recorded.report);
    await expect(open(value, signal())).rejects.toBe(cleanup);
    expect(events).toEqual(["report:session-read-open", "stack-close", "report:session-cleanup"]);
    expect(prepared.close).toHaveBeenCalledTimes(1);
    await expect(open(input("T7"), signal())).rejects.toThrow("overlaps"); expect(acquire).toHaveBeenCalledTimes(1);
    expect(recorded.finish()).toEqual([
      { stage: "session-read-open", classification: "exit-nonzero", exitCode: 7, signal: null, cleanup: "unreturned" },
      { stage: "session-cleanup", classification: "exit-nonzero", exitCode: 9, signal: null, cleanup: "uncertain" },
      { stage: "session-exclusivity", classification: "setup-refused", exitCode: null, signal: null, cleanup: "not-started" },
    ]);
  });
  it("retains exact returned read identity and closes context before stack on mismatch", async () => {
    const value = input(), events: string[] = [], prepared = simulation(value, events), recorded = boundaryCapture(events);
    const reader = session(randomUUID(), events); prepared.openReadSession = vi.fn(async () => reader);
    await expect(freshComprehensionSessions(async () => prepared, recorded.report)(value, signal())).rejects.toThrow("identity differs");
    expect(events).toEqual(["report:session-read-identity", "session-close", "stack-close"]);
    expect(reader.close).toHaveBeenCalledTimes(1); expect(prepared.close).toHaveBeenCalledTimes(1);
    expect(recorded.finish()).toEqual([{ stage: "session-read-identity", classification: "setup-refused", exitCode: null, signal: null, cleanup: "unreturned" }]);
  });
  it("records cancellation after owner return before opening the read context", async () => {
    const value = input(), prepared = simulation(value), controller = new AbortController(), recorded = boundaryCapture();
    const original = new Error("synthetic-private-boundary-canary");
    const open = freshComprehensionSessions(async () => { controller.abort(original); return prepared; }, recorded.report);
    await expect(open(value, controller.signal)).rejects.toBe(original);
    expect(prepared.openReadSession).not.toHaveBeenCalled(); expect(prepared.close).toHaveBeenCalledTimes(1);
    expect(recorded.finish()).toEqual([{ stage: "session-cancellation", classification: "setup-refused", exitCode: null, signal: null, cleanup: "unreturned" }]);
  });
  it.each([false, true])("a failed diagnostic cannot replace operation or cleanup rejection %s", async uncertain => {
    const value = input(), prepared = simulation(value), original = new Error("original public control"), cleanup = new Error("cleanup public control");
    prepared.openReadSession = vi.fn(async () => { throw original; });
    prepared.close = vi.fn(async () => { if (uncertain) throw cleanup; });
    const diagnostic = vi.fn(() => { throw new Error("synthetic-private-boundary-canary"); });
    await expect(freshComprehensionSessions(async () => prepared, diagnostic)(value, signal())).rejects.toBe(uncertain ? cleanup : original);
    expect(prepared.close).toHaveBeenCalledTimes(1); expect(diagnostic).toHaveBeenCalledTimes(uncertain ? 2 : 1);
  });
  it("keeps unknown stages, expanded/private fields and trailing bytes outside the strict closed parser", () => {
    const capture = createHostedBootstrapDiagnostics();
    const valid = { stage: "session-read-open", classification: "setup-refused", exitCode: null, signal: null, cleanup: "unreturned" };
    for (const value of [{ ...valid, stage: "synthetic-private-boundary-canary" }, { ...valid, message: "synthetic-private-boundary-canary" }])
      capture.push(Buffer.from(HOSTED_BOOTSTRAP_PREFIX + JSON.stringify(value) + "\n"));
    expect(capture.finish()).toEqual([]);
    capture.push(Buffer.from(HOSTED_BOOTSTRAP_PREFIX + JSON.stringify(valid) + "\n")); expect(capture.finish()).toEqual([]);
  });
});

import { createResourceIO } from "./fresh-t6-resources";
import { createOwnedLifecycleObserver, parseOwnedLifecycleSnapshot } from "./owned-lifecycle";
it("records a real bounded public child refusal through the existing ResourceIO observer without command or output values", async () => {
  const createdAt = Date.now(), nonce = "00000000-0000-4000-8000-000000000001", head = "a".repeat(40);
  let raw: Uint8Array = new Uint8Array();
  const observer = createOwnedLifecycleObserver({ version: 1, nonce, bootId: nonce, head, uid: 1001, gid: 1001, createdAt },
    bytes => { raw = Uint8Array.from(bytes); });
  const firstIO = createResourceIO(undefined, observer);
  expect(await firstIO.command(process.execPath, ["-e", "process.exit(0)"], { timeout: 2000 })).toBe("");
  const first = parseOwnedLifecycleSnapshot(raw, { nonce, bootId: nonce, head, uid: 1001, gid: 1001 },
    { startedAt: createdAt, endedAt: Date.now() });
  expect(first.latest.process).toMatchObject({ ordinal: 1, event: "terminal", exitCode: 0, signal: null, sender: null });
  const secondIO = createResourceIO(undefined, observer);
  await expect(secondIO.command(process.execPath, ["-e", "process.exit(7)"], { timeout: 2000 }))
    .rejects.toThrow("Fresh runtime command failed; diagnostics suppressed");
  const actual = parseOwnedLifecycleSnapshot(raw, { nonce, bootId: nonce, head, uid: 1001, gid: 1001 },
    { startedAt: createdAt, endedAt: Date.now() });
  expect(actual.latest.process).toMatchObject({ ordinal: 2, event: "terminal", exitCode: 7, signal: null, sender: null });
  expect(actual.latest.sequence).toBeGreaterThan(first.latest.sequence);
  expect(actual.latest.elapsedMs).toBeGreaterThanOrEqual(first.latest.elapsedMs);
  expect(actual.latest.process.durationMs).toBeGreaterThanOrEqual(0);
  expect(actual.completeHistory).toBe(false); expect(actual.qualifyingEvidence).toBe(false);
  expect(Buffer.from(raw).toString()).not.toMatch(/process\.exit|argv|stdout|stderr/);
});
