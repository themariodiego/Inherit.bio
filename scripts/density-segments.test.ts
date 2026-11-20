import { describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { checkedDensityCaptureSegment, validateDensitySegmentUnion } from "./density-segments";
import { densityCapturePlan, densityStateKey, DENSITY_VIEWPORTS } from "./density-capture-plan";
import { requiredDensityCaptures, type DensityContract, type DensityRegister } from "./density-current";

const hash = (x: string) => createHash("sha256").update(x).digest("hex");
const source = { head: "a".repeat(40), tree: "b".repeat(40), registerSha256: "c".repeat(64) };
const contract: DensityContract = { baseline: { commitSha: "864736979c92a08ba77e8580d61946eba6864918", routeCount: 22, captureCount: 44 },
  capture: { artifacts: { measurementModule: { sha256: "d".repeat(64) }, measurementHarness: { sha256: "e".repeat(64) } } },
  routes: [], relativeComparison: { routes: [] } };

/** Public invented pure-parser data, never a native authority or closure fixture. */
function originalSet(pages = 1) {
  const register: DensityRegister = { stateProfiles: { two: { supported: ["empty", "processing"] }, three: { supported: ["empty", "processing", "complete"] } },
    routes: Array.from({ length: pages }, (_, i) => ({ id: `page-${i}`, path: `/page-${i}`, kind: "page", surface: "marketing",
      stateProfile: pages === 64 && i < 40 ? "three" : "two" })) };
  const required = requiredDensityCaptures(register);
  const plan = densityCapturePlan(register, [...new Set(required.map(row => densityStateKey(row.route.id, row.state)))]);
  const environment = { browserName: "chromium", browserVersion: "fixture-version", platform: "fixture-platform", fontManifestSha256: "f".repeat(64),
    theme: "light", devicePixelRatio: 1, locale: "en-US", timezone: "UTC" };
  const fixtureCatalog = plan.states.map(row => ({ routeId: row.route.id, state: row.state, serviceOrigin: "http://localhost:3100",
    sourcePath: "e2e/helpers/density-real-state-fixtures.ts", sourceSha256: "1".repeat(64) }));
  const census = { version: 1, source, registerSha256: source.registerSha256, pageRoutes: plan.pages.map(row => row.id),
    states: plan.states.map(row => ({ routeId: row.route.id, state: row.state })), viewports: DENSITY_VIEWPORTS,
    requiredCaptureCount: required.length, holds: [] as { routeId: string; state: string; reason: string }[] };
  const segments = required.map((row, index) => {
    const selection = { routeId: row.route.id, state: row.state, viewport: row.viewport };
    const viewport = DENSITY_VIEWPORTS.find(x => x.id === row.viewport)!;
    const screenshotSha256 = hash(`public invented PNG ${index}`);
    const pixel = { screenshotSha256, screenshotWidthPx: viewport.width, screenshotHeightPx: viewport.height,
      includedPixelCount: viewport.width * viewport.height, excludedPixelCount: 0, inkPixelCount: 0, inkCoverageRatio: 0, whiteSpaceRatio: 1, exactGroundPixelCount: viewport.width * viewport.height, exactGroundRatio: 1 };
    const raw = { ground: "rgb(247, 248, 241)", innerWidth: viewport.width, innerHeight: viewport.height, dpr: 1, budgetedInteractiveElements: 1, interactiveElements: 1, rawDecoratedElements: 0, budgetedDecoratedElements: 0,
      visibleTextCharacters: 1, statusView: "public synthetic parser fixture", proseElementCount: 0, maxProseMeasureCh: null, minProseMeasureCh: null,
      topLevelSectionCount: 0, minimumAdjacentSectionGapPx: null, primaryContentLeftPaddingPx: 24, primaryClaimTextElementCount: null,
      primaryClaimFigureCount: null, horizontalScroll: false, horizontalOverflowPx: 0, pixelExclusionRects: [] };
    const metrics = { ...pixel, interactiveElementCount: raw.budgetedInteractiveElements, rawInteractiveElementCount: raw.interactiveElements,
      rawDecoratedElementCount: raw.rawDecoratedElements, budgetedDecoratedElementCount: raw.budgetedDecoratedElements, visibleTextCharacterCount: raw.visibleTextCharacters,
      statusView: raw.statusView, proseElementCount: raw.proseElementCount, maxProseMeasureCh: raw.maxProseMeasureCh, minProseMeasureCh: raw.minProseMeasureCh,
      topLevelSectionCount: raw.topLevelSectionCount, minimumAdjacentSectionGapPx: raw.minimumAdjacentSectionGapPx,
      primaryContentLeftPaddingPx: raw.primaryContentLeftPaddingPx, primaryClaimTextElementCount: raw.primaryClaimTextElementCount,
      primaryClaimFigureCount: raw.primaryClaimFigureCount, horizontalScroll: false as const, horizontalOverflowPx: 0 as const };
    const runtime = { version: 1, scope: "disposable-synthetic-native", source, appOrigin: "http://localhost:3100", buildId: "public-fixture-build",
      ownerNonce: `11111111-1111-4111-8111-${String(index + 1).padStart(12, "0")}`, bootId: "22222222-2222-4222-8222-222222222222",
      systemIdentifier: "1", databaseOid: 5, databaseName: "postgres", daemonSha256: "2".repeat(64), fixtureSourceSha256: "1".repeat(64) };
    const runtimeSha256 = hash(JSON.stringify(runtime)), navigationSha256 = hash(`http://localhost:3100${row.route.path}`);
    const proof = { version: 1, routeId: row.route.id, state: row.state, source, runtimeSha256, authorizationSha256: "3".repeat(64),
      currentDataSha256: "4".repeat(64), sessionSha256: "5".repeat(64), navigationSha256, fixtureSourceSha256: runtime.fixtureSourceSha256 };
    const original = { routeId: row.route.id, state: row.state, viewport: row.viewport,
      serviceBinding: { version: 1, port: 3100, runtime, runtimeSha256, appConfigurationSha256: "6".repeat(64) }, registeredPath: row.route.path,
      navigationSha256, screenshotFile: `${hash(densityStateKey(row.route.id, row.state))}__${row.viewport}.png`, screenshotSha256,
      documentSha256: "7".repeat(64), nativeProofBefore: proof, nativeProofAfter: { ...proof }, rawMeasurement: raw, metrics, predecessor: null,
      targetCount: 1, undersizedTargetCount: 0 };
    const capture = { routeId: row.route.id, state: row.state, viewport: row.viewport, measurementPath: row.route.path, metrics, predecessor: null };
    const packet = { version: 1, source, captureEnvironment: environment, measurementModuleSha256: contract.capture.artifacts.measurementModule.sha256,
      computationModuleSha256: contract.capture.artifacts.measurementHarness.sha256, captures: [capture] };
    const result = { version: 1, kind: "density-capture-segment-v1", status: "CAPTURED_SEGMENT_EXTERNAL_CLOSURE_PENDING", selection, source,
      captureEnvironment: environment, fixtureCatalog, packet, requiredCaptureCount: required.length, remainingCaptureCount: required.length - 1,
      captures: 1, originalsSha256: hash(JSON.stringify([original])), targetHolds: [], resumable: false, g2_5Acceptance: false };
    return structuredClone({ result, census, original, screenshotSha256, recomputedPixel: pixel });
  });
  return { register, segments };
}
function check(set: ReturnType<typeof originalSet>) { return validateDensitySegmentUnion({ ...set, source, contract }); }
type PurePart = ReturnType<typeof originalSet>["segments"][number];
function mutate(set: ReturnType<typeof originalSet>, work: (part: PurePart) => void) {
  work(set.segments[0]);
  set.segments[0].result.originalsSha256 = hash(JSON.stringify([set.segments[0].original]));
  return set;
}

describe("explicit one-capture selection and whole source-bound union", () => {
  it("derives all 64 pages/168 states/336 cases and leaves Root closure and G2.5 held", () => {
    const set = originalSet(64), result = check(set);
    expect(set.register.routes).toHaveLength(64); expect(set.segments).toHaveLength(336);
    expect(result.numeric.captures).toBe(336); expect(result.remainingCaptureCount).toBe(0);
    expect(result.resumable).toBe(false); expect(result.g2_5Acceptance).toBe(false);
    expect(result.status).toBe("COMPLETE_SOURCE_BOUND_SEGMENT_UNION_ROOT_CLOSURE_REQUIRED");
  });
  it("accepts exactly one current selection only after complete source-provider preflight", () => {
    const set = originalSet(), keys = [densityStateKey("page-0", "empty"), densityStateKey("page-0", "processing")];
    const plan = densityCapturePlan(set.register, keys);
    expect(checkedDensityCaptureSegment({ routeId: "page-0", state: "empty", viewport: "390x844" }, plan).viewport).toBe("390x844");
    expect(() => checkedDensityCaptureSegment({ routeId: "page-0", state: "empty", viewport: "390x844" }, densityCapturePlan(set.register, keys.slice(0, 1)))).toThrow();
  });
  it.each([null, {}, { routeId: "foreign", state: "empty", viewport: "390x844" }, { routeId: "page-0", state: "foreign", viewport: "390x844" },
    { routeId: "page-0", state: "empty", viewport: "391x844" }, { routeId: "page-0", state: "empty", viewport: "390x844", extra: true }])("refuses unknown/extra selection %#", value => {
    const set = originalSet(), plan = densityCapturePlan(set.register, [densityStateKey("page-0", "empty"), densityStateKey("page-0", "processing")]);
    expect(() => checkedDensityCaptureSegment(value, plan)).toThrow();
  });
  it("refuses accessors and proxies without observing their private values", () => {
    const getter = vi.fn(() => "private"), value = { state: "empty", viewport: "390x844" };
    Object.defineProperty(value, "routeId", { enumerable: true, get: getter });
    const plan = densityCapturePlan(originalSet().register, [densityStateKey("page-0", "empty"), densityStateKey("page-0", "processing")]);
    expect(() => checkedDensityCaptureSegment(value, plan)).toThrow(); expect(getter).not.toHaveBeenCalled();
    const trap = vi.fn(() => []); const proxy = new Proxy({}, { ownKeys: trap });
    expect(() => checkedDensityCaptureSegment(proxy, plan)).toThrow(); expect(trap).not.toHaveBeenCalled();
  });
  it("orders a reversed complete union canonically without deduplicating", () => {
    const set = originalSet(); set.segments.reverse(); const result = check(set);
    expect(result.packet.captures.map(x => x.viewport)).toEqual(["390x844", "1280x800", "390x844", "1280x800"]);
  });
  it("refuses a missing case and a duplicate replacing a different case", () => {
    const missing = originalSet(); missing.segments.pop(); expect(() => check(missing)).toThrow();
    const duplicate = originalSet(); duplicate.segments[1] = structuredClone(duplicate.segments[0]); expect(() => check(duplicate)).toThrow();
  });
  const drifts: [string, (part: PurePart) => void][] = [
    ["result extra key", p => { Object.assign(p.result, { privateValue: "withheld" }); }],
    ["resumable flag", p => { p.result.resumable = true; }], ["acceptance flag", p => { p.result.g2_5Acceptance = true; }],
    ["incomplete census", p => { p.census.states.pop(); }], ["census hold", p => { p.census.holds.push({ routeId: "page-0", state: "empty", reason: "native-state-fixture-missing" }); }],
    ["source head", p => { p.result.source.head = "8".repeat(40); }], ["source tree", p => { p.result.source.tree = "8".repeat(40); }],
    ["environment browser", p => { p.result.packet.captureEnvironment.browserVersion = "changed"; }],
    ["environment font", p => { p.result.packet.captureEnvironment.fontManifestSha256 = "8".repeat(64); }],
    ["measurement source", p => { p.result.packet.measurementModuleSha256 = "8".repeat(64); }],
    ["fixture omitted", p => { p.result.fixtureCatalog.pop(); }], ["fixture source", p => { p.result.fixtureCatalog[0].sourceSha256 = "8".repeat(64); }],
    ["native before/after data", p => { p.original.nativeProofAfter.currentDataSha256 = "8".repeat(64); }],
    ["native session", p => { p.original.nativeProofAfter.sessionSha256 = "8".repeat(64); }],
    ["native navigation", p => { p.original.navigationSha256 = "8".repeat(64); }],
    ["native source", p => { p.original.serviceBinding.runtime.source.head = "8".repeat(40); }],
    ["executable build", p => { p.original.serviceBinding.runtime.buildId = "different-build";
      const digest = hash(JSON.stringify(p.original.serviceBinding.runtime)); p.original.serviceBinding.runtimeSha256 = digest;
      p.original.nativeProofBefore.runtimeSha256 = digest; p.original.nativeProofAfter.runtimeSha256 = digest; }],
    ["PNG bytes", p => { p.screenshotSha256 = "8".repeat(64); }], ["recomputed pixels", p => { p.recomputedPixel.inkPixelCount = 1; }],
    ["omitted pixel field", p => { Reflect.deleteProperty(p.recomputedPixel, "exactGroundRatio"); }],
    ["PNG DOM ground", p => { p.original.rawMeasurement.ground = "wrong"; }],
    ["PNG DOM dimensions", p => { (p.original.rawMeasurement as { innerWidth: number }).innerWidth = 1; }],
    ["DOM original", p => { p.original.rawMeasurement.interactiveElements = 99; }],
    ["real target breach", p => { p.original.undersizedTargetCount = 1; }],
    ["extra capture", p => { p.result.packet.captures.push(structuredClone(p.result.packet.captures[0])); }],
    ["unsupported completion status", p => { p.result.status = "COMPLETE"; }],
    ["original whole hash", p => { p.result.originalsSha256 = "8".repeat(64); }],
  ];
  it.each(drifts)("refuses %s even when the outer original hash is recomputed", (_, change) => {
    const set = originalSet(); mutate(set, change);
    if (_ === "original whole hash") set.segments[0].result.originalsSha256 = "8".repeat(64);
    expect(() => check(set)).toThrow();
  });
  it("keeps default full assertions and the complete original measurement callback", () => {
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
    const driver = fs.readFileSync(path.join(root, "e2e/helpers/density-current-capture.ts"), "utf8");
    for (const assertion of ["Complete current capture census required", "Current native density state proof required",
      "Actual state changed during density capture", "Actual fixture must yield once and settle unchanged"])
      expect(driver + fs.readFileSync(path.join(root, "scripts/density-capture-plan.ts"), "utf8")).toContain(assertion);
    expect(driver).toContain("if (selection)"); expect(driver).toContain("verifyCurrentDensity(packet, register, contract, source)");
    expect(driver).toContain("resumable: false, g2_5Acceptance: false");
  });
});

import { DENSITY_CORRECTED_READINGS_MODULE_SHA256, TEXT_ONLY_FLOOR_VARIANT_SHA256 } from "./density-current";

describe("the corrected readings and text-only floor in the segment union (owner decision 2026-10-22)", () => {
  function corrected(set: ReturnType<typeof originalSet>) {
    for (const part of set.segments) {
      const pixel = part.recomputedPixel;
      const textOnlyFloor = { variantSha256: TEXT_ONLY_FLOOR_VARIANT_SHA256, screenshotSha256: hash(`floor ${part.screenshotSha256}`),
        screenshotWidthPx: pixel.screenshotWidthPx, screenshotHeightPx: pixel.screenshotHeightPx,
        includedPixelCount: pixel.includedPixelCount, excludedPixelCount: pixel.excludedPixelCount, inkPixelCount: 0, inkCoverageRatio: 0 };
      const correctedReadings = { moduleSha256: DENSITY_CORRECTED_READINGS_MODULE_SHA256, proseParagraphCount: 0,
        excludedOneLineLinkParagraphCount: 0, minProseParagraphMeasureCh: null, topLevelSectionRowCount: 0,
        minimumVisualSectionGapPx: null, aboveFoldTextCharacterCount: 1 };
      Object.assign(part.original, { textOnlyFloor, correctedReadings });
      Object.assign(part.result.packet.captures[0], { textOnlyFloor: structuredClone(textOnlyFloor), correctedReadings: structuredClone(correctedReadings) });
      Object.assign(part, { recomputedFloorPixel: { ...pixel, screenshotSha256: textOnlyFloor.screenshotSha256 } });
      part.result.originalsSha256 = hash(JSON.stringify([part.original]));
    }
    return set;
  }
  it("binds the corrected verdict and keeps the contract verdict beside it", () => {
    const result = check(corrected(originalSet()));
    expect(result.numeric.rules).toBe("corrected-2026-10-22");
    expect(result.contractNumeric).toMatchObject({ status: "WITHIN_NUMERIC_BUDGETS", rules: "contract" });
    expect(result.g2_5Acceptance).toBe(false);
  });
  const plants: [string, (part: PurePart & { recomputedFloorPixel?: Record<string, unknown> }) => void][] = [
    ["a floor without its readings", p => { Reflect.deleteProperty(p.original, "correctedReadings"); }],
    ["a recomputed floor that differs from the original", p => { p.recomputedFloorPixel!.inkPixelCount = 1; }],
    ["a floor from another variant", p => { (p.original as unknown as { textOnlyFloor: { variantSha256: string } }).textOnlyFloor.variantSha256 = "8".repeat(64); }],
    ["readings in the packet that the original does not carry", p => {
      Reflect.deleteProperty(p.original, "correctedReadings"); Reflect.deleteProperty(p.original, "textOnlyFloor");
      Reflect.deleteProperty(p, "recomputedFloorPixel"); }],
  ];
  it.each(plants)("planted defect: refuses %s", (_, change) => {
    const set = corrected(originalSet()); mutate(set, change as (part: PurePart) => void);
    expect(() => check(set)).toThrow();
  });
});
