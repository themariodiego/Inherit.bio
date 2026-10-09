/**
 * `pnpm comprehension:run <config.json> [--plan | --close-revision]`
 *
 * Validates the operator's local run configuration, prints what the run will
 * do and the most it can reserve, and then runs `e2e/comprehension-run.spec.ts`
 * through the same bootstrap as the browser suite: the production build under
 * TEST-LOCAL on port 3100, the local Supabase stack and the real Storage
 * provider proxy. `--plan` prints the plan and stops.
 *
 * Nothing here prints a credential. For a real provider it only checks that
 * the named variable is set in this shell.
 */
import { spawn } from "node:child_process";
import { maximumTokenCost } from "./budget";
import { taskIds } from "./conductor-contract";
import { seedSkips } from "./conductor-inputs";
import { InstrumentJournal } from "./instrument-journal";
import { inferenceOf } from "./run-config";
import { loadPrivateRunConfig } from "./private-run-config";

const argv = process.argv.slice(2);
const planOnly = argv.includes("--plan");
const file = argv.find(argument => !argument.startsWith("--")) ?? process.env.INHERIT_COMPREHENSION_CONFIG;
if (!file) throw new Error("Usage: pnpm comprehension:run <absolute path to run configuration> [--plan | --close-revision]");
const configPath = file;
const config = loadPrivateRunConfig(configPath);

if (argv.includes("--close-revision")) {
  // Before full runs move to a new product revision, close the one they were
  // on. Closure reads that revision's last two full runs: clean on the same
  // settings, or a failed revision. Three failed revisions in a row stop every
  // further run, and the affected capability enters the withheld path.
  const journal = await InstrumentJournal.open(config.effortDirectory, config.limitMicroDollars, config.otherCostsMicroDollars,
    config.provider.kind === "local-deterministic-stub" ? "dry" : "live");
  try {
    const revision = journal.history.revision;
    if (revision) await journal.append({ kind: "close-revision", revision });
    console.log(JSON.stringify({ closed: revision ?? null, withheldPathRequired: journal.history.revisionStopRequired }, null, 2));
  } finally { await journal.close(); }
  process.exit(0);
}
const tasks = config.tasks ?? [...taskIds];
const personas = config.personas ?? 30;
const skipped = seedSkips().filter(skip => tasks.includes(skip.taskId));
const sessions = (tasks.length - skipped.length) * personas;
const perCall = maximumTokenCost(config.settings.maximumInputTokens, config.settings.maximumOutputTokens, config.settings.price);
// A session makes at most maxSteps participant calls, one grading call and,
// in a partial run or for a sampled answer, one re-grading call; each may be
// retried up to maxAttempts times, and every attempt reserves its maximum.
const perSessionCeiling = perCall * (config.settings.maxSteps + 2) * config.settings.maxAttempts;
if (config.provider.kind === "openai-compatible-chat" && !process.env[config.provider.apiKeyVariable]) {
  throw new Error(`Credential variable ${config.provider.apiKeyVariable} is not set in this shell`);
}
console.log(JSON.stringify({
  kind: config.kind, inference: inferenceOf(config).label, tasks, personas, skipped, sessions,
  maximumReservationPerCallMicroDollars: perCall, worstCaseReservationPerSessionMicroDollars: perSessionCeiling,
  approvedLimitMicroDollars: config.limitMicroDollars, otherCostsMicroDollars: config.otherCostsMicroDollars,
  record: config.provider.kind === "local-deterministic-stub" ? config.stubRecordRoot : "docs/comprehension-runs",
  note: "Reservations are ceilings, settled down to certain provider usage after each call. A paid full run also needs a calibration record whose measured cost, projected over these sessions with a 25% margin, fits the remaining budget.",
}, null, 2));
if (!planOnly) {
  const child = spawn("corepack", ["pnpm", "exec", "tsx", "scripts/run-upload-browser.mts", "--full", "--", "comprehension-run.spec.ts"],
    { stdio: "inherit", env: { ...process.env, INHERIT_COMPREHENSION_RUN: "1", INHERIT_COMPREHENSION_CONFIG: configPath } });
  child.once("exit", code => { process.exitCode = code ?? 1; });
}
