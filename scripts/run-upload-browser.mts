/** Local or disposable-CI production-browser proof with the installed Storage provider.
 * Full standard gate: pnpm e2e; focused local proof: node --import tsx scripts/run-upload-browser.mts
 * Append local-only Playwright selectors after --; CI never permits narrowing.
 * Lighthouse gate (G1.14 contract on the same served build, database and
 * Storage proxy, G1.16 when it runs on integration CI): pnpm e2e:lighthouse.
 * In CI it starts the main app variant through the same launcher the suite's
 * Playwright web server uses; locally the production build must already be
 * serving on http://localhost:3100.
 * No key files, Auth rotation, database resets or application test switches.
 * The browser's HTTP proxy routes Storage to an isolated provider process;
 * the app continues using the normal local stack and its identical DB/backend.
 */
import assert from "node:assert/strict";
import { assertSqlFixtureIncludes } from "./sql-fixture-includes";
import { assertEmbryoCiShard } from "./ci-browser-embryo-partitions";
import { startCiBrowserRuntime } from "./ci-browser-runtime";
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { generateKeyPairSync, randomUUID } from "node:crypto";
import { readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { localE2eProject, disposableProjectWorkdir, validateDisposableProjectConfig, disposableBootstrapKeys } from "./local-e2e-project";
import http from "node:http";
import { chromium } from "@playwright/test";
import { startLocalStorageProxy } from "./local-storage-browser-proxy";
import { assertLocalProviderEnvironment } from "./local-storage-browser-config";
import { appServerEnvironment } from "./ci-browser-app-environment";
import { ciBrowserShard } from "./ci-browser-shards";
import { readCiBrowserSetupTimings } from "./ci-browser-setup-timings";
import { assertCiRuntime } from "./ci-browser-config";
import { ciBrowserSourceIdentity } from "./ci-browser-shards-io";
import { writeFileSync } from "node:fs";

assertSqlFixtureIncludes();
const arguments_ = process.argv.slice(2);
const bootstrapStarted = performance.now();
const shard = ciBrowserShard(arguments_[0], process.env);
if (!["--lighthouse", "--bootstrap-only"].includes(arguments_[0] ?? "")) assertEmbryoCiShard(shard, process.env);
const shardSource = shard === null ? null : ciBrowserSourceIdentity();
if (shard !== null) {
  assertCiRuntime(process.env);
  readCiBrowserSetupTimings(process.env, shardSource!, shard);
}
const fullSuite = arguments_[0] === "--full" || shard !== null;
const bootstrapOnly = arguments_[0] === "--bootstrap-only";
const lighthouseGate = arguments_[0] === "--lighthouse";
if (fullSuite || bootstrapOnly || lighthouseGate) arguments_.shift();
assert(arguments_.length === 0 || arguments_[0] === "--", "Pass local Playwright selectors after --");
const selectors = arguments_.slice(1);
assert(shard === null || arguments_.length === 0, "CI shards have no selectors");
assertLocalProviderEnvironment(process.env, fullSuite, selectors, lighthouseGate);
const configuredProject = readFileSync(new URL("../supabase/config.toml", import.meta.url), "utf8")
  .match(/^project_id = "([A-Za-z0-9_-]+)"$/m)?.[1];
assert(configuredProject === "sequence", "Expected the unchanged canonical repository project");
const selectedProject = localE2eProject(process.env);
const project = selectedProject.projectId;
let bootstrapEnvironment: Record<string, string> = {};
let disposableWorkdir: string | undefined;
if (project !== "sequence") {
  disposableWorkdir = disposableProjectWorkdir(process.env);
  assert(realpathSync(disposableWorkdir) === disposableWorkdir, "Disposable workdir must not be a symlink");
  validateDisposableProjectConfig(readFileSync(path.join(disposableWorkdir, "supabase/config.toml"), "utf8"), selectedProject);
}
for (const service of ["db", "storage"]) {
  // Inspect only identity/liveness, never Config.Env (provider credentials).
  const identity = JSON.parse(execFileSync("docker", ["inspect", "--format",
    '{{json .Name}} {{json (index .Config.Labels "com.supabase.cli.project")}} {{json .State.Running}}',
    `supabase_${service}_${project}`], { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"], timeout: 15_000 })
    .trim().replace(/^("[^"]*") ("[^"]*") (true|false)$/, "[$1,$2,$3]"));
  assert.deepEqual(identity, [`/supabase_${service}_${project}`, project, true], "Exact running local Docker identity required");
}
if (disposableWorkdir) {
  // CLI output stays in memory. Never let exec/JSON exceptions print status
  // keys, a DB URL or provider diagnostics, and never fall back to sequence.
  try {
    const status = execFileSync(fileURLToPath(new URL("../node_modules/.bin/supabase", import.meta.url)),
      ["status", "--workdir", disposableWorkdir, "-o", "json"],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 15_000, maxBuffer: 65_536 });
    bootstrapEnvironment = disposableBootstrapKeys(JSON.parse(status), selectedProject);
  } catch { throw new Error("Selected disposable project bootstrap unavailable; no status diagnostics retained"); }
}
const sql = (query: string) => execFileSync("docker", ["exec", "-i", `supabase_db_${project}`,
  "psql", "-XAtq", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1"], {
  input: query, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"], timeout: 15_000,
}).trim();
if (process.env.CI) {
  // Only the fresh disposable job may initialize absent test capacity. Do not
  // overwrite existing settings, reset a database or alter shared local state.
  // 50MiB matches the repository Storage cap; this is not a hosted policy.
  sql(`insert into private.upload_authorization_config(singleton,auth_issuer,
    maximum_array_bytes,maximum_vcf_bytes,maximum_account_bytes,maximum_active_uploads)
    values(true,'http://127.0.0.1:54321/auth/v1',52428800,52428800,1073741824,32)
    on conflict(singleton) do nothing;`);
}
const policy = sql("select json_build_object('issuer',auth_issuer,'array',maximum_array_bytes,'vcf',maximum_vcf_bytes,'account',maximum_account_bytes,'active',maximum_active_uploads) from private.upload_authorization_config where singleton;");
const limits = JSON.parse(policy);
assert.equal(limits.issuer, `${selectedProject.apiOrigin}/auth/v1`, "Existing local issuer must match; never changed here");
for (const key of ["array", "vcf", "account", "active"]) {
  assert(Number.isSafeInteger(limits[key]) && limits[key] > 0, "Existing server capacity policy required");
}
const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
const kid = randomUUID();
const signer = JSON.stringify({ ...privateKey.export({ format: "jwk" }), kid });
const publicJwk = { ...publicKey.export({ format: "jwk" }), kid, alg: "ES256", use: "sig" };

let storageProxy: Awaited<ReturnType<typeof startLocalStorageProxy>> | undefined;
let tests: ChildProcess | undefined;
let appServer: ChildProcess | undefined;
let ciRuntime: Awaited<ReturnType<typeof startCiBrowserRuntime>> | undefined;
let stopping = false;
/** The served document the suite's web server also waits for before any test
 * runs; returns the Keep-Alive header the server advertised with it. */
async function waitForDocument(url: string, timeoutMs: number, exited: () => boolean): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  while (true) {
    assert(!exited(), "The app server exited before it served its first document");
    const answer = await new Promise<{ status: number; keepAlive: string }>(resolve => {
      const request = http.get(url, response => {
        response.resume();
        resolve({ status: response.statusCode ?? 0, keepAlive: String(response.headers["keep-alive"] ?? "") });
      });
      request.on("error", () => resolve({ status: 0, keepAlive: "" }));
      request.setTimeout(5000, () => request.destroy(new Error("Document timeout")));
    });
    if (answer.status >= 200 && answer.status < 400) return answer.keepAlive;
    assert(Date.now() < deadline, `No document at ${url} within ${timeoutMs} ms`);
    await new Promise(resolve => setTimeout(resolve, 500));
  }
}
async function stop() {
  if (stopping) return;
  stopping = true;
  if (tests?.pid) {
    // Kill the dedicated test process group, including its Next child servers.
    try { if (process.platform !== "win32") process.kill(-tests.pid, "SIGTERM"); else tests.kill("SIGTERM"); } catch {}
  }
  if (appServer && appServer.exitCode === null) appServer.kill("SIGTERM");
  await storageProxy?.close();
  ciRuntime?.stop();
}
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => { void stop().finally(() => process.exit(1)); });
}
try {
  storageProxy = await startLocalStorageProxy(project, publicJwk);
  if (!bootstrapOnly) {
    if (process.env.CI) ciRuntime = await startCiBrowserRuntime();
    const runtimeEnvironment = { ...process.env, ...bootstrapEnvironment, ...ciRuntime?.env, INHERIT_UPLOAD_SIGNING_JWK: signer,
      INHERIT_LOCAL_BROWSER_STORAGE_PROXY: storageProxy.url };
    if (lighthouseGate) {
      // The suite's Playwright configuration starts the main app variant as its
      // first web server; there is no Playwright here, so the same launcher is
      // started with the same configuration and the same document is awaited.
      // Locally the production build is expected to be serving already.
      const document = "http://localhost:3100/auth/sign-in";
      if (process.env.CI) {
        appServer = spawn("corepack", ["pnpm", "exec", "tsx", "scripts/ci-browser/server.mts", "host", "3100"], {
          stdio: ["ignore", "inherit", "inherit"], env: { ...runtimeEnvironment, ...appServerEnvironment(runtimeEnvironment, 3100) } });
        const server = appServer;
        const keepAlive = await waitForDocument(document, 300_000, () => server.exitCode !== null);
        // The flag the launcher passes must reach the server inside the container.
        assert(/\btimeout=65\b/.test(keepAlive), "The CI app server must keep idle connections for 65 s");
      } else {
        await waitForDocument(document, 5_000, () => false);
      }
    }
    // The Lighthouse gate audits the same served build, seeded database and
    // Storage proxy the suite uses, in the suite's own Chromium unless
    // SEQ_LH_CHROME names another. Its fixture upload must cross the proxy too.
    const bootstrapMs = Math.round(performance.now() - bootstrapStarted);
    tests = lighthouseGate
      ? spawn(process.execPath, ["--experimental-strip-types", "scripts/lighthouse-check.ts"], {
        detached: process.platform !== "win32", stdio: "inherit",
        env: { ...runtimeEnvironment, SEQ_LH_CHROME: process.env.SEQ_LH_CHROME ?? chromium.executablePath() } })
      : spawn("corepack", ["pnpm", "exec", "tsx", "scripts/run-e2e.ts",
        `--config=${fullSuite ? "playwright.config.ts" : "playwright.upload.config.ts"}`,
        ...(shard === null ? selectors : [`--ci-shard=${shard}/6`])], {
        detached: process.platform !== "win32", stdio: "inherit", env: runtimeEnvironment });
    const code = await new Promise<number>(resolve => {
      tests!.once("error", () => resolve(1)); tests!.once("exit", code => resolve(code ?? 1));
    });
    assert.equal(code, 0, lighthouseGate ? "Lighthouse gate failed" : "Browser suite or no-skip/no-retry gate failed");
    if (shard === null) assert(storageProxy.uploads() > 0, "No browser upload crossed the actual provider proxy");
    if (shard !== null) {
      // Publish coverage only after the unchanged actual-provider invariant.
      const receipt = JSON.parse(readFileSync("test-results/ci-browser-shard-pending.json", "utf8"));
      const setup = readCiBrowserSetupTimings(process.env, shardSource!, shard);
      writeFileSync("test-results/ci-browser-shard.json", JSON.stringify({ ...receipt, providerUploads: storageProxy.uploads(),
        timings: { ...receipt.timings, ...setup, bootstrapMs } }) + "\n",
        { mode: 0o600, flag: "wx" });
    }
    console.log(`PASS ${storageProxy.uploads()} browser upload(s) reached the installed provider through the loopback proxy.`);
  }
} finally {
  await stop();
}
