import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { regradeSample } from "./assessment";
import { runLive } from "./conductor";
import type { LiveEnvironment, Settings } from "./conductor-contract";
import { createLiveManifest, loadConductorInputs, repositoryRoot, seedSkips, type LiveManifest } from "./conductor-inputs";
import { isolatedProcesses } from "./inference-isolation";
import { InstrumentJournal } from "./instrument-journal";
import { checkRecord, gateStatus, type LoadedRecord, type RecordLine } from "./records";
import { inferenceOf, labelProblem, modelIdentifierOf, modelIdentityOf, runConfigSchema, STUB_LABEL } from "./run-config";
import { RECORD_ROOT, RunRecord, type RecordHeader } from "./run-record";

// Authored harness checks only. No answer below is a participant's.
const inputs = loadConductorInputs();
const settings: Settings = { temperature: 0, maxSteps: 6, maxAttempts: 1, timeoutMs: 20_000, sessionSetupTimeoutMs: 20_000,
  maximumInputTokens: 24_000, maximumOutputTokens: 400, price: { inputMicroDollarsPerMillion: 1, outputMicroDollarsPerMillion: 1 } };
const build = { baseUrl: "http://localhost:3100", buildId: "synthetic-build", jurisdiction: "TEST-LOCAL" as const };
const header: RecordHeader = { startedAt: "2026-09-28T00:00:00.000Z",
  isolation: { cwdOutsideRepository: true, environmentKeys: ["LANG", "PATH"], allowedKeysOnly: true },
  build: { mode: "next start (production build)", buildIdVerified: true, testJurisdictionVerified: true },
  budget: { limitMicroDollars: 50_000_000, otherCostsMicroDollars: 0, remainingAtStartMicroDollars: 50_000_000 } };
const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
async function temporary(prefix: string) { const root = await mkdtemp(path.join(tmpdir(), prefix)); roots.push(root); return root; }

function fakeBrowsers(): LiveEnvironment["openBrowser"] {
  return async ({ id }) => {
    let path_ = "/overview";
    return { id,
      async observe() { return { path: path_, controls: ["c0"], visibleText: path_ === "/overview"
        ? "# Overview\n[c0 link] Type 2 diabetes report"
        : "# Type 2 diabetes\nThis position is linked to a somewhat higher chance of type 2 diabetes, and it is not a prediction.\n[c0 link] Back" }; },
      async act() { path_ = "/genome/me/reports/type-2-diabetes-tcf7l2-rs7903146"; },
      async record() { return { completed: path_ !== "/overview", path: ["/overview", path_], actions: 1, entries: 0, confirmationExclusions: [] }; },
      async close() {} };
  };
}

describe("a live run through the shared conductor", () => {
  it("runs isolated stub processes, records every answer and skip as it completes, and never claims evidence", async () => {
    const effort = await temporary("inherit-comprehension-effort-"), records = await temporary("inherit-comprehension-records-");
    const journal = await InstrumentJournal.open(effort, 1_000_000, 0, "dry");
    const skips = seedSkips().filter(skip => skip.taskId === "T7");
    expect(skips[0].reason).toMatch(/^T7 cannot be run: No approved producer/);
    const manifest = createLiveManifest(inputs, { kind: "calibration", runId: "calibration-a", revision: "a".repeat(40),
      samplingSeed: "b".repeat(64), settings, taskIds: ["T1", "T7"], personaIds: inputs.personas.slice(0, 2).map(persona => persona.id),
      inference: { label: STUB_LABEL, provider: "local-deterministic-stub" }, modelIdentity: "local-deterministic-stub", build,
      skipped: skips, blockers: [] });
    expect(manifest.qualifyingEvidence).toBe(false);
    expect(manifest.blockers).toEqual(["T7-skipped", "calibration-is-not-a-full-run", "stub-provider-is-not-evidence"].sort());
    const record = await RunRecord.create({ root: records, date: "2026-09-28", manifest, inputs, header, modelIdentifier: null });
    const result = await runLive({ manifest, inputs, journal, modelIdentity: "local-deterministic-stub", onSession: outcome => record.append(outcome),
      environment: { kind: "live-local-build", openBrowser: fakeBrowsers(), openProcess: isolatedProcesses({ kind: "local-deterministic-stub" }) } });
    const spend = await record.finish({ status: result.status, qualifyingEvidence: false, blockers: manifest.blockers });
    await journal.close();
    expect(result).toMatchObject({ status: "completed", qualifyingEvidence: false, assessment: undefined });
    const lines = (await readFile(path.join(record.directory, "responses.jsonl"), "utf8")).trimEnd().split("\n").map(line => JSON.parse(line));
    expect(lines.map(line => `${line.taskId}:${line.status}`)).toEqual(["T1:answered", "T1:answered", "T7:skipped", "T7:skipped"]);
    const answered = lines[0];
    expect(answered).toMatchObject({ completed: true, actions: 1, path: ["/overview", "/genome/me/reports/type-2-diabetes-tcf7l2-rs7903146"],
      deterministic: { class: null, hit: null } });
    expect(answered.steps[0]).toEqual({ path: "/overview", action: { kind: "click", control: "Type 2 diabetes report" } });
    expect(answered.answer).toContain("not a prediction");
    expect(answered.graderRequestDigest).toMatch(/^[0-9a-f]{64}$/);
    // Partial runs re-grade every session, so calibration prices all three roles.
    expect(answered.regrade).not.toBeNull();
    expect(spend.simulations).toBe(2);
    const written = JSON.parse(await readFile(path.join(record.directory, "manifest.json"), "utf8"));
    expect(written).toMatchObject({ status: "completed",
      model: { label: STUB_LABEL, identifier: null, temperature: { participant: 0, grader: 0 } }, inputs: { rubric: { sha256: inputs.pins.rubric }, worker: { sha256: inputs.pins.inferenceWorker } } });
    expect(Object.keys(written.inputs.fixtures)).toContain("data/samples/synthetic_23andme.txt");
    const history = (await readFile(path.join(effort, "dry-history.jsonl"), "utf8")).trimEnd().split("\n").map(line => JSON.parse(line));
    expect(history.filter(event => event.kind === "skipped")).toHaveLength(2);
    // Per session: two participant steps (click, then finish), a grader and a re-grader.
    expect(history.filter(event => event.kind === "attempt")).toHaveLength(2 * 4);
  }, 120_000);

  it("keeps stub runs out of docs/comprehension-runs and real runs inside it", async () => {
    const manifest = (provider: "local-deterministic-stub" | "openai-compatible-chat") => createLiveManifest(inputs, {
      kind: "smoke", runId: `smoke-${provider}`, revision: "a".repeat(40), samplingSeed: "b".repeat(64), settings, taskIds: ["T1"],
      personaIds: [inputs.personas[0].id], build, skipped: [], blockers: [], modelIdentity: provider,
      inference: { label: provider === "local-deterministic-stub" ? STUB_LABEL : "provider-a/config-1", provider } });
    const docs = path.join(repositoryRoot, RECORD_ROOT), elsewhere = await temporary("inherit-comprehension-records-");
    await expect(RunRecord.create({ root: docs, date: "2026-09-28", manifest: manifest("local-deterministic-stub"), inputs, header, modelIdentifier: null }))
      .rejects.toThrow("never records under docs/comprehension-runs");
    await expect(RunRecord.create({ root: elsewhere, date: "2026-09-28", manifest: manifest("openai-compatible-chat"), inputs, header,
      modelIdentifier: "synthetic-placeholder-identifier" })).rejects.toThrow("nowhere else");
    await expect(RunRecord.create({ root: elsewhere, date: "2026-09-28", manifest: manifest("local-deterministic-stub"), inputs, header,
      modelIdentifier: "synthetic-placeholder-identifier" })).rejects.toThrow("the stub has none");
    expect(labelProblem("provider-a/config-1", "vendor-large-2")).toBeUndefined();
    expect(labelProblem("vendor/config-1", "vendor-large-2")).toMatch(/must not contain/);
  });
});

describe("the local run configuration", () => {
  const paid = { schemaVersion: 1, kind: "calibration", effortDirectory: "/private/effort", tasks: ["T1"], personas: 5,
    samplingSeed: "d".repeat(64), settings: { ...settings, price: { inputMicroDollarsPerMillion: 1_000_000, outputMicroDollarsPerMillion: 5_000_000 } },
    limitMicroDollars: 50_000_000, otherCostsMicroDollars: 0,
    provider: { kind: "openai-compatible-chat", label: "provider-a/config-1", endpoint: "https://gateway.invalid/v1",
      modelIdentifier: "synthetic-placeholder-identifier", apiKeyVariable: "COMPREHENSION_MODEL_API_KEY" } };

  it("accepts real prices, and refuses an absurd price, an identifying label, or a paid full run with no calibration", () => {
    expect(runConfigSchema.parse(paid).settings.price.outputMicroDollarsPerMillion).toBe(5_000_000);
    const absurd = structuredClone(paid); absurd.settings.price.outputMicroDollarsPerMillion = 100_000_001;
    expect(runConfigSchema.safeParse(absurd).success).toBe(false);
    expect(runConfigSchema.safeParse({ ...paid, provider: { ...paid.provider, label: "placeholder/config-1" } }).success).toBe(false);
    expect(runConfigSchema.safeParse({ ...paid, kind: "live-run" }).success).toBe(false);
    expect(runConfigSchema.safeParse({ ...paid, kind: "live-run", calibration: "/records/calibration" }).success).toBe(true);
    expect(runConfigSchema.safeParse({ ...paid, provider: { kind: "local-deterministic-stub" } }).success).toBe(false);
  });

  it("keeps one set of settings across runs of one configuration, and starts a new one when the model changes", () => {
    const digest = (raw: typeof paid) => {
      const config = runConfigSchema.parse(raw);
      return createLiveManifest(inputs, { kind: "calibration", runId: "digest", revision: "a".repeat(40), samplingSeed: config.samplingSeed,
        settings: config.settings, taskIds: ["T1"], personaIds: [inputs.personas[0].id], inference: inferenceOf(config),
        modelIdentity: modelIdentityOf(config), build, skipped: [], blockers: [] });
    };
    const first = digest(paid);
    expect(first.settingsDigest).toBe(digest(structuredClone(paid)).settingsDigest);
    expect(first.settingsDigest).not.toBe(digest({ ...paid, provider: { ...paid.provider, modelIdentifier: "another-synthetic-identifier" } }).settingsDigest);
    // The run manifest, which the journal stores, never carries the identifier.
    expect(JSON.stringify(first)).not.toContain("synthetic-placeholder-identifier");
    expect(modelIdentifierOf(runConfigSchema.parse(paid))).toBe("synthetic-placeholder-identifier");
  });
});

// ---- The stopping rule over committed records. Fabricated instrument
// ---- fixtures only; never comprehension results.
function fullRecord(runId: string, options: { revision?: string; temperature?: number; failT1?: number; skipEmbryo?: boolean } = {}): LoadedRecord {
  const personaIds = inputs.personas.map(persona => persona.id);
  const manifest: LiveManifest = createLiveManifest(inputs, { kind: "live-run", runId, revision: options.revision ?? "a".repeat(40),
    samplingSeed: "d".repeat(64), settings: { ...settings, temperature: options.temperature ?? 0 },
    taskIds: ["T1", "T2", "T3", "T4", "T5", "T6", "T7", "T8", "T9", "T10"], personaIds,
    inference: { label: "provider-a/config-1", provider: "openai-compatible-chat" }, modelIdentity: "synthetic-placeholder-identifier", build,
    skipped: options.skipEmbryo ? seedSkips() : [], blockers: [] });
  const sample = regradeSample(personaIds, manifest.samplingSeed);
  const verdict = { passed: true, prohibited: false, noRouteFound: false };
  const lines: RecordLine[] = manifest.taskIds.flatMap(taskId => personaIds.map((personaId, index): RecordLine => {
    const sessionId = `${runId}-${taskId}-${personaId}`;
    if (options.skipEmbryo && (taskId === "T6" || taskId === "T7")) return { taskId, personaId, sessionId, status: "skipped", reason: "blocked" };
    const passed = !(taskId === "T1" && index < (options.failT1 ?? 0));
    return { taskId, personaId, sessionId, status: "answered", completed: true, actions: 3, entries: 0, answer: "Synthetic instrument answer.",
      verdict: { ...verdict, passed }, regrade: sample.has(`${taskId}/${personaId}`) ? { ...verdict, passed } : null,
      deterministic: { class: ["T5", "T6", "T7"].includes(taskId) ? taskId : null, hit: null } };
  }));
  const record: LoadedRecord = { directory: runId, status: "completed", startedAt: `2026-09-${runId.padStart(2, "0")}`, manifest, lines };
  record.recordedAssessment = checkRecord(record).assessment;
  return record;
}

describe("the stopping rule over committed full runs", () => {
  it("is met only by the last two full runs, clean, on one revision and one set of settings", () => {
    expect(gateStatus([fullRecord("1"), fullRecord("2")]).met).toBe(true);
    expect(gateStatus([fullRecord("1")]).met).toBe(false);
    expect(gateStatus([fullRecord("1"), fullRecord("2", { temperature: 0.5 })]).met).toBe(false);
    expect(gateStatus([fullRecord("1"), fullRecord("2", { failT1: 4 }), fullRecord("3")]).met).toBe(false);
    expect(gateStatus([fullRecord("1"), fullRecord("2", { failT1: 3 })]).met).toBe(true);
  });

  it("never lets a run with skipped embryo tasks count as clean", () => {
    const status = gateStatus([fullRecord("1", { skipEmbryo: true }), fullRecord("2", { skipEmbryo: true })]);
    expect(status.met).toBe(false);
    expect(status.fullRuns[1].qualifying).toBe(false);
    expect(status.fullRuns[1].failures).toContain("T6: 30/30 skipped, not answered: blocked");
    expect(status.fullRuns[1].failures).toContain("blocker: T6-skipped");
    expect(status.fullRuns[1].failures).toContain("T7: 30/30 skipped, not answered: blocked");
    expect(status.fullRuns[1].failures).toContain("blocker: T7-skipped");
  });

  it("sends the capability to the withheld path after three successive failed revisions", () => {
    const failing = (runId: string, revision: string) => fullRecord(runId, { revision: revision.repeat(40), failT1: 10 });
    const status = gateStatus([failing("1", "a"), failing("2", "b"), failing("3", "c"), failing("4", "d")]);
    expect(status).toMatchObject({ met: false, failedRevisions: 3, withheldPathRequired: true });
    expect(gateStatus([failing("1", "a"), fullRecord("2", { revision: "b".repeat(40) }), fullRecord("3", { revision: "b".repeat(40) }),
      failing("4", "c")]).failedRevisions).toBe(0);
  });

  it("re-derives every pattern result and the assessment, and flags a record that disagrees", () => {
    const record = fullRecord("1");
    expect(checkRecord(record).problems).toEqual([]);
    const line = record.lines.find(candidate => candidate.status === "answered" && candidate.taskId === "T7")!;
    if (line.status !== "answered") throw new Error("fixture");
    line.answer = "It increases the risk by 40%.";
    expect(checkRecord(record).problems[0]).toMatch(/recorded pattern result null but the patterns now give/);
    expect(checkRecord(record).problems).toContain("Recorded assessment differs from the recomputed one");
  });
});
