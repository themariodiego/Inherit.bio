/** Separate hosted smoke/calibration launcher. Never invoked by standard CI,
 * never sets CI ownership variables, never borrows an existing cohort. */
import assert from "node:assert/strict";
import { assertSqlFixtureIncludes } from "../sql-fixture-includes";
import { randomUUID } from "node:crypto";
import { existsSync, lstatSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { APP_ENV_NAMES, assertCiRuntime } from "../ci-browser-config";
import { recordCiBuild } from "../ci-browser-runtime";
import { createLiveManifest, loadConductorInputs, repositoryRoot } from "./conductor-inputs";
import { runLive } from "./conductor";
import { isolatedProcesses, probeIsolation } from "./inference-isolation";
import { InstrumentJournal } from "./instrument-journal";
import { inferenceOf, modelIdentifierOf, modelIdentityOf, workerProvider } from "./run-config";
import { RECORD_ROOT, RunRecord, runSummary } from "./run-record";
import { acquireFreshStack, actualResourceIO, infrastructureChildEnvironment, infrastructureReservation } from "./fresh-t6-resources";
import { freshT6ConfigSchema } from "./fresh-t6-config";
import { openFreshParticipantCBrowser } from "./fresh-t6-browser";


async function main() {
  assertSqlFixtureIncludes();
  const argv = process.argv.slice(2), file = argv.find(value => !value.startsWith("--"));
  assert(file && path.isAbsolute(file) && argv.every(value => value === file || value === "--prepare" || value === "--plan"),
    "Use an absolute private configuration and only --prepare or --plan");
  const stat = lstatSync(file);
  assert(stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1 && (stat.mode & 0o777) === 0o600
    && stat.uid === process.getuid?.() && realpathSync(file) === file, "Private exact configuration file required");
  for (let directory = path.dirname(file); ; directory = path.dirname(directory)) {
    assert(!existsSync(path.join(directory, ".git")), "Run configuration must stay outside Git");
    if (directory === path.dirname(directory)) break;
  }
  const config = freshT6ConfigSchema.parse(JSON.parse(readFileSync(file, "utf8")));
  const run = config.run;
  if (argv.includes("--plan")) {
    console.log(JSON.stringify({ tasks: ["T6"], personas: run.personas ?? 30, freshStacks: (run.personas ?? 30) + 1,
      infrastructureReservationMicroDollars: infrastructureReservation(run.personas ?? 30, config.maximumInfrastructureCostPerStackMicroDollars, run.limitMicroDollars - run.otherCostsMicroDollars),
      qualifyingEvidence: false, hostedOwnershipRequired: true, T7: "unrun: fresh native no-model read/action not enabled in this T6-only launcher" })); return;
  }
  assertCiRuntime(process.env);
  assert(process.env.GITHUB_JOB === "fresh-t6", "Separate fresh-t6 hosted job required; standard CI cannot launch inference");
  const journal = await InstrumentJournal.open(run.effortDirectory, run.limitMicroDollars, run.otherCostsMicroDollars,
    run.provider.kind === "local-deterministic-stub" ? "dry" : "live");
  try {
    infrastructureReservation(run.personas ?? 30, config.maximumInfrastructureCostPerStackMicroDollars, journal.budget.remaining);
    if (argv.includes("--prepare")) {
      await journal.budget.reserve(`fresh-build-${randomUUID()}`, config.maximumInfrastructureCostPerStackMicroDollars);
      const stack = await acquireFreshStack(new AbortController().signal);
      try {
        assert(Object.entries(stack.keys).every(([name, value]) => process.env[name] === value), "Fresh keys must match the configured build inputs");
        const env = { ...infrastructureChildEnvironment(process.env), NEXT_TELEMETRY_DISABLED: "1",
          ...Object.fromEntries(APP_ENV_NAMES.flatMap(name => process.env[name] ? [[name, process.env[name]!]] : [])) };
        await actualResourceIO.command("pnpm", ["build"], { env, timeout: 600_000 });
        recordCiBuild();
      } finally { await stack.close(); }
    }
    const inputs = loadConductorInputs();
    const revision = await actualResourceIO.command("git", ["rev-parse", "HEAD"]);
    assert(!(await actualResourceIO.command("git", ["status", "--porcelain", "--untracked-files=no"])), "Exact clean source required");
    const buildId = readFileSync(path.join(repositoryRoot, ".next/BUILD_ID"), "utf8").trim();
    assert(buildId && buildId !== "development", "Production build required");
    const isolation = await probeIsolation(workerProvider(run));
    const manifest = createLiveManifest(inputs, { kind: run.kind, runId: `${run.kind}-${new Date().toISOString().slice(0, 10)}-${randomUUID().slice(0, 8)}`,
      revision, samplingSeed: run.samplingSeed, settings: run.settings, taskIds: ["T6"], personaIds: inputs.personas.slice(0, run.personas ?? 30).map(persona => persona.id),
      t6Variant: "standard", inference: inferenceOf(run), modelIdentity: modelIdentityOf(run),
      build: { baseUrl: "http://localhost:3105", buildId, jurisdiction: "TEST-LOCAL" }, skipped: [],
      blockers: ["T6-only-partial-round", "T7-fresh-native-read-not-yet-enabled", "fresh-runtime-lifecycle-not-yet-hosted-verified"] });
    const record = await RunRecord.create({ root: run.provider.kind === "local-deterministic-stub" ? run.stubRecordRoot! : path.join(repositoryRoot, RECORD_ROOT),
      date: new Date().toISOString().slice(0, 10), manifest, inputs, modelIdentifier: modelIdentifierOf(run),
      header: { startedAt: new Date().toISOString(), isolation,
        // Each persona verifies build identity and TEST-LOCAL through the real
        // upload door; no up-front browser probe is claimed here.
        build: { mode: "next start (production build)", buildIdVerified: false, testJurisdictionVerified: false },
        budget: { limitMicroDollars: run.limitMicroDollars, otherCostsMicroDollars: run.otherCostsMicroDollars,
          remainingAtStartMicroDollars: journal.budget.remaining } } });
    const result = await runLive({ inputs, manifest, journal, modelIdentity: modelIdentityOf(run),
      environment: { kind: "live-local-build", openBrowser: async (input, signal) => {
        await journal.budget.reserve(`fresh-stack-${input.id}`, config.maximumInfrastructureCostPerStackMicroDollars);
        // No invoice/hosting receipt is invented: retain the whole reservation
        // permanently, including failed or uncertain setup. A repeated run
        // charges new reservations in the same effort journal.
        return openFreshParticipantCBrowser(input, signal);
      }, openProcess: isolatedProcesses(workerProvider(run)) },
      onSession: outcome => record.append(outcome) });
    const spend = await record.finish({ status: result.status, failure: "failure" in result ? result.failure : undefined,
      assessment: result.assessment, qualifyingEvidence: false, blockers: manifest.blockers });
    console.log(JSON.stringify(runSummary({ directory: record.directory, status: result.status, manifest, spend }), null, 2));
    if (result.status !== "completed") process.exitCode = 1;
  } finally { await journal.close(); }
}

// Importing the schema in unit checks does not create resources or inference.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(() => { console.error("Fresh T6 run stopped; inspect the private journal and ownership receipt. No diagnostics or credentials printed."); process.exitCode = 1; });
}
