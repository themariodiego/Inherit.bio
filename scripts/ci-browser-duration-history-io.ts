/** Explicit offline input only. Never extracts ZIPs, fetches evidence or accepts a baseline. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { closeSync, constants, fstatSync, lstatSync, mkdirSync, openSync, readSync, realpathSync, statSync, writeFileSync, type Stats } from "node:fs";
import path from "node:path";
import AdmZip from "adm-zip";
import { historicalDurationSource, multiRunHistoryFromCaptures, type HistoricalCaptureInput } from "./ci-browser-duration-history";

const maxInputBytes = 10_000_000, maxDecodedBytes = 32_000_000;
function readBounded(file: string): Buffer {
  assert(lstatSync(file).isFile(), "Offline inputs must be regular files, without symlink indirection");
  const fd = openSync(file, "r");
  try {
    const before = fstatSync(fd); assert(before.isFile() && before.size > 0 && before.size <= maxInputBytes, "Offline input size is outside its bound");
    const bounded = Buffer.alloc(before.size + 1); let count = 0;
    while (count < bounded.length) {
      const read = readSync(fd, bounded, count, bounded.length - count, count); if (read === 0) break; count += read;
    }
    const bytes = bounded.subarray(0, count), after = fstatSync(fd);
    assert(bytes.length === before.size && before.dev === after.dev && before.ino === after.ino
      && before.size === after.size && before.mtimeMs === after.mtimeMs, "Offline input changed during read");
    return bytes;
  } finally { closeSync(fd); }
}
export function decodeHistoricalZip(bytes: Buffer, member: "ci-browser-manifest.json" | "ci-browser-shard.json" | "owned-keyfree-smoke.json"): unknown {
  assert(Number(process.versions.node.split(".")[0]) === 22, "Reviewed Node22 bounded inflater required");
  assert(bytes.length > 0 && bytes.length <= maxInputBytes, "ZIP size is outside its bound");
  const entries = new AdmZip(bytes).getEntries(); assert(entries.length === 1, "Exactly one approved JSON member required");
  const entry = entries[0], header = entry.header;
  assert(entry.entryName === member && !entry.isDirectory && (header.flags & 1) === 0
    && (header.method === 0 || header.method === 8), "Unapproved, encrypted or unsupported ZIP member");
  assert(Number.isSafeInteger(header.size) && header.size > 0 && header.size <= maxDecodedBytes
    && Number.isSafeInteger(header.compressedSize) && header.compressedSize > 0 && header.compressedSize <= bytes.length,
  "ZIP member size is outside its bound");
  const decoded = entry.getData(); // Stock synchronous bounded inflate and payload CRC; no extraction API.
  const local: unknown = Reflect.get(header, "localHeader");
  assert(local !== null && typeof local === "object" && "flags" in local && "crc" in local
    && typeof local.flags === "number" && Number.isInteger(local.flags) && local.flags >= 0 && local.flags <= 0xffff
    && typeof local.crc === "number" && Number.isInteger(local.crc) && local.crc >= 0 && local.crc <= 0xffffffff,
  "ZIP local header flags and CRC must be unsigned integers");
  assert(header.flags === local.flags, "ZIP local and central flags differ");
  assert((header.flags & 8) !== 0 || local.crc === header.crc, "ZIP local and central CRC fields differ");
  assert(decoded.length === header.size && decoded.length <= maxDecodedBytes, "Decoded ZIP size differs");
  return JSON.parse(decoded.toString("utf8"));
}
function readMetadata(directory: string, oldName: string, newName: string): Buffer {
  const present: Buffer[] = [];
  for (const name of [oldName, newName]) {
    try { present.push(readBounded(path.join(directory, name))); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  }
  assert(present.length === 1, "Exactly one retained metadata filename required"); return present[0];
}
export function readHistoricalCapture(directory: string): HistoricalCaptureInput {
  const root = realpathSync(directory); assert(statSync(root).isDirectory(), "Saved capture directory required");
  const run = readMetadata(root, "run.json", "run.raw.json");
  const attempt = (JSON.parse(run.toString("utf8")) as { run_attempt?: unknown }).run_attempt;
  assert(typeof attempt === "number" && Number.isSafeInteger(attempt) && attempt > 0, "Actual saved run attempt required");
  const zip = (name: string, member: "ci-browser-manifest.json" | "ci-browser-shard.json") => {
    const bytes = readBounded(path.join(root, `browser-case-${attempt}-${name}.zip`));
    return { bytes, value: decodeHistoricalZip(bytes, member) };
  };
  return { run, jobs: readMetadata(root, "jobs.json", "jobs.raw.json"),
    artifacts: readMetadata(root, "artifacts.json", "artifacts.raw.json"),
    testedCommit: readMetadata(root, "tested-merge-commit.json", "tested-merge-commit.raw.json"),
    captureReceipt: readBounded(path.join(root, "capture-receipt.json")),
    manifest: zip("manifest", "ci-browser-manifest.json"),
    shards: Array.from({ length: 6 }, (_, index) => zip(`shard-${index + 1}`, "ci-browser-shard.json")) };
}
const within = (candidate: string, root: string) => candidate === root || candidate.startsWith(root + path.sep);
type BoundPath = Readonly<{ path: string; uid: number; dev: number; ino: number; directory: boolean }>;
type OutputReservation = Readonly<{ output: BoundPath; parent: BoundPath; protectedPaths: readonly BoundPath[] }>;
const reservations = new Map<string, OutputReservation>();
function ownerUid(): number {
  assert(process.getuid, "Offline output requires a real local ownership identity"); return process.getuid();
}
function boundPath(file: string): BoundPath {
  assert(realpathSync(file) === file, "Canonical nonsymlink path required");
  const value = lstatSync(file); assert(!value.isSymbolicLink(), "Symlink output identities are forbidden");
  assert([value.uid, value.dev, value.ino].every(number => Number.isSafeInteger(number) && number >= 0),
    "Output identity must be represented without integer loss");
  return Object.freeze({ path: file, uid: value.uid, dev: value.dev, ino: value.ino, directory: value.isDirectory() });
}
function sameIdentity(bound: BoundPath): Stats {
  assert(realpathSync(bound.path) === bound.path, "Reserved path was redirected");
  const value = lstatSync(bound.path);
  assert(!value.isSymbolicLink() && value.uid === bound.uid && value.dev === bound.dev && value.ino === bound.ino
    && value.isDirectory() === bound.directory, "Reserved path identity changed");
  return value;
}
function checkedReservation(output: string): OutputReservation {
  const record = reservations.get(output); assert(record, "An owned fresh output reservation is required");
  const uid = ownerUid(), value = sameIdentity(record.output), parent = sameIdentity(record.parent);
  assert(record.output.directory && record.parent.directory && value.uid === uid && parent.uid === uid
    && (value.mode & 0o777) === 0o700, "Output and parent must retain owned private directory identities");
  for (const item of record.protectedPaths) {
    sameIdentity(item);
    assert(!within(output, item.path) && !within(item.path, output), "Offline output aliases protected source/evidence");
    assert(!item.directory || item.dev !== parent.dev || item.ino !== parent.ino, "Offline output parent is protected source/evidence");
  }
  return record;
}
/** Resolve parent aliases first. Existing output (including hard links/symlinks) is never accepted. */
export function reserveOfflineOutput(directory: string, protectedPaths: string[]): string {
  const requested = path.resolve(directory), parent = realpathSync(path.dirname(requested));
  assert(parent === path.dirname(requested), "Output parent must be canonical without symlink aliases");
  const parentIdentity = boundPath(parent);
  assert(parentIdentity.directory && parentIdentity.uid === ownerUid(), "Output parent must be an owned nonsymlink directory");
  const output = path.join(parent, path.basename(requested));
  assert(!reservations.has(output), "An output reservation path cannot be reused");
  try { lstatSync(output); throw new Error("Offline output already exists"); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  const protectedIdentities = protectedPaths.map(item => boundPath(realpathSync(item)));
  for (const item of protectedIdentities) {
    const real = item.path;
    assert(!within(output, real) && !within(real, output), "Offline output aliases protected source/evidence");
    const current = statSync(real), parentStat = statSync(parent);
    assert(!current.isDirectory() || current.dev !== parentStat.dev || current.ino !== parentStat.ino,
      "Offline output parent is protected evidence/source");
  }
  mkdirSync(output, { mode: 0o700 });
  assert(realpathSync(output) === output && lstatSync(output).isDirectory(), "Offline output reservation differs");
  const record = Object.freeze({ output: boundPath(output), parent: parentIdentity,
    protectedPaths: Object.freeze(protectedIdentities) });
  reservations.set(output, record); checkedReservation(output);
  return output;
}
/** Each write rechecks the retained owner/device/inode/parent and protected containment.
 * The exclusive opened FD is checked before payload write and after completion.
 * This detects changed reservations; it does not claim atomic directory capabilities. */
export function writeReservedOfflineHistoryFile(output: string,
  name: "browser-duration-profile-v2.proposal.json" | "history-source-audit.json", raw: string): void {
  assert(["browser-duration-profile-v2.proposal.json", "history-source-audit.json"].includes(name), "Only the two offline proposal filenames are admitted");
  checkedReservation(output);
  const file = path.join(output, name);
  const fd = openSync(file, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try {
    const verifyFile = () => {
      const record = checkedReservation(output), actual = fstatSync(fd), visible = lstatSync(file);
      assert(actual.isFile() && !visible.isSymbolicLink() && actual.uid === ownerUid() && actual.dev === record.output.dev
        && (actual.mode & 0o777) === 0o600 && actual.dev === visible.dev && actual.ino === visible.ino && actual.uid === visible.uid,
      "Exclusive output file identity differs from its reservation");
      return actual;
    };
    verifyFile(); writeFileSync(fd, raw);
    assert(verifyFile().size === Buffer.byteLength(raw), "Offline proposal write is incomplete");
  } finally { closeSync(fd); }
}
export function writeOfflineHistory(directories: string[], outputDirectory: string, sourceDirectory: string): void {
  assert(directories.length >= 2 && directories.length <= 3, "Two or three explicit saved successful captures required");
  const roots = directories.map(directory => realpathSync(directory));
  assert(new Set(roots).size === roots.length, "Duplicate saved capture directory");
  const captures = roots.map(readHistoricalCapture), value = multiRunHistoryFromCaptures(captures);
  const raw = JSON.stringify(value, null, 2) + "\n";
  const output = reserveOfflineOutput(outputDirectory, [...roots, sourceDirectory]);
  writeReservedOfflineHistoryFile(output, "browser-duration-profile-v2.proposal.json", raw);
  const audit = { schemaVersion: 1, status: "offline-proposal-only", profileSha256: createHash("sha256").update(raw).digest("hex"),
    sources: captures.map(historicalDurationSource), noBaselineAcceptance: true, noCurrentDiscoveryOrExecutionProof: true };
  writeReservedOfflineHistoryFile(output, "history-source-audit.json", JSON.stringify(audit, null, 2) + "\n");
}
