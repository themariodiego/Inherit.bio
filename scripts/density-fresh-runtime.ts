import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { createPrivateKey, createPublicKey, randomBytes, randomUUID } from "node:crypto";
import http from "node:http";
import path from "node:path";
import type { Writable } from "node:stream";
import { chromium, type Browser } from "@playwright/test";
import { startCiBrowserRuntime } from "./ci-browser-runtime";
import { APP_PORTS, EMBRYO_APP_ENV, checkedAppEnvironment } from "./ci-browser-config";
import { appServerEnvironment } from "./ci-browser-app-environment";
import { APP_SERVICE_OBSERVATION_OPTION } from "./ci-browser/service-observation";
import { ownedDensityServiceObservers } from "./density-owned-service-observer";
import { acquireFreshStack, createResourceIO, infrastructureChildEnvironment } from "./comprehension/fresh-t6-resources";
import { repositoryRoot } from "./comprehension/conductor-inputs";
import { ownedLinuxChildProof, type OwnedLinuxCapability } from "./owned-linux-runtime";
import { startLocalStorageProxy } from "./local-storage-browser-proxy";
import { chromiumStorageProxyArgs } from "./local-storage-browser-config";

export type RuntimeHandle = Awaited<ReturnType<typeof startCiBrowserRuntime>>;
export type OwnedHostChild = { child: ChildProcess; appEnvironment: Readonly<Record<string, string>> };
type AppPort = typeof APP_PORTS[number];
export interface DensityMail { to: string | string[]; html?: string }
export interface FreshDensityRuntime {
  browser: Browser;
  runtime: RuntimeHandle;
  apps: ReadonlyMap<AppPort, OwnedHostChild>;
  messages: DensityMail[];
  environment: Readonly<Record<string, string | undefined>>;
  operator?: OwnedLinuxCapability;
  observers: (origin: string, fixtureSourcePath: string) => ReturnType<typeof ownedDensityServiceObservers>;
  close: () => Promise<void>;
}

/** A failed cleanup never authorizes acquisition of another fixture. */
export function sequentialDensityCleanup(closers: readonly (() => Promise<void>)[]) {
  let closing: Promise<void> | undefined;
  return () => closing ??= (async () => { for (const close of closers) await close(); })();
}

async function stopApp(child: ChildProcess) {
  if (child.stdout?.closed && child.stderr?.closed) return;
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => { if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
      reject(new Error("Density app cleanup uncertain")); }, 8_000);
    child.once("error", () => { clearTimeout(timer); reject(new Error("Density app cleanup refused")); });
    child.once("close", () => { clearTimeout(timer); resolve(); });
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
  });
}

async function ready(child: ChildProcess, port: AppPort, signal: AbortSignal) {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    signal.throwIfAborted();
    assert(child.exitCode === null && child.signalCode === null && !child.killed, "Owned density app exited before readiness");
    try {
      const response = await fetch(`http://localhost:${port}/`, {
        signal: AbortSignal.any([signal, AbortSignal.timeout(2_000)]), redirect: "manual" });
      await response.body?.cancel();
      if (response.status === 200) return;
    } catch { signal.throwIfAborted(); }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error("Owned density app readiness refused");
}

async function captureMail() {
  const messages: DensityMail[] = [];
  const server = http.createServer((request, response) => {
    if (request.method !== "POST" || request.url !== "/emails") { response.writeHead(404).end(); return; }
    let size = 0; const chunks: Buffer[] = [];
    request.on("data", chunk => { size += chunk.length; if (size > 1_048_576) request.destroy(); else chunks.push(chunk); });
    request.on("end", () => {
      try {
        const value = JSON.parse(Buffer.concat(chunks).toString("utf8")) as DensityMail;
        assert([value.to].flat().every(address => typeof address === "string" && /^[a-zA-Z0-9.+_-]+@e2e\.local$/.test(address))
          && [value.to].flat().length > 0 && typeof value.html === "string" && messages.length < 100,
        "Only actual bounded synthetic fixture mail is admitted");
        messages.push(value); response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ id: randomUUID() }));
      } catch { response.writeHead(400).end(); }
    });
  });
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(8124, "127.0.0.1", resolve); });
  return { messages, close: async () => {
    server.closeAllConnections(); await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  } };
}

/** One exact fresh stack and six real, separate original service variants.
 * No existing stack, child, configuration acknowledgment or browser is adopted.
 * Build and native ownership checks remain the existing acquisition gates. */
export async function acquireFreshDensityRuntime(signal: AbortSignal, operator?: OwnedLinuxCapability): Promise<FreshDensityRuntime> {
  assert(process.cwd() === repositoryRoot, "Exact density checkout required");
  const infrastructure = infrastructureChildEnvironment(process.env, operator), io = createResourceIO(operator);
  const stack = await acquireFreshStack(signal, io, operator);
  let runtime: RuntimeHandle | undefined, browser: Browser | undefined;
  let proxy: Awaited<ReturnType<typeof startLocalStorageProxy>> | undefined;
  let mail: Awaited<ReturnType<typeof captureMail>> | undefined;
  const apps = new Map<AppPort, OwnedHostChild>();
  const detach: (() => void)[] = [];
  const previous = new Map<string, string | undefined>();
  const assign = (values: Record<string, string>) => {
    for (const [name, value] of Object.entries(values)) { previous.set(name, process.env[name]); process.env[name] = value; }
  };
  const close = sequentialDensityCleanup([
    async () => { for (const stop of detach) stop(); await browser?.close(); },
    async () => { for (const app of [...apps.values()].reverse()) await stopApp(app.child); },
    async () => { await mail?.close(); }, async () => { await proxy?.close(); },
    async () => { runtime?.stop(); }, async () => { await stack.close(); },
    async () => { for (const [name, value] of previous) { if (value === undefined) delete process.env[name]; else process.env[name] = value; } },
  ]);
  try {
    assert(Object.entries(stack.keys).every(([name, value]) => process.env[name] === value), "Actual fresh bootstrap must match the built public configuration");
    await io.command(process.execPath, ["--import", "tsx", "scripts/seed.ts"], { env: { ...infrastructure, ...stack.keys }, signal, timeout: 120_000 });
    await io.command("docker", ["exec", "supabase_db_sequence", "psql", "-XAtq", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-c",
      "insert into private.upload_authorization_config(singleton,auth_issuer,maximum_array_bytes,maximum_vcf_bytes,maximum_account_bytes,maximum_active_uploads) values(true,'http://127.0.0.1:54321/auth/v1',52428800,52428800,1073741824,32) on conflict(singleton) do nothing;"], { signal, env: infrastructure });
    const signer = JSON.parse(process.env.INHERIT_UPLOAD_SIGNING_JWK ?? "null");
    assert(signer?.kty === "EC" && signer.crv === "P-256" && typeof signer.kid === "string", "Root's actual ephemeral upload signer required");
    const publicJwk = { ...createPublicKey(createPrivateKey({ key: signer, format: "jwk" })).export({ format: "jwk" }), kid: signer.kid, alg: "ES256", use: "sig" };
    proxy = await startLocalStorageProxy("sequence", publicJwk, infrastructure);
    runtime = await startCiBrowserRuntime(infrastructure, true, operator);
    // Original native journey helpers deliberately recheck these actual live
    // values against their invoking process. Restore them only after full close.
    assign({ ...runtime.env, INHERIT_LOCAL_BROWSER_STORAGE_PROXY: proxy.url });
    const environment = { ...process.env };
    mail = await captureMail();
    for (const port of APP_PORTS) {
      signal.throwIfAborted();
      const appEnvironment = checkedAppEnvironment({ ...appServerEnvironment(environment, port),
        ...(port === 3105 ? { ...EMBRYO_APP_ENV, RESEND_WEBHOOK_SECRET: `whsec_${randomBytes(32).toString("base64")}` } : {}) }, port);
      const child = spawn(process.execPath, ["--import", "tsx", path.join(repositoryRoot, "scripts/ci-browser/server.mts"), "host", String(port), APP_SERVICE_OBSERVATION_OPTION], {
        cwd: repositoryRoot, env: { ...infrastructure, ...appEnvironment, ...runtime.env, ...(operator ? { INHERIT_OWNED_LINUX_RUNTIME_FD: "3" } : {}) },
        stdio: operator ? ["ignore", "pipe", "pipe", "pipe"] : ["ignore", "pipe", "pipe"] });
      apps.set(port, { child, appEnvironment: Object.freeze({ ...appEnvironment }) });
      assert(child.stdout && child.stderr, "Actual owned child output pipes required");
      child.stdout.resume(); child.stderr.resume(); child.on("error", () => {});
      if (operator) { const pipe = child.stdio[3] as Writable; pipe.on("error", () => {}); pipe.end(ownedLinuxChildProof(operator) + "\n"); }
    }
    // Observers must attach before startup emits an acknowledgment. Retain
    // one collector per real child; fixture-specific observers reuse that
    // collector's current ack through the exact source path below.
    const serviceObservers = new Map<AppPort, ReturnType<typeof ownedDensityServiceObservers>>();
    let fixturePath: string | undefined;
    for (const [port, app] of apps) {
      const observingRuntime = { observeActiveService: (ack: unknown) => {
        assert(fixturePath, "Actual selected fixture source required");
        return runtime!.observeActiveService(ack, fixturePath);
      } };
      const observer = ownedDensityServiceObservers({ child: app.child, root: repositoryRoot, origin: `http://localhost:${port}`,
        fixtureSourcePath: "scripts/density-fresh-runtime.ts", launchConfiguration: app.appEnvironment, runtime: observingRuntime });
      serviceObservers.set(port, observer); detach.push(observer.close);
    }
    for (const [port, app] of apps) await ready(app.child, port, signal);
    browser = await chromium.launch({ headless: true, args: chromiumStorageProxyArgs(proxy.url), env: infrastructure });
    const observers = (origin: string, sourcePath: string) => {
      const port = APP_PORTS.find(port => origin === `http://localhost:${port}`);
      assert(port && sourcePath && !path.isAbsolute(sourcePath) && !sourcePath.split(path.sep).includes(".."), "Exact actual service and fixture required");
      assert(fixturePath === undefined || fixturePath === sourcePath, "One fixture owns this fresh resource lease");
      fixturePath = sourcePath;
      return serviceObservers.get(port)!;
    };
    return { browser, runtime, apps, messages: mail.messages, environment, operator, observers, close };
  } catch {
    await close();
    throw new Error("Fresh density resource acquisition refused; no capture was accepted");
  }
}
