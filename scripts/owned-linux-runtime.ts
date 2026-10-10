/** Explicit operator ownership, never a fabricated CI job. The operator must
 * authenticate the Linux host before feeding the private anonymous pipe. */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash, generateKeyPairSync, sign, verify, createPublicKey, type KeyObject } from "node:crypto";
import { closeSync, constants, fstatSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, readlinkSync, realpathSync, rmSync, rmdirSync, writeFileSync } from "node:fs";
import { userInfo } from "node:os";
import path from "node:path";
import { z } from "zod";

const uuid = z.string().uuid();
const exactPath = z.string().refine(value => path.isAbsolute(value) && path.resolve(value) === value);
export const ownedLinuxRequestSchema = z.object({ version: z.literal(1), nonce: uuid, bootId: uuid,
  head: z.string().regex(/^[a-f0-9]{40}$/), root: exactPath, scratch: exactPath, dockerSocket: exactPath }).strict();
export type OwnedLinuxRequest = z.infer<typeof ownedLinuxRequestSchema>;
const proofSchema = ownedLinuxRequestSchema.extend({ uid: z.number().int().positive(), gid: z.number().int().positive(),
  pid: z.number().int().positive(), processStart: z.string().regex(/^\d+$/), daemonId: z.string().min(1).max(256),
  createdAt: z.number().int(), publicKey: z.string().min(1).max(1024) }).strict();
type Proof = z.infer<typeof proofSchema>;
export const ownedLinuxPublicProofSchema = proofSchema;
const challengeSchema = proofSchema.pick({ version: true, nonce: true, bootId: true, head: true, uid: true, createdAt: true });
export const olderBootChallengeSchema = z.object({ kind: z.literal("older-boot-challenge"),
  challenge: challengeSchema, scratch: exactPath }).strict();
type Identity = { dev: number; ino: number; uid: number; gid: number; mode: number };
export type OwnedLinuxCapability = Readonly<{ kind: "owned-linux"; proof: Proof }>;
const admitted = new WeakMap<object, { receipt: Identity; socket: Identity; challenge: Identity; signingKey?: KeyObject; child: boolean; recordDirectory?: string }>();
const REFUSAL = "Actual exclusive owned-Linux capability unavailable";
const challengeDirectory = () => path.join(realpathSync(userInfo().homedir), ".inherit-comprehension-challenges");
const challengeFile = (nonce: string) => path.join(challengeDirectory(), `${uuid.parse(nonce)}.used.json`);
const challengeContent = (proof: Pick<Proof, "nonce" | "bootId" | "head" | "uid" | "createdAt">) =>
  JSON.stringify({ version: 1, nonce: proof.nonce, bootId: proof.bootId, head: proof.head, uid: proof.uid, createdAt: proof.createdAt });
/** Public one-use markers survive lease release and supervisor processes. This
 * helper does not mint a runtime capability; production fixes its directory to
 * the actual account home, never configurable scratch or an environment HOME. */
export function retainChallengeUse(directory: string, nonce: string, publicContent: string) {
  uuid.parse(nonce);
  assert(Buffer.byteLength(publicContent) < 4096 && realpathSync(path.dirname(directory)) === path.dirname(directory), REFUSAL);
  try { mkdirSync(directory, { mode: 0o700 }); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
  const owner = lstatSync(directory);
  assert(owner.isDirectory() && !owner.isSymbolicLink() && owner.uid === process.getuid!()
    && (owner.mode & 0o7777) === 0o700, REFUSAL);
  const descriptor = openSync(path.join(directory, `${nonce}.used.json`), constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try { writeFileSync(descriptor, publicContent); fsyncSync(descriptor); }
  finally { closeSync(descriptor); }
  const parent = openSync(directory, constants.O_RDONLY | constants.O_NOFOLLOW);
  try { fsyncSync(parent); } finally { closeSync(parent); }
}
/** Public-only recovery evidence, retained independently of the daemon lease.
 * A failed write refuses readiness; neither this file nor its challenge is removed. */
export function retainPublicOwnerProof(directory: string, input: unknown) {
  const proof = proofSchema.parse(input), content = JSON.stringify(proof);
  assert(realpathSync(directory) === directory && Buffer.byteLength(content) < 4096, REFUSAL);
  const stat = lstatSync(directory);
  assert(stat.isDirectory() && stat.uid === proof.uid && (stat.mode & 0o7777) === 0o700, REFUSAL);
  assert(readPublicReceipt(path.join(directory, `${proof.nonce}.used.json`), proof.uid) === challengeContent(proof), REFUSAL);
  const descriptor = openSync(path.join(directory, `${proof.nonce}.owner.json`),
    constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try { writeFileSync(descriptor, content); fsyncSync(descriptor); } finally { closeSync(descriptor); }
  const parent = openSync(directory, constants.O_RDONLY | constants.O_NOFOLLOW);
  try { fsyncSync(parent); } finally { closeSync(parent); }
}

/** Reboot proves old-process death without inventing a missing PID/start/key.
 * This pure binding check grants no capability or journal access. */
export function assertOlderBootChallengeBinding(currentInput: unknown, previousInput: unknown, marker: string) {
  const current = proofSchema.parse(currentInput), previous = olderBootChallengeSchema.parse(previousInput);
  const old = previous.challenge;
  assert(marker === challengeContent(old) && old.bootId !== current.bootId && old.uid === current.uid
    && old.nonce !== current.nonce && old.createdAt < current.createdAt, REFUSAL);
  return createHash("sha256").update(marker).digest("hex");
}

function readPublicReceipt(file: string, uid: number) {
  const descriptor = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const before = fstatSync(descriptor);
    assert(before.isFile() && before.nlink === 1 && before.uid === uid
      && (before.mode & 0o7777) === 0o600 && before.size > 0 && before.size < 4096, REFUSAL);
    const content = readFileSync(descriptor, "utf8"), after = fstatSync(descriptor);
    assert.deepEqual([after.dev, after.ino, after.size, after.mtimeMs, after.ctimeMs],
      [before.dev, before.ino, before.size, before.mtimeMs, before.ctimeMs], REFUSAL);
    return content;
  } finally { closeSync(descriptor); }
}
/** Strict NUL-framed porcelain: only this producer's explicitly bound inert
 * record files may appear after initial full nonignored source admission. */
export function assertOwnedSourceStatus(status: string, recordRelative?: string) {
  if (!status) return;
  assert(status.endsWith("\0"), "Malformed exact source status");
  const allowed = new Set(["manifest.json", "responses.jsonl", "assessment.json", ".manifest.json.tmp", ".assessment.json.tmp"]);
  for (const item of status.slice(0, -1).split("\0")) {
    assert(item.startsWith("?? ") && recordRelative && item.slice(3).startsWith(`${recordRelative}/`)
      && allowed.has(item.slice(3 + recordRelative.length + 1)), "Untracked or modified source refuses owned execution");
  }
}
function identity(file: string): Identity {
  const s = lstatSync(file);
  assert(!s.isSymbolicLink(), REFUSAL);
  assert([s.dev, s.ino, s.uid, s.gid, s.mode].every(Number.isSafeInteger), REFUSAL);
  return { dev: s.dev, ino: s.ino, uid: s.uid, gid: s.gid, mode: s.mode };
}
function same(left: Identity, right: Identity) { assert.deepEqual(left, right, REFUSAL); }
function bootId() { return readFileSync("/proc/sys/kernel/random/boot_id", "utf8").trim(); }
function processStart(pid: number) {
  const raw = readFileSync(`/proc/${pid}/stat`, "utf8");
  const end = raw.lastIndexOf(") "); assert(end > 0, REFUSAL);
  const value = raw.slice(end + 2).trim().split(/\s+/)[19]; assert(/^\d+$/.test(value), REFUSAL); return value;
}
// One daemon lease across supervisors and configurable scratch directories.
// Cleanup uncertainty retains it; image reuse never grants mutable adoption.
const lease = (proof: Pick<Proof, "daemonId">) => path.join(challengeDirectory(), `daemon-${createHash("sha256").update(proof.daemonId).digest("hex")}`);
const receipt = (proof: Pick<Proof, "daemonId">) => path.join(lease(proof), "owner.json");
function nativeProof(proof: Proof, child: boolean) {
  assert(process.platform === "linux" && process.getuid?.() === proof.uid && process.getgid?.() === proof.gid, REFUSAL);
  assert(bootId() === proof.bootId && processStart(proof.pid) === proof.processStart
    && lstatSync(`/proc/${proof.pid}`).uid === proof.uid, REFUSAL);
  assert(!child || process.ppid === proof.pid, REFUSAL);
  // The signed inherited channel and actual supervisor lifetime are authority.
  // The two-persona smoke workflow's 45 min cap is not a full-round lease TTL.
  assert(Date.now() >= proof.createdAt, REFUSAL);
  assert(realpathSync(proof.root) === proof.root && realpathSync(proof.scratch) === proof.scratch
    && realpathSync(proof.dockerSocket) === proof.dockerSocket && lstatSync(proof.dockerSocket).isSocket(), REFUSAL);
  const owner = lstatSync(lease(proof));
  assert(owner.isDirectory() && !owner.isSymbolicLink() && owner.uid === proof.uid && (owner.mode & 0o7777) === 0o700, REFUSAL);
  const file = lstatSync(receipt(proof));
  assert(file.isFile() && !file.isSymbolicLink() && file.nlink === 1 && file.uid === proof.uid
    && (file.mode & 0o7777) === 0o600 && file.size < 4096, REFUSAL);
  assert.deepEqual(proofSchema.parse(JSON.parse(readPublicReceipt(receipt(proof), proof.uid))), proof, REFUSAL);
  assert(readPublicReceipt(challengeFile(proof.nonce), proof.uid) === challengeContent(proof), REFUSAL);
}
export function assertOwnedLinuxCapability(value: OwnedLinuxCapability) {
  const state = admitted.get(value); assert(state, REFUSAL);
  nativeProof(value.proof, state.child); same(state.receipt, identity(receipt(value.proof)));
  same(state.socket, identity(value.proof.dockerSocket));
  same(state.challenge, identity(challengeFile(value.proof.nonce)));
}
export function bindOwnedRunRecord(value: OwnedLinuxCapability, directory: string) {
  assertOwnedLinuxCapability(value);
  const state = admitted.get(value)!;
  assert(!state.child && !state.recordDirectory && realpathSync(directory) === directory, REFUSAL);
  const relative = path.relative(value.proof.root, directory);
  assert(/^docs\/comprehension-runs\/\d{4}-\d{2}-\d{2}\/(?:calibration|live-run|smoke)-[a-zA-Z0-9-]+$/.test(relative), REFUSAL);
  const owner = lstatSync(directory);
  assert(owner.isDirectory() && !owner.isSymbolicLink() && owner.uid === value.proof.uid, REFUSAL);
  state.recordDirectory = relative;
}
export function assertOwnedLinuxSource(value: OwnedLinuxCapability, environment?: Record<string, string>) {
  assertOwnedLinuxCapability(value);
  const state = admitted.get(value)!;
  const options = { cwd: value.proof.root, encoding: "utf8" as const, env: environment as NodeJS.ProcessEnv | undefined,
    timeout: 10_000, maxBuffer: 1_048_576, stdio: ["ignore", "pipe", "ignore"] as ["ignore", "pipe", "ignore"] };
  assert(execFileSync("git", ["rev-parse", "HEAD"], options).trim() === value.proof.head, REFUSAL);
  const status = execFileSync("git", ["status", "--porcelain=v1", "--untracked-files=all", "-z"], options);
  assertOwnedSourceStatus(status, state.recordDirectory);
  if (state.recordDirectory) for (const item of status.split("\0").filter(Boolean)) {
    const file = lstatSync(path.join(value.proof.root, item.slice(3)));
    assert(file.isFile() && !file.isSymbolicLink() && file.nlink === 1 && file.uid === value.proof.uid
      && !(file.mode & 0o111), "Only owned inert current-run record output admitted");
  }
}
export function ownedLinuxEnvironment(value: OwnedLinuxCapability) {
  assertOwnedLinuxCapability(value);
  return { RUNNER_TEMP: value.proof.scratch, DOCKER_HOST: `unix://${value.proof.dockerSocket}` };
}
/** A clean remote invocation starts with public runtime configuration only;
 * the model credential may arrive later solely in the anonymous private frame. */
export function assertOperatorHostEnvironment(env: Readonly<Record<string, string | undefined>>) {
  const allowed = new Set(["PATH", "HOME", "LANG", "NODE_ENV", "TZ"]);
  assert(Object.keys(env).every(name => allowed.has(name)) && env.PATH && env.HOME
    && env.LANG === "C.UTF-8" && env.NODE_ENV === "production" && (!env.TZ || env.TZ === "UTC"),
  "Owned Linux starts with exact public environment only");
}
/** Fresh admission only: signed children must not recheck free memory while
 * their already-owned native stack is live. Linux meminfo uses KiB. */
export function assertOwnedLinuxInitialMemory(meminfo: string) {
  const bytes = (name: "MemTotal" | "MemAvailable") => {
    const lines = meminfo.split("\n").filter(line => line.startsWith(`${name}:`));
    assert(lines.length === 1, "One actual Linux memory observation required");
    const match = new RegExp(`^${name}:[\\t ]+(\\d+)[\\t ]+kB[\\t ]*$`).exec(lines[0]);
    assert(match, "Actual Linux memory must use whole KiB");
    const kibibytes = Number(match[1]), value = kibibytes * 1024;
    assert(Number.isSafeInteger(kibibytes) && kibibytes > 0 && Number.isSafeInteger(value),
      "Actual Linux memory observation refused");
    return value;
  };
  const totalBytes = bytes("MemTotal"), availableBytes = bytes("MemAvailable");
  assert(availableBytes <= totalBytes && totalBytes >= 5.5 * 1024 ** 3 && availableBytes >= 4 * 1024 ** 3,
    "Owned Linux initial admission requires 5.5 GiB total and 4 GiB available memory");
  return { totalBytes, availableBytes };
}
/** Only metadata and existing daemon inventory; this creates no native stack.
 * Expected boot/source/socket come from the independently authenticated host. */
export function establishOwnedLinuxRuntime(input: unknown, env: Readonly<Record<string, string | undefined>> = process.env) {
  const request = ownedLinuxRequestSchema.parse(input);
  assertOperatorHostEnvironment(env);
  assert(env.HOME === userInfo().homedir, REFUSAL);
  assert(process.platform === "linux" && process.getuid!() > 0 && process.getgid!() > 0, REFUSAL);
  assertOwnedLinuxInitialMemory(readFileSync("/proc/meminfo", "utf8"));
  assert(!env.CI && !env.GITHUB_ACTIONS && !env.GITHUB_JOB && !env.RUNNER_ENVIRONMENT && !env.DEBUG && !env.PWDEBUG, REFUSAL);
  assert(fstatSync(0).isFIFO() && /^pipe:\[\d+\]$/.test(readlinkSync("/proc/self/fd/0")), "One anonymous operator stdin pipe required");
  assert(bootId() === request.bootId && realpathSync(process.cwd()) === request.root, REFUSAL);
  assert(realpathSync(request.scratch) === request.scratch && realpathSync(request.dockerSocket) === request.dockerSocket
    && lstatSync(request.dockerSocket).isSocket(), REFUSAL);
  const scratch = lstatSync(request.scratch);
  assert(scratch.isDirectory() && !scratch.isSymbolicLink() && scratch.uid === process.getuid!()
    && (scratch.mode & 0o7777) === 0o700, REFUSAL);
  const clean = { NODE_ENV: "production" as const, PATH: env.PATH ?? "/usr/bin:/bin", HOME: env.HOME ?? "/home/runner", LANG: "C.UTF-8",
    DOCKER_HOST: `unix://${request.dockerSocket}` };
  const command = (file: string, args: string[]) => execFileSync(file, args, { cwd: request.root,
    env: clean as NodeJS.ProcessEnv, timeout: 10_000, maxBuffer: 1_048_576, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  assert(command("git", ["rev-parse", "HEAD"]) === request.head
    && command("git", ["status", "--porcelain=v1", "--untracked-files=all", "-z"]) === "", REFUSAL);
  // Images may be reused; containers and non-default networks/volumes may not.
  assert(command("docker", ["ps", "-aq"]) === "" && command("docker", ["volume", "ls", "-q"]) === "", REFUSAL);
  assert(command("docker", ["network", "ls", "--format", "{{.Name}}"])
    .split(/\s+/).filter(Boolean).every(name => ["bridge", "host", "none"].includes(name)), REFUSAL);
  const daemonId = command("docker", ["info", "--format", "{{.ID}}"]); assert(daemonId && daemonId.length <= 256, REFUSAL);
  const pair = generateKeyPairSync("ed25519");
  const createdAt = Date.now();
  const proof = proofSchema.parse({ ...request, uid: process.getuid!(), gid: process.getgid!(), pid: process.pid,
    processStart: processStart(process.pid), daemonId, createdAt,
    publicKey: pair.publicKey.export({ type: "spki", format: "der" }).toString("base64") });
  retainChallengeUse(challengeDirectory(), proof.nonce, challengeContent(proof));
  retainPublicOwnerProof(challengeDirectory(), proof);
  mkdirSync(lease(proof), { mode: 0o700 });
  writeFileSync(receipt(proof), JSON.stringify(proof), { flag: "wx", mode: 0o600 });
  const value = Object.freeze({ kind: "owned-linux" as const, proof: Object.freeze(proof) });
  admitted.set(value, { receipt: identity(receipt(proof)), socket: identity(proof.dockerSocket), challenge: identity(challengeFile(proof.nonce)), signingKey: pair.privateKey, child: false });
  assertOwnedLinuxCapability(value);
  return value;
}
export function ownedLinuxChildProof(value: OwnedLinuxCapability) {
  assertOwnedLinuxCapability(value); const state = admitted.get(value)!; assert(state.signingKey, REFUSAL);
  const payload = JSON.stringify(value.proof);
  return JSON.stringify({ payload, signature: sign(null, Buffer.from(payload), state.signingKey).toString("base64") });
}
/** Receive the supervisor's public capability over an inherited anonymous
 * descriptor. No provider credential is in this app-control channel. */
export function receiveOwnedLinuxChildProof(raw: string, descriptor: number) {
  assert(descriptor === 3 && fstatSync(descriptor).isSocket()
    && /^socket:\[\d+\]$/.test(readlinkSync(`/proc/self/fd/${descriptor}`)), REFUSAL);
  const frame = z.object({ payload: z.string().max(4096), signature: z.string().max(256) }).strict().parse(JSON.parse(raw));
  const proof = proofSchema.parse(JSON.parse(frame.payload));
  assert(frame.payload === JSON.stringify(proof), REFUSAL);
  nativeProof(proof, true);
  assert(verify(null, Buffer.from(frame.payload), createPublicKey({ key: Buffer.from(proof.publicKey, "base64"),
    format: "der", type: "spki" }), Buffer.from(frame.signature, "base64")), REFUSAL);
  const value = Object.freeze({ kind: "owned-linux" as const, proof: Object.freeze(proof) });
  admitted.set(value, { receipt: identity(receipt(proof)), socket: identity(proof.dockerSocket), challenge: identity(challengeFile(proof.nonce)), child: true }); return value;
}
/** Release only this exact lease after native daemon absence; retain the
 * public challenge-use marker permanently, including across reboot. */
export function releaseOwnedLinuxRuntime(value: OwnedLinuxCapability) {
  assertOwnedLinuxCapability(value);
  const command = (args: string[]) => execFileSync("docker", args, { timeout: 10_000, maxBuffer: 1_048_576, encoding: "utf8",
    env: { NODE_ENV: "production", PATH: process.env.PATH ?? "/usr/bin:/bin", DOCKER_HOST: `unix://${value.proof.dockerSocket}`, LANG: "C.UTF-8" } as NodeJS.ProcessEnv,
    stdio: ["ignore", "pipe", "ignore"] }).trim();
  assert(command(["info", "--format", "{{.ID}}"]) === value.proof.daemonId
    && command(["ps", "-aq"]) === "" && command(["volume", "ls", "-q"]) === ""
    && command(["network", "ls", "--format", "{{.Name}}"])
      .split(/\s+/).filter(Boolean).every(name => ["bridge", "host", "none"].includes(name)),
  "Uncertain native cleanup retains operator ownership");
  rmSync(receipt(value.proof)); rmdirSync(lease(value.proof)); admitted.delete(value);
}
export function ownedLinuxSourceIdentity(value: OwnedLinuxCapability) {
  assertOwnedLinuxCapability(value);
  return { kind: value.kind, nonce: value.proof.nonce, bootId: value.proof.bootId, head: value.proof.head,
    daemonId: value.proof.daemonId, proofSha256: createHash("sha256").update(JSON.stringify(value.proof)).digest("hex") };
}

/** Process names only, never arguments or environment. A new manual owner may
 * retain its SSH/tool ancestors and this one ps child, but no old workload. */
export function assertManualCleanupProcesses(observation: string, supervisorPid: number) {
  const rows = observation.trim().split("\n").map(line => {
    const match = /^\s*(\d+)\s+(\d+)\s+(\S(?:.*\S)?)\s*$/.exec(line);
    assert(match, "Unknown process inventory refuses manual cleanup");
    const pid = Number(match[1]), ppid = Number(match[2]);
    assert(Number.isSafeInteger(pid) && pid > 0 && Number.isSafeInteger(ppid) && ppid >= 0,
      "Invalid process inventory refuses manual cleanup");
    return { pid, ppid, name: match[3] };
  });
  const byPid = new Map(rows.map(row => [row.pid, row]));
  assert(byPid.size === rows.length && byPid.has(supervisorPid), "Incomplete process inventory refuses manual cleanup");
  const ancestors = new Set<number>();
  for (let pid = supervisorPid; byPid.has(pid); pid = byPid.get(pid)!.ppid) {
    assert(!ancestors.has(pid), "Cyclic process inventory refuses manual cleanup"); ancestors.add(pid);
  }
  assert(rows.every(row => ancestors.has(row.pid) || (row.ppid === supervisorPid && row.name === "ps")),
    "Active or unknown owned-user process refuses manual cleanup");
}

/** Manual journal reconciliation grants no stack, inference or spending
 * authority. A fresh authenticated supervisor must observe the same empty
 * daemon and a definitively dead prior supervisor; public challenges survive.
 * These checks run again immediately before the append and lock release. */
export function assertOwnedLinuxManualCleanup(value: OwnedLinuxCapability, previousInput: unknown) {
  assertOwnedLinuxSource(value);
  assert(!admitted.get(value)!.child, "Only the actual owner may reconcile a dry journal");
  const previous = proofSchema.parse(previousInput), current = value.proof;
  assert(previous.uid === current.uid && previous.gid === current.gid && previous.root === current.root
    && previous.daemonId === current.daemonId && previous.dockerSocket === current.dockerSocket
    && previous.nonce !== current.nonce && previous.createdAt < current.createdAt,
  "Exact prior owned runtime required for manual cleanup");
  assert(readPublicReceipt(challengeFile(previous.nonce), previous.uid) === challengeContent(previous),
    "Prior one-use challenge must remain permanent");
  if (previous.bootId === current.bootId) {
    try {
      assert(processStart(previous.pid) !== previous.processStart, "Prior supervisor is still active");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  assertManualNativeCleanup(current, [previous.scratch, current.scratch]);
  return createHash("sha256").update(JSON.stringify(previous)).digest("hex");
}

/** Legacy recovery is explicitly limited to a retained challenge from another
 * actual boot. Same-boot recovery still requires the complete original proof. */
export function assertOwnedLinuxOlderBootManualCleanup(value: OwnedLinuxCapability, previousInput: unknown) {
  assertOwnedLinuxSource(value);
  assert(!admitted.get(value)!.child, "Only the actual owner may reconcile a dry journal");
  const previous = olderBootChallengeSchema.parse(previousInput), current = value.proof;
  const marker = readPublicReceipt(challengeFile(previous.challenge.nonce), current.uid);
  const digest = assertOlderBootChallengeBinding(current, previous, marker);
  assert(path.dirname(previous.scratch) === realpathSync(userInfo().homedir)
    && path.basename(previous.scratch) === `inherit-native-smoke-${previous.challenge.nonce}`,
  "Exact preserved older-boot smoke scratch required");
  assertManualNativeCleanup(current, [previous.scratch, current.scratch]);
  return digest;
}

function assertManualNativeCleanup(current: Proof, scratches: string[]) {
  for (const scratch of new Set(scratches)) {
    assert(realpathSync(scratch) === scratch, "Exact preserved scratch required");
    const stat = lstatSync(scratch);
    assert(stat.isDirectory() && stat.uid === current.uid && (stat.mode & 0o7777) === 0o700,
      "Protected preserved scratch required");
    try { lstatSync(path.join(scratch, "inherit-fresh-t6.lock")); throw new Error("Native stack cleanup is unresolved"); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  }
  const command = (args: string[]) => execFileSync("docker", args, { timeout: 10_000, maxBuffer: 1_048_576, encoding: "utf8",
    env: { NODE_ENV: "production", PATH: process.env.PATH ?? "/usr/bin:/bin", DOCKER_HOST: `unix://${current.dockerSocket}`, LANG: "C.UTF-8" },
    stdio: ["ignore", "pipe", "ignore"] }).trim();
  assert(command(["info", "--format", "{{.ID}}"]) === current.daemonId
    && command(["ps", "-aq"]) === "" && command(["volume", "ls", "-q"]) === "",
  "Unknown native cleanup refuses manual reconciliation");
  assert.deepEqual(command(["network", "ls", "--format", "{{.Name}}"])
    .split(/\s+/).filter(Boolean).sort(), ["bridge", "host", "none"], "Unknown native networks refuse manual reconciliation");
  assertManualCleanupProcesses(execFileSync("ps", ["-u", String(current.uid), "-o", "pid=,ppid=,comm="],
    { timeout: 10_000, maxBuffer: 1_048_576, encoding: "utf8", env: { NODE_ENV: "production", PATH: process.env.PATH ?? "/usr/bin:/bin", LANG: "C.UTF-8" },
      stdio: ["ignore", "pipe", "ignore"] }), current.pid);
}

/** A canonical JSON frame prevents duplicate-key aliases without ever printing
 * private parse errors. No file, argument or environment credential is read. */
export function parsePrivateOperatorFrame(raw: Uint8Array) {
  assert(raw.byteLength > 0 && raw.byteLength <= 65_536, "Bounded operator frame required");
  const text = new TextDecoder("utf-8", { fatal: true }).decode(raw);
  const parsed: unknown = JSON.parse(text);
  assert(text === JSON.stringify(parsed) + "\n", "Canonical bounded operator frame required");
  return parsed;
}
export async function readPrivateOperatorPipe(): Promise<unknown> {
  const maximumBytes = 65_536;
  assert(fstatSync(0).isFIFO() && /^pipe:\[\d+\]$/.test(readlinkSync("/proc/self/fd/0")), "One anonymous operator stdin pipe required");
  const chunks: Buffer[] = []; let size = 0;
  try {
    const raw = await new Promise<Buffer>((resolve, reject) => {
      const timer = setTimeout(() => { process.stdin.destroy(); reject(new Error("Private operator pipe refused")); }, 10_000);
      process.stdin.on("data", (chunk: Buffer) => { size += chunk.length;
        if (size > maximumBytes) { clearTimeout(timer); process.stdin.destroy(); reject(new Error("Private operator pipe refused")); }
        else chunks.push(chunk); });
      process.stdin.once("error", () => { clearTimeout(timer); reject(new Error("Private operator pipe refused")); });
      process.stdin.once("end", () => { clearTimeout(timer); resolve(Buffer.concat(chunks)); });
    });
    try { assert(size > 0 && size <= maximumBytes); return parsePrivateOperatorFrame(raw); }
    finally { raw.fill(0); }
  } catch { throw new Error("Private operator pipe refused; no private values retained in diagnostics"); }
  finally { chunks.forEach(chunk => chunk.fill(0)); }
}
