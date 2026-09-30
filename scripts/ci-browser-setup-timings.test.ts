import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ciBrowserSetupStartPath, ciBrowserSetupTimingPath, readCiBrowserSetupTimings, writeCiBrowserSetupTimings } from "./ci-browser-setup-timings";

const source = { head: "a".repeat(40), runId: "12345", runAttempt: "2" };
const roots: string[] = [];
function fixture() {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), "inherit-setup-timing-"))); roots.push(root);
  const env = { RUNNER_TEMP: root };
  writeFileSync(ciBrowserSetupStartPath(env, source, 1), "1000", { mode: 0o600 });
  return { root, env };
}
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

describe("setup timing evidence outside Playwright outputDir", () => {
  it("survives installed native Playwright's real outputDir cleanup with one actual passing case", () => {
    const { root, env } = fixture(); writeCiBrowserSetupTimings(env, source, 1, 1200, 1500);
    const output = path.join(root, "playwright-output"), tests = path.join(root, "tests");
    mkdirSync(output); mkdirSync(tests); writeFileSync(path.join(output, "old-setup-input.json"), "must be removed");
    const require = createRequire(import.meta.url);
    const testPackage = require.resolve("@playwright/test");
    const config = path.join(root, "playwright.config.cjs");
    writeFileSync(config, `module.exports={testDir:${JSON.stringify(tests)},outputDir:${JSON.stringify(output)},testMatch:'cleanup.spec.cjs',workers:1,fullyParallel:false,retries:0,forbidOnly:true,reporter:'json'};`);
    writeFileSync(path.join(tests, "cleanup.spec.cjs"), `const {test,expect}=require(${JSON.stringify(testPackage)});test('native cleanup proof',()=>{expect(1).toBe(1)});`);
    const cli = path.join(path.dirname(require.resolve("@playwright/test/package.json")), "cli.js");
    const report = JSON.parse(execFileSync(process.execPath, [cli, "test", `--config=${config}`],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 30_000, maxBuffer: 1_000_000 }));
    expect(report.stats).toMatchObject({ expected: 1, skipped: 0, unexpected: 0, flaky: 0 });
    expect(report.errors).toEqual([]); expect(existsSync(path.join(output, "old-setup-input.json"))).toBe(false);
    expect(readCiBrowserSetupTimings(env, source, 1)).toEqual({ setupMs: 200, buildMs: 300 });
  }, 35_000);
  it("refuses missing, stale, foreign-source and foreign-shard input with no fallback", () => {
    const { env } = fixture(); expect(() => readCiBrowserSetupTimings(env, source, 1)).toThrow();
    writeCiBrowserSetupTimings(env, source, 1, 1200, 1500);
    for (const change of [{ head: "b".repeat(40) }, { runId: "999" }, { runAttempt: "1" }, { index: 2 }]) {
      const file = ciBrowserSetupTimingPath(env, source, 1);
      writeFileSync(file, JSON.stringify({ schemaVersion: 1, total: 6, ...source, index: 1, setupMs: 200, buildMs: 300, ...change }));
      expect(() => readCiBrowserSetupTimings(env, source, 1)).toThrow();
    }
    expect(() => readCiBrowserSetupTimings(env, source, 2)).toThrow();
  });
  it("refuses altered timing/schema, duplicate writes, linked/permissive files and outputDir locations", () => {
    const { root, env } = fixture(); writeCiBrowserSetupTimings(env, source, 1, 1200, 1500);
    const file = ciBrowserSetupTimingPath(env, source, 1), valid = JSON.parse(readFileSync(file, "utf8"));
    expect(() => writeCiBrowserSetupTimings(env, source, 1, 1200, 1500)).toThrow();
    for (const value of [{ ...valid, setupMs: -1 }, { ...valid, buildMs: 0.5 }, { ...valid, setupMs: 3_600_001 },
      { ...valid, privateData: "unregistered" }]) {
      writeFileSync(file, JSON.stringify(value)); expect(() => readCiBrowserSetupTimings(env, source, 1)).toThrow();
    }
    writeFileSync(file, JSON.stringify(valid)); chmodSync(file, 0o644);
    expect(() => readCiBrowserSetupTimings(env, source, 1)).toThrow(); chmodSync(file, 0o600);
    const linked = path.join(root, "linked"); symlinkSync(file, linked);
    rmSync(file); symlinkSync(linked, file); expect(() => readCiBrowserSetupTimings(env, source, 1)).toThrow();
    expect(() => ciBrowserSetupTimingPath({}, source, 1)).toThrow();
    expect(() => ciBrowserSetupTimingPath({ RUNNER_TEMP: "relative" }, source, 1)).toThrow();
    const output = path.resolve("test-results"); mkdirSync(output, { recursive: true });
    expect(() => ciBrowserSetupTimingPath({ RUNNER_TEMP: realpathSync(output) }, source, 1)).toThrow();
    expect(() => ciBrowserSetupTimingPath(env, source, 7)).toThrow();
  });
  it("refuses absent, malformed, inverted and over-budget start/build timestamps", () => {
    const { env } = fixture(), file = ciBrowserSetupStartPath(env, source, 1);
    for (const value of ["", "not-a-time", "-1", "1201", "0.5"]) {
      writeFileSync(file, value); expect(() => writeCiBrowserSetupTimings(env, source, 1, 1200, 1500)).toThrow();
    }
    writeFileSync(file, "1000");
    expect(() => writeCiBrowserSetupTimings(env, source, 1, 1200, 1199)).toThrow();
    expect(() => writeCiBrowserSetupTimings(env, source, 1, 3_602_001, 3_602_002)).toThrow();
  });
});
