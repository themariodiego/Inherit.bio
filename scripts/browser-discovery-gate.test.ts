import { existsSync, readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ACCESSIBILITY_SWEEP_FILES } from "./ci-browser-balance";
import { parseBrowserDurationProfile } from "./ci-browser-duration-plan";
import { QUEUE_EXCLUSIVE_BROWSER_FILES } from "./ci-browser-queue-isolation";
import { STANDARD_CI_BROWSER_PROJECTS } from "./ci-browser-project-registry";
import { browserDiscoveryArguments, browserDiscoveryEnvironment, checkBrowserDiscovery } from "./browser-discovery-gate";

const mocks = vi.hoisted(() => ({ spawn: vi.fn(), tracked: vi.fn(), profile: vi.fn() }));
vi.mock("node:child_process", async original => ({ ...await original<typeof import("node:child_process")>(), spawnSync: mocks.spawn }));
vi.mock("./ci-browser-shards-io", async original => ({ ...await original<typeof import("./ci-browser-shards-io")>(),
  trackedBrowserSpecs: mocks.tracked, loadBrowserDurationProfile: mocks.profile }));

const initial = [...ACCESSIBILITY_SWEEP_FILES.map(file => ({ file, project: "chromium" })),
  ...Object.entries(QUEUE_EXCLUSIVE_BROWSER_FILES).map(([file, project]) => ({ file, project })),
  ...STANDARD_CI_BROWSER_PROJECTS.filter(project => !project.startsWith("embryo-"))
    .map(project => ({ file: `ordinary-${project}.spec.ts`, project }))];
const rows = [...initial, ...Array.from({ length: 601 - initial.length }, () =>
  ({ file: "ordinary-chromium.spec.ts", project: "chromium" }))].map((row, index) => ({ ...row,
    id: `${index.toString(16).padStart(20, "0")}-${index.toString(16).padStart(20, "0")}` }));
function listing(values = rows) {
  return { config: { workers: 1, fullyParallel: false, shard: null,
    projects: STANDARD_CI_BROWSER_PROJECTS.map(name => ({ name, retries: 0, repeatEach: 1 })) },
  suites: [{ specs: values.map(row => ({ id: row.id, file: row.file, title: "synthetic complete case",
    tests: [{ projectName: row.project, expectedStatus: "passed", results: [] }] })) }],
  errors: [], stats: { expected: 0, unexpected: 0, flaky: 0, skipped: values.length } };
}
const listPaths: string[] = [];
function assignedRows(args: string[]) {
  const argument = args.find(arg => arg.startsWith("--test-list="));
  if (!argument) return rows;
  const filename = argument.slice("--test-list=".length); listPaths.push(filename);
  const groups = readFileSync(filename, "utf8").trim().split("\n");
  return rows.filter(row => groups.includes(`[${row.project}] › ${row.file}`));
}
beforeEach(() => {
  vi.clearAllMocks(); listPaths.length = 0;
  mocks.tracked.mockReturnValue([...new Set(rows.map(row => `e2e/${row.file}`))]);
  mocks.profile.mockReturnValue(parseBrowserDurationProfile(readFileSync("data/ci/browser-duration-profile.json", "utf8")));
  mocks.spawn.mockImplementation((_command: string, args: string[]) => ({ status: 0, stdout: JSON.stringify(listing(assignedRows(args))) }));
});

describe("complete local browser discovery preflight", () => {
  it("never inherits credentials, provider authority, debug hooks or optional case selectors", () => {
    const env = browserDiscoveryEnvironment({ PATH: "synthetic-path", HOME: "synthetic-home", TMPDIR: "synthetic-temp", NODE_ENV: "production",
      NEXT_PUBLIC_SUPABASE_URL: "https://example.invalid", SUPABASE_SERVICE_ROLE_KEY: "EXAMPLE_PRIVATE_VALUE",
      NODE_OPTIONS: "--import private-hook", GITHUB_ACTIONS: "true", GITHUB_SHA: "EXAMPLE_PRIVATE_VALUE",
      INHERIT_DENSITY_CAPTURE: "1", INHERIT_COMPREHENSION_RUN: "1", PWDEBUG: "1",
      INHERIT_CI_BROWSER_RUNTIME: "ready", INHERIT_UPLOAD_SIGNING_JWK: "EXAMPLE_PRIVATE_VALUE", VERCEL: "1" });
    expect(env.PATH).toBe("synthetic-path");
    expect(env.HOME).toBe("synthetic-home");
    expect(env.TMPDIR).toBe("synthetic-temp");
    expect(env.NODE_ENV).toBe("test");
    expect(env.NEXT_PUBLIC_SUPABASE_URL).toBe("http://127.0.0.1:54321");
    expect(env.SUPABASE_SERVICE_ROLE_KEY).toBe("EXAMPLE_SYNTHETIC_DISCOVERY_SERVICE_KEY");
    expect(JSON.stringify(env)).not.toMatch(/EXAMPLE_PRIVATE_VALUE|private-hook|example.invalid/);
    for (const key of ["NODE_OPTIONS", "GITHUB_ACTIONS", "GITHUB_SHA", "INHERIT_DENSITY_CAPTURE", "INHERIT_COMPREHENSION_RUN",
      "PWDEBUG", "INHERIT_CI_BROWSER_RUNTIME", "INHERIT_UPLOAD_SIGNING_JWK", "VERCEL"]) expect(env).not.toHaveProperty(key);
  });
  it("fixes real listing, standard config and all six native partitions without execution or selectors", () => {
    const full = ["synthetic-cli", "test", "--config=playwright.config.ts", "--list", "--reporter=json"];
    expect(browserDiscoveryArguments("synthetic-cli", null)).toEqual(full);
    for (let index = 1; index <= 6; index++)
      expect(browserDiscoveryArguments("synthetic-cli", index)).toEqual([...full, `--shard=${index}/6`]);
    for (const index of [0, 7, 1.5, NaN]) expect(() => browserDiscoveryArguments("synthetic-cli", index)).toThrow();
    expect(browserDiscoveryArguments("synthetic-cli", null, "synthetic-list")).toEqual([...full, "--test-list=synthetic-list"]);
    expect(() => browserDiscoveryArguments("synthetic-cli", 1, "synthetic-list")).toThrow("Do not shard");
  });
  it.each(["profiled", "absent-history"])("discovers all 601 cases through the hosted %s plan and cleans all six lists", mode => {
    if (mode === "absent-history") mocks.profile.mockReturnValue(null);
    expect(checkBrowserDiscovery()).toEqual({ cases: 601, files: new Set(rows.map(row => row.file)).size });
    expect(mocks.spawn).toHaveBeenCalledTimes(7);
    expect(listPaths).toHaveLength(6);
    expect(listPaths.every(filename => !existsSync(filename))).toBe(true);
    for (const [, args] of mocks.spawn.mock.calls) expect(args.some((arg: string) => arg.startsWith("--shard="))).toBe(false);
  });
  it("refuses omitted cases and a failed official listing while cleaning its owned list", () => {
    mocks.spawn.mockImplementation((_command: string, args: string[]) => {
      const assigned = assignedRows(args);
      return { status: 0, stdout: JSON.stringify(listing(args.some(arg => arg.startsWith("--test-list=")) ? assigned.slice(1) : assigned)) };
    });
    expect(() => checkBrowserDiscovery()).toThrow();
    expect(listPaths).toHaveLength(6);
    expect(listPaths.every(filename => !existsSync(filename))).toBe(true);
    listPaths.length = 0;
    mocks.spawn.mockImplementation((_command: string, args: string[]) => {
      const assigned = assignedRows(args);
      return { status: args.some(arg => arg.startsWith("--test-list=")) ? 1 : 0, stdout: JSON.stringify(listing(assigned)) };
    });
    expect(() => checkBrowserDiscovery()).toThrow("preflight failed");
    expect(listPaths).toHaveLength(1);
    expect(existsSync(listPaths[0])).toBe(false);
  });
  it("refuses unreadable or malformed present history before any assigned listing", () => {
    for (const error of [Object.assign(new Error("unreadable profile"), { code: "EACCES" }), new Error("malformed profile")]) {
      mocks.spawn.mockClear(); mocks.profile.mockImplementation(() => { throw error; });
      expect(() => checkBrowserDiscovery()).toThrow(error.message);
      expect(mocks.spawn).toHaveBeenCalledTimes(1);
    }
    expect(listPaths).toHaveLength(0);
  });
});
