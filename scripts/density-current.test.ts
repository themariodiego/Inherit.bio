import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { densityCapturePlan, densityStateKey } from "./density-capture-plan";
import { requiredDensityCaptures, verifyCurrentDensity, type DensityContract,
  type DensityCurrentPacket, type DensityRegister } from "./density-current";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const registerBytes = readFileSync(path.join(root, "docs/route-register.json"));
const register = JSON.parse(registerBytes.toString()) as DensityRegister;
const contract = JSON.parse(readFileSync(path.join(root, "docs/density-baseline.json"), "utf8")) as DensityContract;
const source = { head: "1".repeat(40), tree: "2".repeat(40),
  registerSha256: createHash("sha256").update(registerBytes).digest("hex") };
const environment: DensityCurrentPacket["captureEnvironment"] = {
  browserName: "chromium", browserVersion: "synthetic-unit-only", platform: "synthetic-unit-only",
  fontManifestSha256: "3".repeat(64), theme: "light", devicePixelRatio: 1, locale: "en-US", timezone: "UTC",
};
// These are invented unit measurements, never captured pixels or acceptance.
function fixture(): DensityCurrentPacket {
  return { version: 1, source, captureEnvironment: { ...environment },
    measurementModuleSha256: contract.capture.artifacts.measurementModule.sha256,
    computationModuleSha256: contract.capture.artifacts.measurementHarness.sha256,
    captures: requiredDensityCaptures(register).map(({ route, state, viewport }) => {
      const [width, height] = viewport.split("x").map(Number);
      const predecessor = contract.relativeComparison.routes.find((entry) => entry.successorRouteId === route.id);
      const baseline = contract.routes.find((entry) => entry.route === predecessor?.baselineRoute);
      const sameState = baseline?.state === state || (route.stateProfile === "auth-density-flow" && state === "initial-form" && baseline?.state === "empty");
      const authHeadings: Record<string, string> = { "auth.sign-in": "Welcome back", "auth.sign-up": "Create your account",
        "auth.forgot-password": "Reset your password", "auth.reset-password": "Choose a new password" };
      return { routeId: route.id, state, viewport,
        measurementPath: route.path.replace(/\[[^\]]+\]/gu, "synthetic-unit"),
        metrics: { screenshotSha256: "4".repeat(64), screenshotWidthPx: width, screenshotHeightPx: height,
          includedPixelCount: width * height, excludedPixelCount: 0, inkPixelCount: width * height / 10,
          inkCoverageRatio: 0.1, whiteSpaceRatio: 0.9, interactiveElementCount: 1, rawInteractiveElementCount: 1,
          rawDecoratedElementCount: 2, budgetedDecoratedElementCount: 2, visibleTextCharacterCount: 200,
          statusView: authHeadings[route.id] ?? "Synthetic unit-only complete view",
          proseElementCount: 1, maxProseMeasureCh: 60, minProseMeasureCh: width === 390 ? 30 : 50,
          topLevelSectionCount: 1, minimumAdjacentSectionGapPx: null, primaryContentLeftPaddingPx: 24,
          primaryClaimTextElementCount: 2, primaryClaimFigureCount: 0, horizontalScroll: false, horizontalOverflowPx: 0 },
        predecessor: predecessor && sameState && !["/ancestry", "/reports", "/dashboard"].includes(predecessor.baselineRoute)
          ? { baselineCommit: contract.baseline.commitSha as "864736979c92a08ba77e8580d61946eba6864918",
            baselineRoute: predecessor.baselineRoute, state: baseline!.state, captureEnvironment: { ...environment },
            screenshotSha256: "5".repeat(64), inkCoverageRatio: 0.2 } : null };
    }) };
}
const verify = (packet: unknown) => verifyCurrentDensity(packet, register, contract, source);

describe("current density inventory and unchanged numeric ceilings", () => {
  it("preserves the original zero-state People refusal instead of weakening the census", () => {
    const previous = structuredClone(register);
    previous.routes.find(row => row.id === "settings.people")!.stateProfile = "account-management";
    expect(() => requiredDensityCaptures(previous)).toThrow("No applicable density state: settings.people");
    expect(densityCapturePlan(previous, []).holds).toContainEqual({ routeId: "settings.people", state: null,
      reason: "no-registered-measurable-state" });
  });
  it("requires both People not-built captures and holds when its real provider is missing", () => {
    const required = requiredDensityCaptures(register);
    expect(required.filter(row => row.route.id === "settings.people").map(row => [row.state, row.viewport]))
      .toEqual([["not-built", "390x844"], ["not-built", "1280x800"]]);
    const packet = fixture(); packet.captures = packet.captures.filter(row => row.routeId !== "settings.people");
    expect(() => verify(packet)).toThrow(/Missing density captures/u);
    const keys = [...new Set(required.filter(row => row.route.id !== "settings.people")
      .map(row => densityStateKey(row.route.id, row.state)))];
    const plan = densityCapturePlan(register, keys);
    expect(plan.status).toBe("HOLD_CURRENT_DENSITY_FIXTURES");
    expect(plan.holds).toEqual([{ routeId: "settings.people", state: "not-built", reason: "native-state-fixture-missing" }]);
  });
  it("preserves every historical People waiver and does not call the feature complete", () => {
    const people = register.routes.find(row => row.id === "settings.people")!;
    expect(people.stateProfile).toBe("settings-unbuilt-render");
    expect(people.notApplicableStates).toEqual({
      empty: "The route renders FeatureNotBuilt unconditionally. Corrections item 8, signed 2026-09-13.",
      processing: "The route performs no request. Corrections item 8, signed 2026-09-13.",
      complete: "A page that is not built has no complete state; the route renders FeatureNotBuilt and nothing else. Corrections item 10, signed 2026-09-13.",
    });
    expect(register.stateProfiles[people.stateProfile!].supported)
      .toEqual(["empty", "processing", "complete", "not-built"]);
  });
  it("keeps all four true auth initial forms and the original eight predecessor comparisons", () => {
    const required = requiredDensityCaptures(register).filter(row => row.state === "initial-form");
    expect(required.map(row => [row.route.id, row.viewport])).toEqual([
      ["auth.sign-in", "390x844"], ["auth.sign-in", "1280x800"],
      ["auth.sign-up", "390x844"], ["auth.sign-up", "1280x800"],
      ["auth.forgot-password", "390x844"], ["auth.forgot-password", "1280x800"],
      ["auth.reset-password", "390x844"], ["auth.reset-password", "1280x800"],
    ]);
    const packet = fixture();
    const auth = packet.captures.filter(row => row.routeId.startsWith("auth."));
    expect(auth.filter(row => row.predecessor).every(row => row.state === "initial-form")).toBe(true);
    expect(auth.filter(row => row.state === "processing" || row.state === "complete").every(row => row.predecessor === null)).toBe(true);
    for (const row of auth.filter(row => row.state === "initial-form")) {
      const changed = structuredClone(packet);
      changed.captures.find(value => value.routeId === row.routeId && value.state === row.state && value.viewport === row.viewport)!.predecessor = null;
      expect(() => verify(changed)).toThrow(/Missing comparable predecessor/u);
    }
    for (const id of ["auth.sign-in", "auth.reset-password"]) {
      const route = register.routes.find(row => row.id === id)!;
      expect(route.notApplicableStates?.complete).toContain("Corrections item 10, signed 2026-09-13.");
      expect(requiredDensityCaptures(register).some(row => row.route.id === id && row.state === "complete")).toBe(false);
    }
  });
  it("keeps predecessor environments independent from the current capture and each other", () => {
    const packet = structuredClone(fixture());
    const rows = packet.captures.filter(row => row.predecessor);
    expect(rows[0].predecessor!.captureEnvironment).not.toBe(packet.captureEnvironment);
    expect(rows[0].predecessor!.captureEnvironment).not.toBe(rows[1].predecessor!.captureEnvironment);
    rows[0].predecessor!.captureEnvironment.platform = "different-platform";
    expect(packet.captureEnvironment.platform).toBe("synthetic-unit-only");
    expect(rows[1].predecessor!.captureEnvironment.platform).toBe("synthetic-unit-only");
    expect(() => verify(packet)).toThrow(/Missing comparable predecessor/u);
  });
  it("requires both viewports for every applicable registered page/state, including newer pages", () => {
    const result = verify(fixture());
    expect(result.pageRoutes).toBe(register.routes.filter((row) => row.kind === "page").length);
    expect(result.pageRoutes).toBeGreaterThan(22);
    expect(result.captures).toBe(requiredDensityCaptures(register).length);
    expect(result.g2_5Acceptance).toBe(false);
    expect(fixture().captures.filter((row) => row.routeId.startsWith("auth.") && row.predecessor)).toHaveLength(8);
  });
  it("refuses a missing route, state or viewport instead of passing the frozen 22-route subset", () => {
    const packet = fixture(); packet.captures.pop();
    expect(() => verify(packet)).toThrow(/Missing density captures/u);
  });
  it("refuses duplicate captures even when the overall count is correct", () => {
    const packet = fixture(); packet.captures[1] = packet.captures[0];
    expect(() => verify(packet)).toThrow(/duplicate/u);
  });
  it.each(["head", "tree", "registerSha256"] as const)("refuses a stale %s", (field) => {
    const packet = structuredClone(fixture()); packet.source[field] = "6".repeat(field === "registerSha256" ? 64 : 40);
    expect(() => verify(packet)).toThrow(/Stale density source/u);
  });
  it.each(["measurementModuleSha256", "computationModuleSha256"] as const)("refuses changed %s", (field) => {
    const packet = fixture(); packet[field] = "7".repeat(64);
    expect(() => verify(packet)).toThrow(/measurement module changed/u);
  });
  it("refuses the wrong concrete route or query-string substitute", () => {
    const packet = fixture(); packet.captures[0].measurementPath = "/?empty=1";
    expect(() => verify(packet)).toThrow(/Wrong density route/u);
  });
  it("refuses inconsistent ink counts, rather than trusting a favourable ratio", () => {
    const packet = fixture(); packet.captures[0].metrics.inkCoverageRatio = 0;
    expect(() => verify(packet)).toThrow(/Inconsistent/u);
  });
  it("refuses nonfinite measurements and a noncanonical DPR", () => {
    const packet = fixture(); packet.captures[0].metrics.inkCoverageRatio = Number.NaN;
    expect(() => verify(packet)).toThrow();
    expect(() => verify({ ...fixture(), captureEnvironment: { ...environment, devicePixelRatio: 2 } })).toThrow();
  });
  it("refuses missing geometry when prose exists", () => {
    const packet = fixture(); packet.captures[0].metrics.maxProseMeasureCh = null;
    expect(() => verify(packet)).toThrow(/Missing density geometry/u);
  });
  it("refuses missing or differently rendered predecessors, including auth", () => {
    const packet = structuredClone(fixture());
    const auth = packet.captures.find((row) => row.routeId === "auth.sign-up" && row.state === "initial-form")!;
    auth.predecessor!.captureEnvironment.platform = "different-platform";
    expect(() => verify(packet)).toThrow(/Missing comparable predecessor/u);
    auth.predecessor = null;
    expect(() => verify(packet)).toThrow(/Missing comparable predecessor/u);
  });
  it("applies absolute budgets to the three historically invented predecessors without inventing ratios", () => {
    const packet = fixture();
    const ancestry = packet.captures.find((row) => row.routeId === "genome.ancestry" && row.state === "complete");
    // Resolve from the actual map, so a renamed route cannot silently vanish.
    const id = contract.relativeComparison.routes.find((row) => row.baselineRoute === "/ancestry")!.successorRouteId;
    const row = ancestry ?? packet.captures.find((entry) => entry.routeId === id && entry.state === "complete")!;
    expect(row.predecessor).toBeNull(); row.metrics.visibleTextCharacterCount = 701;
    expect(() => verify(packet)).toThrow(/Density budget exceeded/u);
  });
  it("refuses even a small breach of the exact 60% relative ceiling", () => {
    const packet = fixture(); const row = packet.captures.find((entry) => entry.predecessor)!;
    row.predecessor!.inkCoverageRatio = 0.166666;
    expect(() => verify(packet)).toThrow(/Relative density budget exceeded/u);
  });
  it("refuses a smaller post-submit auth receipt substituted for its initial form", () => {
    const packet = fixture(); const row = packet.captures.find((entry) => entry.routeId === "auth.sign-up" && entry.state === "initial-form")!;
    row.metrics.statusView = "Check your email";
    expect(() => verify(packet)).toThrow(/cannot replace the initial form/u);
  });
  it.each(["hub", "wide-data"])("keeps the %s white-space floor", (surface) => {
    const packet = fixture();
    const route = register.routes.find((entry) => entry.kind === "page" && entry.surface === surface)!;
    const row = packet.captures.find((entry) => entry.routeId === route.id)!;
    const ink = surface === "hub" ? 0.4 : 0.6;
    row.metrics.inkPixelCount = row.metrics.includedPixelCount * ink;
    row.metrics.inkCoverageRatio = ink; row.metrics.whiteSpaceRatio = Number((1 - ink).toFixed(6));
    expect(() => verify(packet)).toThrow(/Density budget exceeded/u);
  });
  it("keeps the desktop prose floor and mobile adjacent-section gap", () => {
    const packet = fixture(); const desktop = packet.captures.find((entry) => entry.viewport === "1280x800")!;
    desktop.metrics.minProseMeasureCh = 44;
    expect(() => verify(packet)).toThrow(/Density budget exceeded/u);
    const other = fixture(); const mobile = other.captures.find((entry) => entry.viewport === "390x844")!;
    mobile.metrics.topLevelSectionCount = 2; mobile.metrics.minimumAdjacentSectionGapPx = 63;
    expect(() => verify(other)).toThrow(/Density budget exceeded/u);
  });
  it.each([
    ["visibleTextCharacterCount", 701], ["budgetedDecoratedElementCount", 41],
    ["maxProseMeasureCh", 69], ["primaryContentLeftPaddingPx", 23],
    ["primaryClaimTextElementCount", 8], ["primaryClaimFigureCount", 2],
  ] as const)("refuses over-budget %s without hiding accuracy text", (field, value) => {
    const packet = fixture(); const row = packet.captures.find((entry) => entry.viewport === "390x844")!;
    row.metrics[field] = value;
    if (field === "budgetedDecoratedElementCount") row.metrics.rawDecoratedElementCount = value;
    expect(() => verify(packet)).toThrow(/Density budget exceeded/u);
  });
  it("refuses an eighth action on a single-purpose auth step", () => {
    const packet = fixture(); const row = packet.captures.find((entry) => entry.routeId === "auth.sign-in")!;
    row.metrics.interactiveElementCount = 8; row.metrics.rawInteractiveElementCount = 8;
    expect(() => verify(packet)).toThrow(/Density budget exceeded/u);
  });
  it("the portable verifier changes only the temporary directory and preserves every frozen check", () => {
    const original = readFileSync(path.join(root, "scripts/density-baseline/verify.mjs"), "utf8");
    const portable = readFileSync(path.join(root, "scripts/density-baseline/verify-portable.mjs"), "utf8");
    expect(portable.replace("    os.tmpdir(),", '    "/private/tmp",')).toBe(original);
    expect(createHash("sha256").update(original).digest("hex"))
      .toBe("03228fc160c5f0afb917953cfd3b97f014919d9fb8203acd4cce7523adc17aa5");
  });
});
