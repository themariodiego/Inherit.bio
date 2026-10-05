import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ACCESSIBILITY_SWEEP_FILES } from "./ci-browser-balance";
import { parseMultiRunBrowserDurationProfile } from "./ci-browser-duration-history";
import { browserDurationPlan, verifyBrowserDurationListings } from "./ci-browser-duration-plan";
import { browserDurationVariance } from "./ci-browser-duration-variance";
import { STANDARD_CI_BROWSER_PROJECTS } from "./ci-browser-project-registry";
import { QUEUE_EXCLUSIVE_BROWSER_FILES, verifyBrowserQueueIsolation } from "./ci-browser-queue-isolation";
import { browserManifest, browserShardReceipt, verifyBrowserShards } from "./ci-browser-shards";

const source = { head: "a".repeat(40), runId: "123", runAttempt: "1" };
const id = (n: number) => `${n.toString(16).padStart(20, "0")}-${n.toString(16).padStart(20, "0")}`;
const projects = [...STANDARD_CI_BROWSER_PROJECTS];
const rows = [
  ...ACCESSIBILITY_SWEEP_FILES.map(file => ({ file, project: "chromium" })),
  ...projects.filter(project => !["embryo-ingest", "embryo-mixed-qc"].includes(project)).map(project => ({ file: `current-${project}.spec.ts`, project })),
  ...Object.entries(QUEUE_EXCLUSIVE_BROWSER_FILES).filter(([, project]) => projects.includes(project)).map(([file, project]) => ({ file, project })),
  { file: "current-chromium.spec.ts", project: "chromium" },
].map((row, index) => ({ ...row, n: index + 1 }));
function listing(values = rows, executed = false) {
  return { config: { workers: 1, fullyParallel: false, shard: null, projects: projects.map(name => ({ name, retries: 0, repeatEach: 1 })) },
    suites: [{ specs: values.map(row => ({ id: id(row.n), file: row.file, title: "duplicate title",
      tests: [{ projectName: row.project, expectedStatus: "passed", results: executed ? [{ status: "passed", retry: 0, duration: 100 }] : [] }] })) }],
    errors: [], stats: { expected: executed ? values.length : 0, unexpected: 0, flaky: 0, skipped: executed ? 0 : values.length } };
}
const profile = () => parseMultiRunBrowserDurationProfile(readFileSync("data/ci/browser-duration-profile-v2.json", "utf8"));
function evidence() {
  const full = listing(), saved = profile(), plan = browserDurationPlan(full, saved);
  const assignments = plan.parts.map(part => rows.filter(row => part.files.some(file => file.file === row.file && file.project === row.project)));
  const assigned = assignments.map(values => listing(values));
  const tracked = [...new Set(rows.map(row => `e2e/${row.file}`))];
  const manifest = browserManifest(full, source, tracked, plan.allocation);
  const receipts = assignments.map((values, index) => browserShardReceipt(full, assigned[index], listing(values, true), source, index + 1, 1,
    { setupMs: 1, buildMs: 1, bootstrapMs: 1, browserMs: 1000 }, tracked, plan.allocation));
  return { full, saved, plan, assigned, manifest, receipts };
}
describe("multi-run weights retain current native and aggregate policy", () => {
  it("covers the true current registry once with whole duplicate-title groups and isolated queues", () => {
    const { full, saved, plan, assigned, manifest, receipts } = evidence();
    expect(() => verifyBrowserDurationListings(full, assigned, plan)).not.toThrow();
    expect(verifyBrowserShards(manifest, receipts, source)).toBe(rows.length);
    expect(plan.allocation.profileSha256).toBe(saved.sha256);
    expect(plan.parts.flatMap(part => part.files).filter(file => file.file === "current-chromium.spec.ts")).toHaveLength(1);
    expect(plan.parts.flatMap(part => part.files).find(file => file.file === "current-chromium.spec.ts")?.cases).toHaveLength(2);
    expect(() => verifyBrowserQueueIsolation(plan.parts)).not.toThrow();
    expect(new Set(plan.parts.flatMap(part => part.files.map(file => file.project)))).toEqual(new Set(projects));
  });
  it("keeps strict current config and detects missing or duplicated independently selected cases", () => {
    const { full, saved, plan, assigned } = evidence();
    const omitted = structuredClone(full); omitted.config.projects.pop();
    expect(() => browserDurationPlan(omitted, saved)).toThrow("Standard browser projects differ");
    const missing = structuredClone(assigned); missing[0].suites[0].specs.pop(); missing[0].stats.skipped--;
    expect(() => verifyBrowserDurationListings(full, missing, plan)).toThrow();
    expect(() => verifyBrowserDurationListings(full, [assigned[0], ...assigned.slice(0, 5)], plan)).toThrow();
  });
  it("ignores removed historical groups without adding cases or narrowing current registry", () => {
    const saved = profile(); const before = browserDurationPlan(listing(), saved);
    for (const source of saved.value.sources) {
      source.projects.push("retired-project"); source.files.push({ file: "retired.spec.ts", project: "retired-project", baselineCaseCount: 1, durationMs: 1 });
    }
    const after = browserDurationPlan(listing(), saved);
    expect(after.allocation.parts.flatMap(part => part.cases).sort()).toEqual(before.allocation.parts.flatMap(part => part.cases).sort());
    expect(after.parts.flatMap(part => part.files).some(file => file.project === "retired-project")).toBe(false);
  });
  it("reports deterministic sanitized variance only from validated actual receipt fields", () => {
    const { saved, receipts } = evidence(); const report = browserDurationVariance(receipts, saved);
    expect(report.informationalOnly).toBe(true);
    expect(report.parts.reduce((sum, part) => sum + part.actualBodyMs, 0)).toBe(rows.length * 100);
    expect(browserDurationVariance([...receipts].reverse(), saved)).toEqual(report);
    expect(JSON.stringify(report)).not.toMatch(/duplicate title|config|attachments|stdout/);
    const malformed = structuredClone(receipts); malformed[0].files[0].durationMs = -1;
    expect(() => browserDurationVariance(malformed, saved)).toThrow();
  });
});
