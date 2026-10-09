import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import http from "node:http";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { runLive } from "../scripts/comprehension/conductor";
import { taskIds, type LiveEnvironment } from "../scripts/comprehension/conductor-contract";
import { createLiveManifest, loadConductorInputs, repositoryRoot, seedSkips } from "../scripts/comprehension/conductor-inputs";
import { isolatedProcesses, probeIsolation } from "../scripts/comprehension/inference-isolation";
import { InstrumentJournal } from "../scripts/comprehension/instrument-journal";
import { type LiveSession } from "../scripts/comprehension/live-browser";
import { inferenceOf, modelIdentifierOf, modelIdentityOf, runConfigSchema, workerProvider } from "../scripts/comprehension/run-config";
import { RECORD_ROOT, readRecordManifest, RunRecord, runSummary } from "../scripts/comprehension/run-record";
import { EMAIL_LABEL } from "../src/copy/family/invite";
import { openComprehensionAccountSession } from "./comprehension-account-session";
import { createConfirmedUser, signIn } from "./helpers";

/**
 * The comprehension harness's live run (G3.1). Never part of the browser
 * suite: `playwright.config.ts` runs this file only in its own project when
 * `pnpm comprehension:run` sets INHERIT_COMPREHENSION_RUN=1, because it is
 * stochastic by construction and G8.4 excludes it from "the whole suite".
 *
 * It drives the production build this suite serves on port 3100 under the
 * TEST-LOCAL jurisdiction, and checks both before the first session: the
 * served build is the one `.next/BUILD_ID` names, and a declared account sees
 * a capability only TEST-LOCAL permits. Every simulation then gets:
 *
 *  - its own browser context (`live-browser.ts`), reaching only the app and
 *    its local Supabase API;
 *  - its own account, seeded from `bindings.json` through the product's own
 *    path exactly as `e2e/comprehension-participants.spec.ts` builds the named
 *    accounts, under an address unique to the session, so no simulation sees
 *    another's deletions, invitations, consents or history;
 *  - a fresh isolated process per inference call (`inference-isolation.ts`).
 *
 * T9's fixture follows the owner's 28 September decision and the measured
 * path in `e2e/task-depth.spec.ts`: another adult reserves a record for the
 * participant's address and invites them in their own context, and the
 * participant starts signed out at the home page with that one email in an
 * inbox beside the browser. Opening it is an entry, never a counted action.
 * This shared-stack entrypoint holds T6/T7. The exclusive participant-c
 * launcher supplies each task/persona a fresh signed-parent publication and
 * native read/action context; it cannot adopt this already-running stack.
 * Neither a shared-stack skip nor an unverified fresh lifecycle is evidence.
 *
 * The pinned model identifier is written only into the run record's
 * `manifest.json` (owner decision, 25 September 2026). Nothing here logs it,
 * and no assertion compares it in a way that would print it on failure.
 */
const CONFIG = process.env.INHERIT_COMPREHENSION_CONFIG;
const ENABLED = process.env.INHERIT_COMPREHENSION_RUN === "1";
const PASSWORD = "e2e-comprehension-participant-pw";
const BASE_URL = "http://localhost:3100";

/** Mail the app sends through its configured provider, captured locally. */
async function captureMail() {
  const captured: { to: string[] | string; subject?: string; html?: string; text?: string }[] = [];
  const server = http.createServer((incoming, response) => {
    let body = "";
    incoming.on("data", chunk => { body += chunk; });
    incoming.on("end", () => {
      if (incoming.method === "POST" && incoming.url?.includes("/emails")) {
        captured.push(JSON.parse(body));
        response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ id: `comprehension-${captured.length}` }));
        return;
      }
      response.writeHead(200).end("{}");
    });
  });
  await new Promise<void>(resolve => server.listen(8124, "127.0.0.1", resolve));
  return { captured, close: () => new Promise<void>(resolve => server.close(() => resolve())) };
}

test("a comprehension run against the local production build under TEST-LOCAL", async ({ browser, request }) => {
  test.setTimeout(0);
  if (!ENABLED || !CONFIG) throw new Error("Run this only through pnpm comprehension:run with a local run configuration");
  const config = runConfigSchema.parse(JSON.parse(readFileSync(CONFIG, "utf8")));
  const inputs = loadConductorInputs();
  const real = config.provider.kind !== "local-deterministic-stub";
  const git = (...args: string[]) => execFileSync("git", args, { cwd: repositoryRoot, encoding: "utf8" }).trim();
  const revision = git("rev-parse", "HEAD");
  const dirty = git("status", "--porcelain", "--untracked-files=no") !== "";

  // The served build is this checkout's production build.
  const buildId = readFileSync(path.join(repositoryRoot, ".next/BUILD_ID"), "utf8").trim();
  expect(buildId, "a production build id").not.toBe("development");
  expect((await request.get(`/_next/static/${buildId}/_buildManifest.js`)).status(), "the server serves this build").toBe(200);

  const runId = `${config.kind}-${new Date().toISOString().slice(0, 10)}-${randomUUID().slice(0, 8)}`;
  const short = runId.slice(-8);
  // TEST-LOCAL: a declared account can open a capability no real jurisdiction permits.
  {
    const context = await browser.newContext({ baseURL: BASE_URL });
    const page = await context.newPage();
    const email = `cmp-${short}-probe@e2e.local`;
    await createConfirmedUser(email, PASSWORD);
    await signIn(page, email, PASSWORD);
    await page.goto("/family/invite");
    await expect(page.getByLabel(EMAIL_LABEL), "third_party_adult_analysis is permitted, so TEST-LOCAL is active").toBeVisible();
    await expect(page.getByRole("heading", { name: "Not available in this jurisdiction yet" })).toHaveCount(0);
    await context.close();
  }

  const isolation = await probeIsolation(workerProvider(config));
  expect(isolation, "every inference process is isolated").toMatchObject({ cwdOutsideRepository: true, allowedKeysOnly: true });

  const journal = await InstrumentJournal.open(config.effortDirectory, config.limitMicroDollars, config.otherCostsMicroDollars,
    real ? "live" : "dry");
  const selected = config.tasks ?? [...taskIds];
  const personas = inputs.personas.slice(0, config.personas ?? 30);
  const skipped = seedSkips().filter(skip => selected.includes(skip.taskId));
  const inference = inferenceOf(config);
  const draft = (blockers: string[]) => createLiveManifest(inputs, { kind: config.kind, runId, revision, samplingSeed: config.samplingSeed,
    settings: config.settings, t6Variant: config.t6Variant, taskIds: selected, personaIds: personas.map(persona => persona.id), inference,
    modelIdentity: modelIdentityOf(config), build: { baseUrl: BASE_URL, buildId, jurisdiction: "TEST-LOCAL" }, skipped, blockers });
  const blockers = dirty ? ["working-tree-differs-from-revision"] : [];
  let calibration: { runId: string; perSimulationMaxMicroDollars: number } | null = null;
  if (real && config.kind === "live-run") {
    // A paid full run must be bounded by a measured calibration on the same
    // provider configuration and settings, and fit what the journal has left.
    const measured = await readRecordManifest(path.resolve(config.calibration!));
    const planned = draft(blockers);
    expect(measured.status).toBe("completed");
    expect(measured.manifest.kind).toBe("calibration");
    expect(measured.manifest.inference).toEqual(inference);
    // A boolean, so a mismatch never prints either identifier into a report.
    expect(measured.model?.identifier === modelIdentifierOf(config), "calibrated on the same model").toBe(true);
    expect(measured.manifest.settingsDigest, "calibrated on the same settings").toBe(planned.settingsDigest);
    expect(measured.spend?.simulations ?? 0).toBeGreaterThan(0);
    const sessions = (selected.length - skipped.length) * personas.length;
    const projected = Math.ceil(measured.spend!.perSimulationMaxMicroDollars * sessions * 1.25);
    expect(projected, "projected spend fits the remaining approved budget").toBeLessThanOrEqual(journal.budget.remaining);
    calibration = { runId: measured.manifest.runId, perSimulationMaxMicroDollars: measured.spend!.perSimulationMaxMicroDollars };
  } else if (real) blockers.push("provider-token-and-cost-bounds-unverified");
  const manifest = draft(blockers);
  const record = await RunRecord.create({ root: real ? path.join(repositoryRoot, RECORD_ROOT) : config.stubRecordRoot!,
    date: new Date().toISOString().slice(0, 10), manifest, inputs, modelIdentifier: modelIdentifierOf(config),
    header: { startedAt: new Date().toISOString(), isolation,
      build: { mode: "next start (production build)", buildIdVerified: true, testJurisdictionVerified: true },
      budget: { limitMicroDollars: config.limitMicroDollars, otherCostsMicroDollars: config.otherCostsMicroDollars,
        remainingAtStartMicroDollars: journal.budget.remaining }, calibration } });

  const mail = await captureMail();
  const sessions = new Map<string, LiveSession>();
  // The conductor records a failed session setup only as a stopped run. Say
  // why, so the operator can act: setup is seeding and the browser, and never
  // touches the model, so nothing here can carry the model identifier.
  const openBrowser: LiveEnvironment["openBrowser"] = async (input, signal) => {
    try { return await openSession(input, signal); }
    catch (error) {
      console.error(`Session setup failed for ${input.taskId}: ${error instanceof Error ? error.message.split("\n")[0].slice(0, 300) : "unknown"}`);
      throw error;
    }
  };
  const openSession: LiveEnvironment["openBrowser"] = async ({ id, taskId, account: accountId }) => {
    if (accountId === "participant-c") throw new Error("The shared-stack runner cannot adopt participant-c; use the exclusive fresh launcher");
    const session = await openComprehensionAccountSession({ browser, id, taskId, accountId,
      email: `cmp-${short}-${id.slice(0, 8)}@e2e.local`, mail: mail.captured });
    sessions.set(id, session);
    return session;
  };


  try {
    const result = await runLive({ manifest, inputs, journal, modelIdentity: modelIdentityOf(config),
      environment: { kind: "live-local-build", openBrowser, openProcess: isolatedProcesses(workerProvider(config)) },
      onSession: async outcome => {
        const session = sessions.get(outcome.sessionId);
        sessions.delete(outcome.sessionId);
        const diagnostics = session?.diagnostics();
        await record.append(outcome, diagnostics && { entryChannels: diagnostics.entryChannels,
          failedActions: diagnostics.failedActions, refusedValues: diagnostics.refusedValues });
      } });
    const spend = await record.finish({ status: result.status, failure: "failure" in result ? result.failure : undefined,
      assessment: result.assessment, qualifyingEvidence: manifest.qualifyingEvidence, blockers: manifest.blockers });
    console.log(JSON.stringify(runSummary({ directory: record.directory, status: result.status, manifest, spend,
      assessment: result.assessment }), null, 2));
    expect(result.status, "the run completed; a stopped run is recorded with its reason").toBe("completed");
  } finally {
    await journal.close();
    await mail.close();
  }
});
