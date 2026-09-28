/**
 * The durable run record G3.1 requires: every raw answer and every verdict,
 * written as each simulation finishes, under `docs/comprehension-runs/<date>/<runId>/`.
 *
 *  - `manifest.json` pins what the run was: kind, product revision, the local
 *    build it drove under TEST-LOCAL, rubric and pattern digests and the
 *    rubric slice version, per-file fixture digests, sampling seed, every
 *    limit, the isolation probe's report, skipped tasks and remaining
 *    blockers, and a `model` block with the inference label, the pinned model
 *    identifier and both temperatures. It is rewritten once at the end with
 *    the outcome and the measured spend.
 *  - `responses.jsonl` holds one line per simulation, appended and flushed as
 *    it completes: completed yes/no, path, counted actions, entries, the steps
 *    taken, the verbatim answer, the blind verdict and any re-grade, the
 *    deterministic pattern result, the grading request digests and the cost.
 *  - `assessment.json` is G3.3's arithmetic over those lines, when the run is
 *    a full one.
 *
 * A stub run is never written under `docs/comprehension-runs`, and a real one
 * is never written anywhere else. Under the owner's decision of 25 September
 * 2026 the pinned identifier appears in the run records and nowhere else, so
 * it is written once, as `model.identifier` in `manifest.json`. Any other
 * field or line that would carry it is refused, and the run stops.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdir, open, readFile, rename, writeFile, type FileHandle } from "node:fs/promises";
import path from "node:path";
import type { RunAssessment } from "./assessment";
import type { BrowserAction, View } from "./conductor-contract";
import type { SessionOutcome } from "./conductor";
import { repositoryRoot, type ConductorInputs, type LiveManifest } from "./conductor-inputs";
import type { IsolationReport } from "./inference-isolation";
import { prohibitedHit } from "./prohibited";

export const RECORD_ROOT = "docs/comprehension-runs";
export const RECORD_SCHEMA_VERSION = 1;

export interface RecordHeader {
  startedAt: string;
  isolation: IsolationReport;
  build: { mode: "next start (production build)"; buildIdVerified: boolean; testJurisdictionVerified: boolean };
  budget: { limitMicroDollars: number; otherCostsMicroDollars: number; remainingAtStartMicroDollars: number };
  calibration?: { runId: string; perSimulationMaxMicroDollars: number } | null;
}
export type SessionExtras = { entryChannels: string[]; failedActions: number; refusedValues: number };
type ModelBlock = { label: string; provider: string; identifier: string | null; temperature: { participant: number; grader: number } };

const sha256 = (bytes: Buffer | string) => createHash("sha256").update(bytes).digest("hex");

function labelFor(view: View, action: BrowserAction): Record<string, string> {
  if (action.kind === "scroll") return { kind: action.kind, direction: action.direction };
  if (action.kind === "entry") return { kind: action.kind, path: action.path, channel: action.channel };
  const line = view.visibleText.split("\n").find(candidate => candidate.startsWith(`[${action.target} `)) ?? "";
  return { kind: action.kind, control: line.replace(/^\[[^\]]+\]\s*/, "").slice(0, 200),
    ...("value" in action ? { value: action.value } : {}) };
}

export function fixtureDigests(inputs: ConductorInputs, repository = repositoryRoot): Record<string, string> {
  const files = [...new Set(inputs.tasks.flatMap(task => task.fixtures))].sort();
  return Object.fromEntries(files.map(file => [file, sha256(readFileSync(path.join(repository, file)))]));
}

export class RunRecord {
  private costs: number[] = [];
  private constructor(readonly directory: string, private readonly responses: FileHandle,
    private readonly identifier: string | null, private readonly base: Record<string, unknown> & { model: ModelBlock },
    private readonly inputs: ConductorInputs) {}

  static async create(input: { root: string; date: string; manifest: LiveManifest; inputs: ConductorInputs;
    header: RecordHeader; modelIdentifier: string | null; docsRepository?: string }): Promise<RunRecord> {
    // Where docs/comprehension-runs lives; tests point it at a scratch
    // repository. Fixtures are always read from this checkout.
    const repository = input.docsRepository ?? repositoryRoot;
    const docs = path.resolve(repository, RECORD_ROOT), root = path.resolve(input.root);
    const inDocs = root === docs;
    const stub = input.manifest.inference.provider === "local-deterministic-stub";
    if (stub && (root === docs || root.startsWith(docs + path.sep))) throw new Error("A stub run is not comprehension evidence and never records under docs/comprehension-runs");
    if (!stub && !inDocs) throw new Error("A real provider's run records under docs/comprehension-runs and nowhere else");
    if (stub !== (input.modelIdentifier === null)) throw new Error("A real provider's run records its pinned model identifier; the stub has none");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date)) throw new Error("Record date must be YYYY-MM-DD");
    const directory = path.join(root, input.date, input.manifest.runId);
    await mkdir(directory, { recursive: true });
    const base = {
      schemaVersion: RECORD_SCHEMA_VERSION,
      evidence: stub ? "harness self-test with the local deterministic stub; never comprehension evidence" : "simulated participants",
      manifest: input.manifest,
      inputs: {
        rubric: { path: "scripts/comprehension/rubric.md", sha256: input.inputs.pins.rubric,
          selection: "shared-preamble-and-exact-task-section-v1" },
        patterns: { path: "scripts/comprehension/prohibited-patterns.json", sha256: input.inputs.pins.patterns },
        bindings: { path: "scripts/comprehension/bindings.json", sha256: input.inputs.pins.bindings },
        personas: { path: "scripts/comprehension/personas.json", sha256: input.inputs.pins.personas },
        // Renders every prompt, so a record's grading requests can be re-rendered from it.
        worker: { path: "scripts/comprehension/inference-worker.ts", sha256: input.inputs.pins.inferenceWorker },
        fixtures: fixtureDigests(input.inputs),
      },
      // G3.1's "the run artifact records the pinned model identifier and
      // temperature": here, and only here.
      model: { label: input.manifest.inference.label, provider: input.manifest.inference.provider,
        identifier: input.modelIdentifier, temperature: { participant: input.manifest.settings.temperature,
          grader: input.manifest.settings.graderTemperature ?? input.manifest.settings.temperature } },
      ...input.header,
    };
    const record = new RunRecord(directory, await open(path.join(directory, "responses.jsonl"), "wx", 0o644),
      input.modelIdentifier, base, input.inputs);
    await record.writeJson("manifest.json", { ...base, status: "running" });
    return record;
  }

  /** Refuses the identifier anywhere but `model.identifier` in manifest.json. */
  private check(text: string) {
    if (this.identifier && text.toLowerCase().includes(this.identifier.toLowerCase())) {
      throw new Error("Record write refused: the model identifier belongs only in manifest.json's model block");
    }
  }

  private async writeJson(name: string, value: unknown) {
    const text = JSON.stringify(value, null, 2) + "\n";
    const model = (value as { model?: ModelBlock }).model;
    // Check everything except the one field allowed to carry the identifier.
    this.check(model ? JSON.stringify({ ...(value as object), model: { ...model, identifier: null } }) : text);
    const temporary = path.join(this.directory, `.${name}.tmp`);
    await writeFile(temporary, text, "utf8");
    await rename(temporary, path.join(this.directory, name));
  }

  async append(outcome: SessionOutcome, extras?: SessionExtras) {
    const klass = this.inputs.patterns.classes.find(candidate => candidate.id === outcome.taskId);
    const line = outcome.status === "skipped"
      ? { taskId: outcome.taskId, personaId: outcome.personaId, sessionId: outcome.sessionId, status: "skipped", reason: outcome.reason }
      : { taskId: outcome.taskId, personaId: outcome.personaId, sessionId: outcome.sessionId, status: "answered",
        completed: outcome.record.completed, path: outcome.record.path, actions: outcome.record.actions,
        entries: outcome.record.entries, entryChannels: extras?.entryChannels ?? [], failedActions: extras?.failedActions ?? 0,
        refusedValues: extras?.refusedValues ?? 0,
        steps: outcome.steps.map(step => ({ path: step.view.path, ...(step.action ? { action: labelFor(step.view, step.action) } : {}) })),
        answer: outcome.response.answer, verdict: outcome.response.verdict, regrade: outcome.response.regrade ?? null,
        deterministic: { class: klass?.id ?? null, hit: klass ? prohibitedHit(klass, outcome.response.answer) : null },
        graderRequestDigest: outcome.graderRequestDigest ?? null, regraderRequestDigest: outcome.regraderRequestDigest ?? null,
        costMicroDollars: outcome.costMicroDollars };
    const text = JSON.stringify(line) + "\n";
    this.check(text);
    await this.responses.writeFile(text, "utf8");
    await this.responses.sync();
    if (outcome.status === "answered") this.costs.push(outcome.costMicroDollars);
  }

  async finish(result: { status: "completed" | "stopped"; failure?: string; assessment?: RunAssessment;
    qualifyingEvidence: boolean; blockers: readonly string[] }) {
    await this.responses.close();
    const spent = this.costs.reduce((sum, value) => sum + value, 0);
    const spend = { settledMicroDollars: spent, simulations: this.costs.length,
      perSimulationMaxMicroDollars: this.costs.length ? Math.max(...this.costs) : 0,
      perSimulationMeanMicroDollars: this.costs.length ? Math.ceil(spent / this.costs.length) : 0 };
    await this.writeJson("assessment.json", { assessable: result.assessment !== undefined, qualifyingEvidence: result.qualifyingEvidence,
      blockers: result.blockers, ...(result.assessment ? { assessment: result.assessment } : {}),
      note: result.assessment ? "G3.3 arithmetic over responses.jsonl; recheck with pnpm comprehension:records check"
        : "Not a full run of 30 personas on ten tasks, so it is not assessed against G3.3." });
    await this.writeJson("manifest.json", { ...this.base, status: result.status, failure: result.failure ?? "none",
      finishedAt: new Date().toISOString(), spend });
    return spend;
  }
}

/** What the runner prints when a run ends. Never the model identifier. */
export function runSummary(input: { directory: string; status: string; manifest: LiveManifest;
  spend: Awaited<ReturnType<RunRecord["finish"]>>; assessment?: RunAssessment }) {
  return { record: path.relative(repositoryRoot, input.directory), status: input.status, inference: input.manifest.inference.label,
    qualifyingEvidence: input.manifest.qualifyingEvidence, blockers: input.manifest.blockers, spend: input.spend,
    assessment: input.assessment ? { clean: input.assessment.clean, failures: input.assessment.failures } : null };
}

export async function readRecordManifest(directory: string) {
  return JSON.parse(await readFile(path.join(directory, "manifest.json"), "utf8")) as Record<string, unknown> & {
    status: string; manifest: LiveManifest; startedAt: string; finishedAt?: string; model?: { identifier: string | null };
    spend?: { perSimulationMaxMicroDollars: number; simulations: number; settledMicroDollars: number } };
}
