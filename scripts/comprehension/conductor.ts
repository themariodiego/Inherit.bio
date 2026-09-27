import { randomUUID } from "node:crypto";
import { assessRun, regradeSample, type ComprehensionRun } from "./assessment";
import { participantPersonaPrompt } from "./personas";
import { browserRecordSchema, freeze, participantResultSchema, verdictSchema, viewSchema,
  type BrowserAdapter, type BrowserAction, type DryEnvironment, type ParticipantPayload } from "./conductor-contract";
import { createManifest, manifestSchema, qualificationBlockers, taskRubric, type ConductorInputs, type RunManifest } from "./conductor-inputs";
import { acquire, bounded, ConductorFailure, invokeInstrument, type JournalPort } from "./conductor-call";

const usedBrowsers = new WeakSet<object>();
export function preflightQualifyingRun() {
  return freeze({ allowed: false, blockers: [...qualificationBlockers] });
}

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
  const sampled = regradeSample(manifest.personaIds, manifest.samplingSeed);
  const run: ComprehensionRun = { runId: manifest.runId, revision: manifest.revision, settingsDigest: manifest.settingsDigest,
    samplingSeed: manifest.samplingSeed, personaIds: [...manifest.personaIds], responses: [] };
  try {
    for (const task of inputs.tasks) for (const persona of inputs.personas) {
      const sessionId = randomUUID();
      let browser: BrowserAdapter | undefined;
      const history: { view: ReturnType<typeof viewSchema.parse>; action?: BrowserAction }[] = [];
      const processIds: string[] = [];
      let answer: string | undefined;
      await journal.append({ kind: "session-open", runId: manifest.runId, sessionId, personaId: persona.id, taskId: task.id });
      const trace = (phase: "observed" | "action" | "answer" | "grader" | "regrader" | "ended", value: unknown) =>
        journal.append({ kind: "trace", runId: manifest.runId, sessionId, phase, value });
      try {
        browser = await acquire(signal => environment.openBrowser(freeze({ id: sessionId, taskId: task.id,
          account: task.account, fixtures: [...task.fixtures] }), signal), manifest.settings.timeoutMs);
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
          processIds.push(result.processId);
          const choice = participantResultSchema.parse(result.value);
          if (choice.kind === "finish") { answer = choice.answer; await trace("answer", { answer }); break; }
          if ("target" in choice && !view.controls.includes(choice.target)) throw new ConductorFailure("invalid-result");
          history[history.length - 1].action = choice;
          await trace("action", { step, action: choice });
          await bounded(() => browser!.act(freeze(choice)), manifest.settings.timeoutMs);
        }
        if (answer === undefined) throw new ConductorFailure("step-bound");
        const record = browserRecordSchema.parse(await bounded(() => browser!.record(), manifest.settings.timeoutMs));
        // No confirmation exclusion is guessed by the scaffold. Real registered
        // exclusion instrumentation remains an adapter prerequisite.
        if (record.confirmationExclusions.length) throw new ConductorFailure("invalid-result");
        const payload = freeze({ rubric: taskRubric(inputs.rubric, task.id), answer });
        const grade = async (role: "grader" | "regrader") => {
          const result = await invokeInstrument({ runId: manifest.runId, slot: randomUUID(), role, payload,
            settings: manifest.settings, environment, journal });
          processIds.push(result.processId);
          const verdict = verdictSchema.parse(result.value);
          await trace(role, { verdict, processId: result.processId });
          return verdict;
        };
        const verdict = await grade("grader");
        const regrade = sampled.has(`${task.id}/${persona.id}`) ? await grade("regrader") : undefined;
        const response = { personaId: persona.id, taskId: task.id, sessionId, completed: record.completed,
          actions: record.actions, entries: record.entries, answer, verdict, ...(regrade ? { regrade } : {}) };
        await journal.append({ kind: "session", runId: manifest.runId, sessionId, personaId: persona.id, taskId: task.id,
          evidence: { kind: "authored-instrument-check", qualifyingEvidence: false, record, history, response, processIds } });
        run.responses.push(response);
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
    const assessment = assessRun(run, undefined, inputs.patterns);
    await journal.append({ kind: "finish", runId: manifest.runId, status: "completed", instrumentClean: assessment.clean, failure: "none" });
    return freeze({ kind: "authored-instrument-check", qualifyingEvidence: false, status: "completed", run, assessment,
      qualification: preflightQualifyingRun() });
  } catch (error) {
    const failure = error instanceof ConductorFailure ? error.code : "invalid-result";
    await journal.append({ kind: "finish", runId: manifest.runId, status: "stopped", instrumentClean: false, failure });
    return freeze({ kind: "authored-instrument-check", qualifyingEvidence: false, status: "stopped", failure, run,
      qualification: preflightQualifyingRun() });
  }
}
