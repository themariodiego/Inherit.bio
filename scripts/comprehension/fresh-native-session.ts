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
export function freshComprehensionSessions(acquire: (input: ParticipantCInput, signal: AbortSignal) => Promise<FreshComprehensionSimulation>): LiveEnvironment["openBrowser"] {
  const used = { sessions: new Set<string>(), owners: new Set<string>(), cohorts: new Set<string>() };
  let active = false;
  return async (input, signal) => {
    const task = bindings.tasks.find(task => task.id === input.taskId);
    assert(task && input.account === task.account && UUID.test(input.id)
      && JSON.stringify(input.fixtures) === JSON.stringify(task.fixtures), "Exact bound task/session required");
    assert(!active && !used.sessions.has(input.id), "Fresh comprehension session overlaps or reuses an identity");
    signal.throwIfAborted();
    active = true; used.sessions.add(input.id);
    let publication: FreshComprehensionSimulation | undefined, session: LiveSession | undefined, closing: Promise<void> | undefined;
    const close = () => closing ??= (async () => {
      // An uncertain cleanup retains exclusivity; never start the next stack.
      await session?.close();
      await publication?.close();
      active = false;
    })();
    try {
      publication = await acquire(input, signal);
      if (input.account === "participant-c") {
        const native = publication.publication;
        assert(native && UUID.test(native.ownerId) && UUID.test(native.cohortId)
          && !used.owners.has(native.ownerId) && !used.cohorts.has(native.cohortId),
        "Fresh persona publication/account identity reused");
        used.owners.add(native.ownerId); used.cohorts.add(native.cohortId);
      } else assert(!publication.publication, "An ordinary task cannot adopt an embryo publication");
      signal.throwIfAborted();
      session = await publication.openReadSession(input, signal);
      assert(session.id === input.id, "Fresh read/action session identity differs");
      signal.throwIfAborted();
      return { ...session, close };
    } catch (error) {
      if (publication) await close();
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
