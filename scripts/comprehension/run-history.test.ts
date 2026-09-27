import { describe, expect, it } from "vitest";
import { RunHistory } from "./run-history";
import { manifest } from "./conductor-fixtures";

const stop = (history: RunHistory, runId: string) => history.apply({ kind: "finish", runId,
  status: "stopped", instrumentClean: false, failure: "adapter-failed" });
function complete(history: RunHistory, runId: string, clean: boolean, revision = "a".repeat(40)) {
  const pinned = manifest(runId, revision);
  history.apply({ kind: "start", manifest: pinned });
  for (const personaId of pinned.personaIds) for (let task = 1; task <= 10; task++) {
    const identity = { runId, sessionId: `${runId}-${personaId}-${task}`, personaId, taskId: `T${task}` };
    history.apply({ kind: "session-open", ...identity });
    history.apply({ kind: "session", ...identity, evidence: { instrumentOnly: true } });
    history.apply({ kind: "trace", runId, sessionId: identity.sessionId, phase: "ended", value: { closed: true } });
  }
  history.apply({ kind: "finish", runId, status: "completed", instrumentClean: clean, failure: "none" });
}

describe("chronological instrument history", () => {
  it("rejects changing revision without closing the previous revision", () => {
    const history = new RunHistory();
    history.apply({ kind: "start", manifest: manifest("one") }); stop(history, "one");
    expect(() => history.apply({ kind: "start", manifest: manifest("two", "c".repeat(40)) })).toThrow("Close the previous");
    history.apply({ kind: "close-revision", revision: "a".repeat(40) });
    history.apply({ kind: "start", manifest: manifest("two", "c".repeat(40)) });
    expect(() => history.apply({ kind: "close-revision", revision: "a".repeat(40) })).toThrow("closure refused");
  });

  it("halts after three successive failed revisions and cannot skip closure to evade the stop", () => {
    const history = new RunHistory();
    for (const [index, char] of ["a", "b", "c"].entries()) {
      const runId = `run-${index}`, revision = char.repeat(40);
      history.apply({ kind: "start", manifest: manifest(runId, revision) }); stop(history, runId);
      history.apply({ kind: "close-revision", revision });
    }
    expect(history.revisionStopRequired).toBe(true);
    expect(() => history.apply({ kind: "start", manifest: manifest("four", "d".repeat(40)) })).toThrow("refuses");
  });

  it("uses the last two runs, preserving intervening failures and settings changes", () => {
    const history = new RunHistory();
    complete(history, "first", true); complete(history, "middle", false); complete(history, "last", true);
    history.apply({ kind: "close-revision", revision: "a".repeat(40) });
    for (const [runId, revision] of [["next", "b".repeat(40)], ["third", "c".repeat(40)]]) {
      history.apply({ kind: "start", manifest: manifest(runId, revision) }); stop(history, runId);
      history.apply({ kind: "close-revision", revision });
    }
    expect(history.revisionStopRequired).toBe(true);
  });

  it("refuses duplicate runs, session reuse, incomplete success and starts after unfinished history", () => {
    const history = new RunHistory(), pinned = manifest();
    history.apply({ kind: "start", manifest: pinned });
    expect(() => history.apply({ kind: "start", manifest: manifest("later") })).toThrow("refuses");
    expect(() => history.apply({ kind: "finish", runId: pinned.runId, status: "completed", instrumentClean: true })).toThrow("Incomplete");
    const session = { kind: "session", runId: pinned.runId, sessionId: "one-session", personaId: pinned.personaIds[0], taskId: "T1", evidence: {} };
    history.apply({ kind: "session-open", runId: pinned.runId, sessionId: "one-session", personaId: pinned.personaIds[0], taskId: "T1" });
    history.apply(session);
    expect(() => history.apply({ ...session, taskId: "T2" })).toThrow("reuse");
    stop(history, pinned.runId);
    expect(() => history.apply({ kind: "start", manifest: pinned })).toThrow("refuses");
  });

  it("requires a recorded unknown outcome before retry and refuses a used slot across runs", () => {
    const history = new RunHistory(); history.apply({ kind: "start", manifest: manifest("instrument-a", "a".repeat(40), { maxAttempts: 3 }) });
    const attempt = { kind: "attempt", runId: "instrument-a", id: "request-1", slot: "same-slot", processId: "process-1", role: "grader", attempt: 1, maximum: 100 };
    history.apply(attempt);
    expect(() => history.apply({ ...attempt, id: "request-2", processId: "process-2", attempt: 2 })).toThrow("replay");
    history.apply({ kind: "usage", runId: "instrument-a", id: "request-1", certain: false, actual: null });
    history.apply({ ...attempt, id: "request-2", processId: "process-2", attempt: 2 });
    history.apply({ kind: "usage", runId: "instrument-a", id: "request-2", certain: true, actual: 1 });
    expect(() => history.apply({ ...attempt, id: "request-3", processId: "process-3", attempt: 3 })).toThrow("replay");
    stop(history, "instrument-a"); history.apply({ kind: "start", manifest: manifest("instrument-b") });
    expect(() => history.apply({ ...attempt, runId: "instrument-b", id: "request-4", processId: "process-4" })).toThrow("replay");
  });

  it("enforces the manifest retry bound when replaying attempts", () => {
    const history = new RunHistory(); history.apply({ kind: "start", manifest: manifest() });
    const attempt = { kind: "attempt", runId: "instrument-a", id: "request-1", slot: "slot", processId: "process-1", role: "grader", attempt: 1, maximum: 100 };
    history.apply(attempt); history.apply({ kind: "usage", runId: "instrument-a", id: "request-1", certain: false, actual: null });
    const replay = new RunHistory(); history.events.forEach(event => replay.apply(event));
    expect(() => replay.apply({ ...attempt, id: "request-2", processId: "process-2", attempt: 2 })).toThrow("Pinned retry bound");
  });

  it("binds unresolved resources to admitted run identities and refuses revision closure", () => {
    const history = new RunHistory(), pinned = manifest(); history.apply({ kind: "start", manifest: pinned });
    const unknown = { kind: "resource-unresolved", runId: pinned.runId, id: "session", resource: "browser" };
    expect(() => history.apply(unknown)).toThrow("Unknown");
    history.apply({ kind: "session-open", runId: pinned.runId, sessionId: "session", personaId: pinned.personaIds[0], taskId: "T1" });
    expect(() => history.apply({ ...unknown, resource: "process" })).toThrow("Unknown");
    history.apply(unknown); stop(history, pinned.runId);
    expect(() => history.apply({ kind: "close-revision", revision: pinned.revision })).toThrow("closure refused");
  });

  it("returns frozen history snapshots that cannot erase an unfavorable event", () => {
    const history = new RunHistory(); history.apply({ kind: "start", manifest: manifest() });
    const snapshot = history.events;
    expect(() => (snapshot as unknown[]).pop()).toThrow();
    expect(() => { (snapshot[0] as { kind: string }).kind = "finish"; }).toThrow();
    expect(history.events).toHaveLength(1);
  });
});
