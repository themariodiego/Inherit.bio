/** UNRUN. Only test wrappers are injected; stock FD reads/closes still happen
 * on genuine owned synthetic files. No production IO hook or fake FD is added. */
import * as fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { readOwnedCurrentCapture, type CurrentInputAdmission, type DirectoryIdentity,
  type EntryIdentity } from "./current-capture-io";

const hooks = vi.hoisted(() => ({ afterRead: null as ((fd: number) => void) | null,
  afterClose: null as ((fd: number) => void) | null }));
vi.mock("node:fs", async importOriginal => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return { ...actual,
    readSync: (...args: unknown[]) => {
      const value: unknown = Reflect.apply(actual.readSync, actual, args);
      const fd = args[0]; if (typeof fd === "number") hooks.afterRead?.(fd);
      return value;
    },
    closeSync: (...args: unknown[]) => {
      Reflect.apply(actual.closeSync, actual, args); // Real close occurs first.
      const fd = args[0]; if (typeof fd === "number") hooks.afterClose?.(fd);
    },
  };
});
const parents: string[] = [];
afterEach(() => {
  hooks.afterRead = null; hooks.afterClose = null;
  for (const parent of parents.splice(0)) fs.rmSync(parent, { recursive: true, force: true });
});
function directory(p: string): DirectoryIdentity {
  const st = fs.lstatSync(p); return { path: p, dev: st.dev, ino: st.ino, uid: st.uid, mode: st.mode };
}
function namespace(root: string): EntryIdentity[] {
  return fs.readdirSync(root).sort().map(name => {
    const st = fs.lstatSync(path.join(root, name));
    return { name, dev: st.dev, ino: st.ino, uid: st.uid, mode: st.mode, nlink: st.nlink,
      size: st.size, mtimeMs: st.mtimeMs, ctimeMs: st.ctimeMs };
  });
}
function fixture() {
  const parent = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "ci-fd-")));
  parents.push(parent); fs.chmodSync(parent, 0o700);
  const root = path.join(parent, "capture"); fs.mkdirSync(root, { mode: 0o700 });
  const names = ["capture-receipt.json", "run.raw", "jobs.raw", "artifacts.raw", "tested-commit.raw",
    "browser-case-1-manifest.raw", ...Array.from({ length: 6 }, (_, i) => `browser-case-1-shard-${i + 1}.raw`)];
  const raws = names.map((name, i) => Buffer.from(`OFFLINE_SYNTHETIC_FD_${i}:${name}`));
  names.forEach((name, i) => fs.writeFileSync(path.join(root, name), raws[i], { mode: 0o600, flag: "wx" }));
  const pins = names.map((name, i) => ({ path: path.join(root, name), bytes: raws[i].length,
    sha256: createHash("sha256").update(raws[i]).digest("hex") }));
  const value: CurrentInputAdmission = { schemaVersion: 1, format: "hosted-reader-raw-v1", runAttempt: 1,
    directory: directory(root), parent: directory(parent), namespace: namespace(root), captureReceipt: pins[0],
    metadata: { run: pins[1], jobs: pins[2], artifacts: pins[3], testedCommit: pins[4] }, zipPins: pins.slice(5) };
  return { parent, root, raws, pins, value };
}
describe("current original FD lifecycle (UNRUN)", () => {
  it("refuses growth after a genuine read while the original FD is open", () => {
    const f = fixture(); let calls = 0, held: number | null = null;
    const observed: { value?: { beforeInode: number; beforeSize: number; afterInode: number;
      afterSize: number; namedInode: number; namedSize: number } } = {};
    hooks.afterRead = fd => {
      hooks.afterRead = null; calls++; held = fd;
      const before = fs.fstatSync(fd);
      fs.appendFileSync(f.pins[0].path, "GROWTH");
      const after = fs.fstatSync(fd), named = fs.lstatSync(f.pins[0].path);
      observed.value = { beforeInode: before.ino, beforeSize: before.size, afterInode: after.ino,
        afterSize: after.size, namedInode: named.ino, namedSize: named.size };
    };
    expect(() => readOwnedCurrentCapture(f.value)).toThrow();
    const inode = f.value.namespace.find(row => row.name === "capture-receipt.json")!.ino;
    expect(observed.value).toEqual({ beforeInode: inode, beforeSize: f.pins[0].bytes,
      afterInode: inode, afterSize: f.pins[0].bytes + Buffer.byteLength("GROWTH"),
      namedInode: inode, namedSize: f.pins[0].bytes + Buffer.byteLength("GROWTH") });
    expect(fs.lstatSync(f.pins[0].path).size).toBe(f.pins[0].bytes + Buffer.byteLength("GROWTH"));
    expect(calls).toBe(1);
    expect(held).not.toBeNull();
    expect(() => fs.fstatSync(held!)).toThrow(); // Genuine finally close occurred.
  });
  it("refuses same-name replacement while retaining the original open FD", () => {
    const f = fixture(); let calls = 0, held: number | null = null;
    const observed: { value?: { beforeInode: number; beforeSize: number; afterInode: number;
      afterSize: number; namedInode: number; namedSize: number; retainedInode: number; retainedSize: number } } = {};
    hooks.afterRead = fd => {
      hooks.afterRead = null; calls++; held = fd;
      const before = fs.fstatSync(fd);
      const retained = path.join(f.parent, "retained-original");
      fs.renameSync(f.pins[0].path, retained);
      fs.writeFileSync(f.pins[0].path, f.raws[0], { mode: 0o600, flag: "wx" });
      const after = fs.fstatSync(fd), named = fs.lstatSync(f.pins[0].path), saved = fs.lstatSync(retained);
      observed.value = { beforeInode: before.ino, beforeSize: before.size, afterInode: after.ino,
        afterSize: after.size, namedInode: named.ino, namedSize: named.size,
        retainedInode: saved.ino, retainedSize: saved.size };
    };
    expect(() => readOwnedCurrentCapture(f.value)).toThrow();
    const inode = f.value.namespace.find(row => row.name === "capture-receipt.json")!.ino;
    expect(observed.value).toBeDefined();
    expect(observed.value?.beforeInode).toBe(inode); expect(observed.value?.beforeSize).toBe(f.pins[0].bytes);
    expect(observed.value?.afterInode).toBe(inode); expect(observed.value?.afterSize).toBe(f.pins[0].bytes);
    expect(observed.value?.retainedInode).toBe(inode); expect(observed.value?.retainedSize).toBe(f.pins[0].bytes);
    expect(observed.value?.namedInode).not.toBe(inode); expect(observed.value?.namedSize).toBe(f.pins[0].bytes);
    expect(fs.lstatSync(f.pins[0].path).ino).toBe(observed.value?.namedInode);
    expect(fs.readFileSync(f.pins[0].path)).toEqual(f.raws[0]);
    expect(calls).toBe(1); expect(held).not.toBeNull();
    expect(() => fs.fstatSync(held!)).toThrow();
  });
  it("does not return success when the genuine FD close reports uncertainty", () => {
    const f = fixture(); let readCalls = 0, closeCalls = 0, held: number | null = null;
    hooks.afterRead = fd => { hooks.afterRead = null; readCalls++; held = fd; };
    hooks.afterClose = fd => {
      if (fd === held) {
        hooks.afterClose = null; closeCalls++;
        throw new Error("SYNTHETIC_CLOSE_UNCERTAINTY");
      }
    };
    expect(() => readOwnedCurrentCapture(f.value)).toThrow("SYNTHETIC_CLOSE_UNCERTAINTY");
    expect(readCalls).toBe(1); expect(closeCalls).toBe(1); expect(held).not.toBeNull();
    expect(() => fs.fstatSync(held!)).toThrow();
  });
});
