import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ACCESSIBILITY_SWEEP_FILES, verifyAccessibilitySweepPlacement } from "./ci-browser-balance";
import { browserDurationPlan, browserDurationTestList, optionalBrowserDurationProfile, parseBrowserDurationProfile,
  verifyBrowserDurationListings, verifyBrowserDurationPartitionListing } from "./ci-browser-duration-plan";
import { browserManifest, browserShardReceipt, verifyBrowserShards } from "./ci-browser-shards";
import { STANDARD_CI_BROWSER_PROJECTS } from "./ci-browser-project-registry";
import { QUEUE_EXCLUSIVE_BROWSER_FILES, verifyBrowserQueueIsolation } from "./ci-browser-queue-isolation";

const projects = [...STANDARD_CI_BROWSER_PROJECTS];
const historicalProjects = ["chromium", "jurisdiction-off", "copilot-local", "prepared-source"];
const source = { head: "a".repeat(40), runId: "12345", runAttempt: "1" };
const id = (n: number) => `${n.toString(16).padStart(20, "0")}-${n.toString(16).padStart(20, "0")}`;
const historicalRows = [
  ...ACCESSIBILITY_SWEEP_FILES.map((file, index) => ({ file, project: "chromium", n: index + 1 })),
  ...Array.from({ length: 8 }, (_, index) => ({ file: `ordinary-${index}.spec.ts`, project: historicalProjects[index % historicalProjects.length], n: index + 7 })),
  { file: "ordinary-0.spec.ts", project: "chromium", n: 15 },
];
// Only the real current registry adds current rows. Timing history stays four projects.
const hasEmbryoProjects = projects.includes("embryo-ingest") || projects.includes("embryo-mixed-qc");
const rows = [...historicalRows.filter(row => projects.includes(row.project)),
  ...(hasEmbryoProjects ? Object.entries(QUEUE_EXCLUSIVE_BROWSER_FILES)
    .filter(([, project]) => projects.includes(project)).map(([file, project], index) => ({ file, project, n: 16 + index })) : [])];
function listing(values = rows, executed = false) {
  return { config: { workers: 1, fullyParallel: false, shard: null,
    projects: projects.map(name => ({ name, retries: 0, repeatEach: 1 })) },
  suites: [{ specs: values.map(row => ({ id: id(row.n), file: row.file, title: "repeated short title",
    tests: [{ projectName: row.project, expectedStatus: "passed",
      results: executed ? [{ status: "passed", retry: 0, duration: 10 }] : [] }] })) }],
  errors: [], stats: { expected: executed ? values.length : 0, unexpected: 0, flaky: 0, skipped: executed ? 0 : values.length } };
}
function history() {
  const unique = historicalRows.filter((row, index) => historicalRows.findIndex(other => other.file === row.file && other.project === row.project) === index);
  return { schemaVersion: 1, source: { ...source, projects: [...historicalProjects], manifestSha256: "b".repeat(64),
    shards: Array.from({ length: 6 }, (_, index) => ({ index: index + 1, sha256: "c".repeat(64) })) },
  files: unique.map(row => ({ file: row.file, project: row.project,
    baselineCaseCount: historicalRows.filter(other => other.file === row.file && other.project === row.project).length,
    durationMs: row.n * 100 })) };
}
const profile = () => parseBrowserDurationProfile(JSON.stringify(history()));
function evidence() {
  const full = listing(), plan = browserDurationPlan(full, profile());
  const assignedRows = plan.parts.map(part => rows.filter(row => part.files.some(file => row.file === file.file && row.project === file.project)));
  return { full, plan, assignedRows, assigned: assignedRows.map(values => listing(values)) };
}

describe("duration history schedules the complete current browser suite", () => {
  it("validates the pinned successful profile without treating its counts as the current inventory", () => {
    const saved = parseBrowserDurationProfile(readFileSync("data/ci/browser-duration-profile.json", "utf8"));
    expect(saved.value.source).toMatchObject({ head: "7e068bc90148d0b80b1ebfe3fdd03d29520cd042", runId: "37212933160", runAttempt: "1" });
    expect(saved.value.files).toHaveLength(95);
    expect(saved.value.files.reduce((sum, row) => sum + row.baselineCaseCount, 0)).toBe(569);
  });
  it("rejects malformed, duplicate, unsafe and unregistered performance input", () => {
    for (const durationMs of [-1, 0.5, 3_600_001, Infinity]) {
      const value = history(); value.files[0].durationMs = durationMs;
      expect(() => parseBrowserDurationProfile(JSON.stringify(value))).toThrow();
    }
    for (const mutate of [(value: ReturnType<typeof history>) => { value.files.push(value.files[0]); },
      (value: ReturnType<typeof history>) => { value.files[0].baselineCaseCount = 0; },
      (value: ReturnType<typeof history>) => { value.source.shards[0].index = 2; },
      (value: ReturnType<typeof history>) => { value.files[0].file = "../escape.spec.ts"; },
      (value: ReturnType<typeof history>) => { value.files[0].file = "file.spec.ts › one test"; },
      (value: ReturnType<typeof history>) => { value.files[0].project = "unknown"; },
      (value: ReturnType<typeof history>) => { value.source.projects.pop(); },
      (value: ReturnType<typeof history>) => { value.source.projects.push("absent-project"); },
      (value: ReturnType<typeof history>) => { value.source.projects.push(value.source.projects[0]); },
      (value: ReturnType<typeof history>) => { value.source.projects[0] = "bad project"; },
      (value: ReturnType<typeof history>) => { value.source.manifestSha256 = "unknown"; }]) {
      const value = history(); mutate(value);
      expect(() => parseBrowserDurationProfile(JSON.stringify(value))).toThrow();
    }
    expect(() => parseBrowserDurationProfile("{}")).toThrow();
  });
  it("falls back only for a missing profile and refuses corruption or access errors", () => {
    expect(optionalBrowserDurationProfile(() => { throw Object.assign(new Error("missing"), { code: "ENOENT" }); })).toBeNull();
    for (const code of ["EACCES", "ENOTDIR", "EIO"])
      expect(() => optionalBrowserDurationProfile(() => { throw Object.assign(new Error("read failed"), { code }); })).toThrow("read failed");
    expect(() => optionalBrowserDurationProfile(() => "{}")).toThrow();
    expect(() => optionalBrowserDurationProfile(() => "invalid JSON")).toThrow();
    expect(optionalBrowserDurationProfile(() => JSON.stringify(history()))?.value.files).toHaveLength(history().files.length);
  });
  it("keeps complete serial files, every current case and project, and the accessibility placement guard", () => {
    const { full, plan, assigned } = evidence();
    expect(() => verifyBrowserDurationListings(full, assigned, plan)).not.toThrow();
    expect(plan.parts.flatMap(part => part.files.flatMap(file => file.cases))).toHaveLength(rows.length);
    const serial = plan.parts.flatMap(part => part.files).filter(file => file.file === "ordinary-0.spec.ts");
    expect(serial).toHaveLength(1); expect(serial[0].cases).toHaveLength(2);
    expect(new Set(plan.parts.flatMap(part => part.files.map(file => file.project)))).toEqual(new Set(projects));
    expect(new Set(verifyAccessibilitySweepPlacement(plan.parts).map(row => row.index)).size).toBeGreaterThanOrEqual(3);
  });
  it("scales known weights by the current count and includes new groups with a conservative positive weight", () => {
    const saved = profile(), baseline = browserDurationPlan(listing(), saved);
    const next = Math.max(...rows.map(row => row.n)) + 1;
    const newRows = [...rows, { ...rows[6], n: next }, { file: "new-file.spec.ts", project: "chromium", n: next + 1 }];
    const updated = browserDurationPlan(listing(newRows), saved);
    const before = baseline.parts.reduce((sum, part) => sum + part.estimatedMs, 0);
    const after = updated.parts.reduce((sum, part) => sum + part.estimatedMs, 0);
    const known = saved.value.files.find(row => row.file === rows[6].file)!;
    const largest = Math.max(...saved.value.files.map(row => row.durationMs));
    expect(after - before).toBe(Math.ceil(known.durationMs / known.baselineCaseCount) + largest);
    expect(updated.parts.flatMap(part => part.files).find(file => file.file === "new-file.spec.ts")?.cases).toEqual([`${id(next + 1)}:chromium`]);
    const removed = browserDurationPlan(listing(rows.filter(row => row.n !== 14)), saved);
    const removedRow = rows.find(row => row.n === 14)!;
    expect(removed.allocation.parts.flatMap(part => part.cases)).not.toContain(`${id(removedRow.n)}:${removedRow.project}`);
  });
  it("includes a real current project absent from a valid three-project historical profile", () => {
    const past = history(); past.source.projects = historicalProjects.filter(project => project !== "prepared-source");
    past.files = past.files.filter(file => file.project !== "prepared-source");
    const saved = parseBrowserDurationProfile(JSON.stringify(past));
    const { full } = evidence(), plan = browserDurationPlan(full, saved);
    const currentPreparedRows = rows.filter(row => row.project === "prepared-source");
    expect(plan.parts.flatMap(part => part.files).filter(file => file.project === "prepared-source"))
      .toHaveLength(new Set(currentPreparedRows.map(row => row.file)).size);
    expect(plan.allocation.parts.flatMap(part => part.cases)).toHaveLength(rows.length);
    const currentPrepared = currentPreparedRows.map(row => `${id(row.n)}:prepared-source`);
    expect(plan.allocation.parts.flatMap(part => part.cases).filter(id => id.endsWith(":prepared-source")).sort()).toEqual(currentPrepared.sort());
    const actualAssignments = plan.parts.map(part => listing(rows.filter(row => part.files.some(file => row.file === file.file && row.project === file.project))));
    expect(() => verifyBrowserDurationListings(full, actualAssignments, plan)).not.toThrow();
  });
  it("accepts obsolete historical projects without adding them to the current registry or assigning their cases", () => {
    const past = history(); past.source.projects.push("retired-project");
    past.files.push({ file: "retired-file.spec.ts", project: "retired-project", baselineCaseCount: 1, durationMs: 3_600_000 });
    const saved = parseBrowserDurationProfile(JSON.stringify(past));
    const original = browserDurationPlan(listing(), profile()), plan = browserDurationPlan(listing(), saved);
    expect(plan.allocation.parts.flatMap(part => part.cases).sort()).toEqual(original.allocation.parts.flatMap(part => part.cases).sort());
    if (!hasEmbryoProjects) expect(plan.allocation.parts).toEqual(original.allocation.parts);
    expect(plan.parts.flatMap(part => part.files).some(file => file.project === "retired-project")).toBe(false);
    const foreign = listing(); foreign.suites[0].specs[0].tests[0].projectName = "retired-project";
    expect(() => browserDurationPlan(foreign, saved)).toThrow();
    const omitted = listing(); omitted.config.projects.pop();
    expect(() => browserDurationPlan(omitted, saved)).toThrow("Standard browser projects differ");
  });
  it("uses deterministic ties independent of discovery or profile row order", () => {
    const original = browserDurationPlan(listing(), profile());
    expect(browserDurationPlan(listing([...rows].reverse()), profile()).allocation).toEqual(original.allocation);
    const reversed = history(); reversed.files.reverse();
    expect(browserDurationPlan(listing(), parseBrowserDurationProfile(JSON.stringify(reversed))).allocation.parts).toEqual(original.allocation.parts);
  });
  it("separates the two Chromium queue journeys even when both fit in the same least-loaded job", () => {
    const past = history();
    for (const file of past.files) {
      const sweep = ACCESSIBILITY_SWEEP_FILES.indexOf(file.file);
      file.durationMs = sweep < 0 ? 1 : (6 - sweep) * 100;
    }
    const queueFiles = Object.entries(QUEUE_EXCLUSIVE_BROWSER_FILES).filter(([, project]) => project === "chromium");
    queueFiles.forEach(([file, project], index) => past.files.push({ file, project, baselineCaseCount: 1, durationMs: 10 - index }));
    const next = Math.max(...rows.map(row => row.n)) + 1;
    const current = [...rows.filter(row => !queueFiles.some(([file]) => row.file === file)),
      ...queueFiles.map(([file, project], index) => ({ file, project, n: next + index }))];
    // In the original four-project fixture the six sweep costs are 600..100.
    // Both 10/9-ms queue groups precede ordinary 1-ms groups and choose job six
    // without the isolation constraint: 100+10+9 remains below job five's 200.
    const plan = browserDurationPlan(listing(current), parseBrowserDurationProfile(JSON.stringify(past)));
    const placements = plan.parts.filter(part => part.files.some(group => queueFiles.some(([file]) => group.file === file)));
    expect(placements).toHaveLength(2);
    expect(plan.allocation.parts.flatMap(part => part.cases).sort()).toEqual(current.map(row => `${id(row.n)}:${row.project}`).sort());
    expect(() => verifyBrowserQueueIsolation(plan.parts)).not.toThrow();
    const selected = plan.parts.map(part => listing(current.filter(row => part.files.some(file => row.file === file.file && row.project === file.project))));
    expect(() => verifyBrowserDurationListings(listing(current), selected, plan)).not.toThrow();
    const collision = structuredClone(plan);
    const left = collision.parts.find(part => part.files.some(group => group.file === queueFiles[0][0]))!;
    const right = collision.parts.find(part => part.files.some(group => group.file === queueFiles[1][0]))!;
    const moved = right.files.find(group => group.file === queueFiles[1][0])!;
    right.files = right.files.filter(group => group !== moved); left.files.push(moved);
    collision.allocation.parts = collision.parts.map(part => ({ index: part.index, cases: part.files.flatMap(group => group.cases).sort() }));
    const observedCollision = listing(current.filter(row => left.files.some(file => row.file === file.file && row.project === file.project)));
    expect(() => verifyBrowserDurationPartitionListing(observedCollision, collision, left.index)).toThrow("at most one queue journey");
  });
  it("emits only whole project/file lines in the official grammar, with no title, line or empty selector", () => {
    const { plan } = evidence();
    for (const part of plan.parts) {
      const lines = browserDurationTestList(plan, part.index).trim().split("\n");
      expect(lines).toHaveLength(part.files.length);
      for (const line of lines) expect(line).toMatch(/^\[[a-z-]+\] › [a-z0-9._/-]+\.spec\.ts$/);
    }
    expect(() => browserDurationTestList(plan, 0)).toThrow();
    expect(() => browserDurationTestList(plan, 7)).toThrow();
  });
  it("rejects actual listing omissions, added selectors and changed whole-file ownership before execution", () => {
    const { full, plan, assigned, assignedRows } = evidence();
    expect(() => verifyBrowserDurationListings(full, assigned.slice(1), plan)).toThrow();
    const omitted = listing(assignedRows[0].slice(1));
    expect(() => verifyBrowserDurationPartitionListing(omitted, plan, 1)).toThrow();
    const sharded = structuredClone(assigned[0]); Object.assign(sharded.config, { shard: { current: 1, total: 6 } });
    expect(() => verifyBrowserDurationPartitionListing(sharded, plan, 1)).toThrow();
    const renamed = structuredClone(assigned[0]); renamed.suites[0].specs[0].file = "renamed.spec.ts";
    expect(() => verifyBrowserDurationPartitionListing(renamed, plan, 1)).toThrow("whole project/file");
  });
  it("binds truthful unsharded reports to one exact plan and refuses foreign or mixed aggregate evidence", () => {
    const { full, plan, assignedRows, assigned } = evidence();
    const tracked = [...new Set(rows.map(row => `e2e/${row.file}`))];
    const manifest = browserManifest(full, source, tracked, plan.allocation);
    const receipts = assignedRows.map((values, index) => browserShardReceipt(full, assigned[index], listing(values, true),
      source, index + 1, 1, { setupMs: 1, buildMs: 1, bootstrapMs: 1, browserMs: 1 }, tracked, plan.allocation));
    expect(verifyBrowserShards(manifest, receipts, source)).toBe(rows.length);
    for (const allocation of [undefined, { ...receipts[0].allocation!, profileSha256: "d".repeat(64) },
      { ...receipts[0].allocation!, planSha256: "d".repeat(64) }])
      expect(() => verifyBrowserShards(manifest, [{ ...receipts[0], allocation }, ...receipts.slice(1)], source)).toThrow();
    const wrongPlan = structuredClone(plan.allocation); wrongPlan.parts[0].cases = wrongPlan.parts[1].cases;
    expect(() => browserManifest(full, source, tracked, wrongPlan)).toThrow();
    expect(() => verifyBrowserShards(browserManifest(full, source, tracked), receipts, source)).toThrow();
  });
});
