/** Explicit key-free dry recovery. Never invoked by normal open, by a failed
 * run, or by the live ledger. No spending entry is read or written here. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open, readdir, realpath, rmdir } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { assertOwnedLinuxManualCleanup, assertOwnedLinuxOlderBootManualCleanup, olderBootChallengeSchema, ownedLinuxPublicProofSchema, type OwnedLinuxCapability } from "../owned-linux-runtime";
import { digest, opaque } from "./conductor-contract";
import { privateDirectory } from "./instrument-journal";
import { RunHistory } from "./run-history";

export const manualDryReconciliationSchema = z.object({ version: z.literal(1), ledger: z.literal("dry"),
  directory: z.string().refine(value => path.isAbsolute(value) && path.resolve(value) === value),
  runId: opaque, sessionId: opaque, historyPrefixSha256: digest, publicCleanupSha256: digest,
  previousOwner: ownedLinuxPublicProofSchema.optional(), previousChallenge: olderBootChallengeSchema.optional() }).strict()
  .refine(value => (value.previousOwner === undefined) !== (value.previousChallenge === undefined),
    "Exactly one prior owner proof or explicit older-boot challenge required");

const refusal = "Manual key-free journal reconciliation refused; prior history and accounting retained";
async function absent(file: string) {
  try { await lstat(file); throw new Error(refusal); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
}
async function protectedFile(file: string) {
  const stat = await lstat(file, { bigint: true });
  assert(stat.isFile() && !stat.isSymbolicLink() && stat.nlink === BigInt(1)
    && stat.uid === BigInt(process.getuid!()) && (stat.mode & BigInt(0o7777)) === BigInt(0o600), refusal);
  return stat;
}
const identity = (stat: Awaited<ReturnType<typeof protectedFile>>) => ({ dev: stat.dev, ino: stat.ino,
  uid: stat.uid, gid: stat.gid, mode: stat.mode, nlink: stat.nlink, size: stat.size,
  mtimeNs: stat.mtimeNs, ctimeNs: stat.ctimeNs });
async function syncDirectory(directory: string) {
  const descriptor = await open(directory, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  try { await descriptor.sync(); } finally { await descriptor.close(); }
}

/** The actual Linux owner rechecks dead prior identity and complete daemon
 * absence around the durable append. Only explicit reviewed public bindings
 * enter the closure; private traces and prior failure are never rewritten. */
export async function reconcileKeyFreeDryJournal(owner: OwnedLinuxCapability, input: unknown) {
  let manual: string | undefined, uncertain = false;
  let descriptor: Awaited<ReturnType<typeof open>> | undefined;
  try {
    const request = manualDryReconciliationSchema.parse(input);
    const cleanup = () => request.previousOwner
      ? assertOwnedLinuxManualCleanup(owner, request.previousOwner)
      : assertOwnedLinuxOlderBootManualCleanup(owner, request.previousChallenge!);
    const previousSha256 = cleanup();
    const previousHead = request.previousOwner?.head ?? request.previousChallenge!.challenge.head;
    await privateDirectory(request.directory);
    assert(await realpath(request.directory) === request.directory, refusal);
    const historyFile = path.join(request.directory, "dry-history.jsonl"), lock = path.join(request.directory, "dry-history.lock");
    const spendFile = path.join(request.directory, "dry-spend.jsonl");
    const lockBefore = await lstat(lock, { bigint: true });
    assert(lockBefore.isDirectory() && !lockBefore.isSymbolicLink() && lockBefore.uid === BigInt(owner.proof.uid)
      && (lockBefore.mode & BigInt(0o7777)) === BigInt(0o700) && (await readdir(lock)).length === 0, refusal);
    await absent(`${spendFile}.lock`); // No spending-owner adoption or balance reconciliation.
    const manualCandidate = `${lock}.manual`;
    await mkdir(manualCandidate, { mode: 0o700 });
    manual = manualCandidate;
    const spendBefore = await protectedFile(spendFile), before = await protectedFile(historyFile);
    assert(before.size > BigInt(0) && before.size <= BigInt(16 * 1024 ** 2), refusal);
    descriptor = await open(historyFile, constants.O_RDWR | constants.O_APPEND | constants.O_NOFOLLOW);
    assert.deepEqual(identity(await descriptor.stat({ bigint: true })), identity(before), refusal);
    const bytes = await descriptor.readFile();
    assert(BigInt(bytes.length) === before.size && createHash("sha256").update(bytes).digest("hex") === request.historyPrefixSha256, refusal);
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    assert(text.endsWith("\n"), refusal);
    const [header, ...lines] = text.slice(0, -1).split("\n");
    assert(header === '{"kind":"instrument-only-history","version":1}', refusal);
    const history = new RunHistory();
    for (const line of lines) {
      const event: unknown = JSON.parse(line);
      assert(JSON.stringify(event) === line, refusal); // Duplicate aliases and partial records refuse.
      history.apply(event);
    }
    assert(history.events.some(event => event.kind === "start" && event.manifest.runId === request.runId
      && event.manifest.revision === previousHead), refusal);
    const closure = history.apply({ kind: "resource-reconciled", runId: request.runId, id: request.sessionId,
      resource: "browser", reason: "manual-key-free-native-cleanup", historyPrefixSha256: request.historyPrefixSha256,
      ...(request.previousOwner ? { previousOwnerSha256: previousSha256 } : { previousChallengeSha256: previousSha256 }),
      publicCleanupSha256: request.publicCleanupSha256, ownerNonce: owner.proof.nonce,
      bootId: owner.proof.bootId, daemonId: owner.proof.daemonId });
    assert(!history.resourceStopRequired && !history.unfinished, refusal);
    cleanup();
    assert.deepEqual(identity(await descriptor.stat({ bigint: true })), identity(before), refusal);
    assert.deepEqual(identity(await protectedFile(historyFile)), identity(before), refusal);
    assert.deepEqual(identity(await protectedFile(spendFile)), identity(spendBefore), refusal);
    uncertain = true; // A partial append/fsync failure retains BOTH recovery locks.
    await descriptor.writeFile(JSON.stringify(closure) + "\n"); await descriptor.sync();
    await syncDirectory(request.directory);
    cleanup();
    assert.deepEqual(identity(await protectedFile(spendFile)), identity(spendBefore), refusal);
    await absent(`${spendFile}.lock`);
    assert.deepEqual(identity(await lstat(lock, { bigint: true })), identity(lockBefore), refusal);
    assert((await readdir(lock)).length === 0, refusal);
    // Close the durable history descriptor before releasing either guard;
    // an uncertain close still retains both locks and the appended original.
    await descriptor.close(); descriptor = undefined;
    await rmdir(lock); await syncDirectory(request.directory);
    await rmdir(manual); manual = undefined; await syncDirectory(request.directory);
    return { status: "reconciled" as const, qualifyingEvidence: false as const, spendChanged: false as const };
  } catch {
    if (manual && !uncertain) await rmdir(manual).catch(() => {});
    throw new Error(refusal); // Never serialize private event, trace or native error values.
  } finally { await descriptor?.close().catch(() => { throw new Error(refusal); }); }
}
