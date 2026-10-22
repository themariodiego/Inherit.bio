import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { densityCapturePlan, densityStateKey } from "./density-capture-plan";
import { familyDensityRecipe } from "./density-family-states";
import { ownedDensityRecipe } from "./density-owned-states";
import { REPORT_DENSITY_STATES, reportDensityRecipe } from "./density-report-states";
import type { DensityRegister } from "./density-current";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (name: string) => readFileSync(path.join(root, name), "utf8");
const register = JSON.parse(read("docs/route-register.json")) as DensityRegister;
const states = densityCapturePlan(register, []).states;

describe("real own-report density providers", () => {
  it("covers nineteen distinct applicable pairs without borrowing initial or shared state", () => {
    const declared = Object.entries(REPORT_DENSITY_STATES).flatMap(([id, rows]) => Object.keys(rows)
      .map(state => densityStateKey(id, state)));
    const actual = states.filter(row => reportDensityRecipe(row));
    expect(new Set(actual.map(row => densityStateKey(row.route.id, row.state)))).toEqual(new Set(declared));
    expect(actual).toHaveLength(19);
    expect(actual.every(row => ownedDensityRecipe(row) === null && familyDensityRecipe(row) === null)).toBe(true);
  });
  it("holds new routes, malformed state names and unrelated cohort or consent states", () => {
    for (const id of ["composition.new-report", "embryos.index", "settings.consents"])
      expect(reportDensityRecipe({ route: { id, path: "/unknown", kind: "page", surface: "standard" }, state: "complete" })).toBeNull();
    const row = states.find(row => row.route.id === "genome.report")!;
    expect(reportDensityRecipe({ ...row, state: "processing" })).toBeNull();
    expect(reportDensityRecipe({ ...row, state: "not-covered-malformed" })).toBeNull();
  });
  it("uses real canonical preparation and explicit generation without seeded results or simulated pages", () => {
    const source = read("e2e/helpers/density-report-state-fixtures.ts");
    for (const text of ["await createConfirmedUser(email, password)", "await signIn(page, email, password)",
      "await uploadOwnFilePrepared(page,", "await generateOwnFileWithChosenReports(page, fileId,",
      "await ownRunCompletions(fileId)", 'expect(run.complete, "exact native source/live-grant completion").toBe(true)',
      "expect(facts.runs.map(run => run.purpose).sort()).toEqual(expectedRuns)"])
      expect(source).toContain(text);
    expect(source).not.toMatch(/\.fulfill\(|\.abort\(|\.setContent\(|\.addInitScript\(/u);
    expect(source).not.toMatch(/\.from\([^)]*\)\.(?:insert|update|upsert)\(/u);
    expect(source).not.toMatch(/\.listen\(/u);
  });
  it("requires complete native rows and independently checked coverage causes, not state labels", () => {
    const source = read("e2e/helpers/density-report-state-fixtures.ts");
    for (const text of ['select("*", { count: "exact" })', "expect(result.data!.length).toBe(result.count)",
      "expect(facts.files[0].normalization_source_revision).toBe(facts.files[0].upload_revision)",
      "expect(facts.user_prs).toHaveLength(facts.scores.length)", "expect(panel.matched).toBeLessThan(panel.needed)",
      "expect(facts.reference.length).toBeGreaterThan(1)", "regionalBelowMinimum(0, regionalManifest.markerCount)",
      "return input.observeState(row, page, sourceSha256,"])
      expect(source).toContain(text);
  });
  it("checks both genuinely generated library layers and keeps complete refusal and disclaimers visible", () => {
    const source = read("e2e/helpers/density-report-state-fixtures.ts");
    expect(source).toContain('["estimate", "estimate", COUNT_NOUNS.estimate.other]');
    expect(source).toContain('["variant_call", "variant-call", COUNT_NOUNS["variant-call"].other]');
    expect(source).toContain("await assertUncoveredLibrary(page, layer, cls, noun)");
    expect(source).toContain("getByText(NOT_COVERED_VCF, { exact: true })");
    expect(source).toContain("getByText(LIMIT_OF_FILE, { exact: true })");
    expect(source).toContain('getByTestId("report-disclaimer")).toHaveText(NOT_DIAGNOSTIC)');
    expect(source).toContain('page.locator(\'[data-figure-kind="percentile"]\')).toHaveCount(0)');
  });
  it("requires actual positive and missing coverage in both completed library layers", () => {
    const source = read("e2e/helpers/density-report-state-fixtures.ts");
    const row = states.find(row => row.route.id === "genome.reports" && row.state === "partial-coverage")!;
    expect(reportDensityRecipe(row)).toBe("tiny");
    for (const text of ['for (const layer of ["estimate", "variant_call"] as const)',
      'await assertPartialLibrary(page, layer === "estimate" ? "estimate" : "variant-call")',
      "expect(covered).toBeGreaterThan(0)", "expect(missing).toBeGreaterThan(0)", "expect(covered + missing).toBe(total)"])
      expect(source).toContain(text);
  });
  it("proves ancestry was readable before its real revocation and checks native purge plus complete source preservation", () => {
    const source = read("e2e/helpers/density-report-state-fixtures.ts");
    const row = states.find(row => row.route.id === "genome.ancestry" && row.state === "consent-required")!;
    expect(reportDensityRecipe(row)).toBe("ancestry-off");
    const before = source.indexOf('expect(before.runs.map(run => run.purpose)).toEqual(["ancestry"])');
    const revoke = source.indexOf('name: "Turn off Ancestry", exact: true');
    expect(before).toBeGreaterThan(0); expect(revoke).toBeGreaterThan(before);
    for (const text of ["expect(await response.finished()).toBeNull()",
      'expect(after.runs, "native derived journal is purged, not merely hidden").toEqual([])',
      'expect(after[name], "revocation preserves the actual canonical source and other outputs").toEqual(before[name])',
      'expect(facts, "the revoked full native state stays exact around capture").toEqual(fixedRevokedFacts)',
      'await expect(off).toHaveCount(3)', 'getByRole("link", { name: ANCESTRY_REPORTS_LINK, exact: true })',
      'toHaveAttribute("href", "/genome/me/reports")']) expect(source).toContain(text);
  });
  it("binds the missing report choice to its one real stored-source route and holds unrelated new states", () => {
    const row = states.find(row => row.route.id === "genome.reports" && row.state === "consent-required")!;
    expect(reportDensityRecipe(row)).toBe("reports-off");
    expect(states.filter(row => reportDensityRecipe(row) === "reports-off").map(row => densityStateKey(row.route.id, row.state)))
      .toEqual([densityStateKey("genome.reports", "consent-required")]);
    for (const id of ["genome.report", "genome.data", "genome.browser", "genome.subject"])
      expect(reportDensityRecipe({ ...row, route: { ...row.route, id } })).toBeNull();
    expect(reportDensityRecipe({ ...row, state: "consent-required-malformed" })).toBeNull();
  });
  it("preserves real canonical data while proving all three choices and both personalized library layers remain off", () => {
    const source = read("e2e/helpers/density-report-state-fixtures.ts");
    expect(source).toContain('recipe === "reports-off" || row.route.id === "genome.browser" ? []');
    expect(source).toContain("if (firstPurpose) await generateOwnFileWithChosenReports");
    for (const text of ["const fixedUnchosenFacts = recipe === \"reports-off\" ? await snapshot(accountId, fileId) : undefined",
      "expect(facts.runs).toEqual([])", "expect(facts.user_prs).toEqual([])", "expect(facts.ancestry_results).toEqual([])",
      "expect(facts.grants.filter(grant => OWN_REPORT_PURPOSES.some(purpose => purpose === grant.purpose))).toEqual([])",
      "expect(facts.user_variants.length + facts.report_observed_calls.length,",
      'expect(facts, "the complete prepared source and absent choices/results stay exact around capture").toEqual(fixedUnchosenFacts)',
      'expect(unchosenMutations, "no choice, revocation or generation request creates this missing-choice state").toBe(0)',
      'await assertUnchosenLibrary(page, layer, layer === "estimate" ? "estimate" : "variant-call")',
      'name: "Generate selected reports", exact: true })).toBeDisabled()',
      '[data-coverage-status="awaiting"]', '[data-coverage-status="covered"], [data-coverage-status="not-covered"]',
      "Enable a report type above to get started. Your file stays stored even if every choice is off."])
      expect(source).toContain(text);
    const choices = read("src/components/reports/own-report-choices.tsx");
    expect(choices).toContain("Enable a report type above to get started. Your file stays stored even if every choice is off.");
    expect(source).not.toMatch(/\.fulfill\(|\.abort\(|\.setContent\(|\.addInitScript\(/u);
  });
});
