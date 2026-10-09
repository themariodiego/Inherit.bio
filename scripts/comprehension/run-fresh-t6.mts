/** Separate hosted complete-round launcher. Never invoked by standard CI,
 * never sets CI ownership variables, never borrows an existing cohort. */
import assert from "node:assert/strict";
import { assertSqlFixtureIncludes } from "../sql-fixture-includes";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { APP_ENV_NAMES, assertCiRuntime } from "../ci-browser-config";
import { recordCiBuild } from "../ci-browser-runtime";
import { bindingSkips, createLiveManifest, loadConductorInputs, repositoryRoot } from "./conductor-inputs";
import { runLive } from "./conductor";
import { isolatedProcesses, probeIsolation } from "./inference-isolation";
import { InstrumentJournal } from "./instrument-journal";
import { inferenceOf, modelIdentifierOf, modelIdentityOf, workerProvider } from "./run-config";
import { RECORD_ROOT, readRecordManifest, RunRecord, runSummary } from "./run-record";
import { acquireFreshStack, actualResourceIO, infrastructureChildEnvironment, infrastructureReservation } from "./fresh-t6-resources";
import { taskIds } from "./conductor-contract";
import { freshT6ConfigSchema } from "./fresh-t6-config";
import { loadPrivateConfiguration } from "./private-run-config";
import type { LiveSession } from "./live-browser";
import { openFreshComprehensionBrowser } from "./fresh-t6-browser";


async function main() {
  assertSqlFixtureIncludes();
  const argv = process.argv.slice(2), file = argv.find(value => !value.startsWith("--"));
  assert(file && path.isAbsolute(file) && argv.every(value => value === file || value === "--prepare" || value === "--plan"),
    "Use an absolute private configuration and only --prepare or --plan");
  const config = loadPrivateConfiguration(file, value => freshT6ConfigSchema.parse(value));
  const run = config.run;
  const tasks = run.tasks ?? [...taskIds], personas = run.personas ?? 30;
  if (argv.includes("--plan")) {
    console.log(JSON.stringify({ tasks, personas, sessions: personas * tasks.length, freshStacks: personas * tasks.length + 1, productionBuilds: 1,
      infrastructureReservationMicroDollars: infrastructureReservation(run.personas ?? 30, config.maximumInfrastructureCostPerStackMicroDollars, run.limitMicroDollars - run.otherCostsMicroDollars, tasks.length),
      qualifyingEvidence: false, hostedOwnershipRequired: true, nativeLifecycle: "unverified until the exact hosted smoke completes" })); return;
  }
  assertCiRuntime(process.env);
  assert(process.env.GITHUB_JOB === "fresh-t6", "Separate fresh-t6 hosted job required; standard CI cannot launch inference");
  const journal = await InstrumentJournal.open(run.effortDirectory, run.limitMicroDollars, run.otherCostsMicroDollars,
    run.provider.kind === "local-deterministic-stub" ? "dry" : "live");
  try {
    infrastructureReservation(run.personas ?? 30, config.maximumInfrastructureCostPerStackMicroDollars, journal.budget.remaining, tasks.length);
    if (argv.includes("--prepare")) {
      await journal.budget.reserve(`fresh-build-${randomUUID()}`, config.maximumInfrastructureCostPerStackMicroDollars);
      const stack = await acquireFreshStack(new AbortController().signal);
      try {
        assert(Object.entries(stack.keys).every(([name, value]) => process.env[name] === value), "Fresh keys must match the configured build inputs");
        const env = { ...infrastructureChildEnvironment(process.env), NEXT_TELEMETRY_DISABLED: "1",
          ...Object.fromEntries(APP_ENV_NAMES.flatMap(name => process.env[name] ? [[name, process.env[name]!]] : [])) };
        await actualResourceIO.command("pnpm", ["build"], { env, timeout: 600_000 });
        recordCiBuild(infrastructureChildEnvironment(process.env));
      } finally { await stack.close(); }
    }
    const inputs = loadConductorInputs();
    const revision = await actualResourceIO.command("git", ["rev-parse", "HEAD"]);
    assert(!(await actualResourceIO.command("git", ["status", "--porcelain", "--untracked-files=no"])), "Exact clean source required");
    const buildId = readFileSync(path.join(repositoryRoot, ".next/BUILD_ID"), "utf8").trim();
    assert(buildId && buildId !== "development", "Production build required");
    const isolation = await probeIsolation(workerProvider(run));
    const skipped = bindingSkips(JSON.parse(readFileSync(path.join(repositoryRoot, "scripts/comprehension/bindings.json"), "utf8")))
      .filter(skip => tasks.includes(skip.taskId));
    const blockers: string[] = [];
    if (run.kind === "live-run" && (tasks.length !== taskIds.length || personas !== 30)) blockers.push("not-a-complete-ten-task-round");
    let calibration: { runId: string; perSimulationMaxMicroDollars: number } | null = null;
    const draft = () => createLiveManifest(inputs, { kind: run.kind, runId: `${run.kind}-${new Date().toISOString().slice(0, 10)}-${randomUUID().slice(0, 8)}`,
      revision, samplingSeed: run.samplingSeed, settings: run.settings, taskIds: tasks, personaIds: inputs.personas.slice(0, run.personas ?? 30).map(persona => persona.id),
      t6Variant: "standard", inference: inferenceOf(run), modelIdentity: modelIdentityOf(run),
      build: { baseUrl: "http://localhost:3100", buildId, jurisdiction: "TEST-LOCAL" }, skipped,
      blockers });
    if (run.provider.kind !== "local-deterministic-stub" && run.kind === "live-run") {
      const measured = await readRecordManifest(path.resolve(run.calibration!));
      const planned = draft();
      assert(measured.status === "completed" && measured.manifest.kind === "calibration", "Completed calibration required");
      assert.deepEqual(measured.manifest.inference, planned.inference, "Calibration provider configuration differs");
      assert(measured.model?.identifier === modelIdentifierOf(run), "Calibration model differs");
      assert(measured.manifest.settingsDigest === planned.settingsDigest && (measured.spend?.simulations ?? 0) > 0,
        "Calibration settings or measured sessions differ");
      const projected = Math.ceil(measured.spend!.perSimulationMaxMicroDollars * personas * tasks.length * 1.25);
      const infrastructure = personas * tasks.length * config.maximumInfrastructureCostPerStackMicroDollars;
      assert(Number.isSafeInteger(projected + infrastructure) && projected + infrastructure <= journal.budget.remaining,
        "Calibrated model cost plus every fresh stack must fit the remaining approved budget");
      calibration = { runId: measured.manifest.runId, perSimulationMaxMicroDollars: measured.spend!.perSimulationMaxMicroDollars };
    } else if (run.provider.kind !== "local-deterministic-stub") blockers.push("provider-token-and-cost-bounds-unverified");
    const manifest = draft();
    const record = await RunRecord.create({ root: run.provider.kind === "local-deterministic-stub" ? run.stubRecordRoot! : path.join(repositoryRoot, RECORD_ROOT),
      date: new Date().toISOString().slice(0, 10), manifest, inputs, modelIdentifier: modelIdentifierOf(run),
      header: { startedAt: new Date().toISOString(), isolation,
        // Each fresh simulation verifies its served build and TEST-LOCAL
        // before inference; no up-front browser probe is claimed here.
        build: { mode: "next start (production build)", buildIdVerified: false, testJurisdictionVerified: false },
        budget: { limitMicroDollars: run.limitMicroDollars, otherCostsMicroDollars: run.otherCostsMicroDollars,
          remainingAtStartMicroDollars: journal.budget.remaining }, calibration } });
    const sessions = new Map<string, LiveSession>();
    const result = await runLive({ inputs, manifest, journal, modelIdentity: modelIdentityOf(run),
      environment: { kind: "live-local-build", openBrowser: async (input, signal) => {
        await journal.budget.reserve(`fresh-stack-${input.id}`, config.maximumInfrastructureCostPerStackMicroDollars);
        // No invoice/hosting receipt is invented: retain the whole reservation
        // permanently, including failed or uncertain setup. A repeated run
        // charges new reservations in the same effort journal.
        const session = await openFreshComprehensionBrowser(input, signal) as LiveSession;
        sessions.set(input.id, session);
        return session;
      }, openProcess: isolatedProcesses(workerProvider(run)) },
      onSession: async outcome => {
        const session = sessions.get(outcome.sessionId); sessions.delete(outcome.sessionId);
        const diagnostics = session?.diagnostics();
        await record.append(outcome, diagnostics && { entryChannels: diagnostics.entryChannels,
          failedActions: diagnostics.failedActions, refusedValues: diagnostics.refusedValues });
      } });
    const spend = await record.finish({ status: result.status, failure: "failure" in result ? result.failure : undefined,
      assessment: result.assessment, qualifyingEvidence: manifest.qualifyingEvidence, blockers: manifest.blockers });
    console.log(JSON.stringify(runSummary({ directory: record.directory, status: result.status, manifest, spend }), null, 2));
    if (result.status !== "completed") process.exitCode = 1;
  } finally { await journal.close(); }
}

// Importing the schema in unit checks does not create resources or inference.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(() => { console.error("Fresh comprehension run stopped; inspect the private journal and ownership receipt. No diagnostics or credentials printed."); process.exitCode = 1; });
}
