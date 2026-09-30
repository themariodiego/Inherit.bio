import { execFile } from "node:child_process";
import { chmod, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { runLive } from "./conductor";
import type { LiveEnvironment, Settings } from "./conductor-contract";
import { createLiveManifest, loadConductorInputs, repositoryRoot } from "./conductor-inputs";
import { isolatedProcesses } from "./inference-isolation";
import { InstrumentJournal } from "./instrument-journal";
import { identityLeaks, listRecords, repositorySources } from "./records";
import { inferenceOf, modelIdentifierOf, modelIdentityOf, runConfigSchema, workerProvider } from "./run-config";
import { RECORD_ROOT, RunRecord, runSummary } from "./run-record";

/**
 * The owner's decision of 25 September 2026: the pinned model identifier and
 * temperature appear only in the run records under docs/comprehension-runs,
 * and stay out of commit messages, pull-request text, comments and code.
 * Everything below uses a synthetic identifier; nothing here is a model name.
 */
const IDENTIFIER = "synthetic-placeholder-identifier";
const KEY = "COMPREHENSION_TEST_KEY";
const inputs = loadConductorInputs();
const settings: Settings = { temperature: 0.4, graderTemperature: 0, maxSteps: 4, maxAttempts: 1, timeoutMs: 20_000,
  sessionSetupTimeoutMs: 20_000, maximumInputTokens: 24_000, maximumOutputTokens: 400,
  price: { inputMicroDollarsPerMillion: 1_000_000, outputMicroDollarsPerMillion: 5_000_000 } };
const roots: string[] = [], servers: http.Server[] = [];
afterEach(async () => {
  for (const server of servers.splice(0)) await new Promise(resolve => server.close(resolve));
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
async function temporary(prefix: string) { const root = await mkdtemp(path.join(tmpdir(), prefix)); roots.push(root); return root; }

async function fakeProvider() {
  const models: unknown[] = [];
  const server = http.createServer((request, response) => {
    let text = "";
    request.on("data", chunk => { text += chunk; });
    request.on("end", () => {
      const body = JSON.parse(text) as { model: unknown; messages: { content: string }[] };
      models.push(body.model);
      const grading = body.messages[0].content.startsWith("You grade");
      const content = grading ? '{"passed":true,"prohibited":false,"noRouteFound":false}' : '{"kind":"finish","answer":"It says the chance is somewhat higher, not certain."}';
      response.writeHead(200, { "content-type": "application/json" })
        .end(JSON.stringify({ choices: [{ message: { content } }], usage: { prompt_tokens: 800, completion_tokens: 30 } }));
    });
  });
  servers.push(server);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  return { models, endpoint: `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1` };
}

const browsers: LiveEnvironment["openBrowser"] = async ({ id }) => ({ id,
  async observe() { return { path: "/genome/me/reports/type-2-diabetes-tcf7l2-rs7903146", controls: [], visibleText: "# A synthetic page" }; },
  async act() {}, async close() {},
  async record() { return { completed: true, path: ["/genome/me/reports/type-2-diabetes-tcf7l2-rs7903146"], actions: 3, entries: 0, confirmationExclusions: [] }; } });

async function filesUnder(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true, recursive: true });
  return entries.filter(entry => entry.isFile()).map(entry => path.join(entry.parentPath, entry.name));
}

describe("the pinned model identifier stays in the run record", () => {
  it("appears nowhere in the repository or its commit messages outside docs/comprehension-runs", async () => {
    const identifiers = (await listRecords()).map(record => record.modelIdentifier);
    const sources = repositorySources();
    expect(sources.filter(source => !source.name.startsWith("commit ")).length, "the scan read the tracked files").toBeGreaterThan(1000);
    expect(sources.some(source => source.name.startsWith("commit ")), "the scan read commit messages").toBe(true);
    expect(sources.some(source => source.name.startsWith(`${RECORD_ROOT}/`)), "the run records themselves are exempt").toBe(false);
    expect(identityLeaks(identifiers, sources)).toEqual([]);
  }, 60_000);

  it("finds a leak by where it is, without repeating the identifier", () => {
    const leaks = identityLeaks([IDENTIFIER, null], [{ name: "src/a.ts", text: `const model = "${IDENTIFIER.toUpperCase()}";` },
      { name: "commit abc", text: `Switch to ${IDENTIFIER}` }, { name: "docs/b.md", text: "nothing here" }]);
    expect(leaks).toEqual(["src/a.ts", "commit abc"]);
    expect(JSON.stringify(leaks)).not.toContain(IDENTIFIER);
  });

  it("writes it once into a real run's manifest.json and into no other file, journal or summary", async () => {
    const { models, endpoint } = await fakeProvider();
    const docsRepository = await temporary("inherit-comprehension-docs-"), effort = await temporary("inherit-comprehension-effort-");
    await chmod(effort, 0o700);
    const config = runConfigSchema.parse({ schemaVersion: 1, kind: "calibration", effortDirectory: effort, tasks: ["T1"], personas: 2,
      samplingSeed: "d".repeat(64), settings, limitMicroDollars: 1_000_000, otherCostsMicroDollars: 0,
      provider: { kind: "openai-compatible-chat", label: "provider-a/config-1", endpoint, modelIdentifier: IDENTIFIER, apiKeyVariable: KEY } });
    const manifest = createLiveManifest(inputs, { kind: "calibration", runId: "calibration-identity", revision: "a".repeat(40),
      samplingSeed: config.samplingSeed, settings, taskIds: ["T1"], personaIds: inputs.personas.slice(0, 2).map(persona => persona.id),
      inference: inferenceOf(config), modelIdentity: modelIdentityOf(config),
      build: { baseUrl: "http://localhost:3100", buildId: "synthetic-build", jurisdiction: "TEST-LOCAL" }, skipped: [], blockers: [] });
    const journal = await InstrumentJournal.open(effort, config.limitMicroDollars, 0, "live");
    const record = await RunRecord.create({ root: path.join(docsRepository, RECORD_ROOT), docsRepository, date: "2026-09-28", manifest, inputs,
      modelIdentifier: modelIdentifierOf(config), header: { startedAt: "2026-09-28T00:00:00.000Z",
        isolation: { cwdOutsideRepository: true, environmentKeys: [KEY, "LANG", "PATH"], allowedKeysOnly: true },
        build: { mode: "next start (production build)", buildIdVerified: true, testJurisdictionVerified: true },
        budget: { limitMicroDollars: 1_000_000, otherCostsMicroDollars: 0, remainingAtStartMicroDollars: 1_000_000 } } });
    const result = await runLive({ manifest, inputs, journal, modelIdentity: modelIdentityOf(config), onSession: outcome => record.append(outcome),
      environment: { kind: "live-local-build", openBrowser: browsers,
        openProcess: isolatedProcesses(workerProvider(config), { PATH: process.env.PATH, [KEY]: "synthetic-test-credential" }) } });
    const spend = await record.finish({ status: result.status, qualifyingEvidence: manifest.qualifyingEvidence, blockers: manifest.blockers });
    await journal.close();
    expect(result.status).toBe("completed");
    expect(models.length).toBeGreaterThan(0);
    expect(models.every(model => model === IDENTIFIER), "the provider was asked for the pinned model").toBe(true);

    const files = [...await filesUnder(effort), ...await filesUnder(docsRepository)];
    const carrying: string[] = [];
    for (const file of files) if ((await readFile(file, "utf8")).includes(IDENTIFIER)) carrying.push(path.relative(docsRepository, file));
    expect(carrying).toEqual([path.join(RECORD_ROOT, "2026-09-28", "calibration-identity", "manifest.json")]);
    const written = JSON.parse(await readFile(path.join(record.directory, "manifest.json"), "utf8"));
    expect(written.model).toEqual({ label: "provider-a/config-1", provider: "openai-compatible-chat", identifier: IDENTIFIER,
      temperature: { participant: 0.4, grader: 0 } });
    expect(JSON.stringify({ ...written, model: { ...written.model, identifier: null } })).not.toContain(IDENTIFIER);
    expect(JSON.stringify(runSummary({ directory: record.directory, status: result.status, manifest, spend }))).not.toContain(IDENTIFIER);
  }, 120_000);

  it("refuses to write it into a response line, or to record a real run without it", async () => {
    const docsRepository = await temporary("inherit-comprehension-docs-");
    const manifest = createLiveManifest(inputs, { kind: "smoke", runId: "smoke-identity", revision: "a".repeat(40), samplingSeed: "d".repeat(64),
      settings, taskIds: ["T1"], personaIds: [inputs.personas[0].id], inference: { label: "provider-a/config-1", provider: "openai-compatible-chat" },
      modelIdentity: IDENTIFIER, build: { baseUrl: "http://localhost:3100", buildId: "synthetic-build", jurisdiction: "TEST-LOCAL" },
      skipped: [], blockers: [] });
    const header = { startedAt: "2026-09-28T00:00:00.000Z", isolation: { cwdOutsideRepository: true, environmentKeys: [], allowedKeysOnly: true },
      build: { mode: "next start (production build)" as const, buildIdVerified: true, testJurisdictionVerified: true },
      budget: { limitMicroDollars: 1, otherCostsMicroDollars: 0, remainingAtStartMicroDollars: 1 } };
    const root = path.join(docsRepository, RECORD_ROOT);
    await expect(RunRecord.create({ root, docsRepository, date: "2026-09-28", manifest, inputs, header, modelIdentifier: null }))
      .rejects.toThrow("records its pinned model identifier");
    const record = await RunRecord.create({ root, docsRepository, date: "2026-09-29", manifest, inputs, header, modelIdentifier: IDENTIFIER });
    const response = { personaId: inputs.personas[0].id, taskId: "T1" as const, sessionId: "s1", completed: true, actions: 1, entries: 0,
      answer: `It mentioned ${IDENTIFIER.toUpperCase()} somewhere.`, verdict: { passed: false, prohibited: false, noRouteFound: false } };
    await expect(record.append({ status: "answered", taskId: "T1", personaId: response.personaId, sessionId: "s1", steps: [],
      record: { completed: true, path: ["/overview"], actions: 1, entries: 0, confirmationExclusions: [] }, response, costMicroDollars: 1 }))
      .rejects.toThrow("belongs only in manifest.json");
  });

  it("is never printed by the plan command", async () => {
    const directory = await temporary("inherit-comprehension-config-");
    const file = path.join(directory, "run.json");
    await mkdir(path.join(directory, "effort"), { mode: 0o700 });
    await writeFile(file, JSON.stringify({ schemaVersion: 1, kind: "calibration", effortDirectory: path.join(directory, "effort"),
      tasks: ["T1"], personas: 5, samplingSeed: "d".repeat(64), settings, limitMicroDollars: 50_000_000, otherCostsMicroDollars: 0,
      provider: { kind: "openai-compatible-chat", label: "provider-a/config-1", endpoint: "https://gateway.invalid/v1",
        modelIdentifier: IDENTIFIER, apiKeyVariable: KEY } }));
    const { stdout, stderr } = await promisify(execFile)(process.execPath, ["--import", "tsx", "scripts/comprehension/run.mts", file, "--plan"],
      { cwd: repositoryRoot, env: { PATH: process.env.PATH, [KEY]: "synthetic-test-credential" } as unknown as NodeJS.ProcessEnv });
    expect(stdout).toContain("provider-a/config-1");
    expect(stdout + stderr).not.toContain(IDENTIFIER);
  }, 60_000);
});
