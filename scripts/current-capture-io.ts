/** This reads original bytes; it does not admit
 * history, inflate ZIPs, produce legacy receipts or accept/overwrite a profile. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { closeSync, constants, fstatSync, lstatSync, openSync, readSync,
  readdirSync, realpathSync, type Stats } from "node:fs";
import path from "node:path";

export const CURRENT_INPUT_BYTE_CAP = 10_000_000;
const maxEntries = 4096;
const digest = (raw: Buffer) => createHash("sha256").update(raw).digest("hex");
export type OriginalPin = Readonly<{ path: string; bytes: number; sha256: string }>;
export type DirectoryIdentity = Readonly<{ path: string; dev: number; ino: number; uid: number; mode: number }>;
export type EntryIdentity = Readonly<{ name: string; dev: number; ino: number; uid: number;
  mode: number; nlink: number; size: number; mtimeMs: number; ctimeMs: number }>;
export type CurrentInputAdmission = Readonly<{
  schemaVersion: 1; format: "hosted-reader-raw-v1"; runAttempt: number;
  directory: DirectoryIdentity; parent: DirectoryIdentity;
  namespace: readonly EntryIdentity[];
  captureReceipt: OriginalPin;
  metadata: Readonly<{ run: OriginalPin; jobs: OriginalPin; artifacts: OriginalPin; testedCommit: OriginalPin }>;
  zipPins: readonly OriginalPin[];
}>;
export type OwnedCurrentInputBuffers = Readonly<{
  format: "hosted-reader-raw-v1"; captureReceipt: Buffer;
  run: Buffer; jobs: Buffer; artifacts: Buffer; testedCommit: Buffer;
  manifestZip: Buffer; shardZips: readonly Buffer[];
  originalPins: readonly OriginalPin[];
  directory: DirectoryIdentity; namespace: readonly EntryIdentity[];
  ioCustodyComplete: true; historicalValidatorAdmission: false;
}>;
const integer = (n: unknown): n is number => typeof n === "number" && Number.isSafeInteger(n) && n >= 0;
function closed(value: unknown, keys: string[]): asserts value is Record<string, unknown> {
  assert(value !== null && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype,
    "Plain closed reviewed admission required");
  assert.deepEqual(Reflect.ownKeys(value).sort(), [...keys].sort(), "Unknown or missing admission field");
  for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(value)))
    assert("value" in descriptor && descriptor.enumerable, "Admission accessors are forbidden");
}
function uid(): number {
  assert(process.getuid, "A genuine local owner identity is required");
  return process.getuid();
}
function absolute(value: unknown): asserts value is string {
  assert(typeof value === "string" && path.isAbsolute(value) && !/[\x00-\x1f\x7f]/.test(value)
    && path.resolve(value) === value, "Canonical absolute input path required");
}
function directoryRow(value: unknown): asserts value is DirectoryIdentity {
  closed(value, ["path", "dev", "ino", "uid", "mode"]); absolute(value.path);
  assert([value.dev, value.ino, value.uid, value.mode].every(integer), "Directory identity integer domain");
}
function visibleDirectory(file: string, privateRoot: boolean): DirectoryIdentity {
  absolute(file);
  assert(realpathSync(file) === file, "Input directory has symlink indirection");
  const actual = lstatSync(file);
  assert(actual.isDirectory() && !actual.isSymbolicLink() && actual.uid === uid()
    && (!privateRoot || (actual.mode & 0o777) === 0o700), "Owned private capture directory required");
  return { path: file, dev: actual.dev, ino: actual.ino, uid: actual.uid, mode: actual.mode };
}
function entry(name: string, actual: Stats): EntryIdentity {
  assert(/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name), "Only a direct safe capture basename is allowed");
  assert(actual.isFile() && !actual.isSymbolicLink() && actual.uid === uid()
    && (actual.mode & 0o777) === 0o600 && actual.nlink === 1,
    "Every capture namespace member must be owned regular0600 singly linked");
  return { name, dev: actual.dev, ino: actual.ino, uid: actual.uid, mode: actual.mode,
    nlink: actual.nlink, size: actual.size, mtimeMs: actual.mtimeMs, ctimeMs: actual.ctimeMs };
}
function entryRow(value: unknown): asserts value is EntryIdentity {
  closed(value, ["name", "dev", "ino", "uid", "mode", "nlink", "size", "mtimeMs", "ctimeMs"]);
  assert(typeof value.name === "string" && /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value.name), "Namespace basename domain");
  assert([value.dev, value.ino, value.uid, value.mode, value.nlink, value.size].every(integer)
    && value.nlink === 1 && typeof value.mtimeMs === "number" && Number.isFinite(value.mtimeMs)
    && value.mtimeMs >= 0 && typeof value.ctimeMs === "number" && Number.isFinite(value.ctimeMs)
    && value.ctimeMs >= 0, "Namespace identity domain");
}
function inventory(root: string, rootDevice: number): EntryIdentity[] {
  const names = readdirSync(root).sort();
  assert(names.length > 0 && names.length <= maxEntries, "Capture namespace bound");
  return names.map(name => {
    const item = entry(name, lstatSync(path.join(root, name)));
    assert(item.dev === rootDevice, "Foreign-device capture member refused");
    return item;
  });
}
function pinRow(value: unknown): asserts value is OriginalPin {
  closed(value, ["path", "bytes", "sha256"]); absolute(value.path);
  assert(integer(value.bytes) && value.bytes > 0 && value.bytes <= CURRENT_INPUT_BYTE_CAP
    && typeof value.sha256 === "string" && /^[0-9a-f]{64}$/.test(value.sha256), "Original input pin bound");
}
function verifyAdmission(value: CurrentInputAdmission): void {
  closed(value, ["schemaVersion", "format", "runAttempt", "directory", "parent", "namespace",
    "captureReceipt", "metadata", "zipPins"]);
  assert(value.schemaVersion === 1 && value.format === "hosted-reader-raw-v1"
    && integer(value.runAttempt) && value.runAttempt > 0, "Explicit current format and attempt required");
  directoryRow(value.directory); directoryRow(value.parent);
  assert(path.dirname(value.directory.path) === value.parent.path, "Exact canonical parent identity required");
  assert(Array.isArray(value.namespace) && value.namespace.length > 0 && value.namespace.length <= maxEntries,
    "Reviewed complete namespace required");
  value.namespace.forEach(entryRow);
  assert(new Set(value.namespace.map(row => row.name)).size === value.namespace.length, "Duplicate namespace member");
  assert.deepEqual(value.namespace.map(row => row.name), value.namespace.map(row => row.name).sort(), "Namespace order must be canonical");
  closed(value.metadata, ["run", "jobs", "artifacts", "testedCommit"]);
  pinRow(value.captureReceipt); Object.values(value.metadata).forEach(pinRow);
  assert(Array.isArray(value.zipPins) && value.zipPins.length === 7, "Exactly seven original ZIP pins required");
  value.zipPins.forEach(pinRow);
  const pins = [value.captureReceipt, value.metadata.run, value.metadata.jobs, value.metadata.artifacts,
    value.metadata.testedCommit, ...value.zipPins];
  const expected = ["capture-receipt.json", "run.raw", "jobs.raw", "artifacts.raw", "tested-commit.raw",
    `browser-case-${value.runAttempt}-manifest.raw`,
    ...Array.from({ length: 6 }, (_, i) => `browser-case-${value.runAttempt}-shard-${i + 1}.raw`)];
  assert.deepEqual(pins.map(row => row.path), expected.map(name => path.join(value.directory.path, name)),
    "Only exact current original names and shard order are admitted");
  const legacy = /^(run|jobs|artifacts)\.(json|raw\.json)$|^tested-merge-commit\.(json|raw\.json)$|^browser-case-.*\.zip$/;
  const rawArtifacts = new Set(expected.slice(5));
  for (const row of value.namespace) {
    assert(!legacy.test(row.name), "Legacy/raw layout mixing refused");
    assert(!/^browser-case-.*\.raw$/.test(row.name) || rawArtifacts.has(row.name), "Foreign or ambiguous raw case artifact refused");
  }
  for (const item of pins) assert(value.namespace.some(row => path.join(value.directory.path, row.name) === item.path),
    "An original input is missing from the reviewed namespace");
}
/** Snapshot equality is not atomic directory capability or independent review.
 * Caller must separately authenticate this entire admission before invoking IO. */
export function readOwnedCurrentCapture(input: CurrentInputAdmission): OwnedCurrentInputBuffers {
  verifyAdmission(input);
  const root = input.directory.path;
  const beforeDirectory = lstatSync(root);
  const checked = () => {
    assert.deepEqual(visibleDirectory(root, true), input.directory, "Capture directory identity drift");
    assert.deepEqual(visibleDirectory(input.parent.path, false), input.parent, "Capture parent identity drift");
    const current = lstatSync(root);
    assert(current.mtimeMs === beforeDirectory.mtimeMs && current.ctimeMs === beforeDirectory.ctimeMs,
      "Capture directory changed during input read");
    assert.deepEqual(inventory(root, input.directory.dev), input.namespace, "Capture namespace drift");
  };
  checked();
  const pins = [input.captureReceipt, input.metadata.run, input.metadata.jobs, input.metadata.artifacts,
    input.metadata.testedCommit, ...input.zipPins];
  const buffers = pins.map(pin => {
    checked();
    const name = path.basename(pin.path), observed = lstatSync(pin.path);
    const bound = input.namespace.find(row => row.name === name); assert(bound, "Missing original input identity");
    assert.deepEqual(entry(name, observed), bound, "Original input identity drift");
    // Nonblocking avoids a replaced FIFO blocking open before the regular-file FD check.
    const fd = openSync(pin.path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    let bytes: Buffer;
    try {
      const original = fstatSync(fd);
      assert.deepEqual(entry(name, original), bound, "Opened FD differs from original named identity");
      assert(original.dev === input.directory.dev && original.size === pin.bytes,
        "Original FD size/device differs from pin");
      const bounded = Buffer.alloc(pin.bytes + 1); let count = 0;
      while (count < bounded.length) {
        const n = readSync(fd, bounded, count, bounded.length - count, count);
        if (n === 0) break; count += n;
      }
      bytes = bounded.subarray(0, count);
      assert(bytes.length === pin.bytes && digest(bytes) === pin.sha256, "Original bytes differ from reviewed pin");
      assert.deepEqual(entry(name, fstatSync(fd)), bound, "Original FD changed during read");
      assert.deepEqual(entry(name, lstatSync(pin.path)), bound, "Original named file changed during read");
      checked();
    } finally { closeSync(fd); }
    checked(); // A close error refuses; no successful return masks uncertainty.
    return bytes;
  });
  checked();
  return Object.freeze({ format: "hosted-reader-raw-v1", captureReceipt: buffers[0],
    run: buffers[1], jobs: buffers[2], artifacts: buffers[3], testedCommit: buffers[4],
    manifestZip: buffers[5], shardZips: Object.freeze(buffers.slice(6)),
    originalPins: Object.freeze(pins.map(pin => Object.freeze({ ...pin }))),
    directory: Object.freeze({ ...input.directory }), namespace: Object.freeze(input.namespace.map(row => Object.freeze({ ...row }))),
    ioCustodyComplete: true, historicalValidatorAdmission: false });
}
