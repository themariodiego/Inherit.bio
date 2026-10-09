import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { historicalDurationSource, multiRunDurationEstimator, multiRunHistoryFromCaptures, parseMultiRunBrowserDurationProfile,
  type HistoricalCaptureInput, type MultiRunDurationHistory } from "./ci-browser-duration-history";
import { DEFAULT_BROWSER_ALLOCATION_SHA256, parseBrowserDurationProfile, selectBrowserDurationProfile } from "./ci-browser-duration-plan";

const rawV1 = () => readFileSync("data/ci/browser-duration-profile.json", "utf8");
const rawV2 = () => readFileSync("data/ci/browser-duration-profile-v2.json", "utf8");
const twoSourceRegression = () => readFileSync("scripts/fixtures/browser-duration-profile-two-source.json", "utf8");
const missing = () => { throw Object.assign(new Error("missing"), { code: "ENOENT" }); };
const hash = (bytes: Buffer | string) => createHash("sha256").update(bytes).digest("hex");
const json = (value: unknown) => Buffer.from(JSON.stringify(value));
const names = ["accessible-authenticated-pages.spec.ts", "control-target-size.spec.ts", "figure-text-alternatives.spec.ts",
  "page-reflow-accessibility.spec.ts", "public-pages-session-accessibility.spec.ts", "viewport-keyboard-accessibility.spec.ts"];
/** Synthetic decoded receipts test the pure validator; they are never saved-history authentication evidence. */
function fixture(runId = 1): HistoricalCaptureInput {
  const head = "a".repeat(40), workflowHead = "b".repeat(40), tree = "c".repeat(40);
  const identity = { head, runId: String(runId), runAttempt: "1", schemaVersion: 1, total: 6 };
  const cases = names.map((_, index) => `${String(index + 1).padStart(20, "0")}-${"1".repeat(20)}:chromium`);
  const files = names.map(file => `e2e/${file}`);
  const manifest = { bytes: Buffer.from("synthetic-manifest"), value: { ...identity, cases, files } };
  const shards = names.map((file, index) => ({ bytes: Buffer.from(`synthetic-shard-${index}`), value: {
    ...identity, index: index + 1, fullCases: cases, assignedCases: [cases[index]], executedCases: [cases[index]], fullFiles: files,
    timings: { setupMs: 1, buildMs: 1, bootstrapMs: 1, browserMs: 100 }, providerUploads: 1,
    files: [{ file, project: "chromium", cases: [cases[index]], durationMs: 100 }] } }));
  const run = json({ id: runId, run_attempt: 1, head_sha: workflowHead, status: "completed", conclusion: "success", event: "pull_request", path: ".github/workflows/ci.yml" });
  const jobs = json({ total_count: 8, jobs: ["repository-checks", "checks", ...names.map((_, index) => `browser (${index + 1})`)].map((name, index) => ({
    id: index + 1, name, run_id: runId, run_attempt: 1, head_sha: workflowHead, status: "completed", conclusion: "success", steps: [{ status: "completed", conclusion: "success" }] })) });
  const artifacts = json({ total_count: 7, artifacts: [manifest, ...shards].map((zip, index) => ({
    id: index + 1, name: `browser-case-1-${index ? `shard-${index}` : "manifest"}`, size_in_bytes: zip.bytes.length, digest: `sha256:${hash(zip.bytes)}`,
    expired: false, workflow_run: { id: runId, head_sha: workflowHead } })) });
  const testedCommit = json({ sha: head, tree: { sha: tree } });
  const captureReceipt = json({ runId, runAttempt: 1, prHead: workflowHead, testedMerge: head,
    metadataPins: [run, jobs, artifacts, testedCommit].map((bytes, index) => ({ path: `metadata${index}`, bytes: bytes.length, sha256: hash(bytes) })),
    downloadPins: [manifest, ...shards].map((zip, index) => ({ path: `artifact${index}`, bytes: zip.bytes.length, sha256: hash(zip.bytes) })) });
  return { run, jobs, artifacts, testedCommit, captureReceipt, manifest, shards };
}
function mutateJson(input: HistoricalCaptureInput, field: "run" | "jobs" | "artifacts" | "testedCommit", change: (value: Record<string, unknown>) => void) {
  const value = JSON.parse(input[field].toString("utf8")); change(value); input[field] = json(value);
}
function simpleHistory(): MultiRunDurationHistory {
  const value = structuredClone(parseMultiRunBrowserDurationProfile(rawV2()).value);
  for (const source of value.sources) {
    source.projects = ["chromium"];
    source.files = [{ file: "ordinary.spec.ts", project: "chromium", baselineCaseCount: 3, durationMs: 10 }];
  }
  return value;
}
describe("closed multi-run history and fixed selection", () => {
  it("retains two separate genuine 95-row histories and hashes selected raw V2 bytes", () => {
    const selected = selectBrowserDurationProfile(rawV1, rawV2)!;
    expect(selected.sha256).toBe(hash(rawV2()));
    expect(selected.value.schemaVersion).toBe(2);
    const value = parseMultiRunBrowserDurationProfile(rawV2()).value;
    expect(value.sources.slice(0, 2).map(source => [source.runId, source.files.length, source.files.reduce((sum, row) => sum + row.baselineCaseCount, 0)]))
      .toEqual([["37212933160", 95, 569], ["37226288862", 95, 569]]);
    expect(value.sources.slice(0, 2)).toEqual(parseMultiRunBrowserDurationProfile(twoSourceRegression()).value.sources);
    expect(value.sources).toHaveLength(3);
    const third = value.sources[2];
    expect([third.runId, third.runAttempt, third.files.length, third.files.reduce((sum, row) => sum + row.baselineCaseCount, 0)])
      .toEqual(["37725805440", "1", 95, 569]);
    expect([third.head, third.workflowHead, third.tree]).toEqual([
      "575d9191227bae67323022cc3d46b6e4b3a8cd8b", "575d9191227bae67323022cc3d46b6e4b3a8cd8b",
      "c75aa59249346e9e8fcee1c006107e4079122318",
    ]);
    expect(third.projects).toEqual(["chromium", "copilot-local", "jurisdiction-off", "prepared-source"]);
    expect(third.manifestSha256).toBe("90b0f47a6c33fbef6d4707e13431b5abf2b55e8c7e5fa662e7f2fd1e4753a527");
    expect(third.shards).toEqual([
      { index: 1, sha256: "8ff3411a04eaf2eb2b77e53b1efe66ff263ab08a38ad9bec60144f02035e7c1d" },
      { index: 2, sha256: "9b5f8dcf29da71293d2d657e1f223f0a849d63fe741c2229d29f0703581db28c" },
      { index: 3, sha256: "e0cfd65adb892da79a65457ffb131453c85f0cf9e732a73f5b6cc7ebbc733da4" },
      { index: 4, sha256: "247356705cad459eed3ecaad6c02a93d7c3231df2e1bc3e12bffe4c0388da674" },
      { index: 5, sha256: "0ffe81154197fae3db251494efd9ce3487a2b48e96e8113e6febbe3cd4fb3f76" },
      { index: 6, sha256: "10c744a835d2aeb0d6f280a83dafbfb14e3f4e22e16214e89610ee88e6f7fb33" },
    ]);
    expect(third.metadata).toEqual({
      runSha256: "1e7bd429cf00759fd0130a85fcfd397ab50a9249e141baba28ee9dd7018f48ce",
      jobsSha256: "45316bb527634817bdc923a2e2df3d805ce934f7bfaa7c2fbe6d53d35605d4d3",
      testedCommitSha256: "96a8f4beaba6225a2253a551f8426143896d085e5ded404370ad27767d2e376f",
      artifactsSha256: "c20c693f77b16cbcf73f24b88391b9473786be7ece2978ea3031099da13f1b3c",
      captureReceiptSha256: "262d86cf1c8398f9293a71bc6e5593c1434a2f1bf8beb63288f99171a249a8e3",
    });
    expect(parseBrowserDurationProfile(rawV1()).value.source.runId).toBe("37212933160");
  });
  it("retains conservative old costs when the genuine third source refreshes the selected profile", () => {
    const baseline = parseMultiRunBrowserDurationProfile(twoSourceRegression());
    const current = parseMultiRunBrowserDurationProfile(rawV2());
    const oldCost = multiRunDurationEstimator(baseline), newCost = multiRunDurationEstimator(current);
    for (const row of current.value.sources[2].files) {
      const group = { file: row.file, project: row.project, count: row.baselineCaseCount };
      expect(newCost(group)).toBeGreaterThanOrEqual(oldCost(group));
      expect(newCost(group)).toBeGreaterThanOrEqual(row.durationMs);
    }
    const family = { file: "family-health-picture.spec.ts", project: "chromium", count: 15 };
    expect(oldCost(family)).toBe(279772); expect(newCost(family)).toBe(340082);
    const unknown = { file: "not-in-history.spec.ts", project: "chromium", count: 7 };
    expect(newCost(unknown)).toBeGreaterThanOrEqual(oldCost(unknown));
  });
  it("accepts V1 only when V2 is absent, and native only when both are absent", () => {
    expect(selectBrowserDurationProfile(rawV1, missing)?.sha256).toBe(hash(rawV1()));
    expect(selectBrowserDurationProfile(missing, rawV2)?.sha256).toBe(hash(rawV2()));
    expect(selectBrowserDurationProfile(missing, missing)).toBeNull();
  });
  it.each(["bad-v1", "bad-v2", "unreadable-v1", "unreadable-v2", "swapped-versions"])("refuses a present invalid alternate: %s", mode => {
    const unreadable = () => { throw Object.assign(new Error("denied"), { code: "EACCES" }); };
    const first = mode === "bad-v1" ? () => "{}" : mode === "unreadable-v1" ? unreadable : mode === "swapped-versions" ? rawV2 : rawV1;
    const second = mode === "bad-v2" ? () => "{}" : mode === "unreadable-v2" ? unreadable : mode === "swapped-versions" ? rawV1 : rawV2;
    expect(() => selectBrowserDurationProfile(first, second)).toThrow();
  });
  it("uses maximum per-case ratio, not maximum raw file total or a single-run label", () => {
    const value = simpleHistory(); value.sources[1].files[0] = { ...value.sources[1].files[0], durationMs: 8, baselineCaseCount: 2 };
    const profile = parseMultiRunBrowserDurationProfile(JSON.stringify(value));
    expect(multiRunDurationEstimator(profile)({ file: "ordinary.spec.ts", project: "chromium", count: 5 })).toBe(20);
    expect(value.sources[0].files[0].durationMs).toBe(10);
  });
  it("uses exact rational ceiling and gives all-zero unknown N a cost of at least N", () => {
    const value = simpleHistory(); const group = { file: "ordinary.spec.ts", project: "chromium", count: 7 };
    expect(multiRunDurationEstimator(parseMultiRunBrowserDurationProfile(JSON.stringify(value)))(group)).toBe(24);
    value.sources.forEach(source => { source.files[0].durationMs = 0; });
    const estimate = multiRunDurationEstimator(parseMultiRunBrowserDurationProfile(JSON.stringify(value)));
    expect(estimate(group)).toBe(1);
    expect(estimate({ ...group, file: "unknown.spec.ts" })).toBe(7);
    expect(estimate({ ...group, project: "new-project", count: 100 })).toBe(100);
  });
  it("rejects invalid current counts and safe-integer estimate overflow", () => {
    const estimate = multiRunDurationEstimator(parseMultiRunBrowserDurationProfile(JSON.stringify(simpleHistory())));
    for (const count of [0, -1, 0.5, Number.MAX_SAFE_INTEGER])
      expect(() => estimate({ file: "ordinary.spec.ts", project: "chromium", count })).toThrow();
  });
  it.each(["duplicate-run", "duplicate-file", "undeclared-project", "duplicate-project", "extra-field", "extra-source"])("rejects closed provenance defect: %s", mode => {
    const value = simpleHistory();
    if (mode === "duplicate-run") value.sources[1].runId = value.sources[0].runId;
    if (mode === "duplicate-file") value.sources[0].files.push(value.sources[0].files[0]);
    if (mode === "undeclared-project") value.sources[0].projects = ["unrelated"];
    if (mode === "duplicate-project") value.sources[0].projects.push("chromium");
    if (mode === "extra-field") Object.assign(value, { combinedRunId: "fiction" });
    if (mode === "extra-source") value.sources.push(value.sources[0], value.sources[1]);
    expect(() => parseMultiRunBrowserDurationProfile(JSON.stringify(value))).toThrow();
  });
});
describe("pure captured historical source contract", () => {
  it("reconstructs all six whole measured files from each independent decoded fixture", () => {
    const source = historicalDurationSource(fixture());
    expect(source.files).toHaveLength(6); expect(source.projects).toEqual(["chromium"]);
    expect(multiRunHistoryFromCaptures([fixture(2), fixture(1)]).sources.map(source => source.runId)).toEqual(["1", "2"]);
  });
  it.each(["duration-v1", "queue-v1"])("retains actual measured timings from complete %s receipts", mode => {
    const input = fixture();
    const parts = input.shards.map((zip, index) => ({ index: index + 1,
      cases: (zip.value as { assignedCases: string[] }).assignedCases }));
    const profileSha256 = mode === "queue-v1" ? DEFAULT_BROWSER_ALLOCATION_SHA256 : "d".repeat(64);
    const identity = { mode, profileSha256, planSha256: hash(JSON.stringify({ profileSha256, parts })) };
    Object.assign(input.manifest.value as object, { allocation: { ...identity, parts } });
    input.shards.forEach(zip => Object.assign(zip.value as object, { allocation: identity }));
    const source = historicalDurationSource(input);
    expect(source.files).toHaveLength(6);
    expect(source.files.every(file => file.durationMs === 100 && file.baselineCaseCount === 1)).toBe(true);
    Object.assign(input.shards[0].value as object, { allocation: { ...identity,
      mode: mode === "queue-v1" ? "duration-v1" : "queue-v1" } });
    expect(() => historicalDurationSource(input)).toThrow("allocation identity");
  });
  it.each(["failed-run", "failed-step", "missing-job", "changed-api-artifact", "changed-zip", "mixed-head", "duplicate-case", "split-file", "missing-upload", "missing-sweep"])("rejects historical proof defect: %s", mode => {
    const input = fixture();
    if (mode === "failed-run") mutateJson(input, "run", value => { value.conclusion = "failure"; });
    if (mode === "failed-step") mutateJson(input, "jobs", value => { (value.jobs as { steps: { conclusion: string }[] }[])[0].steps[0].conclusion = "failure"; });
    if (mode === "missing-job") mutateJson(input, "jobs", value => { (value.jobs as unknown[]).pop(); });
    if (mode === "changed-api-artifact") {
      mutateJson(input, "artifacts", value => { (value.artifacts as { digest: string }[])[0].digest = `sha256:${"0".repeat(64)}`; });
      // Even caller-recomputed capture hashes cannot replace the API's ZIP digest check.
      const capture = JSON.parse(input.captureReceipt.toString("utf8"));
      capture.metadataPins[2] = { path: "metadata2", bytes: input.artifacts.length, sha256: hash(input.artifacts) };
      input.captureReceipt = json(capture);
    }
    if (mode === "changed-zip") input.shards[0].bytes = Buffer.from("changed");
    const first = input.shards[0].value as { head: string; executedCases: string[]; assignedCases: string[]; files: { file: string; cases: string[] }[]; providerUploads: number };
    if (mode === "mixed-head") first.head = "d".repeat(40);
    if (mode === "duplicate-case") first.executedCases.push(first.executedCases[0]);
    if (mode === "split-file") first.files.push(first.files[0]);
    if (mode === "missing-upload") input.shards.forEach(zip => { (zip.value as { providerUploads: number }).providerUploads = 0; });
    if (mode === "missing-sweep") {
      const second = input.shards[1].value as typeof first;
      first.files[0].file = second.files[0].file;
    }
    expect(() => historicalDurationSource(input)).toThrow();
  });
});
