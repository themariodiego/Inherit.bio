import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { inspectSqlFixtureIncludes, relativeIncludes } from "./sql-fixture-includes";

const temporary: string[] = [];
const plantedInventory = new Map<string, string[]>();
afterEach(() => { for (const root of temporary.splice(0)) rmSync(root, { recursive: true, force: true }); });
function plant(files: Record<string, string>) {
  const root = mkdtempSync(path.join(os.tmpdir(), "sql-include-preflight-"));temporary.push(root);
  for (const [name, source] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(root, name)), { recursive: true });writeFileSync(path.join(root, name), source);
  }
  plantedInventory.set(root, Object.keys(files));
  return root;
}
function inspectPlanted(root: string, entryRoots: string[]) {
  return inspectSqlFixtureIncludes(root, entryRoots, plantedInventory.get(root)!);
}
describe("literal psql relative include closure", () => {
  it("resolves each nested include against its own containing directory, including a quoted path and diamond", () => {
    const root = plant({ "tests/main.sql": "\\ir fixtures/parent.inc\n\\ir 'fixtures/leaf with space.inc'\n",
      "tests/fixtures/parent.inc": "\\include_relative 'leaf with space.inc'\n", "tests/fixtures/leaf with space.inc": "select 1;" });
    const result = inspectPlanted(root, ["tests/main.sql"]);
    expect(result.failures).toEqual([]);expect(result.files).toBe(3);
    expect(result.edges.map(row => row.target)).toEqual(["tests/fixtures/parent.inc", "tests/fixtures/leaf with space.inc", "tests/fixtures/leaf with space.inc"]);
  });
  it("refuses the actual extraction bug and a missing directory before any SQL execution", () => {
    const root = plant({ "tests/main.sql": "\\ir fixtures/parent.inc", "tests/fixtures/parent.inc": "\\ir fixtures/leaf.inc\n\\ir missing/child.inc", "tests/fixtures/leaf.inc": "select 1;" });
    expect(inspectPlanted(root, ["tests/main.sql"]).failures).toEqual([
      { file: "tests/fixtures/parent.inc", line: 1, code: "missing" }, { file: "tests/fixtures/parent.inc", line: 2, code: "missing" }]);
  });
  it("refuses direct and indirect cycles while allowing repeated noncyclic leaves", () => {
    const cases: Record<string, string>[] = [{ "a.sql": "\\ir a.sql" }, { "a.sql": "\\ir sub/b.inc", "sub/b.inc": "\\ir ../a.sql" }];
    for (const files of cases) {
      const result = inspectPlanted(plant(files), ["a.sql"]);
      expect(result.failures).toHaveLength(1);expect(result.failures[0].code).toBe("cycle");
    }
  });
  it("refuses absolute, lexical and symlink escapes rather than following host files", () => {
    const outside = plant({ "external.inc": "select 1;" });
    const root = plant({ "a.sql": `\\ir ../external.inc\n\\ir ${outside}/external.inc\n\\ir link.inc\n` });
    symlinkSync(path.join(outside, "external.inc"), path.join(root, "link.inc"));
    expect(inspectPlanted(root, ["a.sql"]).failures.map(row => row.code)).toEqual(["escape", "escape", "escape"]);
    expect(inspectPlanted(root, ["link.inc"]).failures).toEqual([{ file: "link.inc", line: 1, code: "escape" }]);
  });
  it("refuses a real existing untracked include independently of its tracked entry root", () => {
    const root = plant({ "a.sql": "\\ir fixtures/local.inc\n", "fixtures/local.inc": "select 1;" });
    execFileSync("git", ["init", "--quiet"], { cwd: root });
    execFileSync("git", ["add", "--", "a.sql"], { cwd: root });
    expect(inspectSqlFixtureIncludes(root).failures).toEqual([{ file: "a.sql", line: 1, code: "untracked" }]);
    execFileSync("git", ["add", "--", "fixtures/local.inc"], { cwd: root });
    expect(inspectSqlFixtureIncludes(root).failures).toEqual([]);
  });
  it("requires the full tracked inventory and refuses internal links to untracked content", () => {
    const root = plant({ "a.sql": "\\ir child.fixture\n", "child.fixture": "select 1;" });
    expect(inspectSqlFixtureIncludes(root, ["a.sql"], ["a.sql"]).failures).toEqual([{ file: "a.sql", line: 1, code: "untracked" }]);
    expect(inspectSqlFixtureIncludes(root, ["a.sql"], ["a.sql", "child.fixture"]).failures).toEqual([]);
    writeFileSync(path.join(root, "a.sql"), "\\ir link.fixture\n");
    symlinkSync("child.fixture", path.join(root, "link.fixture"));
    expect(inspectSqlFixtureIncludes(root, ["a.sql"], ["a.sql", "link.fixture"]).failures).toEqual([{ file: "a.sql", line: 1, code: "untracked" }]);
    expect(inspectSqlFixtureIncludes(root, ["a.sql"], ["a.sql", "link.fixture", "child.fixture"]).failures).toEqual([]);
  });
  it("does not mistake SQL strings, identifiers, comments or function bodies for includes, and never evaluates dynamic arguments", () => {
    const source = "-- \\ir absent.inc\n/* outer /* \\ir absent.inc */ inner */\nselect '\\ir absent.inc', E'escaped\\\' \\ir absent.inc', \"\\ir absent.inc\";\nDO $body$ begin -- body\n\\ir absent.inc\nend $body$;\n\\ir :target\n\\ir `command`\n\\ir 'escaped\\n.inc'\nselect 1; \\ir real.inc\n";
    expect(relativeIncludes(source)).toEqual([{ line: 7, filename: null }, { line: 8, filename: null }, { line: 9, filename: null }, { line: 10, filename: "real.inc" }]);
  });
  it("closes the complete live tracked SQL/fixture graph", () => {
    const result = inspectSqlFixtureIncludes(process.cwd());
    expect(result.files).toBeGreaterThan(250);expect(result.edges.length).toBeGreaterThan(70);
    expect(result.failures).toEqual([]);
  });
  it("runs before the fresh CI stack/tests and native provider bootstrap", () => {
    const workflow = readFileSync(".github/workflows/ci.yml", "utf8");
    expect(workflow.indexOf("pnpm gate:sql-includes")).toBeGreaterThan(0);
    const freshJobs = workflow.split(/^  [a-z-]+:\n/m).filter(job => job.includes("run: pnpm exec supabase start"));
    expect(freshJobs).toHaveLength(2);
    for (const job of freshJobs) {
      expect(job.indexOf("pnpm gate:sql-includes")).toBeGreaterThan(0);
      expect(job.indexOf("pnpm gate:sql-includes")).toBeLessThan(job.indexOf("run: pnpm exec supabase start"));
    }
    const firstRun = readFileSync(".github/workflows/self-host-first-run.yml", "utf8");
    expect(firstRun.indexOf("corepack pnpm gate:sql-includes")).toBeGreaterThan(0);
    expect(firstRun.indexOf("corepack pnpm gate:sql-includes")).toBeLessThan(firstRun.indexOf("corepack pnpm exec supabase start"));
    expect(workflow.indexOf("pnpm gate:sql-includes")).toBeLessThan(workflow.indexOf("pnpm exec supabase start"));
    const repositoryJob = workflow.split(/^  [a-z-]+:\n/m).find(job => job.includes("- name: Unit tests"))!;
    const targetedCensus = repositoryJob.indexOf("run: pnpm exec supabase test db supabase/tests/export_member_plan.sql\n");
    const fullDatabaseSuite = repositoryJob.indexOf("run: pnpm exec supabase test db\n");
    const units = repositoryJob.indexOf("run: pnpm test\n");
    for (const index of [targetedCensus, fullDatabaseSuite, units]) expect(index).toBeGreaterThan(0);
    expect(repositoryJob.indexOf("pnpm gate:sql-includes")).toBeLessThan(targetedCensus);
    expect(targetedCensus).toBeLessThan(units);
    expect(units).toBeLessThan(fullDatabaseSuite);
    const fresh = readFileSync("scripts/comprehension/run-fresh-t6.mts", "utf8");
    const entry = fresh.indexOf("export async function runFreshComprehension(");
    const includes = fresh.indexOf("assertSqlFixtureIncludes();", entry);
    const prepare = fresh.indexOf("await prepareFreshInvocation({", entry);
    const acquisition = fresh.indexOf("acquire: () => acquireFreshStack(", prepare);
    for (const index of [entry, includes, prepare, acquisition]) expect(index).toBeGreaterThan(0);
    expect(includes).toBeLessThan(prepare);
    expect(prepare).toBeLessThan(acquisition);
    const bootstrap = readFileSync("scripts/run-upload-browser.mts", "utf8");
    expect(bootstrap.indexOf("assertSqlFixtureIncludes();")).toBeLessThan(bootstrap.indexOf("const arguments_ ="));
  });
});
