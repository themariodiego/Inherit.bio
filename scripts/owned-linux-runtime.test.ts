import { afterEach, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, lstatSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { assertOperatorHostEnvironment, assertOwnedLinuxCapability, assertOwnedLinuxInitialMemory, assertOwnedSourceStatus, ownedLinuxRequestSchema,
  parsePrivateOperatorFrame, retainChallengeUse, type OwnedLinuxCapability } from "./owned-linux-runtime";

const directories: string[] = [];
afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }); });
const scratch = () => { const directory = realpathSync(mkdtempSync(path.join(os.tmpdir(), "owned-linux-unit-"))); directories.push(directory); return directory; };
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
