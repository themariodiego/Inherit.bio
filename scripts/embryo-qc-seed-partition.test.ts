import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { qcSeedJobPartition } from "../e2e/helpers/embryo-qc-seed-partition";
import { ciBrowserSetupTimingPath, type readCiBrowserSetupTimings } from "./ci-browser-setup-timings";
import type { CiBrowserIdentity } from "./ci-browser-shards";

const source: CiBrowserIdentity = { head: "a".repeat(40), runId: "123", runAttempt: "2" };
type Environment = Parameters<typeof readCiBrowserSetupTimings>[0];
let root: string, env: Environment;
beforeEach(() => {
  root = realpathSync(mkdtempSync(path.join(os.tmpdir(), "inherit-qc-job-")));
  env = { RUNNER_TEMP: root, CI: "true", GITHUB_ACTIONS: "true", RUNNER_ENVIRONMENT: "github-hosted",
    INHERIT_DISPOSABLE_LOCAL_E2E: "true", INHERIT_CI_BROWSER_RUNTIME: "ready", GITHUB_JOB: "browser",
    GITHUB_SHA: source.head, GITHUB_RUN_ID: source.runId, GITHUB_RUN_ATTEMPT: source.runAttempt };
});
afterEach(() => rmSync(root, { recursive: true, force: true }));
function setup(index: number, changes: Record<string, unknown> = {}) {
  const file = ciBrowserSetupTimingPath(env, source, index);
  writeFileSync(file, JSON.stringify({ schemaVersion: 1, ...source, index, total: 6, setupMs: 100, buildMs: 200,
    ...changes }), { mode: 0o600, flag: "wx" });
  return file;
}

describe("QC seed actual browser-job partition", () => {
  it.each([1, 2, 3, 4, 5, 6])("binds duration-list config.shard=null to actual job %i", index => {
    setup(index);
    expect(qcSeedJobPartition(null, source, true, env, "linux")).toBe(index);
  });
  it.each([1, 2, 3, 4, 5, 6])("binds native config to actual job %i", index => {
    setup(index);
    expect(qcSeedJobPartition({ current: index, total: 6 }, source, false, env, "linux")).toBe(index);
  });
  it("refuses a missing or duplicate current-job receipt", () => {
    expect(() => qcSeedJobPartition(null, source, true, env, "linux")).toThrow();
    setup(3); setup(4);
    expect(() => qcSeedJobPartition(null, source, true, env, "linux")).toThrow();
  });
  it.each([{ head: "b".repeat(40) }, { runId: "124" }, { runAttempt: "1" }, { index: 3 }, { total: 5 },
    { extra: true }, { setupMs: -1 }])("refuses foreign or malformed receipt %j", changes => {
    setup(4, changes);
    expect(() => qcSeedJobPartition(null, source, true, env, "linux")).toThrow();
  });
  it("does not borrow a receipt from an earlier source/run/attempt", () => {
    const foreign = { ...source, runAttempt: "1" };
    writeFileSync(ciBrowserSetupTimingPath(env, foreign, 4), JSON.stringify({ schemaVersion: 1, ...foreign,
      index: 4, total: 6, setupMs: 100, buildMs: 200 }), { mode: 0o600 });
    expect(() => qcSeedJobPartition(null, source, true, env, "linux")).toThrow();
  });
  it("refuses a symlink, including a dangling second job identity", () => {
    const file = setup(4); rmSync(file); symlinkSync(path.join(root, "missing"), file);
    expect(() => qcSeedJobPartition(null, source, true, env, "linux")).toThrow();
    rmSync(file); setup(4); symlinkSync(path.join(root, "missing"), ciBrowserSetupTimingPath(env, source, 3));
    expect(() => qcSeedJobPartition(null, source, true, env, "linux")).toThrow();
  });
  it("refuses mixed native/duration modes and a foreign native index or total", () => {
    setup(4);
    expect(() => qcSeedJobPartition({ current: 4, total: 6 }, source, true, env, "linux")).toThrow();
    expect(() => qcSeedJobPartition(null, source, false, env, "linux")).toThrow();
    expect(() => qcSeedJobPartition({ current: 3, total: 6 }, source, false, env, "linux")).toThrow();
    expect(() => qcSeedJobPartition({ current: 4, total: 5 }, source, false, env, "linux")).toThrow();
    expect(() => qcSeedJobPartition(undefined as unknown as Parameters<typeof qcSeedJobPartition>[0], source, true, env, "linux")).toThrow();
  });
  it.each([{ GITHUB_JOB: "database" }, { GITHUB_SHA: "b".repeat(40) }, { GITHUB_RUN_ID: "124" },
    { GITHUB_RUN_ATTEMPT: "1" }, { INHERIT_CI_BROWSER_RUNTIME: "pending" }, { CI: "false" },
    { GITHUB_ACTIONS: "false" }, { RUNNER_ENVIRONMENT: "self-hosted" }, { INHERIT_DISPOSABLE_LOCAL_E2E: "false" },
    { INHERIT_DENSITY_CAPTURE: "1" }, { INHERIT_COMPREHENSION_RUN: "1" }])("refuses foreign job/runtime %j", changes => {
    setup(4);
    expect(() => qcSeedJobPartition(null, source, true, { ...env, ...changes }, "linux")).toThrow();
  });
  it("refuses a non-Linux runner", () => {
    setup(4);
    expect(() => qcSeedJobPartition(null, source, true, env, "darwin")).toThrow();
  });
});
