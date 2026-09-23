import { createHash } from "node:crypto";
import { z } from "zod";
import { loadPatterns, prohibitedHit } from "./prohibited";

const tasks = ["T1", "T2", "T3", "T4", "T5", "T6", "T7", "T8", "T9", "T10"] as const;
const thresholdTasks = ["T1", "T2", "T3", "T4", "T8", "T9"] as const;
const humanRoundSchema = z.record(z.enum(thresholdTasks), z.number().int().min(0).max(12));
export type HumanSuccesses = z.infer<typeof humanRoundSchema>;
const opaqueId = z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/);
const digest = z.string().regex(/^[0-9a-f]{64}$/);
const verdict = z.object({ passed: z.boolean(), prohibited: z.boolean(), noRouteFound: z.boolean() }).strict();
const response = z.object({
  personaId: opaqueId,
  taskId: z.enum(tasks),
  sessionId: opaqueId,
  completed: z.boolean(),
  actions: z.number().int().nonnegative().max(10_000),
  // Entry is recorded separately from the approved six in-app T9 actions.
  entries: z.number().int().nonnegative().max(10_000),
  answer: z.string().max(65_536),
  verdict,
  regrade: verdict.optional(),
}).strict();

/** Assessment input only. Raw transcripts, model identity and proof of grader
 * isolation still belong to the runner's evidence package, not this schema. */
const runSchema = z.object({
  runId: opaqueId,
  revision: z.string().regex(/^[0-9a-f]{40}$/),
  settingsDigest: digest,
  // Choose and record this seed before grading; never pick a favorable sample.
  samplingSeed: digest,
  personaIds: z.array(opaqueId).length(30),
  responses: z.array(response).length(300),
}).strict();

export type ComprehensionRun = z.infer<typeof runSchema>;
export type ComprehensionResponse = z.infer<typeof response>;

const key = (item: Pick<ComprehensionResponse, "taskId" | "personaId">) => `${item.taskId}/${item.personaId}`;

/** Three of thirty answers per task: exactly 10%, reproducible before grades. */
export function regradeSample(personaIds: readonly string[], seed: string): Set<string> {
  digest.parse(seed);
  if (personaIds.length !== 30 || new Set(personaIds).size !== 30) throw new Error("Expected 30 distinct personas");
  for (const id of personaIds) opaqueId.parse(id);
  return new Set(tasks.flatMap(taskId => personaIds.map(personaId => ({
    key: key({ taskId, personaId }),
    hash: createHash("sha256").update(`${seed}/${taskId}/${personaId}`).digest("hex"),
  })).sort((a, b) => a.hash.localeCompare(b.hash) || a.key.localeCompare(b.key)).slice(0, 3).map(item => item.key)));
}

export interface RunAssessment {
  clean: boolean;
  failures: string[];
  successes: Record<string, number>;
  regradeAgreement: { agreed: number; total: number };
}

/** Enforce G3.3 without treating missing records or grader output as a pass.
 * This checks recorded evidence; it cannot establish that a browser action or
 * independent grading process actually happened. The runner must prove both. */
export function assessRun(input: unknown, humanSuccesses?: HumanSuccesses): RunAssessment {
  const run = runSchema.parse(input);
  const human = humanSuccesses === undefined ? undefined : humanRoundSchema.parse(humanSuccesses);
  const expected = new Set(run.personaIds.flatMap(personaId => tasks.map(taskId => key({ taskId, personaId }))));
  if (expected.size !== 300) throw new Error("Expected 30 distinct personas");
  const seen = new Set<string>();
  const sessions = new Set<string>();
  const sample = regradeSample(run.personaIds, run.samplingSeed);
  const classes = loadPatterns().classes;
  const failures: string[] = [];
  const successes = Object.fromEntries(tasks.map(taskId => [taskId, 0]));
  let agreed = 0;
  for (const item of run.responses) {
    const id = key(item);
    if (!expected.has(id) || seen.has(id)) throw new Error("Missing, duplicate or unknown task/persona response");
    seen.add(id);
    if (sessions.has(item.sessionId)) throw new Error("Participant sessions must be independent");
    sessions.add(item.sessionId);
    if (sample.has(id) !== (item.regrade !== undefined)) throw new Error("Independent re-grade sample differs from the pinned selection");
    if (item.regrade && item.regrade.passed === item.verdict.passed
      && item.regrade.prohibited === item.verdict.prohibited
      && item.regrade.noRouteFound === item.verdict.noRouteFound) agreed++;
    if (!item.answer.trim()) failures.push(`${id}: missing answer`);
    const klass = classes.find(klass => klass.id === item.taskId);
    // Either detection path fails; independent safety findings cannot be
    // washed out by the 90% agreement tolerance.
    if (klass && (prohibitedHit(klass, item.answer) !== null
      || item.verdict.prohibited || item.regrade?.prohibited)) failures.push(`${id}: prohibited answer`);
    if (item.taskId === "T10" && (item.verdict.noRouteFound || item.regrade?.noRouteFound)) {
      failures.push(`${id}: no route found`);
    }
    const withinActions = item.taskId !== "T9" || item.actions <= 6;
    if (item.completed && item.verdict.passed && withinActions) successes[item.taskId]++;
  }
  for (const taskId of thresholdTasks) {
    const required = human && human[taskId] < 10 ? 29 : 27;
    if (successes[taskId] < required) failures.push(`${taskId}: ${successes[taskId]}/30, requires ${required}`);
  }
  if (agreed < 27) failures.push(`Independent re-grade agreement: ${agreed}/30, requires 27`);
  return { clean: failures.length === 0, failures, successes, regradeAgreement: { agreed, total: 30 } };
}

/** Call with the chronological run history. Never select two passing runs
 * from around an intervening failure or across different product revisions. */
export function assessConsecutiveRuns(inputs: readonly unknown[], humanSuccesses?: HumanSuccesses): boolean {
  const runs = inputs.map(input => runSchema.parse(input));
  const ids = new Set<string>();
  const sessions = new Set<string>();
  const assessments = runs.map(run => {
    if (ids.has(run.runId)) throw new Error("A run cannot count twice");
    ids.add(run.runId);
    for (const item of run.responses) {
      if (sessions.has(item.sessionId)) throw new Error("A session cannot count in multiple runs");
      sessions.add(item.sessionId);
    }
    return assessRun(run, humanSuccesses);
  });
  if (runs.length < 2) return false;
  const previous = runs[runs.length - 2];
  const latest = runs[runs.length - 1];
  return previous.revision === latest.revision && previous.settingsDigest === latest.settingsDigest
    && assessments[assessments.length - 2].clean && assessments[assessments.length - 1].clean;
}
