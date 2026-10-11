import assert from "node:assert/strict";
import type { LiveEnvironment } from "./conductor-contract";
import bindings from "./bindings.json";
import type { LiveSession } from "./live-browser";

export type ParticipantCInput = Parameters<LiveEnvironment["openBrowser"]>[0];
export type FreshComprehensionSimulation = {
  publication?: { ownerId: string; cohortId: string };
  openReadSession(input: ParticipantCInput, signal: AbortSignal): Promise<LiveSession>;
  close(): Promise<void>;
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** One exclusive stack per task/persona, never a shared seed.
 * The production acquire callback owns the signed hosted stack and real UI
 * producers; injected callbacks in unit controls are not participant evidence. */
export type FreshSessionSetupStage = "session-binding" | "session-exclusivity" | "session-cancellation" | "session-acquisition"
  | "session-publication-binding" | "session-read-open" | "session-read-identity" | "session-cleanup";
export type FreshSessionSetupDiagnostic = (stage: FreshSessionSetupStage, error: unknown,
  cleanup: "not-started" | "unreturned" | "uncertain") => void;
export function freshComprehensionSessions(acquire: (input: ParticipantCInput, signal: AbortSignal) => Promise<FreshComprehensionSimulation>,
  diagnostic?: FreshSessionSetupDiagnostic): LiveEnvironment["openBrowser"] {
  const used = { sessions: new Set<string>(), owners: new Set<string>(), cohorts: new Set<string>() };
  let active = false;
  const report: FreshSessionSetupDiagnostic = (stage, error, cleanup) => {
    try { diagnostic?.(stage, error, cleanup); } catch { /* Telemetry cannot replace a refusal or authorize cleanup. */ }
  };
  return async (input, signal) => {
    let stage: FreshSessionSetupStage = "session-binding";
    try {
      const task = bindings.tasks.find(task => task.id === input.taskId);
      assert(task && input.account === task.account && UUID.test(input.id)
        && JSON.stringify(input.fixtures) === JSON.stringify(task.fixtures), "Exact bound task/session required");
      stage = "session-exclusivity";
      assert(!active && !used.sessions.has(input.id), "Fresh comprehension session overlaps or reuses an identity");
      stage = "session-cancellation";
      signal.throwIfAborted();
    } catch (error) { report(stage, error, "not-started"); throw error; }
    active = true; used.sessions.add(input.id);
    let publication: FreshComprehensionSimulation | undefined, session: LiveSession | undefined, closing: Promise<void> | undefined;
    const close = () => closing ??= (async () => {
      // An uncertain cleanup retains exclusivity; never start the next stack.
      await session?.close();
      await publication?.close();
      active = false;
    })();
    try {
      stage = "session-acquisition";
      publication = await acquire(input, signal);
      stage = "session-publication-binding";
      if (input.account === "participant-c") {
        const native = publication.publication;
        assert(native && UUID.test(native.ownerId) && UUID.test(native.cohortId)
          && !used.owners.has(native.ownerId) && !used.cohorts.has(native.cohortId),
        "Fresh persona publication/account identity reused");
        used.owners.add(native.ownerId); used.cohorts.add(native.cohortId);
      } else assert(!publication.publication, "An ordinary task cannot adopt an embryo publication");
      stage = "session-cancellation";
      signal.throwIfAborted();
      stage = "session-read-open";
      session = await publication.openReadSession(input, signal);
      stage = "session-read-identity";
      assert(session.id === input.id, "Fresh read/action session identity differs");
      stage = "session-cancellation";
      signal.throwIfAborted();
      return { ...session, close };
    } catch (error) {
      // Record the actual operation before cleanup can throw a different error.
      report(stage, error, "unreturned");
      if (publication) {
        try { await close(); }
        catch (cleanupError) { report("session-cleanup", cleanupError, "uncertain"); throw cleanupError; }
      }
      // An acquisition that never returned an owner remains unresolved. Its
      // production callback retains the lock for any uncertain started stack.
      throw error;
    }
  };
}

/** Genuine current native reads surround each observation/action/record. A
 * drift never yields a completed read or a silently adopted new publication. */
export function currentNativeReadSession(session: LiveSession, current: () => Promise<unknown>): LiveSession {
  return { ...session,
    observe: async () => { await current(); const view = await session.observe(); await current(); return view; },
    act: async action => { await current(); await session.act(action); await current(); },
    record: async () => { await current(); const record = await session.record(); await current(); return record; },
  };
}
