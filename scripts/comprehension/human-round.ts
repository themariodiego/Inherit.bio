/**
 * The runnable half of the human comprehension protocol (G3.4).
 *
 *   pnpm comprehension:human sheet [P01] [--t6-withheld]   one participant's facilitator sheet
 *   pnpm comprehension:human template                     a blank round file for the facilitator
 *   pnpm comprehension:human tally <round.json>           per-task results against the thresholds
 *
 * The sheet reads the opening and closing scripts verbatim from
 * `docs/comprehension-protocol.md` and every task prompt verbatim from
 * `bindings.json`, so a facilitator never reads a paraphrase. The tally
 * applies the shared rubric's thresholds, the committed prohibited-answer
 * patterns and the adjustment rule to what a facilitator recorded.
 *
 * It never writes `docs/comprehension-results-<date>.md`. Only a facilitator
 * who ran a round writes that file, from this output and their own notes. No
 * part of this repository may produce a human result, and nothing here does:
 * the template is blank and the tally only counts what a person recorded.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import bindings from "./bindings.json";
import { taskIds, verdictSchema, type TaskId } from "./conductor-contract";
import { repositoryRoot } from "./conductor-inputs";
import { loadPatterns, prohibitedHit, type PatternFile } from "./prohibited";

const THRESHOLD_TASKS = ["T1", "T2", "T3", "T4", "T8", "T9"] as const;
const SAFETY_TASKS = ["T5", "T6", "T7"] as const;
const participantCode = z.string().regex(/^P(?:0[1-9]|1[0-2])$/);

/** The quoted block that follows a heading in the protocol, verbatim. */
export function protocolQuote(heading: string, protocol = readFileSync(path.join(repositoryRoot, "docs/comprehension-protocol.md"), "utf8")): string {
  const start = protocol.indexOf(`### ${heading}`);
  if (start < 0) throw new Error(`The protocol has no "${heading}" section`);
  const lines = protocol.slice(start).split("\n").slice(1);
  const quote: string[] = [];
  for (const line of lines) {
    if (line.startsWith(">")) quote.push(line.replace(/^> ?/, ""));
    else if (quote.length) break;
  }
  if (!quote.length) throw new Error(`The protocol's "${heading}" section has no quoted script`);
  return quote.join("\n");
}

type BoundTask = { id: TaskId; prompt: string; account: string; withheldVariant?: { prompt: string } };
const tasks = bindings.tasks as unknown as BoundTask[];
export const promptFor = (task: BoundTask, t6Withheld: boolean) => task.id === "T6" && t6Withheld ? task.withheldVariant!.prompt : task.prompt;

export function facilitatorSheet(participant: string, t6Withheld = false): string {
  participantCode.parse(participant);
  const refusal = "I can't help with that one — do whatever you'd do on your own.";
  return [
    `# Session sheet ${participant}`, "",
    "Screening, consent and environment: see docs/comprehension-protocol.md. Never a real genetic file.", "",
    "## Opening, read once, verbatim", "", protocolQuote("Opening, read once, verbatim"), "",
    ...tasks.flatMap(task => [
      `## ${task.id}${task.id === "T6" ? ` (${t6Withheld ? "withheld" : "standard"} variant)` : ""}`, "",
      `Context: ${task.account}`, "",
      `Read verbatim: "${promptFor(task, t6Withheld)}"`, "",
      `When they stop, ask exactly: "What did you find?"  If asked for help, say exactly: "${refusal}"`, "",
      "- Completed (yes/no):",
      "- Path taken:",
      ...(task.id === "T9" ? ["- In-app click and submit actions (ceiling 6):", "- Mailed-link or typed-URL entries (not counted):",
        "- Created an account (yes/no):"] : []),
      "- Verbatim answer:", "",
    ]),
    "## Closing, verbatim", "", protocolQuote("Closing"), "", "- Closing comment (not graded):", "",
  ].join("\n");
}

const answerSchema = z.object({
  taskId: z.enum(taskIds),
  variant: z.enum(["standard", "withheld"]),
  completed: z.boolean(),
  path: z.array(z.string().max(2048)).max(200),
  actions: z.number().int().nonnegative(),
  entries: z.number().int().nonnegative(),
  accountCreated: z.boolean(),
  /** Verbatim, as the participant said it. */
  answer: z.string().max(65_536),
  /** From a grader given only the rubric slice and this answer. */
  grade: verdictSchema.nullable(),
  regrade: verdictSchema.nullable().optional(),
}).strict();
const sessionSchema = z.object({
  participant: participantCode,
  eligibility: z.object({ noGeneticsOrMedicalTraining: z.boolean(), noPriorConsumerGenomics: z.boolean(),
    noProjectConnection: z.boolean() }).strict(),
  consentSigned: z.boolean(),
  facilitatorAssisted: z.boolean(),
  answers: z.array(answerSchema),
}).strict();
export const roundSchema = z.object({
  schemaVersion: z.literal(1),
  roundFinished: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  recruitment: z.object({ aimedFor: z.string(), achieved: z.string() }).strict(),
  sessions: z.array(sessionSchema),
  discarded: z.array(z.object({ participant: participantCode, reason: z.string().min(1) }).strict()),
}).strict();
export type Round = z.infer<typeof roundSchema>;

export function blankRound(): Round {
  return { schemaVersion: 1, roundFinished: "0000-00-00", recruitment: { aimedFor: "", achieved: "" },
    sessions: Array.from({ length: 12 }, (_, index) => ({ participant: `P${String(index + 1).padStart(2, "0")}`,
      eligibility: { noGeneticsOrMedicalTraining: false, noPriorConsumerGenomics: false, noProjectConnection: false },
      consentSigned: false, facilitatorAssisted: false,
      answers: tasks.map(task => ({ taskId: task.id, variant: "standard" as const, completed: false, path: [], actions: 0, entries: 0,
        accountCreated: false, answer: "", grade: null })) })),
    discarded: [] };
}

export interface TaskTally { taskId: TaskId; successes: number; prohibited: number; noRouteFound: number; ungraded: number; met: boolean }
export interface RoundTally {
  eligibleSessions: number;
  tasks: TaskTally[];
  met: boolean;
  /** Feed to assessRun: a task below 10/12 raises its simulated threshold to 29/30. */
  humanSuccesses: Record<(typeof THRESHOLD_TASKS)[number], number>;
  raisedSimulatedThresholds: string[];
  regradeAgreement: { agreed: number; total: number } | null;
}

/** Counts only what a facilitator and a blind grader recorded. Refuses a
 * round that is not twelve eligible, consented, unassisted sessions. */
export function tallyRound(input: unknown, patterns: PatternFile = loadPatterns()): RoundTally {
  const round = roundSchema.parse(input);
  const problems: string[] = [];
  const codes = round.sessions.map(session => session.participant);
  if (round.sessions.length !== 12 || new Set(codes).size !== 12) problems.push("A round is twelve distinct participants");
  for (const session of round.sessions) {
    const { eligibility } = session;
    if (!eligibility.noGeneticsOrMedicalTraining || !eligibility.noPriorConsumerGenomics || !eligibility.noProjectConnection) {
      problems.push(`${session.participant} is not eligible: remove, list under discarded, and replace`);
    }
    if (!session.consentSigned) problems.push(`${session.participant} has no signed consent`);
    if (session.facilitatorAssisted) problems.push(`${session.participant} was assisted: discard and re-run with a new participant`);
    const seen = session.answers.map(answer => answer.taskId);
    if (seen.length !== 10 || taskIds.some(id => !seen.includes(id))) problems.push(`${session.participant} does not record all ten tasks once`);
  }
  if (problems.length) throw new Error(problems.join("\n"));
  let agreed = 0, regraded = 0;
  const tallies = taskIds.map((taskId): TaskTally => {
    const answers = round.sessions.map(session => session.answers.find(answer => answer.taskId === taskId)!);
    const klass = patterns.classes.find(candidate => candidate.id === taskId);
    let successes = 0, prohibited = 0, noRouteFound = 0, ungraded = 0;
    for (const answer of answers) {
      if (!answer.grade) { ungraded++; continue; }
      if (answer.regrade) {
        regraded++;
        if (JSON.stringify(answer.regrade) === JSON.stringify(answer.grade)) agreed++;
      }
      const withinActions = taskId !== "T9" || (answer.actions <= 6 && !answer.accountCreated);
      if (answer.completed && answer.grade.passed && withinActions && answer.answer.trim()) successes++;
      if (klass && (answer.grade.prohibited || answer.regrade?.prohibited || prohibitedHit(klass, answer.answer) !== null)) prohibited++;
      if (answer.grade.noRouteFound || answer.regrade?.noRouteFound) noRouteFound++;
    }
    const met = ungraded === 0 && ((THRESHOLD_TASKS as readonly string[]).includes(taskId) ? successes >= 10
      : (SAFETY_TASKS as readonly string[]).includes(taskId) ? prohibited === 0 : noRouteFound === 0);
    return { taskId, successes, prohibited, noRouteFound, ungraded, met };
  });
  const humanSuccesses = Object.fromEntries(THRESHOLD_TASKS.map(taskId =>
    [taskId, tallies.find(tally => tally.taskId === taskId)!.successes])) as RoundTally["humanSuccesses"];
  return { eligibleSessions: round.sessions.length, tasks: tallies, met: tallies.every(tally => tally.met), humanSuccesses,
    raisedSimulatedThresholds: THRESHOLD_TASKS.filter(taskId => humanSuccesses[taskId] < 10).map(taskId => `${taskId}: 29/30`),
    regradeAgreement: regraded ? { agreed, total: regraded } : null };
}

function main() {
  const [command, ...rest] = process.argv.slice(2);
  if (command === "sheet") {
    console.log(facilitatorSheet(rest.find(value => !value.startsWith("--")) ?? "P01", rest.includes("--t6-withheld")));
  } else if (command === "template") {
    console.log(JSON.stringify(blankRound(), null, 2));
  } else if (command === "tally" && rest[0]) {
    console.log(JSON.stringify(tallyRound(JSON.parse(readFileSync(path.resolve(rest[0]), "utf8"))), null, 2));
  } else {
    console.error("Usage: pnpm comprehension:human sheet [P01] [--t6-withheld] | template | tally <round.json>");
    process.exitCode = 2;
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
