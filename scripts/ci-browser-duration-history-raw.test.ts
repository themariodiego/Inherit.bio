import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { multiRunDurationEstimator, parseMultiRunBrowserDurationProfile } from "./ci-browser-duration-history";
import { appendHistoricalSource, observeCurrentRawInput, rawHistoryAppendPlanSchema } from "./ci-browser-duration-history-raw";
import { admittedCurrentHistoricalSource, readAdmittedCurrentHistoricalInput } from "./current-historical-integration";
import { historicalDurationSource } from "./ci-browser-duration-history";
import { historicalDurationMain } from "./ci-browser-duration-history.run.mjs";
import { syntheticRawCapture } from "./ci-browser-duration-history-raw.fixture";
const parents: string[] = [];
afterEach(() => { for (const parent of parents.splice(0)) rmSync(parent, { recursive: true, force: true }); });
const fixture = (event: "push" | "pull_request" = "push") => {
  const f = syntheticRawCapture(event); parents.push(f.parent); return f;
};
const hash = (raw: Buffer | string) => createHash("sha256").update(raw).digest("hex");
const originalProfile = () => readFileSync("data/ci/browser-duration-profile-v2.json", "utf8");
function privateFile(parent: string, name: string, value: string) {
  const file = path.join(parent, name); writeFileSync(file, value, { mode: 0o600, flag: "wx" });
  return { path: file, bytes: Buffer.byteLength(value), sha256: hash(value) };
}
function appendPlan(f = fixture()) {
  const baseRaw = originalProfile();
  const existingHistory = privateFile(f.parent, "prior-history.json", baseRaw);
  const inputAdmission = privateFile(f.parent, "node-io-admission.json", JSON.stringify(f.io));
  const captureAdmission = privateFile(f.parent, "capture-admission.json", JSON.stringify(f.captureAdmission));
  const raw = JSON.stringify({ schemaVersion: 1, format: "hosted-reader-raw-v1", existingHistory, inputAdmission, captureAdmission });
  const plan = privateFile(f.parent, "raw-append-plan.json", raw);
  return { f, baseRaw, existingHistory, inputAdmission, captureAdmission, plan, output: path.join(f.parent, "proposal") };
}
describe("explicit raw historical bridge and conservative proposal", () => {
  it.each(["push", "pull_request"] as const)("uses actual Node stats and stock validation for a synthetic %s capture", event => {
    const f = fixture(event), input = readAdmittedCurrentHistoricalInput(f.io, f.captureAdmission);
    const source = historicalDurationSource(input);
    expect(source.files).toHaveLength(6); expect(source.projects).toEqual(["chromium"]);
    expect(source.head).toBe(f.captureAdmission.request.testedHead);
    expect(source.workflowHead).toBe(f.captureAdmission.request.head);
    expect(source.metadata.captureReceiptSha256).toBe(f.captureAdmission.capturePin.sha256);
    const st = lstatSync(f.captureAdmission.capturePin.path);
    expect(f.io.namespace.find(row => row.name === "capture-receipt.json"))
      .toEqual({ name: "capture-receipt.json", dev: st.dev, ino: st.ino, uid: st.uid, mode: st.mode,
        nlink: st.nlink, size: st.size, mtimeMs: st.mtimeMs, ctimeMs: st.ctimeMs });
  });
  it("requires explicit raw admission and never falls back to the legacy receipt", () => {
    const f = fixture(), input = readAdmittedCurrentHistoricalInput(f.io, f.captureAdmission);
    Reflect.deleteProperty(input, "captureAdmission");
    expect(() => historicalDurationSource(input)).toThrow();
  });
  it("refuses raw admission on the legacy path and an unknown capture selector", () => {
    const f = fixture(), input = readAdmittedCurrentHistoricalInput(f.io, f.captureAdmission);
    Reflect.set(input, "captureFormat", "legacy-v1");
    expect(() => historicalDurationSource(input)).toThrow();
    Reflect.set(input, "captureFormat", "unknown");
    expect(() => historicalDurationSource(input)).toThrow();
  });
  it("refuses legacy/raw mixing during genuine Node inventory observation", () => {
    const f = fixture(); writeFileSync(path.join(f.root, "run.json"), "{}", { mode: 0o600, flag: "wx" });
    expect(() => observeCurrentRawInput(f.root, 1, f.originalPins)).toThrow();
  });
  it("refuses an IO/semantic pin disagreement before bridge success", () => {
    const f = fixture(), bad = { ...f.captureAdmission, capturePin: { ...f.captureAdmission.capturePin, sha256: "f".repeat(64) } };
    expect(() => admittedCurrentHistoricalSource(f.io, bad)).toThrow();
  });
  it("preserves both prior source rows and every prior known/unknown conservative cost", () => {
    const f = fixture(), raw = originalProfile(), source = admittedCurrentHistoricalSource(f.io, f.captureAdmission);
    const prior = parseMultiRunBrowserDurationProfile(raw), appended = appendHistoricalSource(raw, source);
    expect(appended.sources.slice(0, 2)).toEqual(prior.value.sources); expect(appended.sources).toHaveLength(3);
    const oldCost = multiRunDurationEstimator(prior), newCost = multiRunDurationEstimator(parseMultiRunBrowserDurationProfile(JSON.stringify(appended)));
    for (const row of prior.value.sources.flatMap(s => s.files)) {
      const group = { file: row.file, project: row.project, count: row.baselineCaseCount };
      expect(newCost(group)).toBeGreaterThanOrEqual(oldCost(group));
    }
    const unknown = { file: "unmeasured.spec.ts", project: "chromium", count: 7 };
    expect(newCost(unknown)).toBeGreaterThanOrEqual(oldCost(unknown));
    expect(originalProfile()).toBe(raw);
  });
  it("refuses a duplicate run even when supplied as a different source object", () => {
    const f = fixture(), raw = originalProfile(), source = admittedCurrentHistoricalSource(f.io, f.captureAdmission);
    source.runId = parseMultiRunBrowserDurationProfile(raw).value.sources[0].runId;
    expect(() => appendHistoricalSource(raw, source)).toThrow();
  });
  it("refuses a fourth source instead of evicting or replacing history", () => {
    const f = fixture(), source = admittedCurrentHistoricalSource(f.io, f.captureAdmission);
    const three = appendHistoricalSource(originalProfile(), source);
    expect(() => appendHistoricalSource(JSON.stringify(three), { ...source, runId: "9002" })).toThrow();
  });
  it("writes only fresh private proposal/audit files and preserves the pinned source profile", () => {
    const p = appendPlan();
    historicalDurationMain(["--raw-append", p.plan.path, p.plan.sha256, p.output], p.f.sourceDirectory);
    expect(readdirSync(p.output).sort()).toEqual(["browser-duration-profile-v2.proposal.json", "history-source-audit.json"]);
    const proposed = parseMultiRunBrowserDurationProfile(readFileSync(path.join(p.output, "browser-duration-profile-v2.proposal.json"), "utf8"));
    expect(proposed.value.sources.slice(0, 2)).toEqual(parseMultiRunBrowserDurationProfile(p.baseRaw).value.sources);
    expect(proposed.value.sources[2].metadata.captureReceiptSha256).toBe(p.f.captureAdmission.capturePin.sha256);
    expect(readFileSync(p.existingHistory.path, "utf8")).toBe(p.baseRaw);
    for (const name of readdirSync(p.output)) { const st = lstatSync(path.join(p.output, name));
      expect(st.mode & 0o777).toBe(0o600); expect(st.nlink).toBe(1); }
    expect(lstatSync(p.output).mode & 0o777).toBe(0o700);
    const retained = readdirSync(p.output).map(name => readFileSync(path.join(p.output, name)));
    expect(() => historicalDurationMain(["--raw-append", p.plan.path, p.plan.sha256, p.output], p.f.sourceDirectory)).toThrow();
    expect(readdirSync(p.output).map(name => readFileSync(path.join(p.output, name)))).toEqual(retained);
  });
  it("refuses a changed explicit plan digest before reserving output", () => {
    const p = appendPlan();
    expect(() => historicalDurationMain(["--raw-append", p.plan.path, "f".repeat(64), p.output], p.f.sourceDirectory)).toThrow();
    expect(existsSync(p.output)).toBe(false); expect(readFileSync(p.existingHistory.path, "utf8")).toBe(p.baseRaw);
  });
  it("refuses source/input overwrite aliases without changing their bytes", () => {
    const p = appendPlan();
    expect(() => historicalDurationMain(["--raw-append", p.plan.path, p.plan.sha256, p.f.root], p.f.sourceDirectory)).toThrow();
    expect(readFileSync(p.f.captureAdmission.capturePin.path).length).toBe(p.f.captureAdmission.capturePin.bytes);
    expect(readFileSync(p.existingHistory.path, "utf8")).toBe(p.baseRaw);
  });
  it("refuses unknown format/baseline flags and malformed CLI paths", () => {
    const p = appendPlan(), value = JSON.parse(readFileSync(p.plan.path, "utf8"));
    expect(() => rawHistoryAppendPlanSchema.parse({ ...value, acceptBaseline: true })).toThrow();
    expect(() => rawHistoryAppendPlanSchema.parse({ ...value, format: "unknown" })).toThrow();
    expect(() => historicalDurationMain(["--raw-append", p.plan.path, p.plan.sha256])).toThrow();
    expect(() => historicalDurationMain(["--raw-append", "relative.json", p.plan.sha256, p.output])).toThrow();
    expect(() => historicalDurationMain(["--unknown", p.plan.path, p.output])).toThrow();
  });
});
