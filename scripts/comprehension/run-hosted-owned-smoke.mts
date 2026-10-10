/** GitHub's fresh Linux job invokes the unchanged native owned supervisor. */
import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { closeSync, fstatSync, lstatSync, mkdirSync, openSync, readFileSync, realpathSync, renameSync, writeFileSync } from "node:fs";
import { userInfo } from "node:os";
import path from "node:path";
import { ownedLinuxRequestSchema } from "../owned-linux-runtime";
import { assertHostedSmokeReady, canonicalHostedSmokeFrame, hostedOwnedEnvironment, hostedSmokeFrame,
  HOSTED_OWNED_CORE_PINS, HOSTED_OWNED_SMOKE_LIMITS as limits, selectHostedSmokeArtifacts, verifyHostedSmokeArtifact } from "./hosted-owned-smoke";

async function main() {
  assert(process.argv.length === 2 && process.platform === "linux" && process.env.CI === "true"
    && process.env.GITHUB_ACTIONS === "true" && process.env.RUNNER_ENVIRONMENT === "github-hosted"
    && process.env.GITHUB_JOB === "owned-keyfree-smoke", "Dedicated hosted Linux job required");
  process.umask(0o077);
  const root = realpathSync(process.cwd()), home = realpathSync(userInfo().homedir);
  const env = hostedOwnedEnvironment({ uid: process.getuid!(), gid: process.getgid!(), home: process.env.HOME!,
    actualHome: home, path: process.env.PATH! });
  const command = (program: string, args: string[]) => execFileSync(program, args, {
    cwd: root, env, timeout: 10_000, maxBuffer: 1024 * 1024, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  const head = command("git", ["rev-parse", "HEAD"]), tree = command("git", ["rev-parse", "HEAD^{tree}"]);
  assert(head === process.env.GITHUB_SHA && !command("git", ["status", "--porcelain=v1", "--untracked-files=all"]));
  for (const [file, hash] of Object.entries(HOSTED_OWNED_CORE_PINS))
    assert(createHash("sha256").update(readFileSync(path.join(root, file))).digest("hex") === hash);
  const parent = realpathSync(process.env.RUNNER_TEMP!), directory = path.join(parent, "inherit-owned-keyfree");
  mkdirSync(directory, { mode: 0o700 });
  for (const name of ["scratch", "effort", "records", "public-artifact"]) mkdirSync(path.join(directory, name), { mode: 0o700 });
  const owner = ownedLinuxRequestSchema.parse({ version: 1, nonce: randomUUID(),
    bootId: readFileSync("/proc/sys/kernel/random/boot_id", "utf8").trim(), head, root,
    scratch: path.join(directory, "scratch"), dockerSocket: realpathSync("/var/run/docker.sock") });
  // The supervisor independently proves this socket, actual native memory,
  // empty daemon, source and one-use owner lease before returning READY.
  const frame = canonicalHostedSmokeFrame(hostedSmokeFrame(directory), directory);
  const fds = ["stdout.raw", "stderr.raw"].map(name => openSync(path.join(directory, name), "wx", 0o600));
  let child: ReturnType<typeof spawn> | undefined, exitCode: number | null = null, signal: string | null = null;
  let timedOut = false, closed = false, ready = false, refusal = false, groupAbsent = false;
  let line = "", inputTimer: ReturnType<typeof setTimeout> | undefined, readyTimer: ReturnType<typeof setTimeout> | undefined;
  let terminal: Record<string, unknown> | undefined;
  let killTimer: ReturnType<typeof setTimeout> | undefined;
  const kill = () => { if (child?.pid) try { process.kill(-child.pid, "SIGKILL"); } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ESRCH") refusal = true; } };
  const stop = () => { if (killTimer) return;
    if (child?.pid) try { process.kill(-child.pid, "SIGTERM"); } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ESRCH") refusal = true; }
    killTimer = setTimeout(kill, limits.settlementMs);
  };
  const whole = setTimeout(() => { timedOut = true; stop(); }, limits.wholeMs);
  const outputBound = setInterval(() => { try { if (fds.some(fd => fstatSync(fd).size > limits.outputBytes)) { refusal = true; stop(); } }
    catch { refusal = true; stop(); } }, 250);
  const onCancel = () => { refusal = true; stop(); };
  process.once("SIGTERM", onCancel); process.once("SIGINT", onCancel);
  try {
    child = spawn("python3", ["scripts/comprehension/hosted-owned-pipe.py", process.execPath,
      Buffer.from(JSON.stringify(owner)).toString("base64url")], {
      cwd: root, env, detached: true, stdio: ["pipe", fds[0], "pipe"] });
    readyTimer = setTimeout(() => { timedOut = true; stop(); }, limits.readyMs);
    child.stdin!.on("error", () => { refusal = true; stop(); });
    child.stderr!.on("error", () => { refusal = true; stop(); });
    child.stderr!.on("data", (chunk: Buffer) => {
      try {
      writeFileSync(fds[1], chunk);
      if (fstatSync(fds[0]).size > limits.outputBytes || fstatSync(fds[1]).size > limits.outputBytes) { refusal = true; stop(); }
      if (!ready && !refusal) {
        line += chunk.toString("utf8");
        if (Buffer.byteLength(line) > 1024) { refusal = true; stop(); return; }
        const end = line.indexOf("\n");
        if (end >= 0) try {
          assertHostedSmokeReady(line.slice(0, end + 1), owner.nonce); ready = true; clearTimeout(readyTimer);
          inputTimer = setTimeout(() => { timedOut = true; stop(); }, limits.inputMs);
          child!.stdin!.end(frame, () => { if (inputTimer) clearTimeout(inputTimer); });
        } catch { refusal = true; stop(); }
      }
      } catch { refusal = true; stop(); }
    });
    await new Promise<void>(resolve => {
      child!.once("error", () => { refusal = true; });
      child!.once("close", (code, why) => { exitCode = code; signal = why; closed = true; resolve(); });
    });
    clearTimeout(readyTimer);
  } finally {
    clearTimeout(whole); clearInterval(outputBound); if (readyTimer) clearTimeout(readyTimer); if (inputTimer) clearTimeout(inputTimer);
    process.removeListener("SIGTERM", onCancel); process.removeListener("SIGINT", onCancel);
    const until = performance.now() + limits.settlementMs;
    while (child?.pid && performance.now() < until) {
      try { process.kill(-child.pid, 0); stop(); }
      catch (error) { if ((error as NodeJS.ErrnoException).code === "ESRCH") { groupAbsent = true; break; } refusal = true; break; }
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    if (killTimer) { clearTimeout(killTimer); if (!groupAbsent) kill(); }
    for (const fd of fds) closeSync(fd);
    terminal = { schemaVersion: 1,
      head, tree, uid: process.getuid!(), gid: process.getgid!(), bootId: owner.bootId, nonce: owner.nonce,
      corePins: HOSTED_OWNED_CORE_PINS, ready, exitCode, signal, timedOut, closed, groupAbsent, refusal,
      qualifyingEvidence: false, paidInference: false };
    writeFileSync(path.join(directory, "public-artifact", "owned-keyfree-smoke.json"), JSON.stringify({ terminal, records: null, history: null, spend: null }) + "\n", { flag: "wx", mode: 0o600 });
  }
  assert(ready && closed && exitCode === 0 && signal === null && !timedOut && !refusal && groupAbsent,
    "Owned smoke failed; native journals and original private output retained without automatic recovery");
  // Select the one exact run; unknown/symlinked artifacts cannot enter the public upload.
  const { readdirSync } = await import("node:fs");
  const dates = readdirSync(path.join(directory, "records")); assert(dates.length === 1 && /^\d{4}-\d\d-\d\d$/.test(dates[0]));
  const day = path.join(directory, "records", dates[0]); assert(lstatSync(day).isDirectory() && !lstatSync(day).isSymbolicLink());
  const runs = readdirSync(day); assert(runs.length === 1 && /^smoke-[a-zA-Z0-9-]+$/.test(runs[0]));
  const record = path.join(day, runs[0]); assert(lstatSync(record).isDirectory() && !lstatSync(record).isSymbolicLink());
  const read = (name: string) => { const file = path.join(record, name), stat = lstatSync(file);
    assert(stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1 && stat.uid === process.getuid!()
      && stat.size > 0 && stat.size < limits.outputBytes); return readFileSync(file, "utf8"); };
  const records = { manifest: JSON.parse(read("manifest.json")),
    responses: read("responses.jsonl").trimEnd().split("\n").map(line => JSON.parse(line)),
    assessment: JSON.parse(read("assessment.json")) };
  const selected = selectHostedSmokeArtifacts(records, head);
  assert.deepEqual(readdirSync(record).sort(), [...selected].sort());
  const journal = (name: string) => { const file = path.join(directory, "effort", name), stat = lstatSync(file);
    assert(stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1 && stat.uid === process.getuid!()
      && stat.size > 0 && stat.size < limits.outputBytes); return readFileSync(file, "utf8"); };
  const artifact = { terminal, records, history: journal("dry-history.jsonl"), spend: journal("dry-spend.jsonl") };
  verifyHostedSmokeArtifact(artifact, head, tree);
  const temporary = path.join(directory, "public-artifact", ".completed.json");
  writeFileSync(temporary, JSON.stringify(artifact) + "\n", { flag: "wx", mode: 0o600 });
  renameSync(temporary, path.join(directory, "public-artifact", "owned-keyfree-smoke.json"));
}
main().catch(() => { console.error("Hosted owned key-free smoke refused; original journals retained"); process.exitCode = 1; });
