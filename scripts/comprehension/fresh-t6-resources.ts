/** Exclusive disposable-host stack ownership. A failed/uncertain start or
 * cleanup retains the lock; it never adopts or deletes another resource. */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { cp, lstat, mkdir, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { assertCiRuntime, CI_RUNTIME_CONTAINER } from "../ci-browser-config";
import { attestFreshT6Workflow } from "./fresh-t6-attestation";
import { repositoryRoot } from "./conductor-inputs";
import { assertOwnedLinuxSource, ownedLinuxEnvironment, ownedLinuxSourceIdentity, type OwnedLinuxCapability } from "../owned-linux-runtime";

export type Resource = { kind: "container" | "volume" | "network"; name: string; identity: string; project: string };
export type ResourceIO = {
  inventory(): Promise<Resource[]>;
  command(file: string, args: string[], options?: { env?: Record<string, string>; signal?: AbortSignal; timeout?: number }): Promise<string>;
};
export function ownedStack(resources: Resource[]): Resource[] {
  assert(resources.length > 0, "Fresh stack identity is missing");
  for (const item of resources) {
    assert(item.project === "sequence" && /^supabase_[a-z0-9_]+_sequence$/.test(item.name)
      && item.identity.length > 0, "Unregistered stack resource");
  }
  assert(new Set(resources.map(item => `${item.kind}:${item.name}`)).size === resources.length, "Duplicate resource identity");
  for (const name of ["supabase_db_sequence", "supabase_storage_sequence", "supabase_kong_sequence"])
    assert(resources.some(item => item.kind === "container" && item.name === name), "Incomplete fresh stack");
  assert(resources.some(item => item.kind === "network" && item.name === "supabase_network_sequence"), "Fresh stack network missing");
  return resources.toSorted((a, b) => `${a.kind}:${a.name}`.localeCompare(`${b.kind}:${b.name}`));
}
export function assertEmptyHost(resources: Resource[]) {
  assert(resources.length === 0, "Fresh T6 refuses existing Supabase or browser resources");
}
export function assertSameResources(expected: Resource[], actual: Resource[]) {
  assert.deepEqual(ownedStack(actual), ownedStack(expected), "Owned resource identity changed; cleanup refused");
}
export function infrastructureReservation(personas: number, ceiling: number, available: number, tasks = 1) {
  assert(Number.isSafeInteger(personas) && personas > 0 && personas <= 30
    && Number.isSafeInteger(tasks) && tasks >= 1 && tasks <= 10
    && Number.isSafeInteger(ceiling) && ceiling > 0 && Number.isSafeInteger(available), "Invalid fresh runtime budget");
  // One build bootstrap, then one fresh stack for every (task, persona). This maximum
  // remains reserved even if setup/cleanup fails, separately from model tokens.
  const total = (personas * tasks + 1) * ceiling;
  assert(Number.isSafeInteger(total) && available >= total, "Runtime cost ceiling must fit the shared journal");
  return total;
}
export function infrastructureChildEnvironment(parent: Readonly<Record<string, string | undefined>>, operator?: OwnedLinuxCapability): Record<string, string> & { NODE_ENV: "production" } {
  const names = ["PATH", "HOME", "LANG", "CI", "GITHUB_ACTIONS", "RUNNER_ENVIRONMENT", "RUNNER_TEMP", "GITHUB_WORKSPACE",
    "GITHUB_JOB", "GITHUB_RUN_ID", "GITHUB_RUN_ATTEMPT", "INHERIT_DISPOSABLE_LOCAL_E2E"];
  return { NODE_ENV: "production", ...Object.fromEntries(names.flatMap(name => parent[name] ? [[name, parent[name]!]] : [])),
    ...(operator ? ownedLinuxEnvironment(operator) : {}) };
}
export function createResourceIO(operator?: OwnedLinuxCapability): ResourceIO {
 const io: ResourceIO = {
  async command(file, args, options = {}) {
    return new Promise((resolve, reject) => {
      const child = spawn(file, args, { cwd: repositoryRoot, env: { ...(options.env ?? infrastructureChildEnvironment(process.env, operator)), NODE_ENV: "production" },
        stdio: ["ignore", "pipe", "pipe"], signal: options.signal });
      let output = "", failed = false;
      const timer = setTimeout(() => { failed = true; child.kill("SIGKILL"); }, options.timeout ?? 60_000);
      child.stdout.on("data", chunk => { output += chunk; if (output.length > 1_048_576) { failed = true; child.kill("SIGKILL"); } });
      child.stderr.resume();
      child.once("error", () => { clearTimeout(timer); reject(new Error("Fresh runtime command refused; diagnostics suppressed")); });
      child.once("exit", code => { clearTimeout(timer); if (code !== 0 || failed) reject(new Error("Fresh runtime command failed; diagnostics suppressed")); else resolve(output.trim()); });
    });
  },
  async inventory() {
    const out: Resource[] = [];
    for (const kind of ["container", "volume", "network"] as const) {
      const args = kind === "container" ? ["ps", "-aq"] : [kind, "ls", "-q"];
      const names = (await io.command("docker", args)).split(/\s+/).filter(Boolean);
      for (const id of names) {
        const format = kind === "container" ? '{"name":{{json .Name}},"identity":{{json .Id}},"project":{{json (index .Config.Labels "com.supabase.cli.project")}}}'
          : kind === "network" ? '{"name":{{json .Name}},"identity":{{json .Id}},"project":{{json (index .Labels "com.supabase.cli.project")}}}'
          : '{"name":{{json .Name}},"identity":{{json .CreatedAt}},"project":{{json (index .Labels "com.supabase.cli.project")}}}';
        const item = JSON.parse(await io.command("docker", [kind === "container" ? "inspect" : kind, ...(kind === "container" ? [] : ["inspect"]), "--format", format, id]));
        const name = String(item.name).replace(/^\//, "");
        if (name.startsWith("supabase_") || name === CI_RUNTIME_CONTAINER || item.project) {
          // CLI volumes may omit the project label; exact name plus creation
          // identity is captured, never inferred from data or account IDs.
          const project = item.project ?? (kind === "volume" && /^supabase_[a-z0-9_]+_sequence$/.test(name) ? "sequence" : "unassigned");
          out.push({ kind, name, identity: item.identity, project });
        }
      }
    }
    return out;
  },
 };
 return io;
}
export const actualResourceIO = createResourceIO();

const usedResourceIdentities = new Set<string>();
export async function disposeOwnedStack(expected: Resource[], io: ResourceIO, stop: () => Promise<unknown>, release: () => Promise<void>) {
  assertSameResources(expected, await io.inventory());
  await stop();
  assertEmptyHost(await io.inventory());
  await release();
}

export async function acquireFreshStack(signal: AbortSignal, io: ResourceIO = actualResourceIO, operator?: OwnedLinuxCapability) {
  assertCiRuntime(process.env, process.platform, operator);
  if (operator) assert(operator.proof.root === repositoryRoot && operator.proof.scratch === process.env.RUNNER_TEMP,
    "Exact owning operator checkout and scratch required");
  else assert(process.env.GITHUB_WORKSPACE && await realpath(process.env.GITHUB_WORKSPACE) === repositoryRoot
    && process.env.GITHUB_JOB && process.env.GITHUB_RUN_ID && process.env.GITHUB_RUN_ATTEMPT,
  "Actual owning checkout and job identity required");
  const scratch = process.env.RUNNER_TEMP!;
  assert(await realpath(scratch) === scratch, "Runner scratch must be exact");
  const lock = path.join(scratch, "inherit-fresh-t6.lock");
  await mkdir(lock, { mode: 0o700 }); // Exclusive across bootstrap and personas.
  let lease: Resource[] | undefined;
  let started = false;
  const directory = path.join(lock, randomUUID());
  try {
    assertEmptyHost(await io.inventory());
    if (operator) assertOwnedLinuxSource(operator, infrastructureChildEnvironment(process.env, operator));
    else assert(!(await io.command("git", ["status", "--porcelain", "--untracked-files=no"])), "Fresh stack requires clean tracked source");
    const head = await io.command("git", ["rev-parse", "HEAD"]);
    assert(/^[a-f0-9]{40}$/.test(head), "Exact source head required");
    const attestation = operator ? ownedLinuxSourceIdentity(operator) : await attestFreshT6Workflow({ head, ref: process.env.GITHUB_REF!,
      runId: process.env.GITHUB_RUN_ID!, attempt: process.env.GITHUB_RUN_ATTEMPT! });
    await mkdir(path.join(directory, "supabase"), { recursive: true, mode: 0o700 });
    await cp(path.join(repositoryRoot, "supabase/config.toml"), path.join(directory, "supabase/config.toml"));
    const config = await readFile(path.join(directory, "supabase/config.toml"), "utf8");
    assert(/^project_id = "sequence"$/m.test(config), "Exact registered fresh project required");
    await cp(path.join(repositoryRoot, "supabase/migrations"), path.join(directory, "supabase/migrations"), { recursive: true });
    try { await cp(path.join(repositoryRoot, "supabase/seed.sql"), path.join(directory, "supabase/seed.sql")); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    const files = (await readdir(path.join(directory, "supabase/migrations"))).filter(file => /^\d{14}_.+\.sql$/.test(file)).sort();
    const migrationHash = createHash("sha256");
    for (const file of files) {
      const copied = await readFile(path.join(directory, "supabase/migrations", file));
      assert(copied.equals(await readFile(path.join(repositoryRoot, "supabase/migrations", file))), "Copied migration source changed");
      migrationHash.update(file).update("\0").update(copied).update("\0");
    }
    const source = { head, attestation, migrationSha256: migrationHash.digest("hex"), configSha256: createHash("sha256").update(config).digest("hex") };
    await writeFile(path.join(lock, "owner.json"), JSON.stringify({ version: 1, directory, source,
      job: process.env.GITHUB_JOB, runId: process.env.GITHUB_RUN_ID, attempt: process.env.GITHUB_RUN_ATTEMPT }), { flag: "wx", mode: 0o600 });
    signal.throwIfAborted();
    started = true;
    await io.command(path.join(repositoryRoot, "node_modules/.bin/supabase"), ["start", "--workdir", directory], { signal, timeout: 600_000 });
    lease = ownedStack(await io.inventory());
    for (const resource of lease) {
      const identity = `${resource.kind}:${resource.name}:${resource.identity}`;
      assert(!usedResourceIdentities.has(identity), "A persona cannot reuse a prior resource identity");
      usedResourceIdentities.add(identity);
    }
    const ledger = JSON.parse(await io.command("docker", ["exec", "supabase_db_sequence", "psql", "-XAtq", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-c", "select coalesce(json_agg(version order by version),'[]'::json) from supabase_migrations.schema_migrations;"], { signal }));
    assert.deepEqual(ledger, files.map(file => file.slice(0, 14)), "Fresh database must apply exactly the captured source migrations");
    await writeFile(path.join(lock, "resources.json"), JSON.stringify(lease), { flag: "wx", mode: 0o600 });
    const env = JSON.parse(await io.command(path.join(repositoryRoot, "node_modules/.bin/supabase"), ["status", "--workdir", directory, "-o", "json"], { signal }));
    assert(env.API_URL === "http://127.0.0.1:54321" && typeof env.ANON_KEY === "string" && env.ANON_KEY
      && typeof env.SERVICE_ROLE_KEY === "string" && env.SERVICE_ROLE_KEY, "Fresh stack bootstrap unavailable");
    let closed = false;
    const close = async () => {
      if (closed) return;
      await disposeOwnedStack(lease!, io,
        () => io.command(path.join(repositoryRoot, "node_modules/.bin/supabase"), ["stop", "--no-backup", "--workdir", directory], { timeout: 35_000 }),
        async () => {
          const stat = await lstat(lock);
          assert(stat.isDirectory() && !stat.isSymbolicLink() && stat.uid === process.getuid?.(), "Owned lock changed");
          await rm(lock, { recursive: true });
        });
      closed = true;
    };
    return { source, keys: { NEXT_PUBLIC_SUPABASE_URL: env.API_URL as string,
      NEXT_PUBLIC_SUPABASE_ANON_KEY: env.ANON_KEY as string, SUPABASE_SERVICE_ROLE_KEY: env.SERVICE_ROLE_KEY as string }, close };
  } catch {
    // Pre-start refusals created no Docker resource and may release this lock.
    // An uncertain command never earns authority to delete what appeared.
    if (!started) await rm(lock, { recursive: true });
    throw new Error("Fresh stack acquisition refused; uncertain started resources retain their ownership receipt");
  }
}
