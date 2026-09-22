import "server-only";

export const preparationMetricPhases = ["claim", "setup", "source_scan", "source_runs", "source_merge", "canonical_runs",
  "canonical_merge", "canonical_materialization", "rsid_runs", "rsid_merge", "rsid_materialization", "publication_preflight", "publication"] as const;
export const preparationMetricOperations = ["artifact_read", "artifact_write", "rpc", "provider_get", "provider_put", "source_get"] as const;
export const preparationMetricCheckpoints = ["source-scan", "source-runs", "source-merge", "canonical-runs", "canonical-merge",
  "canonical-materialization", "rsid-runs", "rsid-merge", "rsid-materialization", "publication-preflight"] as const;
export type PreparationMetricPhase = typeof preparationMetricPhases[number];
export type PreparationMetricOperation = typeof preparationMetricOperations[number];
type Outcome = "prepared" | "idle" | "failed" | "aborted";
type Operation = { started: number; completed: number; failed: number; incomplete: number; wallMs: number; completedBytes: number };
type Phase = { entered: boolean; completed: boolean; wallMs: number; cpuUserUs: number; cpuSystemUs: number;
  wallAvailable: boolean; cpuAvailable: boolean; operations: Record<PreparationMetricOperation, Operation> };
export type PreparationMetricsEvent = { event: "preparation_metrics_v1"; outcome: Outcome; activePhase: PreparationMetricPhase;
  lastCompletedCheckpoint: typeof preparationMetricCheckpoints[number] | null; completedCheckpoints: number;
  dropped: number; phases: Record<PreparationMetricPhase, Phase> };
export type PreparationMetricsSink = (event: Readonly<PreparationMetricsEvent>) => unknown;
export type PreparationMetricsClock = { now(): number; cpu(): { user: number; system: number } | null };
type Sample = { now: number | null; cpu: { user: number; system: number } | null };
type Pending = { phase: PreparationMetricPhase; operation: PreparationMetricOperation; started: number | null };
const noOperation = () => {};
const defaultClock: PreparationMetricsClock = { now: () => performance.now(), cpu: () => process.cpuUsage() };
const numeric = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0;
const add = (a: number, b: number) => Math.min(Number.MAX_SAFE_INTEGER, a + b);

function emptyPhase(): Phase {
  return { entered: false, completed: false, wallMs: 0, cpuUserUs: 0, cpuSystemUs: 0, wallAvailable: true, cpuAvailable: true,
    operations: Object.fromEntries(preparationMetricOperations.map(key => [key,
      { started: 0, completed: 0, failed: 0, incomplete: 0, wallMs: 0, completedBytes: 0 }])) as Phase["operations"] };
}

/** Optional, process-local aggregate instrument. Never receives work identities,
 * response objects, content, paths or errors. It neither waits nor performs I/O.
 * Durations may overlap (RPC/provider operations are inside artifact work).
 * CPU deltas include other activity in this process; they are not task CPU.
 * In-flight work at finish stays incomplete, including a later successful reply.
 */
export class PreparationMetrics {
  private readonly phases = Object.fromEntries(preparationMetricPhases.map(key => [key, emptyPhase()])) as PreparationMetricsEvent["phases"];
  private phase: PreparationMetricPhase = "claim";
  private sample: Sample = { now: null, cpu: null };
  private readonly pending = new Set<Pending>();
  private dropped = 0;
  private finished = false;
  private lastCompletedCheckpoint: PreparationMetricsEvent["lastCompletedCheckpoint"] = null;
  private completedCheckpoints = 0;

  constructor(private readonly sink: PreparationMetricsSink, private readonly clock: PreparationMetricsClock = defaultClock) {
    this.phases.claim.entered = true; this.sample = this.readClock();
  }
  private drop() { this.dropped = add(this.dropped, 1); }
  private readNow(): number | null {
    try { const value = this.clock.now(); if (numeric(value)) return value; } catch { /* Unavailable. */ }
    this.drop(); return null;
  }
  private readClock(): Sample {
    const now = this.readNow(); let cpu: Sample["cpu"] = null;
    try {
      const value = this.clock.cpu();
      if (value && numeric(value.user) && numeric(value.system)) cpu = { user: value.user, system: value.system };
      else if (value !== null) this.drop();
    } catch { this.drop(); }
    return { now, cpu };
  }
  private elapsed(start: number | null, end: number | null) {
    if (start === null || end === null || end < start) { this.drop(); return null; }
    return Math.min(Number.MAX_SAFE_INTEGER, Math.floor(end - start));
  }
  private closePhase(sample: Sample, completed: boolean) {
    const phase = this.phases[this.phase], wall = this.elapsed(this.sample.now, sample.now);
    if (wall === null) phase.wallAvailable = false; else phase.wallMs = add(phase.wallMs, wall);
    if (!this.sample.cpu || !sample.cpu || sample.cpu.user < this.sample.cpu.user || sample.cpu.system < this.sample.cpu.system) phase.cpuAvailable = false;
    else {
      phase.cpuUserUs = add(phase.cpuUserUs, Math.floor(sample.cpu.user - this.sample.cpu.user));
      phase.cpuSystemUs = add(phase.cpuSystemUs, Math.floor(sample.cpu.system - this.sample.cpu.system));
    }
    phase.completed = completed;
  }
  enterPhase(phase: PreparationMetricPhase): void {
    try {
      if (this.finished) return;
      if (!preparationMetricPhases.includes(phase)) { this.drop(); return; }
      if (phase === this.phase) return;
      const sample = this.readClock(); this.closePhase(sample, true);
      this.phase = phase; this.sample = sample; this.phases[phase].entered = true;
    } catch { this.drop(); }
  }
  checkpointCompleted(checkpoint: typeof preparationMetricCheckpoints[number]): void {
    if (this.finished) return;
    if (!preparationMetricCheckpoints.includes(checkpoint)) { this.drop(); return; }
    this.lastCompletedCheckpoint = checkpoint; this.completedCheckpoints = add(this.completedCheckpoints, 1);
  }
  operation(operation: PreparationMetricOperation): (completed: boolean, completedBytes?: number) => void {
    try {
      if (this.finished) return noOperation;
      if (!preparationMetricOperations.includes(operation) || this.pending.size >= 32) { this.drop(); return noOperation; }
      const pending: Pending = { phase: this.phase, operation, started: this.readNow() };
      this.pending.add(pending);
      const counters = this.phases[pending.phase].operations[operation]; counters.started = add(counters.started, 1);
      return (completed, completedBytes = 0) => {
        try {
          if (this.finished || !this.pending.delete(pending)) return;
          const wall = this.elapsed(pending.started, this.readNow());
          if (wall !== null) counters.wallMs = add(counters.wallMs, wall);
          else this.phases[pending.phase].wallAvailable = false;
          if (completed === true) {
            counters.completed = add(counters.completed, 1);
            if (Number.isSafeInteger(completedBytes) && completedBytes >= 0) counters.completedBytes = add(counters.completedBytes, completedBytes);
            else this.drop();
          } else counters.failed = add(counters.failed, 1);
        } catch { this.drop(); }
      };
    } catch { this.drop(); return noOperation; }
  }
  finish(outcome: Outcome): void {
    try {
      if (this.finished) return; this.finished = true;
      if (!["prepared", "idle", "failed", "aborted"].includes(outcome)) { this.drop(); return; }
      const sample = this.readClock(); this.closePhase(sample, outcome === "prepared" || outcome === "idle");
      for (const pending of this.pending) {
        const counters = this.phases[pending.phase].operations[pending.operation], wall = this.elapsed(pending.started, sample.now);
        counters.incomplete = add(counters.incomplete, 1);
        if (wall !== null) counters.wallMs = add(counters.wallMs, wall);
        else this.phases[pending.phase].wallAvailable = false;
      }
      this.pending.clear();
      const event: PreparationMetricsEvent = { event: "preparation_metrics_v1", outcome, activePhase: this.phase,
        lastCompletedCheckpoint: this.lastCompletedCheckpoint, completedCheckpoints: this.completedCheckpoints,
        dropped: this.dropped, phases: structuredClone(this.phases) };
      for (const phase of Object.values(event.phases)) {
        Object.values(phase.operations).forEach(Object.freeze); Object.freeze(phase.operations); Object.freeze(phase);
      }
      Object.freeze(event.phases); Object.freeze(event);
      // A throwing sink, rejected promise or hostile thenable cannot affect work.
      try { void Promise.resolve(this.sink(event)).catch(() => {}); } catch { /* Best effort only. */ }
    } catch { /* Metrics never replace the operation's result or failure. */ }
  }
}
