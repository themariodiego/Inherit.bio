import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { densityCapturePlan } from "./density-capture-plan";
import { familyDensityRecipe } from "./density-family-states";
import { portraitDensityRecipe, checkedPortraitJurisdictionTransition, PORTRAIT_DENSITY_NATIVE_SOURCES } from "./density-portrait-states";
import type { DensityRegister } from "./density-current";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (name: string) => readFileSync(path.join(root, name), "utf8");
const source = read("e2e/helpers/density-portrait-state-fixtures.ts");
const states = densityCapturePlan(JSON.parse(read("docs/route-register.json")) as DensityRegister, []).states;
const copy = <T>(value: T): T => structuredClone(value);
const when = "2026-10-11T09:00:00.000Z";
function transition() {
  const before = { profiles: [{ id: "A", jurisdiction_code: "DK", jurisdiction_subdivision: null,
    jurisdiction_declared_at: null, jurisdiction_attestation_version: null, jurisdiction_attestation_sha256: null, retained: "profile" },
    { id: "B", jurisdiction_code: "DK", retained: "other" }],
    family_pairs: [{ id: "pair", status: "current", pair_revision: 9, subject_a_id: "sa", subject_b_id: "sb" }],
    grants: ["ga", "gb"].map((id, i) => ({ grant_id: id, grant_revision: i + 3, purpose: "family.portrait", revoked_at: null, revocation_reason: null, retained: id })),
    directions: ["ga", "gb"].map((id, i) => ({ grant_id: id, grant_revision: i + 3, pair_id: "pair", recipient_account_id: i ? "A" : "B", direction: "subject_to_recipient", status: "current", ended_at: null })),
    files: [], variants: [{ id: "unchanged", genotype: "0/1" }], signatures: [{ id: "signature", body_sha256: "c".repeat(64) }] };
  const after: Record<string, Record<string, unknown>[]> = copy(before);
  after.profiles[0] = { ...after.profiles[0], jurisdiction_code: "XX", jurisdiction_subdivision: null,
    jurisdiction_declared_at: when, jurisdiction_attestation_version: 2, jurisdiction_attestation_sha256: "d".repeat(64) };
  after.family_pairs[0].status = "pending";
  for (const grant of after.grants) { grant.revoked_at = when; grant.revocation_reason = "jurisdiction_changed"; }
  for (const direction of after.directions) { direction.status = "revoked"; direction.ended_at = when; }
  return { before, after };
}
function exactBetween(value: string, start: string, end: string) { return value.slice(value.indexOf(start), value.indexOf(end, value.indexOf(start))); }

describe("genuine additional Portrait density states", () => {
  it("adds only the five exact registered pairs with no legacy provider overlap", () => {
    const actual = states.filter(row => portraitDensityRecipe(row));
    expect(actual.map(row => row.state).sort()).toEqual(["complete", "jurisdiction-unavailable", "not-covered", "partial-coverage", "processing"]);
    expect(actual.every(row => familyDensityRecipe(row) === null)).toBe(true);
  });
  it.each(["empty", "consent-required", "awaiting-choice", "malformed"])("does not adopt the original or unsupported %s", state => {
    const row = states.find(row => row.route.id === "family.portrait")!;
    expect(portraitDensityRecipe({ ...row, state })).toBeNull();
  });
  it.each(["id", "path", "auth", "stateProfile", "kind"])("refuses a foreign route %s", field => {
    const row = states.find(row => row.route.id === "family.portrait" && row.state === "complete")!;
    expect(portraitDensityRecipe({ ...row, route: { ...row.route, [field]: "foreign" } })).toBeNull();
  });
  it("checks every original whole reviewed audit function rather than fixture titles", () => {
    const original = read("e2e/portrait-reviewed-carrier.spec.ts");
    expect(source).toContain(exactBetween(original, "async function selfSubjectOf(", "test.beforeAll("));
    expect(source).toContain(exactBetween(original, "async function registryRevision(", "// ---------------------------------------------------------------------------\n// The journey"));
    expect(source).toContain(exactBetween(original, '  await expect(page.getByRole("heading", { level: 1, name: PORTRAIT_H1 }))', '});\n\n/**\n * `partial-coverage`'));
    expect(source).toContain(exactBetween(original, '  await expect(page.locator(\'[data-slot="portrait-output"]\')).toHaveCount(2);', "  const fromA = await findingTexts(page);"));
    expect(source).toContain(exactBetween(original, '  await expectRecessiveBlock(page, "b");', '});\n'));
  });
  it("retains both actual fixture parsers, native ROH and original prepared-upload assertions", () => {
    const original = read("e2e/portrait-reviewed-carrier.spec.ts");
    expect(source).toContain(exactBetween(original, '  for (const [side, account, fixture] of [["a", A, FIXTURE_A]', '});\n\ntest("A invites B'));
    for (const required of ["verify(buildCarrierPairVcf())", "verifyAgainst(buildCarrierPairBVcf(), CARRIER_B_POSITIONS)",
      'expect(b.has("chr1:10000000")).toBe(false)',
      'await review(BOTH_COVER, "activate")', 'await review(ONE_SIDE_COVERS, "activate")',
      'await review(condition, "deactivate")', 'input.findActualInvitation(B.email)?.html', '"the invitation", environment.JOBS_SECRET'])
      expect(source).toContain(required);
    expect(source).not.toMatch(/\.fulfill\(|\.abort\(|\.setContent\(|\.addInitScript\(|\.listen\(|test\.setTimeout/u);
    expect(source).not.toMatch(/\.from\([^)]*\)\.(?:insert|update|upsert)\(/u);
  });
  it("holds only the original real POST, settles it before closing its uploader and uses an independent viewer", () => {
    for (const required of ['held = await hold(page, "**/api/files/*/process")', 'await uploadOwnFileThroughUi(page, FIXTURE_B)',
      'viewingContext = await input.browser.newContext(options)', 'capturedPage = await viewingContext.newPage()',
      'await response.finished() === null', 'assert(response.ok(), "Actual Family write must succeed")',
      'normalization_completed_at: null', 'expect(state.portrait_results).toEqual([])']) expect(source).toContain(required);
    expect(source.indexOf("await held.settle()")).toBeLessThan(source.indexOf("await viewingContext?.close()"));
  });
  it("does not invent independent report choices for sources prepared only for Portrait", () => {
    expect(source).toContain('"The original Portrait flow did not select independent reports"');
    expect(source).toContain('expect(runs, "Unselected own-analysis journals remain genuinely absent").toEqual([])');
    expect(source).toContain('expect(await ownRunCompletions(fileIds.b)).toEqual([])');
    expect(source).not.toContain("generateOwnFileWithChosenReports(");
    expect(source).toContain('roh_status: "measured", roh_reason: null');
    expect(source).toContain('expect(actual.sha256).toBe(createHash("sha256").update(fs.readFileSync(FIXTURE_B)).digest("hex"))');
  });
  it("uses an inactive actual reviewed release and exact unavailable text for not-covered", () => {
    for (const required of ['expect(await ruleGenes()).toEqual([])', 'await adminClient().rpc("import_clinical_assertion_release_v1"',
      'await assertNotCovered(capturedPage)', 'toHaveAttribute("data-state", "unavailable")', 'toHaveText(NO_CLASSIFIED_POSITIONS)',
      'for (const entry of CONDITIONS)', 'not.toContainText("No change to show that you both carry")']) expect(source).toContain(required);
  });
  it("binds all complete native rows, actual acknowledgements, current revisions and Root's exact runtime around capture", () => {
    for (const required of ['input.withFreshNativeRuntime(row, viewport', 'ownedLinuxEnvironment(operator)',
      'value.current_carrier_assertions = assertions.data', 'select("*", { count: "exact" })',
      'expect(result.data!.length).toBe(result.count)', 'expect(nativeSnapshot, "Complete actual Portrait rows remain identical around every capture").toEqual(fixed)',
      '"portrait_acknowledged_at", "independent_login_at"', 'direction.grant_revision === row.grant_revision']) expect(source).toContain(required);
    for (const name of PORTRAIT_DENSITY_NATIVE_SOURCES) expect(read(name).length).toBeGreaterThan(0);
  });
  it("accepts the exact whole native jurisdiction revocation and pending pair without erasing sources", () => {
    const { before, after } = transition(); expect(checkedPortraitJurisdictionTransition(before, after, "A", "pair")).toBe(after);
  });
  it.each(["file", "signature", "grant-revision", "grant-body", "one-direction", "ended-pair", "pair-revision", "other-profile", "attestation", "foreign-fields"])("refuses %s drift in the real declaration proof", fault => {
    const { before, after } = transition();
    if (fault === "file") after.files.push({ id: "forged" });
    else if (fault === "signature") after.signatures[0].body_sha256 = "e".repeat(64);
    else if (fault === "grant-revision") after.grants[0].grant_revision = 44;
    else if (fault === "grant-body") after.grants[0].retained = "changed";
    else if (fault === "one-direction") after.directions.pop();
    else if (fault === "ended-pair") after.family_pairs[0].status = "revoked";
    else if (fault === "pair-revision") after.family_pairs[0].pair_revision = 10;
    else if (fault === "other-profile") after.profiles[1].jurisdiction_code = "XX";
    else if (fault === "attestation") after.profiles[0].jurisdiction_attestation_sha256 = "unknown";
    else after.foreign = [{ arbitrary: "data" }];
    expect(() => checkedPortraitJurisdictionTransition(before, after, "A", "pair")).toThrow();
  });
});
