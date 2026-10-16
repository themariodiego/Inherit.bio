import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { densityCapturePlan, densityStateKey } from "./density-capture-plan";
import { FAMILY_DENSITY_STATES, familyDensityRecipe } from "./density-family-states";
import { ownedDensityRecipe } from "./density-owned-states";
import type { DensityRegister } from "./density-current";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (name: string) => readFileSync(path.join(root, name), "utf8");
const register = JSON.parse(read("docs/route-register.json")) as DensityRegister;
const states = densityCapturePlan(register, []).states;

describe("real paired Family density providers", () => {
  it("provides twenty-one distinct applicable pairs without borrowing an owned-state fixture", () => {
    const declared = Object.entries(FAMILY_DENSITY_STATES).flatMap(([id, rows]) => Object.keys(rows)
      .map(state => densityStateKey(id, state)));
    const actual = states.filter(row => familyDensityRecipe(row));
    expect(new Set(actual.map(row => densityStateKey(row.route.id, row.state)))).toEqual(new Set(declared));
    expect(actual).toHaveLength(21);
    expect(actual.every(row => ownedDensityRecipe(row) === null)).toBe(true);
  });
  it("keeps unavailable Portrait, health-picture and new composed states held", () => {
    for (const id of ["family.health-picture", "family.portrait", "composition.new-page"])
      expect(familyDensityRecipe({ route: { id, path: "/unknown", kind: "page", surface: "standard" }, state: "complete" })).toBeNull();
    const row = states.find(row => row.route.id === "family.person")!;
    expect(familyDensityRecipe({ ...row, state: "awaiting-choice" })).toBeNull();
  });
  it("creates the pair through the original real mail, independent account acceptance and grants", () => {
    const source = read("e2e/helpers/density-family-state-fixtures.ts");
    for (const text of ["await drainMailUntil(page.request", "input.findActualInvitation(bEmail)",
      "adultInvitationToken(message.html)", "await acceptAdultInvitation(", "await uploadOwnFileWithChosenReports(page,",
      "await turnOn(page, selfA.id as string, purpose)", "await ownRunCompletions(file.id as string)"])
      expect(source).toContain(text);
    expect(source).not.toMatch(/\.fulfill\(|\.abort\(|\.setContent\(|\.addInitScript\(/u);
    expect(source).not.toMatch(/\.from\([^)]*\)\.(?:insert|update|upsert)\(/u);
    expect(source).not.toMatch(/\.listen\(/u);
  });
  it("keeps uploader and viewer in separate contexts while the original processing request is held", () => {
    const source = read("e2e/helpers/density-family-state-fixtures.ts");
    expect(source).toContain("viewingContext = await input.browser.newContext(");
    expect(source).toContain("capturedPage = await viewingContext.newPage()");
    expect(source).toContain("await response.finished() === null");
    expect(source).toContain('assert(response.ok(), "Actual Family write must succeed")');
    expect(source.indexOf("if (held) await held.settle()")).toBeLessThan(source.indexOf("await viewingContext?.close()"));
    expect(source).toContain('await ancestry.getByRole("button", { name: "Turn off" }).click()');
  });
  it("binds full native rows, exact source/grant revisions, genuine Tier-2 and no-coverage cause", () => {
    const source = read("e2e/helpers/density-family-state-fixtures.ts");
    expect(source).toContain('select("*", { count: "exact" })');
    expect(source).toContain("expect(rows.data!.length).toBe(rows.count)");
    expect(source).toContain("direction.grant_revision === row.grant_revision");
    expect(source).toContain("expect(run.complete,");
    expect(source).toContain("await passGate(capturedPage)");
    expect(source).toContain("expect(stored.local).not.toMatch(/tier2|family/i)");
    expect(source).toContain("for (const panel of facts.user_prs) expect(panel.matched).toBe(0)");
    expect(source).toContain("return input.observeState(row, capturedPage, sourceSha256,");
  });
  it("requires the actual populated hub, report-ready card and truthful ungranted Portrait tile", () => {
    const source = read("e2e/helpers/density-family-state-fixtures.ts");
    const row = states.find(row => row.route.id === "family.index" && row.state === "complete")!;
    expect(familyDensityRecipe(row)).toBe("both-layers");
    expect(source).toContain('admin.from("family_pairs").select("*", { count: "exact" })');
    expect(source).toContain('toHaveAttribute("data-subject-id", handle)');
    expect(source).toContain("toHaveText(CARD_READY_STATUS)");
    expect(source).toContain("expect(facts.family_pairs).toEqual([])");
    expect(source).toContain('HUB_TILES.find(tile => tile.id === "portrait")!.blocked');
    expect(source).toContain('toHaveAttribute("href", "/copilot/family")');
    expect(source).toContain("getByText(NOT_DIAGNOSTIC, { exact: true })");
  });
  it("declares a real viewer refusal after genuine sharing and retains every source and revoked grant", () => {
    const source = read("e2e/helpers/density-family-state-fixtures.ts");
    expect(source).toContain('await page.request.put("/api/settings/jurisdiction"');
    expect(source).toContain('data: { code: "XX", attestationVersion: artifact.version');
    expect(source).toContain('await passGate(capturedPage)');
    expect(source).toContain('revocation_reason: "jurisdiction_changed"');
    expect(source).toContain('expect(revoked, "the same whole grant retains only its native revocation fields")');
    expect(source).toContain('expect(after[name], "a legal refusal preserves the native source and unrelated outputs").toEqual(before[name])');
    expect(source).toContain('expect(actual, "the complete declared refusal remains current around capture").toEqual(fixedDenialFacts)');
    expect(source).toContain('expect(privateReads, "no browser or variant request starts after the refusal").toEqual([])');
  });
  it("adds only three genuine joint permission or no-file states and leaves scientific result fixtures held", () => {
    const expected = [["family.health-picture", "consent-required", "health-paused"],
      ["family.portrait", "consent-required", "portrait-missing"], ["family.portrait", "empty", "portrait-empty"]];
    for (const [id, state, recipe] of expected) {
      const row = states.find(row => row.route.id === id && row.state === state)!;
      expect(familyDensityRecipe(row)).toBe(recipe);
    }
    for (const id of ["family.health-picture", "family.portrait"])
      for (const state of ["complete", "partial-coverage", "not-covered", "processing", "malformed"])
        expect(familyDensityRecipe({ route: { id, path: "/unknown", kind: "page", surface: "standard" }, state })).toBeNull();
  });
  it("requires independent own-session purpose and personal acknowledgements before a live Portrait empty capture", () => {
    const source = read("e2e/helpers/density-family-state-fixtures.ts");
    for (const text of ['await page.request.post("/auth/sign-out"); await signIn(page, bEmail, password)',
      'await turnOn(page, selfA.id as string, recipe === "health-paused"',
      'await turnOn(capturedPage, handle, recipe === "health-paused"',
      'await acknowledgeOwnPortrait(page, pair.id as string, selfB.id as string)',
      'await acknowledgeOwnPortrait(capturedPage, pair.id as string, selfA.id as string)',
      'toEqual({ acknowledgement: "portrait", subjectId, affirmed: true })',
      'toEqual({ acknowledgement: "tier2-result-gate", affirmed: true })',
      'expect(actual, "Every complete native boundary row remains current around capture").toEqual(fixedBoundaryFacts)',
      'admin.from("consent_signatures").select("*", { count: "exact" })',
      'admin.from("portrait_results").select("*", { count: "exact" })']) expect(source).toContain(text);
  });
  it("asserts both live native grant directions or the precise missing own steps, never an invented scientific result", () => {
    const source = read("e2e/helpers/density-family-state-fixtures.ts");
    for (const text of ['expect(pair.status).toBe("pending")', 'expect(pair.status).toBe("current")',
      'expect(directionalPurposes(facts, subjectId, viewer)).toEqual(["family.heritability"])',
      'expect(directionalPurposes(facts, mine.id as string, other.subject_account_id)).toEqual(["family.heritability"])',
      'expect(directionalPurposes(facts, subjectId, viewer)).toEqual(["family.portrait"])',
      'expect(directionalPurposes(facts, mine.id as string, other.subject_account_id)).toEqual([])',
      'toHaveText(viewerMissingStep(VIEWER_PORTRAIT_STEPS.grant))', 'toHaveText(missingStep(name, PORTRAIT_STEPS.acknowledged))',
      'toContainText(pausedWith(name))', 'toContainText(VIEWER_NO_FILE_YET)', 'toContainText(noFileYet(name))',
      'expect(facts[table], "This real permission state has no prepared or invented results").toEqual([])']) expect(source).toContain(text);
  });
  it("uses the actual accepted subject on all eight denied routes while mixed permissions retain rights", () => {
    const source = read("e2e/helpers/density-family-state-fixtures.ts");
    const denied = states.filter(row => familyDensityRecipe(row) === "jurisdiction");
    expect(denied).toHaveLength(8);
    expect(new Set(denied.map(row => row.route.id))).toEqual(new Set([
      "family.person", "family.permissions", "genome.subject", "genome.reports", "genome.report",
      "genome.ancestry", "genome.data", "genome.browser",
    ]));
    expect(source).toContain('`/genome/s-${handle}${suffix}`');
    expect(source).toContain('"/reports/lactase-persistence-lct-rs4988235"');
    expect(source).toContain('getByRole("button", { name: "Pause sharing", exact: true })');
    expect(source).toContain('getByRole("button", { name: "Stop sharing", exact: true })');
    expect(source).toContain('page.locator(\'[data-slot="permission-control"]\')).toHaveCount(0)');
    expect(source).toContain('"We create no analysis or consent record."');
    expect(source).toContain('"It says nothing about you or anyone else."');
    expect(source).toContain('page.locator(\'[data-slot="subject-name"]\')).toHaveCount(0)');
    const resolver = read("src/lib/family/subject-route.ts");
    expect(resolver.indexOf('if (!permits(decision)) return { kind: "jurisdiction"')).toBeLessThan(resolver.indexOf("const live = liveGrantsToViewer"));
  });
});
