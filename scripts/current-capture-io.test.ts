/** UNRUN real-filesystem controls with tiny synthetic buffers only. No original
 * CI/provider data, ZIP inflater, stock validator, CLI or runtime proof exists here. */
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { CURRENT_INPUT_BYTE_CAP, readOwnedCurrentCapture,
  type CurrentInputAdmission, type DirectoryIdentity, type EntryIdentity } from "./current-capture-io";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });
const hash = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
function directory(file: string): DirectoryIdentity {
  const st = fs.lstatSync(file); return { path: file, dev: st.dev, ino: st.ino, uid: st.uid, mode: st.mode };
}
function namespace(root: string): EntryIdentity[] {
  return fs.readdirSync(root).sort().map(name => {
    const st = fs.lstatSync(path.join(root, name));
    return { name, dev: st.dev, ino: st.ino, uid: st.uid, mode: st.mode, nlink: st.nlink,
      size: st.size, mtimeMs: st.mtimeMs, ctimeMs: st.ctimeMs };
  });
}
function fixture() {
  const parent = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "ci-raw-io-")));
  roots.push(parent); fs.chmodSync(parent, 0o700);
  const root = path.join(parent, "capture"); fs.mkdirSync(root, { mode: 0o700 });
  const names = ["capture-receipt.json", "run.raw", "jobs.raw", "artifacts.raw", "tested-commit.raw",
    "browser-case-1-manifest.raw", ...Array.from({ length: 6 }, (_, i) => `browser-case-1-shard-${i + 1}.raw`)];
  const raws = names.map((name, index) => Buffer.from(`OFFLINE_SYNTHETIC_${index}:${name}`));
  names.forEach((name, i) => fs.writeFileSync(path.join(root, name), raws[i], { mode: 0o600, flag: "wx" }));
  // Genuine captures also retain original-command/readback/log files. They must
  // remain represented, not silently excluded from full directory custody.
  fs.writeFileSync(path.join(root, "synthetic.original-command.json"), "{}", { mode: 0o600, flag: "wx" });
  const pins = names.map((name, i) => ({ path: path.join(root, name), bytes: raws[i].length, sha256: hash(raws[i]) }));
  const value: CurrentInputAdmission = { schemaVersion: 1, format: "hosted-reader-raw-v1", runAttempt: 1,
    directory: directory(root), parent: directory(parent), namespace: namespace(root), captureReceipt: pins[0],
    metadata: { run: pins[1], jobs: pins[2], artifacts: pins[3], testedCommit: pins[4] }, zipPins: pins.slice(5) };
  return { root, parent, names, raws, pins, value };
}
const clone = (value: CurrentInputAdmission): CurrentInputAdmission => JSON.parse(JSON.stringify(value));
const refresh = (f: ReturnType<typeof fixture>) => ({ ...f.value, namespace: namespace(f.root) });
describe("owned original current-capture IO (UNRUN)", () => {
  it("returns all twelve exact original buffers without history admission", () => {
    const f = fixture(), actual = readOwnedCurrentCapture(f.value);
    expect([actual.captureReceipt, actual.run, actual.jobs, actual.artifacts, actual.testedCommit,
      actual.manifestZip, ...actual.shardZips]).toEqual(f.raws);
    expect(actual.originalPins).toEqual(f.pins);
    expect(actual.ioCustodyComplete).toBe(true);
    expect(actual.historicalValidatorAdmission).toBe(false);
    expect(actual.format).toBe("hosted-reader-raw-v1");
  });
  it("retains the complete observed namespace including nonselected original records", () => {
    const f = fixture(), actual = readOwnedCurrentCapture(f.value);
    expect(actual.namespace).toEqual(f.value.namespace);
    expect(actual.namespace.some(row => row.name === "synthetic.original-command.json")).toBe(true);
  });
  it("refuses a nonprivate capture root", () => {
    const f = fixture(); fs.chmodSync(f.root, 0o755); expect(() => readOwnedCurrentCapture(f.value)).toThrow();
  });
  it("refuses a symlink capture root even when its target is owned", () => {
    const f = fixture(), alias = path.join(f.parent, "alias"); fs.symlinkSync(f.root, alias);
    const value = clone(f.value); Reflect.set(value.directory, "path", alias);
    expect(() => readOwnedCurrentCapture(value)).toThrow();
  });
  it("refuses a foreign admitted owner identity", () => {
    const f = fixture(), value = clone(f.value); Reflect.set(value.directory, "uid", value.directory.uid + 1);
    expect(() => readOwnedCurrentCapture(value)).toThrow();
  });
  it("refuses a foreign admitted device identity", () => {
    const f = fixture(), value = clone(f.value); Reflect.set(value.directory, "dev", value.directory.dev + 1);
    expect(() => readOwnedCurrentCapture(value)).toThrow();
  });
  it("refuses an aliased or mismatched parent", () => {
    const f = fixture(), value = clone(f.value); Reflect.set(value.parent, "ino", value.parent.ino + 1);
    expect(() => readOwnedCurrentCapture(value)).toThrow();
  });
  it("refuses a missing original input", () => {
    const f = fixture(); fs.unlinkSync(f.pins[1].path); expect(() => readOwnedCurrentCapture(f.value)).toThrow();
  });
  it("refuses an input symlink rather than opening its target", () => {
    const f = fixture(), item = f.pins[1].path; fs.unlinkSync(item); fs.symlinkSync(f.pins[2].path, item);
    expect(() => readOwnedCurrentCapture(refresh(f))).toThrow();
  });
  it("refuses a multiply linked original regular input", () => {
    const f = fixture(); fs.linkSync(f.pins[1].path, path.join(f.parent, "other-link"));
    expect(() => readOwnedCurrentCapture(refresh(f))).toThrow();
  });
  it("refuses permissive regular-file mode", () => {
    const f = fixture(); fs.chmodSync(f.pins[1].path, 0o644);
    expect(() => readOwnedCurrentCapture(refresh(f))).toThrow();
  });
  it("refuses zero length input even when the supplied pin agrees", () => {
    const f = fixture(); fs.truncateSync(f.pins[1].path, 0);
    const value = { ...refresh(f), metadata: { ...f.value.metadata, run: { ...f.pins[1], bytes: 0, sha256: hash(Buffer.alloc(0)) } } };
    expect(() => readOwnedCurrentCapture(value)).toThrow();
  });
  it("refuses oversized sparse input before allocating its contents", () => {
    const f = fixture(); fs.truncateSync(f.pins[1].path, CURRENT_INPUT_BYTE_CAP + 1);
    const value = { ...refresh(f), metadata: { ...f.value.metadata, run: { ...f.pins[1], bytes: CURRENT_INPUT_BYTE_CAP + 1 } } };
    expect(() => readOwnedCurrentCapture(value)).toThrow();
  });
  it("refuses an original digest mismatch", () => {
    const f = fixture(), value = clone(f.value); Reflect.set(value.metadata.run, "sha256", "f".repeat(64));
    expect(() => readOwnedCurrentCapture(value)).toThrow();
  });
  it("refuses original byte count mismatch", () => {
    const f = fixture(), value = clone(f.value); Reflect.set(value.metadata.run, "bytes", f.pins[1].bytes + 1);
    expect(() => readOwnedCurrentCapture(value)).toThrow();
  });
  it("refuses a duplicate or reordered ZIP pin", () => {
    const f = fixture(), value = clone(f.value); Reflect.set(value.zipPins, "1", value.zipPins[0]);
    expect(() => readOwnedCurrentCapture(value)).toThrow();
  });
  it("refuses a different attempt in the explicit admission", () => {
    const f = fixture(), value = clone(f.value); Reflect.set(value, "runAttempt", 2);
    expect(() => readOwnedCurrentCapture(value)).toThrow();
  });
  it("refuses legacy metadata alongside current originals", () => {
    const f = fixture(); fs.writeFileSync(path.join(f.root, "run.raw.json"), "{}", { mode: 0o600, flag: "wx" });
    expect(() => readOwnedCurrentCapture(refresh(f))).toThrow();
  });
  it("refuses a legacy ZIP alias alongside original raw archive bytes", () => {
    const f = fixture(); fs.writeFileSync(path.join(f.root, "browser-case-1-manifest.zip"), "x", { mode: 0o600, flag: "wx" });
    expect(() => readOwnedCurrentCapture(refresh(f))).toThrow();
  });
  it("refuses foreign raw artifacts from another attempt", () => {
    const f = fixture(); fs.writeFileSync(path.join(f.root, "browser-case-2-manifest.raw"), "x", { mode: 0o600, flag: "wx" });
    expect(() => readOwnedCurrentCapture(refresh(f))).toThrow();
  });
  it("refuses unexpected namespace additions rather than excluding them", () => {
    const f = fixture(); fs.writeFileSync(path.join(f.root, "unexpected.raw"), "x", { mode: 0o600, flag: "wx" });
    expect(() => readOwnedCurrentCapture(f.value)).toThrow();
  });
  it("refuses same-name inode replacement with otherwise identical bytes", () => {
    const f = fixture(), file = f.pins[1].path; fs.renameSync(file, path.join(f.parent, "retained-old"));
    fs.writeFileSync(file, f.raws[1], { mode: 0o600, flag: "wx" });
    expect(() => readOwnedCurrentCapture(f.value)).toThrow();
  });
  it("refuses a directory child instead of a regular capture record", () => {
    const f = fixture(); fs.mkdirSync(path.join(f.root, "unknown-child"), { mode: 0o700 });
    expect(() => readOwnedCurrentCapture(f.value)).toThrow();
  });
  it("refuses unknown admission keys", () => {
    const f = fixture(); Reflect.set(f.value, "acceptBaseline", true);
    expect(() => readOwnedCurrentCapture(f.value)).toThrow();
  });
  it("refuses an implicit or legacy format selector", () => {
    const f = fixture(), value = clone(f.value); Reflect.set(value, "format", "legacy");
    expect(() => readOwnedCurrentCapture(value)).toThrow();
  });
  it("refuses an accessor in otherwise matching admission", () => {
    const f = fixture(); Object.defineProperty(f.value, "runAttempt", { enumerable: true, get: () => 1 });
    expect(() => readOwnedCurrentCapture(f.value)).toThrow();
  });
});
