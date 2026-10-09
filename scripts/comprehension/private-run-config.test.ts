import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { chmodSync, existsSync, linkSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import type { BigIntStats, Stats } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it, vi } from "vitest";
import { repositoryRoot } from "./conductor-inputs";
import { freshT6ConfigSchema } from "./fresh-t6-config";
import { loadPrivateConfiguration, loadPrivateRunConfig, PRIVATE_CONFIG_MAX_BYTES, PRIVATE_CONFIG_REFUSAL } from "./private-run-config";

const controls = vi.hoisted(() => ({ duringRead: undefined as (() => void) | undefined,
  buffers: [] as Buffer[], rejectClose: false,
  statProjection: undefined as ((value: Stats | BigIntStats, file?: unknown) => Stats | BigIntStats) | undefined }));
vi.mock("node:fs", async importOriginal => {
  const actual = await importOriginal<typeof import("node:fs")>();
  function projected(value: Stats | BigIntStats, file?: unknown): Stats | BigIntStats {
    return controls.statProjection?.(value, file) ?? value;
  }
  return { ...actual,
    lstatSync(...args: Parameters<typeof actual.lstatSync>) {
      const value = actual.lstatSync(...args);
      return value === undefined ? value : projected(value, args[0]);
    },
    fstatSync(...args: Parameters<typeof actual.fstatSync>) {
      return projected(actual.fstatSync(...args));
    },
    readSync(fd: number, bytes: Buffer, offset: number, length: number, position: number | null) {
      controls.buffers.push(bytes);
      const count = actual.readSync(fd, bytes, offset, length, position);
      const effect = controls.duringRead; controls.duringRead = undefined; effect?.();
      return count;
    },
    closeSync(fd: number) {
      actual.closeSync(fd);
      if (controls.rejectClose) { controls.rejectClose = false; throw new Error("Synthetic close uncertainty"); }
    },
  };
});

const roots: string[] = [];
afterEach(() => {
  controls.duringRead = undefined; controls.buffers = []; controls.rejectClose = false; controls.statProjection = undefined;
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
function directory(): string {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), "inherit-private-config-")));
  roots.push(root); return root;
}
function config(root: string) {
  return { schemaVersion: 1, kind: "smoke", effortDirectory: path.join(root, "effort"),
    tasks: ["T1", "T6", "T7"], personas: 1, samplingSeed: "d".repeat(64),
    settings: { temperature: 0, maxSteps: 8, maxAttempts: 1, timeoutMs: 60_000,
      sessionSetupTimeoutMs: 600_000, maximumInputTokens: 24_000, maximumOutputTokens: 600,
      price: { inputMicroDollarsPerMillion: 1, outputMicroDollarsPerMillion: 1 } },
    limitMicroDollars: 1_000_000, otherCostsMicroDollars: 0,
    stubRecordRoot: path.join(root, "records"), provider: { kind: "local-deterministic-stub" } };
}
function file(root = directory()): string {
  const result = path.join(root, "run.json");
  writeFileSync(result, JSON.stringify(config(root)), { flag: "wx", mode: 0o600 });
  return result;
}
function privateError(input: string) { expect(() => loadPrivateRunConfig(input)).toThrow(PRIVATE_CONFIG_REFUSAL); }
function clearedReadBytes() {
  expect(controls.buffers.length).toBeGreaterThan(0);
  expect(controls.buffers.every(bytes => bytes.every(byte => byte === 0))).toBe(true);
}

describe("private comprehension configuration admission", () => {
  it("reads the owned canonical private file without changing its bytes or opening the journal", () => {
    const root = directory(), input = file(root), original = readFileSync(input);
    expect(loadPrivateRunConfig(input)).toMatchObject(config(root));
    expect(readFileSync(input).equals(original)).toBe(true);
    expect(existsSync(path.join(root, "effort"))).toBe(false);
    expect(existsSync(path.join(root, "records"))).toBe(false);
    clearedReadBytes();
  });

  it("uses the same closed admission for the exclusive schema, clearing bytes on parser refusal", () => {
    const root = directory(), input = file(root);
    const value = { run: config(root), maximumInfrastructureCostPerStackMicroDollars: 10 };
    writeFileSync(input, JSON.stringify(value));
    expect(loadPrivateConfiguration(input, value => freshT6ConfigSchema.parse(value))).toMatchObject(value);
    clearedReadBytes();
    controls.buffers = [];
    expect(() => loadPrivateConfiguration(input, () => { throw new Error("Private parser detail"); })).toThrow(PRIVATE_CONFIG_REFUSAL);
    clearedReadBytes();
    expect(existsSync(path.join(root, "effort"))).toBe(false);
  });

  it("plans the complete ten-task 300-pair round and 301 stack reservations without opening native or inference resources", async () => {
    const root = directory(), input = file(root), runtime = path.join(root, "tmp"); mkdirSync(runtime, { mode: 0o700 });
    const defaults = { ...config(root), tasks: undefined, personas: undefined };
    writeFileSync(input, JSON.stringify({ run: defaults, maximumInfrastructureCostPerStackMicroDollars: 10 }));
    const { stdout, stderr } = await promisify(execFile)(process.execPath,
      ["--import", "tsx", "scripts/comprehension/run-fresh-t6.mts", input, "--plan"],
      { cwd: repositoryRoot, timeout: 4_000, env: { PATH: process.env.PATH, NODE_ENV: "test", TMPDIR: runtime } });
    expect(JSON.parse(stdout)).toMatchObject({ tasks: ["T1", "T2", "T3", "T4", "T5", "T6", "T7", "T8", "T9", "T10"],
      personas: 30, sessions: 300, freshStacks: 301, productionBuilds: 1, infrastructureReservationMicroDollars: 3010,
      qualifyingEvidence: false, hostedOwnershipRequired: true });
    expect(stderr).toBe(""); expect(stdout).not.toContain(input);
    expect(existsSync(path.join(root, "effort"))).toBe(false);
    expect(existsSync(path.join(root, "records"))).toBe(false);
  });

  it("accepts the exact byte ceiling and refuses one extra byte before parsing", () => {
    const input = file(), body = readFileSync(input);
    writeFileSync(input, Buffer.concat([body, Buffer.alloc(PRIVATE_CONFIG_MAX_BYTES - body.length, 0x20)]));
    expect(loadPrivateRunConfig(input).provider.kind).toBe("local-deterministic-stub");
    writeFileSync(input, Buffer.concat([readFileSync(input), Buffer.from(" ")]));
    privateError(input);
  });

  it("refuses a relative input instead of adopting the operator's working directory", () => {
    privateError(path.relative(process.cwd(), file()));
  });

  it.each([0o644, 0o660, 0o400])("refuses file mode %i without changing it", mode => {
    const input = file(); chmodSync(input, mode); privateError(input);
  });

  it("refuses a file symlink without following it", () => {
    const input = file(), alias = path.join(path.dirname(input), "alias.json");
    symlinkSync(input, alias); privateError(alias);
  });

  it("refuses a directory alias even when its final file is regular", () => {
    const root = directory(), real = path.join(root, "private"); mkdirSync(real, { mode: 0o700 });
    const input = file(real), alias = path.join(root, "alias"); symlinkSync(real, alias, "dir");
    privateError(path.join(alias, path.basename(input)));
  });

  it("refuses a hard-linked private file", () => {
    const input = file(); linkSync(input, path.join(path.dirname(input), "second.json")); privateError(input);
  });

  it.each(["directory", "worktree-file"])("refuses a configuration below a Git %s marker", kind => {
    const root = directory(), input = file(root);
    if (kind === "directory") mkdirSync(path.join(root, ".git"));
    else writeFileSync(path.join(root, ".git"), "gitdir: /synthetic/unopened/path\n");
    privateError(input);
  });

  it("refuses a directory input before attempting a file read", () => {
    privateError(directory()); expect(controls.buffers).toEqual([]);
  });

  it("refuses an empty file", () => {
    const input = file(); writeFileSync(input, ""); privateError(input);
  });

  it("does not turn invalid UTF-8 or a BOM into accepted configuration", () => {
    const input = file(), body = readFileSync(input);
    writeFileSync(input, Buffer.from([0xc3, 0x28])); privateError(input);
    writeFileSync(input, Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), body])); privateError(input);
    clearedReadBytes();
  });

  it("keeps malformed JSON and unknown private schema keys out of refusal diagnostics", () => {
    const input = file(), marker = randomUUID();
    writeFileSync(input, `{"${marker}":`);
    privateError(input);
    writeFileSync(input, JSON.stringify({ ...config(path.dirname(input)), [marker]: true }));
    try { loadPrivateRunConfig(input); throw new Error("Unexpected admission"); }
    catch (error) { expect((error as Error).message).toBe(PRIVATE_CONFIG_REFUSAL); }
    clearedReadBytes();
  });

  it("refuses a named-file replacement during a real read and clears consumed bytes", () => {
    const input = file(), replacement = path.join(path.dirname(input), "replacement.json");
    writeFileSync(replacement, readFileSync(input), { mode: 0o600 });
    controls.duringRead = () => renameSync(replacement, input);
    privateError(input); clearedReadBytes();
  });

  it("refuses a permission change during a real read", () => {
    const input = file(); controls.duringRead = () => chmodSync(input, 0o644);
    privateError(input); clearedReadBytes();
  });

  it("refuses a checkout marker introduced during the read", () => {
    const input = file(); controls.duringRead = () => mkdirSync(path.join(path.dirname(input), ".git"));
    privateError(input); clearedReadBytes();
  });

  it("does not return configuration when descriptor closure is uncertain", () => {
    const input = file(); controls.rejectClose = true;
    privateError(input); clearedReadBytes();
  });

  it("runs the credential-free stub plan without opening an effort or record directory", async () => {
    const root = directory(), input = file(root), runtime = path.join(root, "tmp"); mkdirSync(runtime, { mode: 0o700 });
    const { stdout, stderr } = await promisify(execFile)(process.execPath,
      ["--import", "tsx", "scripts/comprehension/run.mts", input, "--plan"],
      { cwd: repositoryRoot, timeout: 4_000, env: { PATH: process.env.PATH, NODE_ENV: "test", TMPDIR: runtime } });
    const result = JSON.parse(stdout);
    expect(result).toMatchObject({ kind: "smoke", inference: "local/deterministic-stub",
      tasks: ["T1", "T6", "T7"], personas: 1, sessions: 1, approvedLimitMicroDollars: 1_000_000 });
    expect(result.skipped.map((skip: { taskId: string }) => skip.taskId)).toEqual(["T6", "T7"]);
    expect(stderr).toBe("");
    expect(stdout).not.toContain(input);
    expect(existsSync(path.join(root, "effort"))).toBe(false);
    expect(existsSync(path.join(root, "records"))).toBe(false);
  });

  it("stops the CLI with a generic refusal before a journal or browser can start", async () => {
    const root = directory(), input = file(root), marker = randomUUID(), runtime = path.join(root, "tmp");
    mkdirSync(runtime, { mode: 0o700 }); writeFileSync(input, `{"${marker}":`);
    try {
      await promisify(execFile)(process.execPath, ["--import", "tsx", "scripts/comprehension/run.mts", input, "--plan"],
        { cwd: repositoryRoot, timeout: 4_000, env: { PATH: process.env.PATH, NODE_ENV: "test", TMPDIR: runtime } });
      throw new Error("Unexpected successful CLI");
    } catch (error) {
      if (typeof error !== "object" || error === null || !("code" in error) || !("stdout" in error) || !("stderr" in error)) throw error;
      expect(error.code).toBe(1);
      expect(String(error.stderr)).toContain(PRIVATE_CONFIG_REFUSAL);
      expect(String(error.stdout) + String(error.stderr)).not.toContain(marker);
    }
    expect(existsSync(path.join(root, "effort"))).toBe(false);
    expect(existsSync(path.join(root, "records"))).toBe(false);
  });

  it.each(["ino", "mtimeNs", "ctimeNs", "gid"] as const)("refuses an exact %s change while clearing consumed bytes", field => {
    const input = file();
    const base = field === "gid" ? BigInt(20) : field === "ino" ? BigInt("9007199254740992") : BigInt("1700000000000000000");
    let changed = false;
    const observations: bigint[] = [];
    controls.statProjection = value => {
      if (!value.isFile() || typeof value.ino !== "bigint") return value;
      const exact = value as BigIntStats;
      const identity = base + (changed ? BigInt(1) : BigInt(0));
      observations.push(identity);
      return Object.assign(Object.create(Object.getPrototypeOf(exact)), exact, { [field]: identity });
    };
    controls.duringRead = () => { changed = true; };
    privateError(input);
    clearedReadBytes();
    expect(observations).toContain(base);
    expect(observations).toContain(base + BigInt(1));
    if (field !== "gid") expect(Number(base)).toBe(Number(base + BigInt(1)));
    expect(existsSync(path.join(path.dirname(input), "effort"))).toBe(false);
    expect(existsSync(path.join(path.dirname(input), "records"))).toBe(false);
  });

  it("refuses adjacent parent inode values that collide as Numbers", () => {
    const root = directory(), input = file(root), base = BigInt("9007199254740992");
    let changed = false;
    const observations: bigint[] = [];
    controls.statProjection = (value, name) => {
      if (name !== root || !value.isDirectory() || typeof value.ino !== "bigint") return value;
      const exact = value as BigIntStats, identity = base + (changed ? BigInt(1) : BigInt(0));
      observations.push(identity);
      return Object.assign(Object.create(Object.getPrototypeOf(exact)), exact, { ino: identity });
    };
    controls.duringRead = () => { changed = true; };
    privateError(input);
    clearedReadBytes();
    expect(Number(base)).toBe(Number(base + BigInt(1)));
    expect(observations).toContain(base);
    expect(observations).toContain(base + BigInt(1));
    expect(existsSync(path.join(root, "effort"))).toBe(false);
    expect(existsSync(path.join(root, "records"))).toBe(false);
  });
});
