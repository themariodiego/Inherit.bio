import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { checkedDensityStateProof, densityCapturePlan, densityRouteMatches, densityRuntimeSchema,
  densityStateKey, type DensitySource } from "./density-capture-plan";
import type { DensityRegister } from "./density-current";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const register = JSON.parse(readFileSync(path.join(root, "docs/route-register.json"), "utf8")) as DensityRegister;
const source: DensitySource = { head: "a".repeat(40), tree: "b".repeat(40), registerSha256: "c".repeat(64) };
const base = () => ({ routes: [{ id: "page", path: "/page", kind: "page", surface: "standard", stateProfile: "result" }],
  stateProfiles: { result: { supported: ["empty", "processing", "complete"] } } });
const keys = ["empty", "processing", "complete"].map(state => densityStateKey("page", state));

describe("complete current density capture inventory", () => {
  it("derives every actual page and every applicable state at both fixed viewports", () => {
    const actual = densityCapturePlan(register, []);
    const pages = register.routes.filter(row => row.kind === "page");
    const stateCount = pages.reduce((sum, row) => sum + register.stateProfiles[row.stateProfile!].supported
      .filter(state => !Object.hasOwn(row.notApplicableStates ?? {}, state)).length, 0);
    expect(actual.pages.map(row => row.id)).toEqual(pages.map(row => row.id));
    expect(actual.states).toHaveLength(stateCount);
    expect(actual.requiredCaptureCount).toBe(stateCount * 2);
    expect(actual.holds.filter(row => row.reason === "native-state-fixture-missing")).toHaveLength(stateCount);
    expect(actual.status).toBe("HOLD_CURRENT_DENSITY_FIXTURES");
  });

  it("adds a newly composed page automatically without a 62/63 whitelist", () => {
    const before = densityCapturePlan(register, []);
    const composed = structuredClone(register);
    composed.routes.push({ id: "composition.new-page", path: "/new-page", kind: "page",
      surface: "reading", stateProfile: "static-document" });
    const after = densityCapturePlan(composed, []);
    expect(after.pages).toHaveLength(before.pages.length + 1);
    expect(after.requiredCaptureCount).toBe(before.requiredCaptureCount + 2);
    expect(after.holds).toContainEqual({ routeId: "composition.new-page", state: "complete", reason: "native-state-fixture-missing" });
  });

  it("does not count the old selected 22 paths as complete current capture", () => {
    const full = densityCapturePlan(register, []);
    const oldSelection = full.states.slice(0, 22).map(row => densityStateKey(row.route.id, row.state));
    expect(densityCapturePlan(register, oldSelection).status).toBe("HOLD_CURRENT_DENSITY_FIXTURES");
    expect(full.states.length).toBeGreaterThan(oldSelection.length);
  });

  it("requires a separate real fixture for every transient state", () => {
    const result = densityCapturePlan(base(), keys.filter(key => key !== densityStateKey("page", "processing")));
    expect(result.holds).toEqual([{ routeId: "page", state: "processing", reason: "native-state-fixture-missing" }]);
    expect(result.requiredCaptureCount).toBe(6);
  });

  it("keeps an entirely waived route visible as a hold, not a density exclusion", () => {
    const input: DensityRegister = base();
    input.routes[0].notApplicableStates = Object.fromEntries(["empty", "processing", "complete"].map(key => [key, "Existing owner declaration."]));
    const result = densityCapturePlan(input, []);
    expect(result.pages).toHaveLength(1);
    expect(result.states).toHaveLength(0);
    expect(result.status).toBe("HOLD_CURRENT_DENSITY_FIXTURES");
    expect(result.holds).toEqual([{ routeId: "page", state: null, reason: "no-registered-measurable-state" }]);
  });

  it("does not change an existing named state waiver", () => {
    const input: DensityRegister = base();
    input.routes[0].notApplicableStates = { empty: "Existing signed decision." };
    const before = structuredClone(input);
    const result = densityCapturePlan(input, keys.slice(1));
    expect(result.states.map(row => row.state)).toEqual(["processing", "complete"]);
    expect(result.requiredCaptureCount).toBe(4);
    expect(result.status).toBe("READY_FOR_ACTUAL_CAPTURE");
    expect(input).toEqual(before);
  });

  it.each(["blank-reason", "unknown-state", "missing-profile", "duplicate-state", "unknown-surface"])(
    "refuses %s in the live register", fault => {
      const input: DensityRegister = base();
      if (fault === "blank-reason") input.routes[0].notApplicableStates = { empty: " " };
      if (fault === "unknown-state") input.routes[0].notApplicableStates = { invented: "Not a declared state." };
      if (fault === "missing-profile") input.routes[0].stateProfile = "missing";
      if (fault === "duplicate-state") input.stateProfiles.result.supported.push("empty");
      if (fault === "unknown-surface") input.routes[0].surface = "invented";
      expect(() => densityCapturePlan(input, [])).toThrow();
    });

  it("refuses duplicate pages, duplicate providers and providers outside the current census", () => {
    const duplicate = base(); duplicate.routes.push({ ...duplicate.routes[0] });
    expect(() => densityCapturePlan(duplicate, [])).toThrow();
    expect(() => densityCapturePlan(base(), [...keys, keys[0]])).toThrow();
    expect(() => densityCapturePlan(base(), [...keys, densityStateKey("old-page", "complete")])).toThrow();
  });
});

describe("actual density route and native state correspondence", () => {
  const row = { route: base().routes[0], state: "processing" };
  const expected = { row, source, runtimeSha256: "d".repeat(64), navigationSha256: "e".repeat(64), fixtureSourceSha256: "f".repeat(64) };
  const proof = () => ({ version: 1, routeId: "page", state: "processing", source,
    runtimeSha256: expected.runtimeSha256, navigationSha256: expected.navigationSha256,
    fixtureSourceSha256: expected.fixtureSourceSha256, authorizationSha256: "1".repeat(64),
    currentDataSha256: "2".repeat(64), sessionSha256: "3".repeat(64) });
  it("binds the complete state proof to route, state, source, runtime, navigation and fixture source", () => {
    expect(checkedDensityStateProof(proof(), expected)).toEqual(proof());
  });
  it.each(["route", "state", "source", "runtime", "navigation", "fixture", "missing-authority", "extra"])(
    "refuses a %s mismatch rather than treating the UI as proof", fault => {
      const value: Record<string, unknown> = proof();
      if (fault === "route") value.routeId = "other";
      if (fault === "state") value.state = "complete";
      if (fault === "source") value.source = { ...source, tree: "0".repeat(40) };
      if (fault === "runtime") value.runtimeSha256 = "0".repeat(64);
      if (fault === "navigation") value.navigationSha256 = "0".repeat(64);
      if (fault === "fixture") value.fixtureSourceSha256 = "0".repeat(64);
      if (fault === "missing-authority") delete value.authorizationSha256;
      if (fault === "extra") value.fakeDOM = true;
      expect(() => checkedDensityStateProof(value, expected)).toThrow();
    });
  it("does not accept production as disposable runtime admission", () => {
    const runtime = { version: 1, scope: "disposable-synthetic-native", source,
      appOrigin: "http://localhost:3100", buildId: "actual-build",
      ownerNonce: "8d0e1e5e-3a97-4e07-9bae-e625a9e99bcd", bootId: "ed534c7b-b7cd-4808-9829-b2dc444b4878",
      systemIdentifier: "123456789", databaseOid: 5, databaseName: "postgres",
      daemonSha256: "a".repeat(64), fixtureSourceSha256: "b".repeat(64) };
    expect(densityRuntimeSchema.parse(runtime)).toEqual(runtime);
    expect(() => densityRuntimeSchema.parse({ ...runtime, scope: "production" })).toThrow();
    for (const appOrigin of ["http://example.com:3100", "http://localhost:3100/path", "http://user@localhost:3100", "https://localhost:3100"])
      expect(() => densityRuntimeSchema.parse({ ...runtime, appOrigin })).toThrow();
  });
  it("matches real dynamic paths and retains legitimate query inputs in the live URL", () => {
    expect(densityRouteMatches("/genome/[subject]/data/browser", "http://localhost:3100/genome/me/data/browser?q=rs762551", "http://localhost:3100")).toBe(true);
    expect(densityRouteMatches("/legal/[artifact]/diff/[from]/[to]", "/legal/consent.own-polygenic/diff/1/2", "http://localhost:3100")).toBe(true);
  });
  it.each(["http://example.com/page", "/page#wrong", "/page/extra", "/%70age", "//example.com/page"])(
    "refuses wrong live navigation %s", navigation => {
      expect(densityRouteMatches("/page", navigation, "http://localhost:3100")).toBe(false);
    });
});
