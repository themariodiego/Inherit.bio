/**
 * Reading committed run records back, without a model in the loop (G3.3).
 *
 *  - `check <dir>` re-applies the committed prohibited-answer patterns to every
 *    verbatim answer and recomputes G3.3's arithmetic, and fails if either
 *    differs from what the run recorded. It is the reproducible detection path
 *    the brief requires.
 *  - `status` applies the stopping rule to every committed full run in
 *    chronological order: the gate is met when the last two full runs share a
 *    product revision and settings and both meet every threshold. A full run
 *    that is not clean, including one with skipped tasks, breaks the sequence.
 *    Three successive revisions closed without two clean runs send the
 *    affected capability to the withheld path, with these transcripts as its
 *    evidence. Calibration and smoke runs are listed and never counted.
 *
 * Run it with `pnpm comprehension:records status` or `... check <dir>`.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { assessRun, type ComprehensionResponse, type ComprehensionRun, type HumanSuccesses, type RunAssessment } from "./assessment";
import { isFullRun, repositoryRoot, type LiveManifest } from "./conductor-inputs";
import { loadPatterns, prohibitedHit, type PatternFile } from "./prohibited";
import { RECORD_ROOT } from "./run-record";

export type RecordLine =
  | { taskId: ComprehensionResponse["taskId"]; personaId: string; sessionId: string; status: "skipped"; reason: string }
  | { taskId: ComprehensionResponse["taskId"]; personaId: string; sessionId: string; status: "answered"; completed: boolean;
    actions: number; entries: number; answer: string; verdict: ComprehensionResponse["verdict"];
    regrade: ComprehensionResponse["verdict"] | null; deterministic: { class: string | null; hit: string | null } };
export interface LoadedRecord {
  directory: string; status: string; startedAt: string; manifest: LiveManifest; lines: RecordLine[];
  recordedAssessment?: RunAssessment; modelIdentifier?: string | null;
}

export async function loadRecord(directory: string): Promise<LoadedRecord> {
  const header = JSON.parse(await readFile(path.join(directory, "manifest.json"), "utf8"));
  const text = await readFile(path.join(directory, "responses.jsonl"), "utf8");
  if (text && !text.endsWith("\n")) throw new Error(`${directory}: responses.jsonl ends mid-line`);
  const assessment = JSON.parse(await readFile(path.join(directory, "assessment.json"), "utf8").catch(() => "{}"));
  return { directory, status: header.status, startedAt: header.startedAt, manifest: header.manifest,
    lines: text.trimEnd().split("\n").filter(Boolean).map(line => JSON.parse(line)), recordedAssessment: assessment.assessment,
    modelIdentifier: header.model?.identifier ?? null };
}

/** Every record directory under the root, oldest first. */
export async function listRecords(root = path.join(repositoryRoot, RECORD_ROOT)): Promise<LoadedRecord[]> {
  const found: LoadedRecord[] = [];
  const dates = await readdir(root, { withFileTypes: true }).catch(() => []);
  for (const date of dates.filter(entry => entry.isDirectory() && /^\d{4}-\d{2}-\d{2}$/.test(entry.name))) {
    for (const run of await readdir(path.join(root, date.name), { withFileTypes: true })) {
      if (run.isDirectory()) found.push(await loadRecord(path.join(root, date.name, run.name)));
    }
  }
  return found.sort((left, right) => left.startedAt.localeCompare(right.startedAt) || left.directory.localeCompare(right.directory));
}

export function toRun(record: LoadedRecord): ComprehensionRun {
  const { manifest } = record;
  return { runId: manifest.runId, revision: manifest.revision, settingsDigest: manifest.settingsDigest,
    samplingSeed: manifest.samplingSeed, personaIds: [...manifest.personaIds],
    responses: record.lines.map(line => line.status === "skipped"
      ? { personaId: line.personaId, taskId: line.taskId, sessionId: line.sessionId, completed: false, actions: 0, entries: 0,
        answer: "", verdict: { passed: false, prohibited: false, noRouteFound: false }, skipped: line.reason }
      : { personaId: line.personaId, taskId: line.taskId, sessionId: line.sessionId, completed: line.completed,
        actions: line.actions, entries: line.entries, answer: line.answer, verdict: line.verdict,
        ...(line.regrade ? { regrade: line.regrade } : {}) }) };
}

export function checkRecord(record: LoadedRecord, patterns: PatternFile = loadPatterns(), human?: HumanSuccesses) {
  const problems: string[] = [];
  const digest = createHash("sha256").update(JSON.stringify(patterns)).digest("hex");
  for (const line of record.lines) {
    if (line.status !== "answered") continue;
    const klass = patterns.classes.find(candidate => candidate.id === line.taskId);
    const hit = klass ? prohibitedHit(klass, line.answer) : null;
    if (hit !== line.deterministic.hit) problems.push(`${line.taskId}/${line.personaId}: recorded pattern result ${line.deterministic.hit} but the patterns now give ${hit}`);
  }
  let assessment: RunAssessment | undefined;
  if (isFullRun(record.manifest) && record.status === "completed") {
    assessment = assessRun(toRun(record), human, patterns);
    if (!human && JSON.stringify(assessment) !== JSON.stringify(record.recordedAssessment)) problems.push("Recorded assessment differs from the recomputed one");
  }
  return { problems, assessment, patternsDigest: digest };
}

export interface GateStatus {
  met: boolean;
  fullRuns: { runId: string; revision: string; settingsDigest: string; status: string; qualifying: boolean; clean: boolean; failures: string[] }[];
  otherRuns: { runId: string; kind: string; status: string }[];
  failedRevisions: number;
  withheldPathRequired: boolean;
  explanation: string;
}

export function gateStatus(records: readonly LoadedRecord[], human?: HumanSuccesses, patterns?: PatternFile): GateStatus {
  const full = records.filter(record => isFullRun(record.manifest));
  const fullRuns = full.map(record => {
    const { assessment } = record.status === "completed" ? checkRecord(record, patterns, human) : { assessment: undefined };
    const failures = [...(record.status === "completed" ? [] : [`run ${record.status}`]), ...record.manifest.blockers.map(blocker => `blocker: ${blocker}`),
      ...(assessment?.failures ?? [])];
    return { runId: record.manifest.runId, revision: record.manifest.revision, settingsDigest: record.manifest.settingsDigest,
      status: record.status, qualifying: record.manifest.qualifyingEvidence,
      clean: record.status === "completed" && record.manifest.qualifyingEvidence && Boolean(assessment?.clean), failures };
  });
  const [previous, latest] = fullRuns.slice(-2);
  const met = Boolean(previous && latest && previous.clean && latest.clean && previous.revision === latest.revision
    && previous.settingsDigest === latest.settingsDigest);
  // Revisions in the order they were first run; every revision but the
  // current one is closed. A closed revision failed unless its last two full
  // runs were clean on the same settings.
  const revisions = [...new Set(fullRuns.map(run => run.revision))];
  let failedRevisions = 0;
  for (const revision of revisions.slice(0, -1)) {
    const runs = fullRuns.filter(run => run.revision === revision).slice(-2);
    const passed = runs.length === 2 && runs.every(run => run.clean) && runs[0].settingsDigest === runs[1].settingsDigest;
    failedRevisions = passed ? 0 : failedRevisions + 1;
  }
  const withheldPathRequired = failedRevisions >= 3;
  const explanation = met ? "G3.3 met: the last two full runs are clean on one revision and one set of settings."
    : withheldPathRequired ? "Three successive revisions failed to reach two clean runs: the affected capability enters the withheld path."
      : fullRuns.length === 0 ? "No full run is recorded. G3.3 needs two consecutive clean full runs."
        : `Not met: ${latest?.clean ? "one clean run so far on this revision and settings" : "the latest full run is not clean"}.`;
  return { met, fullRuns, otherRuns: records.filter(record => !isFullRun(record.manifest))
    .map(record => ({ runId: record.manifest.runId, kind: record.manifest.kind, status: record.status })),
  failedRevisions, withheldPathRequired, explanation };
}

/**
 * Where a pinned identifier from a committed run record appears outside
 * `docs/comprehension-runs/`. The owner's decision of 25 September 2026 allows
 * it in the run records and nowhere else: not in code, other docs or commit
 * messages. Each hit names only its source, never the identifier, so a
 * failure cannot print it into a log.
 */
export function identityLeaks(identifiers: readonly (string | null | undefined)[], sources: readonly { name: string; text: string }[]): string[] {
  const wanted = [...new Set(identifiers.filter((value): value is string => Boolean(value)).map(value => value.toLowerCase()))];
  return sources.filter(source => { const text = source.text.toLowerCase(); return wanted.some(value => text.includes(value)); })
    .map(source => source.name);
}

/** Every tracked file outside the run records, and every commit message. */
export function repositorySources(repository = repositoryRoot): { name: string; text: string }[] {
  const git = (...args: string[]) => execFileSync("git", args, { cwd: repository, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
  const files = git("ls-files", "-z").split("\0").filter(file => file && !file.startsWith(`${RECORD_ROOT}/`));
  const sources = files.flatMap(file => {
    const full = path.join(repository, file);
    try { return statSync(full).size <= 16 * 1024 * 1024 ? [{ name: file, text: readFileSync(full, "utf8") }] : []; }
    catch { return []; }
  });
  const messages = git("log", "--format=%H%x00%B%x1e").split("\x1e").map(entry => entry.trim()).filter(Boolean)
    .map(entry => { const [hash, body] = entry.split("\0"); return { name: `commit ${hash}`, text: body ?? "" }; });
  return [...sources, ...messages];
}

async function main() {
  const [command, argument] = process.argv.slice(2);
  if (command === "status") {
    const root = argument ? path.resolve(argument) : undefined;
    console.log(JSON.stringify(gateStatus(await listRecords(root)), null, 2));
  } else if (command === "check" && argument) {
    const result = checkRecord(await loadRecord(path.resolve(argument)));
    console.log(JSON.stringify({ problems: result.problems, assessment: result.assessment ?? null }, null, 2));
    if (result.problems.length) process.exitCode = 1;
  } else {
    console.error("Usage: pnpm comprehension:records status [root] | check <record directory>");
    process.exitCode = 2;
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) void main();
