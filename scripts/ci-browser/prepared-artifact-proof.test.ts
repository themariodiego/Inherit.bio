import { chmodSync, linkSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync,
  symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { checkedPreparedArtifactProof, createPreparedArtifactProofWriter, readPreparedArtifactProof } from "./prepared-artifact-proof";
import type { PreparedArtifactFixtureSnapshot } from "./prepared-artifact-fixture";

const state = vi.hoisted(() => ({ root: "", startTicks: "123456", processState: "S", foreignOwner: false }));
// Production exports accept no path. Redirect only their fixed filesystem I/O;
// no test touches the real fixture namespace or starts a server/process.
vi.mock("node:fs", async importOriginal => {
  const actual = await importOriginal<typeof import("node:fs")>();
  const mapped = (value: unknown) => typeof value === "string" && value.startsWith("/tmp/prepared-artifact-fixture")
    ? state.root + "/fixture" + value.slice("/tmp/prepared-artifact-fixture".length) : value;
  const redirects = Object.fromEntries(["mkdirSync", "openSync", "unlinkSync", "renameSync"].map(name => [name,
    (...args: unknown[]) => Reflect.apply(actual[name as keyof typeof actual] as (...args: unknown[]) => unknown,
      undefined, args.map((value, index) => index === 0 || (name === "renameSync" && index === 1) ? mapped(value) : value))]));
  return { ...actual, ...redirects,
    lstatSync: (file: string) => {
      const stat = actual.lstatSync(/^\/proc\/\d+$/.test(file) ? state.root : mapped(file) as string);
      if (state.foreignOwner) stat.uid++;
      return stat;
    },
    readFileSync: (...args: unknown[]) => {
      if (typeof args[0] === "string" && /^\/proc\/\d+\/stat$/.test(args[0]))
        return `${process.pid} (fixture name) ${Array.from({ length: 20 }, (_, index) => index === 19 ? state.startTicks
          : index === 0 ? state.processState : "0").join(" ")}`;
      return Reflect.apply(actual.readFileSync, undefined, [mapped(args[0]), ...args.slice(1)]);
    },
  };
});

const initial = (): PreparedArtifactFixtureSnapshot => ({ requests: 0, rejected: 0, activeRequests: 0, receivedBytes: 0,
  objects: 0, payloadBytes: 0, payloadObjects: 0, tombstones: 0, putCommits: 0, tombstoneCommits: 0, getReads: 0,
  allPayloadsEmpty: false });
const removed = (): PreparedArtifactFixtureSnapshot => ({ ...initial(), requests: 3, receivedBytes: 42, objects: 1,
  tombstones: 1, putCommits: 1, tombstoneCommits: 1, getReads: 1, allPayloadsEmpty: true });
const file = () => path.join(state.root, "fixture/snapshot.json");
function changeEnvelope(change: Record<string, unknown>) {
  const value = JSON.parse(readFileSync(file(), "utf8"));
  writeFileSync(file(), JSON.stringify({ ...value, ...change }), { mode: 0o600 });
}
beforeEach(() => { state.root = mkdtempSync(path.join(tmpdir(), "artifact-proof-test-")); state.startTicks = "123456";
  state.processState = "S"; state.foreignOwner = false; });
afterEach(() => { vi.restoreAllMocks(); rmSync(state.root, { recursive: true, force: true }); });

describe("fixed synthetic artifact aggregate proof", () => {
  it("writes atomically before returning and exposes only validated aggregates", () => {
    const write = createPreparedArtifactProofWriter();
    write(initial()); expect(readPreparedArtifactProof()).toEqual(initial());
    const first = lstatSync(file()).ino;
    write(removed()); expect(readPreparedArtifactProof()).toEqual(removed());
    expect(lstatSync(file()).ino).not.toBe(first);
    expect(lstatSync(file()).mode & 0o7777).toBe(0o600);
    expect(lstatSync(path.join(state.root, "fixture")).mode & 0o7777).toBe(0o700);
    expect(Object.keys(readPreparedArtifactProof())).not.toContain("pid");
  });
  it("refuses to adopt an existing directory or a replaced directory", () => {
    const write = createPreparedArtifactProofWriter(); write(initial());
    expect(() => createPreparedArtifactProofWriter()).toThrow();
    renameSync(path.join(state.root, "fixture"), path.join(state.root, "old"));
    mkdirSync(path.join(state.root, "fixture"), { mode: 0o700 });
    expect(() => write(removed())).toThrow();
  });
  it.each([0o644, 0o666, 0o4600])("refuses unsafe file mode %s", mode => {
    createPreparedArtifactProofWriter()(removed()); chmodSync(file(), mode);
    expect(() => readPreparedArtifactProof()).toThrow();
  });
  it("rejects foreign owners, public directories and hard-linked files", () => {
    createPreparedArtifactProofWriter()(removed()); state.foreignOwner = true;
    expect(() => readPreparedArtifactProof()).toThrow(); state.foreignOwner = false;
    chmodSync(path.join(state.root, "fixture"), 0o755);
    expect(() => readPreparedArtifactProof()).toThrow();
    chmodSync(path.join(state.root, "fixture"), 0o700);
    linkSync(file(), path.join(state.root, "linked"));
    expect(() => readPreparedArtifactProof()).toThrow();
  });
  it("rejects symlink files and directories", () => {
    createPreparedArtifactProofWriter()(removed());
    renameSync(file(), path.join(state.root, "other.json"));
    symlinkSync(path.join(state.root, "other.json"), file());
    expect(() => readPreparedArtifactProof()).toThrow();
    renameSync(path.join(state.root, "fixture"), path.join(state.root, "old"));
    symlinkSync(path.join(state.root, "old"), path.join(state.root, "fixture"));
    expect(() => readPreparedArtifactProof()).toThrow();
  });
  it("rejects dead writers and PID reuse without imposing an idle timeout", () => {
    createPreparedArtifactProofWriter()(removed());
    state.startTicks = "999999"; expect(() => readPreparedArtifactProof()).toThrow();
    state.startTicks = "123456";
    const kill = vi.spyOn(process, "kill").mockImplementation(() => { throw new Error("not alive"); });
    expect(() => readPreparedArtifactProof()).toThrow(); kill.mockRestore();
    expect(readPreparedArtifactProof()).toEqual(removed());
  });
  it.each([{ pid: 0 }, { pid: -1 }, { pid: 1.1 }, { startTicks: "bad" }, { extra: "not aggregate" }])("rejects invalid envelope %j", change => {
    createPreparedArtifactProofWriter()(removed()); changeEnvelope(change);
    expect(() => readPreparedArtifactProof()).toThrow();
  });
  it.each(["Z", "X", "x"])("rejects a terminated writer in process state %s", processState => {
    createPreparedArtifactProofWriter()(removed()); state.processState = processState;
    expect(() => readPreparedArtifactProof()).toThrow();
  });
  it("bounds reads and rejects invalid JSON", () => {
    createPreparedArtifactProofWriter()(removed()); writeFileSync(file(), " ".repeat(4096));
    expect(() => readPreparedArtifactProof()).toThrow();
    writeFileSync(file(), "{"); expect(() => readPreparedArtifactProof()).toThrow();
  });
  it.each([{ secret: "not allowed" }, { requests: -1 }, { objects: 513 }, { receivedBytes: 33_554_433 },
    { payloadBytes: NaN }, { getReads: 1.5 }, { allPayloadsEmpty: "true" }, { payloadObjects: 1 },
    { activeRequests: 1 }, { putCommits: 0 }, { payloadBytes: 1 }])("rejects unsafe or inconsistent aggregate %j", change => {
    expect(() => checkedPreparedArtifactProof({ ...removed(), ...change })).toThrow();
  });
  it("rejects bad writes without replacing the last valid snapshot", () => {
    const write = createPreparedArtifactProofWriter(); write(removed());
    expect(() => write({ ...removed(), requests: Infinity })).toThrow();
    expect(readPreparedArtifactProof()).toEqual(removed());
  });
});
