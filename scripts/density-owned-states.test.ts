import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { densityCapturePlan, densityStateKey } from "./density-capture-plan";
import { OWNED_DENSITY_STATES, ownedDensityRecipe } from "./density-owned-states";
import type { DensityRegister } from "./density-current";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (name: string) => readFileSync(path.join(root, name), "utf8");
const register = JSON.parse(read("docs/route-register.json")) as DensityRegister;
const states = densityCapturePlan(register, []).states;

describe("real owned density state coverage", () => {
  it("requires every declared recipe to be an applicable current registered pair", () => {
    const declared = Object.entries(OWNED_DENSITY_STATES).flatMap(([id, rows]) =>
      Object.keys(rows).map(state => densityStateKey(id, state)));
    const actual = states.filter(row => ownedDensityRecipe(row) !== null)
      .map(row => densityStateKey(row.route.id, row.state));
    expect(new Set(declared).size).toBe(declared.length);
    expect(new Set(actual)).toEqual(new Set(declared));
    expect(actual).toHaveLength(31);
  });

  it("does not inherit a recipe from a matching state name or composed new route", () => {
    const row = states.find(row => row.route.id === "app.overview" && row.state === "empty")!;
    expect(ownedDensityRecipe({ ...row, state: "complete" })).toBeNull();
    expect(ownedDensityRecipe({ ...row, route: { ...row.route, id: "composition.new-page" } })).toBeNull();
    expect(ownedDensityRecipe({ ...row, route: { ...row.route, id: "constructor" } })).toBeNull();
  });

  it("leaves genuinely missing native fixtures explicitly held, including an omitted People provider", () => {
    const provided = states.filter(row => ownedDensityRecipe(row)).map(row => densityStateKey(row.route.id, row.state));
    const plan = densityCapturePlan(register, provided);
    expect(plan.status).toBe("HOLD_CURRENT_DENSITY_FIXTURES");
    expect(plan.holds).not.toContainEqual({ routeId: "settings.people", state: null, reason: "no-registered-measurable-state" });
    const omitted = densityCapturePlan(register, provided.filter(key => key !== densityStateKey("settings.people", "not-built")));
    expect(omitted.status).toBe("HOLD_CURRENT_DENSITY_FIXTURES");
    expect(omitted.holds).toContainEqual({ routeId: "settings.people", state: "not-built", reason: "native-state-fixture-missing" });
    expect(plan.holds).toContainEqual({ routeId: "family.person", state: "complete", reason: "native-state-fixture-missing" });
    expect(plan.holds).toContainEqual({ routeId: "embryos.detail", state: "complete", reason: "native-state-fixture-missing" });
  });

  it("requires the exact authenticated People render and keeps its historical feature states unavailable", () => {
    const row = states.find(value => value.route.id === "settings.people" && value.state === "not-built")!;
    expect(ownedDensityRecipe(row)).toBe("people-not-built");
    for (const state of ["empty", "processing", "complete", "jurisdiction-unavailable"])
      expect(ownedDensityRecipe({ ...row, state })).toBeNull();
    for (const route of [{ ...row.route, path: "/settings" }, { ...row.route, auth: "public" },
      { ...row.route, stateProfile: "account-management" }])
      expect(ownedDensityRecipe({ ...row, route })).toBeNull();
    const source = read("e2e/helpers/density-owned-state-fixtures.ts");
    for (const fragment of ["await auth.auth.getClaims()", "claims.sub === accountId", "claims.session_id",
      "claims.exp * 1000 > Date.now()", "await auth.auth.getUser()", "current.data.user?.id === accountId",
      "Actual People session cannot rotate", "await peopleSession() === originalPeopleSession",
      "sessionId: await peopleSession()", "Reviewed actual People provider source changed",
      'expect(facts, "Opening People does not make any account, consent, file, sharing or operation record").toEqual(native)',
      'main [role="status"][data-slot="not-built"]', "People and relationships", "Not built yet",
      "No law and nothing about you is holding it back", 'name: "Go back", exact: true',
      'if (recipe === "people-not-built") await observe()']) expect(source).toContain(fragment);
    expect(source).not.toMatch(/\.fulfill\(|\.abort\(|\.setContent\(|\.addInitScript\(/u);
  });

  it("uses existing upload and consent contracts and settles the exact original request", () => {
    const source = read("e2e/helpers/density-owned-state-fixtures.ts");
    for (const contract of ["await createConfirmedUser(email, password)", "await signIn(holder, email, password)",
      "await uploadOwnFileThroughUi(holder,", "await uploadOwnFilePrepared(holder,", "await completeOwnUploadConsent(holder)",
      "await route.continue()", "await response.finished() === null", "if (continuation) await continuation",
      "await grantCloudConsent(holder)", "return input.observeState(row, capturedPage, sourceSha256,"])
      expect(source).toContain(contract);
    expect(source).not.toMatch(/\.fulfill\(|\.abort\(|\.setContent\(|\.addInitScript\(/u);
    expect(source).not.toMatch(/\.from\([^)]*\)\.(?:insert|update|upsert)\(/u);
  });

  it("requires complete actor rows, native absence and measured timing rather than labels alone", () => {
    const source = read("e2e/helpers/density-owned-state-fixtures.ts");
    expect(source).toContain('select("*", { count: "exact" })');
    expect(source).toContain("expect(result.data!.length).toBe(result.count)");
    expect(source).toContain('"family_grants_given", "directional_grants_received", "family_sharing_pauses"');
    expect(source).toContain('adminClient().rpc("processing_time_stats")');
    expect(source).toContain("timing.n >= 20");
    expect(source).toContain("expect(native.purpose_grants).toEqual([])");
    expect(source).toContain("expect(native.account_deletion_requests).toEqual([])");
    expect(source).toContain("expect(native.account_operation_nonces).toEqual([])");
  });
});
