/**
 * Externally enforced isolation for every inference call (G3.1, G3.3).
 *
 * Each `openProcess` makes a fresh empty directory outside the checkout, and
 * each call spawns `inference-worker.ts` there as a new operating-system
 * process with a scrubbed environment: PATH, a locale, and for a real
 * provider only the credential variable it names and the proxy settings the
 * network needs. The payload the conductor built is the only other input, on
 * stdin. So a participant process holds no rubric, a grader process holds no
 * persona, page or path, and no process holds the repository, the brief, a
 * sibling session or an earlier run. `probeIsolation` spawns the same way and
 * reports what the child actually saw, and a live run records that report.
 *
 * The credential never crosses stdin, a file or a log: the parent reads the
 * named variable from the operator's own shell and hands it only to the child
 * environment. It is never deployment configuration and never in `src/`.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { LiveEnvironment, Payload, ProcessAdapter, Role, Settings } from "./conductor-contract";
import { repositoryRoot } from "./conductor-inputs";
import type { Provider, WorkerRequest } from "./inference-worker";

export const WORKER = fileURLToPath(new URL("./inference-worker.ts", import.meta.url));
const PROXY_VARIABLES = ["HTTPS_PROXY", "https_proxy", "HTTP_PROXY", "http_proxy", "NO_PROXY", "no_proxy",
  "NODE_EXTRA_CA_CERTS", "SSL_CERT_FILE"] as const;
const REPLY_LIMIT = 1_048_576;

/** Exactly what a child process may see, and nothing else. */
export function childEnvironment(provider: Provider, parent: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const environment: Record<string, string> = { PATH: parent.PATH ?? "/usr/bin:/bin", LANG: "C.UTF-8" };
  if (provider.kind !== "openai-compatible-chat") return environment;
  if (!/^[A-Z][A-Z0-9_]{2,63}$/.test(provider.apiKeyVariable)) throw new Error("Invalid credential variable name");
  const key = parent[provider.apiKeyVariable];
  if (!key) throw new Error(`Credential variable ${provider.apiKeyVariable} is not set`);
  environment[provider.apiKeyVariable] = key;
  for (const name of PROXY_VARIABLES) if (parent[name]) environment[name] = parent[name]!;
  if (environment.HTTPS_PROXY || environment.https_proxy) environment.NODE_USE_ENV_PROXY = "1";
  return environment;
}

function workerSettings(settings: Readonly<Settings>): WorkerRequest["settings"] {
  return { temperature: settings.temperature, graderTemperature: settings.graderTemperature, maxSteps: settings.maxSteps,
    timeoutMs: settings.timeoutMs, maximumInputTokens: settings.maximumInputTokens, maximumOutputTokens: settings.maximumOutputTokens };
}

async function runChild(request: WorkerRequest, directory: string, environment: Record<string, string>,
  signal: AbortSignal, started: (child: ChildProcess) => void): Promise<unknown> {
  const child = spawn(process.execPath, ["--experimental-strip-types", "--no-warnings", WORKER],
    { cwd: directory, env: environment, stdio: ["pipe", "pipe", "ignore"] });
  started(child);
  const kill = () => { if (child.exitCode === null) child.kill("SIGKILL"); };
  signal.addEventListener("abort", kill, { once: true });
  try {
    const output: Buffer[] = [];
    let size = 0;
    child.stdout!.on("data", (chunk: Buffer) => { size += chunk.length; if (size > REPLY_LIMIT) kill(); else output.push(chunk); });
    child.stdin!.on("error", () => {});
    child.stdin!.end(JSON.stringify(request));
    const code = await new Promise<number | null>((resolve, reject) => { child.once("error", reject); child.once("close", resolve); });
    if (code !== 0 || size > REPLY_LIMIT) throw new Error("Inference process failed");
    const reply = JSON.parse(Buffer.concat(output).toString("utf8").trim().split("\n").at(-1) ?? "null") as Record<string, unknown> | null;
    if (!reply || "error" in reply) throw new Error("Inference process reported a failure");
    return reply;
  } finally { signal.removeEventListener("abort", kill); }
}

/** The live environment's process factory: one fresh directory and one fresh
 * child per acquired process, and exactly one call per process. */
export function isolatedProcesses(provider: Provider, parent: NodeJS.ProcessEnv = process.env): LiveEnvironment["openProcess"] {
  const environment = childEnvironment(provider, parent);
  return async ({ id, role }: Readonly<{ id: string; role: Role }>): Promise<ProcessAdapter> => {
    const directory = await mkdtemp(path.join(tmpdir(), "inherit-comprehension-call-"));
    let child: ChildProcess | undefined, used = false;
    return {
      id,
      async invoke(payload: Payload, settings: Readonly<Settings>, signal: AbortSignal) {
        if (used) throw new Error("One call per isolated process");
        used = true;
        return runChild({ role, payload, settings: workerSettings(settings), provider }, directory, environment, signal,
          value => { child = value; });
      },
      async close() {
        if (child && child.exitCode === null && child.signalCode === null) {
          child.kill("SIGKILL");
          await new Promise(resolve => child!.once("close", resolve));
        }
        await rm(directory, { recursive: true, force: true });
      },
    };
  };
}

export interface IsolationReport {
  cwdOutsideRepository: boolean;
  environmentKeys: string[];
  allowedKeysOnly: boolean;
}

/** Spawn a child exactly as a real call would and report what it could see. */
export async function probeIsolation(provider: Provider, parent: NodeJS.ProcessEnv = process.env): Promise<IsolationReport> {
  const environment = childEnvironment(provider, parent);
  const directory = await mkdtemp(path.join(tmpdir(), "inherit-comprehension-probe-"));
  try {
    const reply = await runChild({ role: "grader", payload: {}, provider: { kind: "isolation-probe" },
      settings: { temperature: 0, maxSteps: 1, timeoutMs: 10_000, maximumInputTokens: 1, maximumOutputTokens: 1 } },
    directory, environment, AbortSignal.timeout(20_000), () => {}) as { value: { cwd: string; environmentKeys: string[] } };
    const cwd = await realpath(reply.value.cwd), repository = await realpath(repositoryRoot);
    const allowed = new Set(Object.keys(environment));
    const keys = reply.value.environmentKeys.filter(key => !NODE_INJECTED.has(key));
    return { cwdOutsideRepository: !cwd.startsWith(repository + path.sep) && cwd !== repository,
      environmentKeys: keys, allowedKeysOnly: keys.every(key => allowed.has(key)) };
  } finally { await rm(directory, { recursive: true, force: true }); }
}

/** Set by Node itself inside every child, not inherited from the parent. */
const NODE_INJECTED = new Set(["NODE_UNIQUE_ID"]);
