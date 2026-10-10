import { randomUUID } from "node:crypto";
import { assessRun, regradeSample, type ComprehensionResponse, type ComprehensionRun } from "./assessment";
import { participantPersonaPrompt, type Persona } from "./personas";
import { browserRecordSchema, freeze, participantResultSchema, verdictSchema, viewSchema,
  type BrowserAdapter, type BrowserAction, type BrowserRecord, type ConductorEnvironment, type DryEnvironment,
  type LiveEnvironment, type ParticipantPayload, type TaskId, type View } from "./conductor-contract";
import { createManifest, isFullRun, liveManifestSchema, liveSettingsDigest, manifestSchema, qualificationBlockers, taskRubric,
  type AnyManifest, type ConductorInputs, type LiveManifest, type RunManifest } from "./conductor-inputs";
import { acquire, bounded, ConductorFailure, invokeInstrument, type JournalPort } from "./conductor-call";

const usedBrowsers = new WeakSet<object>();
export function preflightQualifyingRun() {
  return freeze({ allowed: false, blockers: [...qualificationBlockers] });
}

export type SessionStep = { view: View; action?: BrowserAction };
/** What one simulation produced, handed to the run record as it completes. */
export type SessionOutcome =
  | { status: "answered"; taskId: TaskId; personaId: string; sessionId: string; record: BrowserRecord;
    steps: readonly SessionStep[]; response: ComprehensionResponse; costMicroDollars: number;
    graderRequestDigest?: string; regraderRequestDigest?: string }
  | { status: "skipped"; taskId: TaskId; personaId: string; sessionId: string; reason: string;
    response: ComprehensionResponse };

type Task = ConductorInputs["tasks"][number];
type Loop = { manifest: AnyManifest; inputs: ConductorInputs; environment: ConductorEnvironment; journal: JournalPort;
  tasks: readonly Task[]; personas: readonly Persona[]; sampled: ReadonlySet<string>; skipped: ReadonlyMap<string, string>;
  evidenceKind: "authored-instrument-check" | "live-run"; qualifyingEvidence: boolean; run: ComprehensionRun;
  onSession?: (outcome: SessionOutcome) => Promise<void> };

/** One loop for the dry instrument and the live harness, so the isolation and
 * accounting rules the dry tests prove are the ones a live run executes. Each
 * (task, persona) pair gets a fresh session identity, a fresh browser from the
 * environment, a fresh process per inference call, and a blind grading
 * payload of the rubric slice and the verbatim answer only. */
async function conductSessions(loop: Loop): Promise<void> {
  const { manifest, inputs, environment, journal, run } = loop;
  const setupTimeout = manifest.settings.sessionSetupTimeoutMs ?? manifest.settings.timeoutMs;
  for (const task of loop.tasks) for (const persona of loop.personas) {
    const sessionId = randomUUID();
    const reason = loop.skipped.get(task.id);
    if (reason) {
      await journal.append({ kind: "skipped", runId: manifest.runId, personaId: persona.id, taskId: task.id, reason });
      const response: ComprehensionResponse = { personaId: persona.id, taskId: task.id, sessionId, completed: false,
        actions: 0, entries: 0, answer: "", verdict: { passed: false, prohibited: false, noRouteFound: false }, skipped: reason };
      run.responses.push(response);
      try { await loop.onSession?.({ status: "skipped", taskId: task.id, personaId: persona.id, sessionId, reason, response }); }
      catch { throw new ConductorFailure("persistence-failed"); }
      continue;
    }
    let browser: BrowserAdapter | undefined;
    const history: SessionStep[] = [];
    const processIds: string[] = [];
    let answer: string | undefined, cost = 0;
    await journal.append({ kind: "session-open", runId: manifest.runId, sessionId, personaId: persona.id, taskId: task.id });
    const trace = (phase: "observed" | "action" | "answer" | "grader" | "regrader" | "ended", value: unknown) =>
      journal.append({ kind: "trace", runId: manifest.runId, sessionId, phase, value });
    try {
      browser = await acquire(signal => environment.openBrowser(freeze({ id: sessionId, taskId: task.id,
        account: task.account, fixtures: [...task.fixtures] }), signal), setupTimeout);
      if (browser.id !== sessionId || usedBrowsers.has(browser)) throw new ConductorFailure("invalid-result");
      usedBrowsers.add(browser);
      const prompt = task.id === "T6" && manifest.t6Variant === "withheld" ? task.withheldVariant?.prompt : task.prompt;
      if (!prompt) throw new ConductorFailure("invalid-result");
      for (let step = 0; step < manifest.settings.maxSteps; step++) {
        const view = viewSchema.parse(await bounded(() => browser!.observe(), manifest.settings.timeoutMs));
        history.push({ view });
        await trace("observed", { step, view });
        const payload: ParticipantPayload = { persona: participantPersonaPrompt(persona), task: prompt, history };
        const result = await invokeInstrument({ runId: manifest.runId, slot: randomUUID(), role: "participant",
          payload, settings: manifest.settings, environment, journal });
        processIds.push(result.processId); cost += result.actual;
        const choice = participantResultSchema.parse(result.value);
        if (choice.kind === "finish") { answer = choice.answer; await trace("answer", { answer }); break; }
        if ("target" in choice && !view.controls.includes(choice.target)) throw new ConductorFailure("invalid-result");
        history[history.length - 1].action = choice;
        await trace("action", { step, action: choice });
        await bounded(() => browser!.act(freeze(choice)), manifest.settings.timeoutMs);
      }
      if (answer === undefined) throw new ConductorFailure("step-bound");
      const record = browserRecordSchema.parse(await bounded(() => browser!.record(), setupTimeout));
      // No confirmation exclusion is guessed. Counting every registered click
      // and submit errs toward a higher count, never a lower one.
      if (record.confirmationExclusions.length) throw new ConductorFailure("invalid-result");
      const payload = freeze({ rubric: taskRubric(inputs.rubric, task.id), answer });
      const digests: Partial<Record<"grader" | "regrader", string>> = {};
      const grade = async (role: "grader" | "regrader") => {
        const result = await invokeInstrument({ runId: manifest.runId, slot: randomUUID(), role, payload,
          settings: manifest.settings, environment, journal });
        processIds.push(result.processId); cost += result.actual;
        if (result.requestDigest) digests[role] = result.requestDigest;
        const verdict = verdictSchema.parse(result.value);
        await trace(role, { verdict, processId: result.processId });
        return verdict;
      };
      const verdict = await grade("grader");
      const regrade = loop.sampled.has(`${task.id}/${persona.id}`) ? await grade("regrader") : undefined;
      const response: ComprehensionResponse = { personaId: persona.id, taskId: task.id, sessionId, completed: record.completed,
        actions: record.actions, entries: record.entries, answer, verdict, ...(regrade ? { regrade } : {}) };
      await journal.append({ kind: "session", runId: manifest.runId, sessionId, personaId: persona.id, taskId: task.id,
        evidence: { kind: loop.evidenceKind, qualifyingEvidence: loop.qualifyingEvidence, record, history, response, processIds } });
      run.responses.push(response);
      try {
        await loop.onSession?.({ status: "answered", taskId: task.id, personaId: persona.id, sessionId, record,
          steps: history, response, costMicroDollars: cost, graderRequestDigest: digests.grader, regraderRequestDigest: digests.regrader });
      } catch { throw new ConductorFailure("persistence-failed"); }
    } finally {
      let closed = false;
      try { if (browser) { await bounded(() => browser!.close(), manifest.settings.timeoutMs); closed = true; } }
      finally {
        if (!closed) await journal.append({ kind: "resource-unresolved", runId: manifest.runId, id: sessionId, resource: "browser" });
        await trace("ended", { closed, history, answer: answer ?? null, processIds });
        if (!closed) throw new ConductorFailure("resource-unresolved");
      }
    }
  }
}

const emptyRun = (manifest: AnyManifest): ComprehensionRun => ({ runId: manifest.runId, revision: manifest.revision,
  settingsDigest: manifest.settingsDigest, samplingSeed: manifest.samplingSeed, personaIds: [...manifest.personaIds], responses: [] });
const failureOf = (error: unknown) => error instanceof ConductorFailure ? error.code : "invalid-result";

/** Only authored test adapters run here. No endpoint or browser implementation
 * is supplied, and this return value can never claim participant evidence. */
export async function runInstrument(input: { mode: "instrument-dry-run"; manifest: RunManifest;
  inputs: ConductorInputs; environment: DryEnvironment; journal: JournalPort }) {
  if (input.mode !== "instrument-dry-run" || input.environment.kind !== "synthetic-local-adapter") {
    throw new Error("Qualifying execution is blocked");
  }
  const inputs = freeze(structuredClone(input.inputs));
  const manifest = freeze(manifestSchema.parse(input.manifest)), expected = createManifest(inputs, manifest);
  if (JSON.stringify(manifest) !== JSON.stringify(expected)) throw new Error("Manifest no longer matches pinned inputs");
  const { environment, journal } = input;
  await journal.append({ kind: "start", manifest });
  const run = emptyRun(manifest);
  try {
    await conductSessions({ manifest, inputs, environment, journal, tasks: inputs.tasks, personas: inputs.personas,
      sampled: regradeSample(manifest.personaIds, manifest.samplingSeed), skipped: new Map(),
      evidenceKind: "authored-instrument-check", qualifyingEvidence: false, run });
    const assessment = assessRun(run, undefined, inputs.patterns);
    await journal.append({ kind: "finish", runId: manifest.runId, status: "completed", instrumentClean: assessment.clean, failure: "none" });
    return freeze({ kind: "authored-instrument-check", qualifyingEvidence: false, status: "completed", run, assessment,
      qualification: preflightQualifyingRun() });
  } catch (error) {
    const failure = failureOf(error);
    await journal.append({ kind: "finish", runId: manifest.runId, status: "stopped", instrumentClean: false, failure });
    return freeze({ kind: "authored-instrument-check", qualifyingEvidence: false, status: "stopped", failure, run,
      qualification: preflightQualifyingRun() });
  }
}

/** The live harness. The environment must be the live one, the manifest must
 * still match the pinned inputs, and a run's qualifying status is the
 * manifest's own: it is true only when no blocker remains, which today it
 * cannot be inferred from a callable fixture or a partial hosted smoke. A partial run
 * (calibration or smoke) is recorded and never assessed against G3.3. */
export async function runLive(input: { manifest: LiveManifest; inputs: ConductorInputs; environment: LiveEnvironment;
  journal: JournalPort; modelIdentity: string; onSession?: (outcome: SessionOutcome) => Promise<void> }) {
  if (input.environment.kind !== "live-local-build") throw new Error("Live runs require the live environment");
  const inputs = freeze(structuredClone(input.inputs));
  const manifest = freeze(liveManifestSchema.parse(input.manifest));
  if (manifest.inputDigest !== inputs.inputDigest || JSON.stringify(manifest.pins) !== JSON.stringify(inputs.pins)
    || manifest.settingsDigest !== liveSettingsDigest(inputs.inputDigest, manifest, input.modelIdentity)) {
    throw new Error("Manifest no longer matches pinned inputs");
  }
  const tasks = inputs.tasks.filter(task => manifest.taskIds.includes(task.id));
  const personas = manifest.personaIds.map(id => inputs.personas.find(persona => persona.id === id)!);
  const full = isFullRun(manifest);
  // A full run re-grades the pinned 10% sample. A partial run re-grades every
  // session, so calibration measures what each of the three roles costs.
  const sampled = full ? regradeSample(manifest.personaIds, manifest.samplingSeed)
    : new Set(tasks.flatMap(task => personas.map(persona => `${task.id}/${persona.id}`)));
  const { environment, journal } = input;
  await journal.append({ kind: "start", manifest });
  const run = emptyRun(manifest);
  try {
    await conductSessions({ manifest, inputs, environment, journal, tasks, personas, sampled,
      skipped: new Map(manifest.skipped.map(skip => [skip.taskId, skip.reason])), evidenceKind: "live-run",
      qualifyingEvidence: manifest.qualifyingEvidence, run, onSession: input.onSession });
    const assessment = full ? assessRun(run, undefined, inputs.patterns) : undefined;
    const clean = Boolean(assessment?.clean && manifest.qualifyingEvidence);
    await journal.append({ kind: "finish", runId: manifest.runId, status: "completed", instrumentClean: clean, failure: "none" });
    return freeze({ kind: "live-run", qualifyingEvidence: manifest.qualifyingEvidence, status: "completed" as const, run, assessment });
  } catch (error) {
    const failure = failureOf(error);
    await journal.append({ kind: "finish", runId: manifest.runId, status: "stopped", instrumentClean: false, failure });
    return freeze({ kind: "live-run", qualifyingEvidence: manifest.qualifyingEvidence, status: "stopped" as const, failure, run,
      assessment: undefined });
  }
}
