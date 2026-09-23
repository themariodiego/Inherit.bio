/** Aggregate evidence from the live synthetic CI binding, never hosted R2. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { closeSync, constants, fstatSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync,
  readSync, renameSync, unlinkSync, writeFileSync, type Stats } from "node:fs";
import type { PreparedArtifactFixtureSnapshot } from "./prepared-artifact-fixture";

const DIRECTORY = "/tmp/prepared-artifact-fixture";
const FILE = `${DIRECTORY}/snapshot.json`;
const LIMITS = { requests: 2048, rejected: 2048, activeRequests: 8, receivedBytes: 33_554_432,
  objects: 512, payloadBytes: 33_554_432, payloadObjects: 512, tombstones: 512,
  putCommits: 512, tombstoneCommits: 2048, getReads: 2048 } as const;
const refused = "Prepared artifact proof unavailable";
const uid = () => { const value = process.getuid?.(); assert(value !== undefined, refused); return value; };
function record(value: unknown, keys: string[]): Record<string, unknown> {
  assert(value !== null && typeof value === "object" && !Array.isArray(value), refused);
  assert(Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key)), refused);
  return value as Record<string, unknown>;
}

export function checkedPreparedArtifactProof(value: unknown): PreparedArtifactFixtureSnapshot {
  const data = record(value, [...Object.keys(LIMITS), "allPayloadsEmpty"]);
  for (const [key, limit] of Object.entries(LIMITS))
    assert(Number.isSafeInteger(data[key]) && (data[key] as number) >= 0 && (data[key] as number) <= limit, refused);
  assert(typeof data.allPayloadsEmpty === "boolean", refused);
  const result = data as PreparedArtifactFixtureSnapshot;
  assert(result.payloadObjects + result.tombstones === result.objects && result.rejected <= result.requests
    && result.activeRequests <= result.requests && result.getReads <= result.requests
    && result.payloadBytes <= result.receivedBytes, refused);
  assert(!result.allPayloadsEmpty || (result.activeRequests === 0 && result.putCommits > 0
    && result.objects > 0 && result.tombstones === result.objects && result.payloadBytes === 0), refused);
  return { ...result };
}

function ownedDirectory(): Stats {
  const stat = lstatSync(DIRECTORY);
  assert(stat.isDirectory() && !stat.isSymbolicLink() && stat.uid === uid() && (stat.mode & 0o7777) === 0o700, refused);
  return stat;
}
function sameDirectory(original: Stats) {
  const current = ownedDirectory();
  assert(current.dev === original.dev && current.ino === original.ino, refused);
}
function ownedFile(stat: Stats) {
  assert(stat.isFile() && !stat.isSymbolicLink() && stat.uid === uid() && stat.nlink === 1
    && (stat.mode & 0o7777) === 0o600 && stat.size < 4096, refused);
}
function writerIdentity(pid: number): string {
  assert(Number.isSafeInteger(pid) && pid > 0 && pid <= 4_194_304, refused);
  process.kill(pid, 0);
  const directory = lstatSync(`/proc/${pid}`);
  assert(directory.isDirectory() && directory.uid === uid(), refused);
  const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
  assert(stat.startsWith(`${pid} (`), refused);
  const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
  assert(fields[0] && !["Z", "X", "x"].includes(fields[0]), refused);
  const started = fields[19];
  assert(/^\d{1,30}$/.test(started ?? ""), refused);
  return started;
}

/** Exclusive creation refuses an old instance; every callback persists before returning. */
export function createPreparedArtifactProofWriter(): (snapshot: PreparedArtifactFixtureSnapshot) => void {
  const pid = process.pid, startTicks = writerIdentity(pid);
  mkdirSync(DIRECTORY, { mode: 0o700 });
  const directory = ownedDirectory();
  return snapshot => {
    const body = JSON.stringify({ pid, startTicks, snapshot: checkedPreparedArtifactProof(snapshot) });
    assert(Buffer.byteLength(body) < 4096, refused);
    sameDirectory(directory);
    const temporary = `${DIRECTORY}/.snapshot-${randomUUID()}.json`;
    const fd = openSync(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    try {
      ownedFile(fstatSync(fd));
      writeFileSync(fd, body, "utf8"); fsyncSync(fd);
      sameDirectory(directory);
      renameSync(temporary, FILE);
      sameDirectory(directory);
    } finally {
      closeSync(fd);
      try { unlinkSync(temporary); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    }
  };
}

/** Fixed path, read-only, bounded read; reject a dead or reused writer PID. */
export function readPreparedArtifactProof(): PreparedArtifactFixtureSnapshot {
  const directory = ownedDirectory(), expected = lstatSync(FILE);
  ownedFile(expected);
  const fd = openSync(FILE, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const before = fstatSync(fd); ownedFile(before);
    assert(before.dev === expected.dev && before.ino === expected.ino, refused);
    const bytes = Buffer.alloc(4096);
    let length = 0, count: number;
    do { count = readSync(fd, bytes, length, bytes.length - length, null); length += count; }
    while (count > 0 && length < bytes.length);
    assert(length > 0 && length < 4096 && length === before.size, refused);
    const after = fstatSync(fd); ownedFile(after);
    assert(after.size === before.size && after.mtimeMs === before.mtimeMs, refused);
    sameDirectory(directory);
    const envelope = record(JSON.parse(bytes.subarray(0, length).toString("utf8")), ["pid", "startTicks", "snapshot"]);
    assert(typeof envelope.pid === "number" && typeof envelope.startTicks === "string"
      && writerIdentity(envelope.pid) === envelope.startTicks, refused);
    return checkedPreparedArtifactProof(envelope.snapshot);
  } finally { closeSync(fd); }
}
