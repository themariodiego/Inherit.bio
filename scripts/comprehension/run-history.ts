import { z } from "zod";
import { freeze, opaque, type Settings } from "./conductor-contract";
import { manifestSchema, type RunManifest } from "./conductor-inputs";

const finishSchema = z.object({ kind: z.literal("finish"), runId: opaque,
  status: z.enum(["completed", "stopped"]), instrumentClean: z.boolean(),
  failure: z.enum(["none", "adapter-failed", "invalid-result", "budget-refused", "persistence-failed", "step-bound", "resource-unresolved"]).default("none") }).strict();
export const historyEventSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("start"), manifest: manifestSchema }).strict(),
  z.object({ kind: z.literal("attempt"), runId: opaque, id: opaque, slot: opaque, processId: opaque,
    role: z.enum(["participant", "grader", "regrader"]), attempt: z.number().int().min(1).max(3), maximum: z.number().int().positive().safe() }).strict(),
  z.object({ kind: z.literal("usage"), runId: opaque, id: opaque, certain: z.boolean(), actual: z.number().int().nonnegative().safe().nullable() }).strict(),
  z.object({ kind: z.literal("resource-unresolved"), runId: opaque, id: opaque,
    resource: z.enum(["browser", "process"]) }).strict(),
  z.object({ kind: z.literal("session-open"), runId: opaque, sessionId: opaque, personaId: opaque,
    taskId: z.enum(["T1", "T2", "T3", "T4", "T5", "T6", "T7", "T8", "T9", "T10"]) }).strict(),
  z.object({ kind: z.literal("trace"), runId: opaque, sessionId: opaque,
    phase: z.enum(["observed", "action", "answer", "grader", "regrader", "ended"]), value: z.unknown() }).strict(),
  z.object({ kind: z.literal("session"), runId: opaque, sessionId: opaque, personaId: opaque,
    taskId: z.enum(["T1", "T2", "T3", "T4", "T5", "T6", "T7", "T8", "T9", "T10"]),
    evidence: z.unknown() }).strict(),
  finishSchema,
  z.object({ kind: z.literal("close-revision"), revision: z.string().regex(/^[0-9a-f]{40}$/) }).strict(),
]);
export type HistoryEvent = z.infer<typeof historyEventSchema>;
type Run = { manifest: RunManifest; keys: Set<string>; finish?: z.infer<typeof finishSchema> };

/** Replay validates chronology. No caller may choose only favorable runs,
 * silently replay a request slot, reuse identities, or skip an unfinished run. */
export class RunHistory {
  private readonly recorded: HistoryEvent[] = [];
  get events(): readonly HistoryEvent[] { return Object.freeze([...this.recorded]); }
  private runs = new Map<string, Run>();
  private calls = new Map<string, { maximum: number; done: boolean; runId: string; processId: string }>();
  private slots = new Map<string, { attempt: number; id: string; runId: string; role: string; certain?: boolean }>();
  private identities = new Set<string>();
  private sessions = new Map<string, { runId: string; personaId: string; taskId: string; ended: boolean }>();
  private closedRevisions = new Set<string>();
  private failedRevisions = 0;
  private currentRevision?: string;
  private unresolvedResources = new Set<string>();
  get unfinished(): boolean { return [...this.runs.values()].some(run => !run.finish); }
  get revisionStopRequired(): boolean { return this.failedRevisions >= 3; }
  get resourceStopRequired(): boolean { return this.unresolvedResources.size > 0; }
  settingsFor(runId: string): Readonly<Settings> {
    const run = this.runs.get(runId);
    if (!run || run.finish || this.resourceStopRequired) throw new Error("No available run for inference");
    return run.manifest.settings;
  }

  apply(input: unknown): HistoryEvent {
    const event = historyEventSchema.parse(input);
    if (event.kind === "start") {
      if (this.unfinished || this.revisionStopRequired || this.resourceStopRequired || this.runs.has(event.manifest.runId)
        || this.closedRevisions.has(event.manifest.revision)) throw new Error("Run history refuses start");
      if (this.currentRevision && this.currentRevision !== event.manifest.revision
        && !this.closedRevisions.has(this.currentRevision)) throw new Error("Close the previous revision before changing it");
      this.runs.set(event.manifest.runId, { manifest: event.manifest, keys: new Set() });
      this.currentRevision = event.manifest.revision;
    } else if (event.kind === "close-revision") {
      const runs = [...this.runs.values()].filter(run => run.manifest.revision === event.revision);
      if (this.unfinished || this.resourceStopRequired || !runs.length || this.closedRevisions.has(event.revision)
        || event.revision !== this.currentRevision) throw new Error("Revision closure refused");
      const last = runs.slice(-2);
      const clean = last.length === 2 && last.every(run => run.finish?.status === "completed" && run.finish.instrumentClean)
        && last[0].manifest.settingsDigest === last[1].manifest.settingsDigest;
      this.failedRevisions = clean ? 0 : this.failedRevisions + 1;
      this.closedRevisions.add(event.revision);
    } else {
      const run = this.runs.get(event.runId);
      if (!run || run.finish) throw new Error("No current run for event");
      if (event.kind === "attempt") {
        const previous = this.slots.get(event.slot);
        if (this.resourceStopRequired || event.attempt > run.manifest.settings.maxAttempts) throw new Error("Pinned retry bound or resource stop refuses attempt");
        if (this.calls.has(event.id) || this.identities.has(event.processId)
          || event.attempt !== (previous?.attempt ?? 0) + 1 || (previous && (previous.certain !== false
            || previous.runId !== event.runId || previous.role !== event.role))) {
          throw new Error("Request slot replay or identity reuse refused");
        }
        this.calls.set(event.id, { maximum: event.maximum, done: false, runId: event.runId, processId: event.processId });
        this.slots.set(event.slot, { attempt: event.attempt, id: event.id, runId: event.runId, role: event.role });
        this.identities.add(event.processId);
      } else if (event.kind === "usage") {
        const call = this.calls.get(event.id);
        if (!call || call.runId !== event.runId || call.done || event.certain !== (event.actual !== null)
          || (event.actual !== null && event.actual > call.maximum)) throw new Error("Usage history inconsistent");
        call.done = true;
        const slot = [...this.slots.values()].find(slot => slot.id === event.id);
        if (!slot) throw new Error("Missing request slot");
        slot.certain = event.certain;
      } else if (event.kind === "resource-unresolved") {
        const admitted = event.resource === "browser" ? this.sessions.get(event.id)?.runId === event.runId
          : [...this.calls.values()].some(call => call.runId === event.runId && call.processId === event.id);
        if (!admitted || this.unresolvedResources.has(event.id)) throw new Error("Unknown or duplicate unresolved resource");
        this.unresolvedResources.add(event.id);
      } else if (event.kind === "session-open") {
        if (this.resourceStopRequired || !run.manifest.personaIds.includes(event.personaId) || this.identities.has(event.sessionId)) {
          throw new Error("Session identity reuse or unknown persona refused");
        }
        this.identities.add(event.sessionId);
        this.sessions.set(event.sessionId, { runId: event.runId, personaId: event.personaId, taskId: event.taskId, ended: false });
      } else if (event.kind === "trace") {
        const session = this.sessions.get(event.sessionId);
        if (!session || session.runId !== event.runId || session.ended) throw new Error("No open session for trace");
        if (event.phase === "ended") session.ended = true;
      } else if (event.kind === "session") {
        const key = `${event.taskId}/${event.personaId}`;
        const session = this.sessions.get(event.sessionId);
        if (!session || session.runId !== event.runId || session.personaId !== event.personaId
          || session.taskId !== event.taskId || session.ended || run.keys.has(key)) {
          throw new Error("Session identity reuse or unknown persona refused");
        }
        run.keys.add(key);
      } else {
        if (event.status === "completed" && (this.resourceStopRequired || run.keys.size !== 300
          || [...this.calls.values()].some(call => call.runId === event.runId && !call.done)
          || [...this.sessions.values()].some(session => session.runId === event.runId && !session.ended))) throw new Error("Incomplete run");
        if (event.status !== "completed" && event.instrumentClean) throw new Error("Stopped run cannot pass");
        run.finish = event;
      }
    }
    this.recorded.push(freeze(event));
    return event;
  }
}
