import { afterEach, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { chmodSync, existsSync, lstatSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { assertManualCleanupProcesses, assertOperatorHostEnvironment, assertOwnedLinuxCapability, assertOwnedLinuxInitialMemory, assertOwnedSourceStatus, ownedLinuxRequestSchema,
  assertOlderBootChallengeBinding, parsePrivateOperatorFrame, retainChallengeUse, retainPublicOwnerProof, type OwnedLinuxCapability } from "./owned-linux-runtime";

const directories: string[] = [];
const persistence = vi.hoisted(() => ({ failSync: false }));
vi.mock("node:fs", async importOriginal => {
  const original = await importOriginal<typeof import("node:fs")>();
  return { ...original, fsyncSync: (...args: Parameters<typeof original.fsyncSync>) => {
    if (persistence.failSync) throw new Error("synthetic public persistence failure");
    return original.fsyncSync(...args);
  } };
});
afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }); });
const scratch = () => { const directory = realpathSync(mkdtempSync(path.join(os.tmpdir(), "owned-linux-unit-"))); directories.push(directory); return directory; };
describe("manual cleanup process certainty", () => {
  const clean = " 100 1 sshd\n 101 100 sh\n 102 101 node\n 103 102 ps\n";
  it("allows only the authenticated supervisor, its ancestors and its exact inventory child", () => {
    expect(() => assertManualCleanupProcesses(clean, 102)).not.toThrow();
    expect(() => assertManualCleanupProcesses(clean.replace(" 103 102 ps\n", ""), 102)).not.toThrow();
  });
  it("refuses surviving workload, unknown processes and a ps outside the supervisor", () => {
    for (const extra of ["104 1 node\n", "104 102 chrome\n", "104 101 ps\n", "104 102 unknown\n"])
      expect(() => assertManualCleanupProcesses(clean + extra, 102)).toThrow();
  });
  it("refuses absent, duplicated, cyclic, malformed and overflowing identity observations", () => {
    for (const value of ["", "100 1 sshd\n", clean + "102 101 node\n", clean.replace("101 100", "101 102"),
      clean + "broken\n", clean + "9007199254740992 102 ps\n", clean.replace("103 102 ps", "103 -1 ps")])
      expect(() => assertManualCleanupProcesses(value, 102)).toThrow();
  });
});
describe("initial owned Linux memory admission", () => {
  const memory = (total = "5767168", available = "4194304") =>
    `MemTotal:       ${total} kB\nMemAvailable:   ${available} kB\nMemFree: 1 kB\n`;
  it("admits both exact inclusive boundaries and the observed nominal six-GiB guest", () => {
    expect(assertOwnedLinuxInitialMemory(memory())).toEqual({ totalBytes: 5.5 * 1024 ** 3, availableBytes: 4 * 1024 ** 3 });
    expect(assertOwnedLinuxInitialMemory(memory("6052620", "5742032"))).toEqual({ totalBytes: 6_197_882_880, availableBytes: 5_879_840_768 });
  });
  it("refuses a four-GiB guest and either boundary one KiB short", () => {
    for (const value of [memory("4194304"), memory("5767167"), memory("5767168", "4194303")])
      expect(() => assertOwnedLinuxInitialMemory(value)).toThrow();
  });
  it("refuses absent or duplicate readings instead of inferring capacity from free or swap values", () => {
    for (const value of ["MemTotal: 5767168 kB\nMemFree: 4194304 kB\nSwapFree: 9999999 kB\n",
      "MemAvailable: 4194304 kB\n", `${memory()}MemTotal: 5767168 kB\n`,
      `${memory()}MemAvailable: unknown kB\n`])
      expect(() => assertOwnedLinuxInitialMemory(value)).toThrow();
  });
  it("refuses wrong units, partial numbers, overflow and impossible available memory", () => {
    for (const value of [memory().replace("5767168 kB", "5767168 MB"), memory("5767168.0"), memory("-5767168"),
      memory("9007199254740992"), memory("9007199254740991"), memory("5767168", "5767169")])
      expect(() => assertOwnedLinuxInitialMemory(value)).toThrow();
  });
});
describe("one-use public operator challenges", () => {
  it("retains a used challenge across a separate supervisor process and refuses reuse", () => {
    const root = scratch(), directory = path.join(root, "challenges"), nonce = randomUUID();
    retainChallengeUse(directory, nonce, JSON.stringify({ nonce, public: true }));
    const sourceModule = path.resolve("scripts/owned-linux-runtime.ts");
    const code = `import { retainChallengeUse } from ${JSON.stringify(sourceModule)};
      try { retainChallengeUse(${JSON.stringify(directory)}, ${JSON.stringify(nonce)}, "replacement"); process.exitCode = 1; }
      catch (error) { if (error.code !== "EEXIST") throw error; }`;
    expect(() => execFileSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", code],
      { timeout: 10_000, stdio: "pipe", env: { NODE_ENV: "test", PATH: process.env.PATH, LANG: "C.UTF-8" } })).not.toThrow();
    expect(readFileSync(path.join(directory, `${nonce}.used.json`), "utf8")).toBe(JSON.stringify({ nonce, public: true }));
    expect(existsSync(path.join(directory, `${nonce}.used.json`))).toBe(true);
  });
  it("refuses a symlink directory and marker without replacing either", () => {
    const root = scratch(), directory = path.join(root, "challenges");
    symlinkSync(root, directory); expect(() => retainChallengeUse(directory, randomUUID(), "public")).toThrow();
    rmSync(directory); const nonce = randomUUID(); retainChallengeUse(directory, randomUUID(), "public");
    const target = path.join(directory, `${nonce}.used.json`); symlinkSync(path.join(root, "absent"), target);
    expect(() => retainChallengeUse(directory, nonce, "public")).toThrow();
    expect(lstatSync(target).isSymbolicLink()).toBe(true);
  });
});
const publicOwner = () => ({ version: 1 as const, nonce: randomUUID(), bootId: randomUUID(), head: "a".repeat(40),
  root: "/home/unit/source", scratch: "/home/unit/current", dockerSocket: "/run/docker.sock", uid: process.getuid!(),
  gid: process.getgid!(), pid: 12345, processStart: "42", daemonId: "unit-daemon", createdAt: 2, publicKey: "unit-public-key" });
const challenge = (owner: ReturnType<typeof publicOwner>) => ({ version: 1 as const, nonce: owner.nonce,
  bootId: owner.bootId, head: owner.head, uid: owner.uid, createdAt: owner.createdAt });
describe("permanent public owner proof", () => {
  it("retains the complete public proof independently of the lease and refuses replacement in another process", () => {
    const root = scratch(), directory = path.join(root, "challenges"), owner = publicOwner();
    retainChallengeUse(directory, owner.nonce, JSON.stringify(challenge(owner)));
    retainPublicOwnerProof(directory, owner);
    const file = path.join(directory, `${owner.nonce}.owner.json`), before = readFileSync(file, "utf8");
    expect(JSON.parse(before)).toEqual(owner); expect(lstatSync(file).mode & 0o7777).toBe(0o600);
    const code = `import { retainPublicOwnerProof } from ${JSON.stringify(path.resolve("scripts/owned-linux-runtime.ts"))};
      try { retainPublicOwnerProof(${JSON.stringify(directory)}, ${JSON.stringify(owner)}); process.exitCode = 1; }
      catch (error) { if (error.code !== "EEXIST") throw error; }`;
    expect(() => execFileSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", code],
      { timeout: 10_000, stdio: "pipe", env: { NODE_ENV: "test", PATH: process.env.PATH, LANG: "C.UTF-8" } })).not.toThrow();
    expect(readFileSync(file, "utf8")).toBe(before);
    expect(readFileSync(path.join(directory, `${owner.nonce}.used.json`), "utf8")).toBe(JSON.stringify(challenge(owner)));
  });
  it("refuses incomplete durable persistence and keeps the one-use challenge consumed", () => {
    const root = scratch(), directory = path.join(root, "challenges"), owner = publicOwner();
    expect(() => retainPublicOwnerProof(root, owner)).toThrow();
    retainChallengeUse(directory, owner.nonce, JSON.stringify(challenge(owner)));
    persistence.failSync = true;
    try { expect(() => retainPublicOwnerProof(directory, owner)).toThrow("synthetic public persistence failure"); }
    finally { persistence.failSync = false; }
    expect(readFileSync(path.join(directory, `${owner.nonce}.used.json`), "utf8")).toBe(JSON.stringify(challenge(owner)));
    expect(() => retainPublicOwnerProof(directory, owner)).toThrow();
    // Readiness can follow only a completed persistence call; a failed write is never retried/adopted.
  });
  it("refuses mismatched, linked and nonprivate evidence without retaining a private field", () => {
    const root = scratch(), directory = path.join(root, "challenges"), owner = publicOwner();
    retainChallengeUse(directory, owner.nonce, JSON.stringify(challenge(owner)));
    for (const change of [{ head: "b".repeat(40) }, { privateKey: "MUST_NOT_PRINT_SYNTHETIC_CANARY" }])
      expect(() => retainPublicOwnerProof(directory, { ...owner, ...change })).toThrow();
    const file = path.join(directory, `${owner.nonce}.owner.json`);
    symlinkSync(path.join(root, "absent"), file); expect(() => retainPublicOwnerProof(directory, owner)).toThrow();
    expect(lstatSync(file).isSymbolicLink()).toBe(true); rmSync(file);
    chmodSync(path.join(directory, `${owner.nonce}.used.json`), 0o644);
    expect(() => retainPublicOwnerProof(directory, owner)).toThrow(); expect(existsSync(file)).toBe(false);
  });
});
describe("explicit older-boot challenge binding", () => {
  it("accepts exact retained challenge bytes from a different boot without reconstructing a PID/start/key", () => {
    const current = publicOwner(), prior = { ...challenge(current), nonce: randomUUID(), bootId: randomUUID(), createdAt: 1 };
    const input = { kind: "older-boot-challenge", challenge: prior, scratch: `/home/unit/inherit-native-smoke-${prior.nonce}` };
    expect(assertOlderBootChallengeBinding(current, input, JSON.stringify(prior))).toMatch(/^[0-9a-f]{64}$/);
    for (const name of ["pid", "processStart", "publicKey"]) expect(prior).not.toHaveProperty(name);
  });
  it("refuses same boot, current nonce, foreign owner, nonolder chronology and every marker mismatch", () => {
    const current = publicOwner(), prior = { ...challenge(current), nonce: randomUUID(), bootId: randomUUID(), createdAt: 1 };
    const input = { kind: "older-boot-challenge", challenge: prior, scratch: "/home/unit/prior" };
    for (const change of [{ bootId: current.bootId }, { nonce: current.nonce }, { uid: current.uid + 1 }, { createdAt: current.createdAt }]) {
      const altered = { ...prior, ...change };
      expect(() => assertOlderBootChallengeBinding(current, { ...input, challenge: altered }, JSON.stringify(altered))).toThrow();
    }
    for (const marker of [JSON.stringify({ ...prior, head: "b".repeat(40) }), JSON.stringify({ ...prior, createdAt: 0 }),
      JSON.stringify(prior) + "\n", JSON.stringify({ ...prior, pid: 999 }), "MUST_NOT_PRINT_SYNTHETIC_CANARY"])
      expect(() => assertOlderBootChallengeBinding(current, input, marker)).toThrow();
  });
});
describe("exact owned source admission", () => {
  const record = "docs/comprehension-runs/2026-10-10/live-run-2026-10-10-abcd1234";
  it("refuses nonignored untracked source at initial admission", () => {
    expect(() => assertOwnedSourceStatus("?? scripts/unreviewed.ts\0")).toThrow();
    expect(() => assertOwnedSourceStatus(`?? ${record}/manifest.json\0`)).toThrow();
    expect(() => assertOwnedSourceStatus("")).not.toThrow();
  });
  it("admits only the current producer's fixed inert outputs", () => {
    expect(() => assertOwnedSourceStatus(`?? ${record}/manifest.json\0?? ${record}/responses.jsonl\0`, record)).not.toThrow();
    for (const file of [`${record}/source.ts`, `${record}/nested/manifest.json`, `${record}-other/manifest.json`, "scripts/source.ts"])
      expect(() => assertOwnedSourceStatus(`?? ${file}\0`, record)).toThrow();
  });
  it("rejects tracked changes, conflicts, rename framing and malformed status", () => {
    for (const status of [" M scripts/source.ts\0", "UU scripts/source.ts\0", "R  next.ts\0prior.ts\0", "?? source.ts", "\0"])
      expect(() => assertOwnedSourceStatus(status, record)).toThrow();
  });
});
describe("explicit capability and bounded private channel", () => {
  it("refuses ambient credential/configuration channels and keeps genuine CI admission separate", () => {
    const clean = { PATH: "/usr/bin:/bin", HOME: "/home/operator", LANG: "C.UTF-8", NODE_ENV: "production" };
    expect(() => assertOperatorHostEnvironment(clean)).not.toThrow();
    for (const change of [{ COMPREHENSION_MODEL_API_KEY: "EXAMPLE_NO_REAL_CREDENTIAL" }, { NODE_OPTIONS: "--inspect" },
      { GITHUB_JOB: "fresh-t6" }, { CI: "true" }, { LANG: "other" }, { NODE_ENV: "test" }])
      expect(() => assertOperatorHostEnvironment({ ...clean, ...change })).toThrow();
  });
  it("never admits a copied public object or environment flag as capability", () => {
    expect(() => assertOwnedLinuxCapability({ kind: "owned-linux", proof: {} } as OwnedLinuxCapability)).toThrow();
  });
  it("requires exact public paths and does not accept fabricated CI identity fields", () => {
    const request = { version: 1, nonce: randomUUID(), bootId: randomUUID(), head: "a".repeat(40), root: "/work/source", scratch: "/work/scratch", dockerSocket: "/run/docker.sock" };
    expect(ownedLinuxRequestSchema.parse(request)).toEqual(request);
    for (const change of [{ root: "relative" }, { scratch: "/work/../scratch" }, { GITHUB_JOB: "fresh-t6" }, { nonce: "reused" }])
      expect(() => ownedLinuxRequestSchema.parse({ ...request, ...change })).toThrow();
  });
  it("accepts only one canonical bounded UTF-8 JSON frame, rejecting duplicate aliases", () => {
    const value = { configuration: { synthetic: true } };
    expect(parsePrivateOperatorFrame(Buffer.from(JSON.stringify(value) + "\n"))).toEqual(value);
    for (const raw of ['{"x":1,"x":2}\n', '{ "x":1 }\n', '{}\n{}\n', '{}', ''])
      expect(() => parsePrivateOperatorFrame(Buffer.from(raw))).toThrow();
    expect(() => parsePrivateOperatorFrame(Buffer.from([0xff]))).toThrow();
    expect(() => parsePrivateOperatorFrame(Buffer.alloc(65_537, 32))).toThrow();
  });
});
