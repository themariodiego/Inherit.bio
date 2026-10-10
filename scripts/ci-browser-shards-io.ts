import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { browserDurationTestList, selectBrowserDurationProfile, type BrowserDurationPlan, type SelectedBrowserDurationProfile } from "./ci-browser-duration-plan";
import { assertCiRuntime } from "./ci-browser-config";
import { CI_BROWSER_SHARDS, type CiBrowserIdentity } from "./ci-browser-shards";

export function trackedBrowserSpecs(): string[] {
  return execFileSync("git", ["ls-files", "-z", "--", "e2e"], { encoding: "utf8" })
    .split("\0").filter(file => file.endsWith(".spec.ts")).sort();
}

export function ciBrowserSourceIdentity(): CiBrowserIdentity {
  assertCiRuntime(process.env);
  assert(!process.env.INHERIT_DENSITY_CAPTURE && !process.env.INHERIT_COMPREHENSION_RUN, "Only the standard suite may be inventoried");
  const head = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  assert(/^[0-9a-f]{40}$/.test(head) && head === process.env.GITHUB_SHA, "Exact GitHub checkout revision required");
  assert(execFileSync("git", ["status", "--porcelain", "--untracked-files=no"], { encoding: "utf8" }).trim() === "",
    "Browser coverage must use unchanged tracked source");
  const runId = process.env.GITHUB_RUN_ID ?? "", runAttempt = process.env.GITHUB_RUN_ATTEMPT ?? "";
  assert(/^[1-9][0-9]*$/.test(runId) && /^[1-9][0-9]*$/.test(runAttempt), "Actual GitHub run identity required");
  return { head, runId, runAttempt };
}
/** Absence uses public queue-aware weights; malformed history always fails closed. */
export function loadBrowserDurationProfile(): SelectedBrowserDurationProfile | null {
  return selectBrowserDurationProfile(
    () => readFileSync("data/ci/browser-duration-profile.json", "utf8"),
    () => readFileSync("data/ci/browser-duration-profile-v2.json", "utf8"));
}
export function createBrowserDurationList(plan: BrowserDurationPlan, index: number): { path: string; cleanup(): void } {
  const content = browserDurationTestList(plan, index);
  const directory = mkdtempSync(path.join(tmpdir(), "inherit-ci-browser-list-"));
  const listPath = path.join(directory, "whole-project-files.txt");
  try { writeFileSync(listPath, content, { mode: 0o600, flag: "wx" }); }
  catch (error) { rmSync(directory, { recursive: true, force: true }); throw error; }
  return { path: listPath, cleanup: () => rmSync(directory, { recursive: true, force: true }) };
}
export function discoverBrowserCases(index: number | null = null, testList: string | null = null): unknown {
  assert(index === null || testList === null, "Do not shard an already assigned duration list");
  const command = process.platform === "win32" ? "playwright.cmd" : "playwright";
  const discovery = spawnSync(command, ["test", "--config=playwright.config.ts", "--list", "--reporter=json",
    ...(index === null ? [] : [`--shard=${index}/${CI_BROWSER_SHARDS}`]),
    ...(testList === null ? [] : [`--test-list=${testList}`])], {
    env: process.env, stdio: ["ignore", "pipe", "pipe"], encoding: "utf8", maxBuffer: 32_000_000,
  });
  assert(!discovery.error && discovery.status === 0, "Full browser discovery failed; sensitive diagnostics suppressed");
  try { return JSON.parse(discovery.stdout); } catch { throw new Error("Browser discovery returned no valid JSON report"); }
}
