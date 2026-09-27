import { randomUUID } from "node:crypto";
import { maximumTokenCost, type SpendJournal } from "./budget";
import { freeze, inferenceResultSchema, settingsSchema, type DryEnvironment, type Payload, type ProcessAdapter, type Role, type Settings } from "./conductor-contract";
import type { HistoryEvent, RunHistory } from "./run-history";

export interface JournalPort {
  budget: Pick<SpendJournal, "reserve" | "settle">;
  history: RunHistory;
  append(event: HistoryEvent): Promise<void>;
}
export class ConductorFailure extends Error {
  constructor(readonly code: "adapter-failed" | "invalid-result" | "budget-refused" | "persistence-failed" | "step-bound" | "resource-unresolved") {
    super(code);
  }
}

export async function bounded<T>(operation: (signal: AbortSignal) => Promise<T>, timeoutMs: number): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => { controller.abort(); reject(new ConductorFailure("adapter-failed")); }, timeoutMs);
  });
  try { return await Promise.race([operation(controller.signal), timeout]); }
  finally { clearTimeout(timer!); }
}

/** An unresolved acquisition is never considered closed or retried. If it
 * resolves after cancellation, dispose it without ever invoking it. */
export function acquire<T extends { close(): Promise<void> }>(factory: (signal: AbortSignal) => Promise<T>, timeoutMs: number) {
  return bounded(async signal => {
    const resource = await factory(signal);
    if (signal.aborted) {
      await bounded(() => resource.close(), timeoutMs).catch(() => {});
      throw new ConductorFailure("adapter-failed");
    }
    return resource;
  }, timeoutMs);
}

const usedProcesses = new WeakSet<object>();
export async function invokeInstrument(input: { runId: string; slot: string; role: Role; payload: Payload;
  settings: Settings; environment: DryEnvironment; journal: JournalPort }) {
  const { journal } = input;
  const settings = freeze(settingsSchema.parse(input.settings));
  if (JSON.stringify(settings) !== JSON.stringify(journal.history.settingsFor(input.runId))) {
    throw new ConductorFailure("invalid-result");
  }
  const maximum = maximumTokenCost(settings.maximumInputTokens, settings.maximumOutputTokens, settings.price);
  if (maximum === 0) throw new ConductorFailure("budget-refused");
  // Freeze a detached copy; adapters cannot change the manifest or prior turns.
  const payload = freeze(structuredClone(input.payload)), limits = freeze(structuredClone(settings));
  for (let attempt = 1; attempt <= settings.maxAttempts; attempt++) {
    const id = randomUUID(), processId = randomUUID();
    try { await journal.budget.reserve(id, maximum); }
    catch { throw new ConductorFailure("budget-refused"); }
    try { await journal.append({ kind: "attempt", runId: input.runId, id, slot: input.slot, processId,
      role: input.role, attempt, maximum }); }
    catch { throw new ConductorFailure("persistence-failed"); }
    let process: ProcessAdapter | undefined, result: unknown, failed = false, closed = false;
    try {
      process = await acquire(signal => input.environment.openProcess(freeze({ id: processId, role: input.role }), signal), settings.timeoutMs);
      if (process.id !== processId || usedProcesses.has(process)) throw new ConductorFailure("invalid-result");
      usedProcesses.add(process);
      result = await bounded(signal => process!.invoke(payload, limits, signal), settings.timeoutMs);
    } catch { failed = true; }
    finally {
      if (process) {
        try { await bounded(() => process!.close(), settings.timeoutMs); closed = true; }
        catch { failed = true; closed = false; }
      }
    }
    if (failed) {
      if (!closed) await journal.append({ kind: "resource-unresolved", runId: input.runId, id: processId, resource: "process" });
      await journal.append({ kind: "usage", runId: input.runId, id, certain: false, actual: null });
      // Unknown outcomes keep the entire reservation. A retry has a new durable
      // request and process id; no retry runs alongside an unclosed process.
      if (!closed) throw new ConductorFailure("resource-unresolved");
      if (attempt === settings.maxAttempts) throw new ConductorFailure("adapter-failed");
      continue;
    }
    const parsed = inferenceResultSchema.safeParse(result);
    if (!parsed.success || parsed.data.usage.inputTokens > settings.maximumInputTokens
      || parsed.data.usage.outputTokens > settings.maximumOutputTokens) {
      await journal.append({ kind: "usage", runId: input.runId, id, certain: false, actual: null });
      throw new ConductorFailure("invalid-result");
    }
    const actual = maximumTokenCost(parsed.data.usage.inputTokens, parsed.data.usage.outputTokens, settings.price);
    await journal.budget.settle(id, actual);
    await journal.append({ kind: "usage", runId: input.runId, id, certain: true, actual });
    return { value: parsed.data.value, processId };
  }
  throw new ConductorFailure("adapter-failed");
}
