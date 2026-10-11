import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { densityCapturePlan, densityStateKey } from "./density-capture-plan";
import { COHORT_ENTRY_DENSITY_STATES, cohortEntryDensityRecipe } from "./density-cohort-entry-states";
import { ownedDensityRecipe } from "./density-owned-states";
import { familyDensityRecipe } from "./density-family-states";
import { reportDensityRecipe } from "./density-report-states";
import type { DensityRegister } from "./density-current";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (name: string) => readFileSync(path.join(root, name), "utf8");
const register = JSON.parse(read("docs/route-register.json")) as DensityRegister;
const states = densityCapturePlan(register, []).states;

describe("native fresh-account cohort entry density", () => {
  it("adds exactly three distinct current applicable pairs without borrowing result states", () => {
    const declared = Object.entries(COHORT_ENTRY_DENSITY_STATES).flatMap(([id, rows]) => Object.keys(rows)
      .map(state => densityStateKey(id, state)));
    const actual = states.filter(row => cohortEntryDensityRecipe(row));
    expect(actual).toHaveLength(3);
    expect(new Set(actual.map(row => densityStateKey(row.route.id, row.state)))).toEqual(new Set(declared));
    expect(actual.every(row => !ownedDensityRecipe(row) && !familyDensityRecipe(row) && !reportDensityRecipe(row))).toBe(true);
  });
  it("keeps advanced native cohorts and new composed pages held", () => {
    const row = states.find(row => row.route.id === "embryos.index" && row.state === "empty")!;
    for (const state of ["complete", "processing", "not-covered", "partial-coverage"])
      expect(cohortEntryDensityRecipe({ ...row, state })).toBeNull();
    expect(cohortEntryDensityRecipe({ ...row, route: { ...row.route, id: "embryos.new-page" } })).toBeNull();
    expect(cohortEntryDensityRecipe({ ...row, route: { ...row.route, id: "constructor" } })).toBeNull();
    expect(densityCapturePlan(register, states.filter(cohortEntryDensityRecipe)
      .map(row => densityStateKey(row.route.id, row.state))).holds)
      .toContainEqual({ routeId: "embryos.detail", state: "complete", reason: "native-state-fixture-missing" });
  });
  it("uses real account sessions and complete native absence without inserted cohort status", () => {
    const source = read("e2e/helpers/density-cohort-entry-state-fixtures.ts");
    for (const text of ["await createConfirmedUser(email, password)", "await signIn(page, email, password)",
      'select("*", { count: "exact" })', "expect(result.data!.length).toBe(result.count)",
      '"memberships"', '"analysis_grants"', "expect(nativeSnapshot,", ".toEqual(before)", "expect(apiWrites,"])
      expect(source).toContain(text);
    expect(source).not.toMatch(/\.fulfill\(|\.abort\(|\.setContent\(|\.addInitScript\(|\.listen\(/u);
    expect(source).not.toMatch(/\.from\([^)]*\)\.(?:insert|update|upsert)\(/u);
  });
  it("does not count the waived upload attestation render as an applicable consent pair", () => {
    const row = states.find(row => row.route.id === "embryos.index" && row.state === "empty")!;
    const route = register.routes.find(route => route.id === "embryos.upload")!;
    expect(route.notApplicableStates).toHaveProperty("consent-required");
    expect(cohortEntryDensityRecipe({ ...row, route, state: "consent-required" })).toBeNull();
    expect(states.some(state => state.route.id === route.id && state.state === "consent-required")).toBe(false);
  });
  it("retains the whole letter, no-record disclosure and no numeric result assertions", () => {
    const source = read("e2e/helpers/density-cohort-entry-state-fixtures.ts");
    for (const text of ["toHaveText(LETTER)", "toHaveText(FORMATS_SENTENCE)", "toHaveText(NEXT_STEP_SENTENCE)",
      "innerText()).not.toMatch", "[data-figure-kind]", "[data-slot=\"qc-table\"]", "await capture({ page, observe })"])
      expect(source).toContain(text);
  });
});
