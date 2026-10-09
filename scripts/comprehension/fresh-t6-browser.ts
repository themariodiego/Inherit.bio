import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { generateKeyPairSync, randomUUID } from "node:crypto";
import http from "node:http";
import { chromium, expect, type Browser } from "@playwright/test";
import { startCiBrowserRuntime } from "../ci-browser-runtime";
import { withEmbryoJourney } from "../ci-embryo-journey";
import { freshT6AppEnvironments } from "./fresh-t6-app-environment";
import { acquireFreshStack, actualResourceIO, infrastructureChildEnvironment } from "./fresh-t6-resources";
import { repositoryRoot } from "./conductor-inputs";
import type { LiveEnvironment } from "./conductor-contract";
import { freshComprehensionSessions, type FreshComprehensionSimulation, type ParticipantCInput } from "./fresh-native-session";
import { openComprehensionAccountSession, type ComprehensionMail } from "../../e2e/comprehension-account-session";
import { createConfirmedUser, signIn, SUPABASE_URL } from "../../e2e/helpers";
import { EMAIL_LABEL } from "../../src/copy/family/invite";
import { readFileSync } from "node:fs";
import path from "node:path";
import { startLocalStorageProxy } from "../local-storage-browser-proxy";
import { chromiumStorageProxyArgs } from "../local-storage-browser-config";
import { openParticipantCReadSession } from "../../e2e/participant-c-harness";
import { seedParticipantC, participantCPassword } from "../../e2e/participant-c-journey";

function startApp(port: 3100 | 3105, runtime: Record<string, string>, app: Record<string, string>) {
  const env = { ...infrastructureChildEnvironment(process.env), ...app, ...runtime };
  const child = spawn(process.execPath, ["--import", "tsx", "scripts/ci-browser/server.mts", "host", String(port)],
    { cwd: repositoryRoot, env, stdio: ["ignore", "pipe", "pipe"] });
  child.stdout.resume(); child.stderr.resume(); // No credential-bearing app diagnostics.
  return child;
}
async function stopApp(child: ChildProcess) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => { child.kill("SIGKILL"); reject(new Error("App cleanup uncertain")); }, 8_000);
    child.once("error", () => { clearTimeout(timer); reject(new Error("App cleanup refused")); });
    child.once("exit", () => { clearTimeout(timer); resolve(); });
    child.kill("SIGTERM");
  });
}
async function ready(child: ChildProcess, port: number, signal: AbortSignal) {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    signal.throwIfAborted();
    assert(child.exitCode === null && child.signalCode === null, "Owned app exited before readiness");
    try { const result = await fetch(`http://localhost:${port}/`, { signal: AbortSignal.any([signal, AbortSignal.timeout(2_000)]), redirect: "manual" });
      if (result.status === 200) return;
    } catch { signal.throwIfAborted(); }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error("Owned app did not become ready");
}
async function mailCapture() {
  const messages: ComprehensionMail[] = [];
  const server = http.createServer((request, response) => {
    if (request.method !== "POST" || request.url !== "/emails") { response.writeHead(404).end(); return; }
    let size = 0; const chunks: Buffer[] = [];
    request.on("data", chunk => { size += chunk.length; if (size > 1_048_576) request.destroy(); else chunks.push(chunk); });
    request.on("end", () => {
      try {
        const message = JSON.parse(Buffer.concat(chunks).toString("utf8")) as ComprehensionMail;
        assert([message.to].flat().every(address => typeof address === "string" && /^cmp-(?:t6-)?[a-f0-9-]+(?:-parent|-reserver|-probe)?@e2e\.local$/.test(address)), "Synthetic recipient required");
        assert(typeof message.html === "string" && messages.length < 100, "Invalid synthetic mail");
        messages.push(message); response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ id: randomUUID() }));
      } catch { response.writeHead(400).end(); }
    });
  });
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(8124, "127.0.0.1", resolve); });
  return { messages, close: async () => {
    server.closeAllConnections(); await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  } };
}

/** No optional inference process is started here. The existing conductor opens
 * it only after this genuine publication is ready. Each call owns a full fresh
 * stack; its returned close disposes it before the next persona can begin. */
async function acquireSimulation(input: ParticipantCInput, signal: AbortSignal): Promise<FreshComprehensionSimulation> {
  const stack = await acquireFreshStack(signal);
  let runtime: Awaited<ReturnType<typeof startCiBrowserRuntime>> | undefined;
  let browser: Browser | undefined;
  let storageProxy: Awaited<ReturnType<typeof startLocalStorageProxy>> | undefined;
  let mail: Awaited<ReturnType<typeof mailCapture>> | undefined;
  const apps: ChildProcess[] = [];
  let closing: Promise<void> | undefined;
  const close = () => closing ??= (async () => {
    // Any failure stops the chain; the conductor retains resource-unresolved.
    await browser?.close();
    for (const app of apps.toReversed()) await stopApp(app);
    await mail?.close(); await storageProxy?.close(); runtime?.stop();
    await stack.close();
  })();
  try {
    assert(Object.entries(stack.keys).every(([name, value]) => process.env[name] === value), "Actual fresh bootstrap must match the built public configuration");
    await actualResourceIO.command(process.execPath, ["--import", "tsx", "scripts/seed.ts"], { signal,
      env: { ...infrastructureChildEnvironment(process.env), ...stack.keys }, timeout: 120_000 });
    const capacity = "insert into private.upload_authorization_config(singleton,auth_issuer,maximum_array_bytes,maximum_vcf_bytes,maximum_account_bytes,maximum_active_uploads) values(true,'http://127.0.0.1:54321/auth/v1',52428800,52428800,1073741824,32) on conflict(singleton) do nothing;";
    await actualResourceIO.command("docker", ["exec", "supabase_db_sequence", "psql", "-XAtq", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-c", capacity], { signal });
    runtime = await startCiBrowserRuntime(infrastructureChildEnvironment(process.env));
    const pair = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
    const signer = JSON.stringify({ ...pair.privateKey.export({ format: "jwk" }), kid: randomUUID() });
    const publicJwk = { ...pair.publicKey.export({ format: "jwk" }), kid: JSON.parse(signer).kid, alg: "ES256", use: "sig" };
    storageProxy = await startLocalStorageProxy("sequence", publicJwk, infrastructureChildEnvironment(process.env));
    const appEnvironments = freshT6AppEnvironments(process.env, signer);
    mail = await mailCapture();
    for (const port of [3100, 3105] as const) { const app = startApp(port, runtime.env, appEnvironments[port]); apps.push(app); await ready(app, port, signal); }
    browser = await chromium.launch({ args: chromiumStorageProxyArgs(storageProxy.url), env: infrastructureChildEnvironment(process.env) });
    // This build receipt was checked against source and public configuration
    // by startCiBrowserRuntime. Verify the actual served build and TEST-LOCAL
    // capability before a simulation or optional inference can begin.
    const probe = await browser.newContext({ baseURL: "http://localhost:3100", serviceWorkers: "block" });
    try {
      await probe.route("**/*", route => ["http://localhost:3100", SUPABASE_URL].includes(new URL(route.request().url()).origin) ? route.continue() : route.abort());
      const page = await probe.newPage();
      const buildId = readFileSync(path.join(repositoryRoot, ".next/BUILD_ID"), "utf8").trim();
      assert(buildId && buildId !== "development", "Production build required");
      expect((await page.request.get(`http://localhost:3100/_next/static/${buildId}/_buildManifest.js`)).status(), "The owned app serves this build").toBe(200);
      const email = `cmp-${input.id}-probe@e2e.local`;
      await createConfirmedUser(email, participantCPassword);
      await signIn(page, email, participantCPassword);
      await page.goto("/family/invite");
      await expect(page.getByLabel(EMAIL_LABEL), "TEST-LOCAL capability must be active").toBeVisible();
      await expect(page.getByRole("heading", { name: "Not available in this jurisdiction yet" })).toHaveCount(0);
    } finally { await probe.close(); }
    if (input.account !== "participant-c") return { close,
      openReadSession: async (sessionInput, sessionSignal) => {
        sessionSignal.throwIfAborted();
        const session = await openComprehensionAccountSession({ browser: browser!, id: sessionInput.id, taskId: sessionInput.taskId,
          accountId: sessionInput.account, email: `cmp-${input.id}@e2e.local`, mail: mail!.messages });
        if (sessionInput.account === "participant-a") {
          assert(storageProxy!.uploads() > 0, "Real account files must cross the installed provider proxy");
        }
        return session;
      } };
    const context = await browser.newContext({ baseURL: "http://localhost:3105", serviceWorkers: "block" });
    await context.route("**/*", route => {
      const origin = new URL(route.request().url()).origin;
      return ["http://localhost:3105", "http://127.0.0.1:54321"].includes(origin) ? route.continue() : route.abort();
    });
    try {
      const page = await context.newPage();
      const seeded = await withEmbryoJourney({ ...process.env, ...runtime.env, INHERIT_UPLOAD_SIGNING_JWK: signer }, async fixture => {
        const seeded = await seedParticipantC({
          page,
          browser: browser!, ownerEmail: `cmp-t6-${input.id}@e2e.local`, parentEmail: `cmp-t6-${input.id}-parent@e2e.local`,
          password: participantCPassword, messages: mail!.messages, runtime: { proof: fixture.proof, runWorker: async id => { signal.throwIfAborted(); await fixture.runWorker(id); } } });
        await seeded.closeCoParent();
        return seeded;
      });
      signal.throwIfAborted();
      return { publication: { ownerId: seeded.owner, cohortId: seeded.cohortId }, close,
        openReadSession: async (sessionInput, sessionSignal) => {
          sessionSignal.throwIfAborted();
          return openParticipantCReadSession({ browser: browser!, sessionId: sessionInput.id, ownerId: seeded.owner,
            cohortId: seeded.cohortId, email: `cmp-t6-${input.id}@e2e.local`, password: participantCPassword, read: seeded.readPublication });
        } };
    } finally { await context.close(); }
  } catch {
    await close();
    throw new Error("Fresh comprehension setup refused; no inference was started");
  }
}
export const openFreshComprehensionBrowser: LiveEnvironment["openBrowser"] = freshComprehensionSessions(acquireSimulation);
/** Kept for the original native instrument caller, never ordinary-stack adoption. */
export const openFreshParticipantCBrowser: LiveEnvironment["openBrowser"] = (input, signal) => {
  assert(input.account === "participant-c" && (input.taskId === "T6" || input.taskId === "T7"), "Participant-c task required");
  return openFreshComprehensionBrowser(input, signal);
};
