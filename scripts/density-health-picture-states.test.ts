import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { densityCapturePlan } from "./density-capture-plan";
import { familyDensityRecipe } from "./density-family-states";
import { healthPictureDensityRecipe, checkedHealthPictureLayerWithdrawal,
  checkedHealthPicturePreparationHold, HEALTH_PICTURE_DENSITY_NATIVE_SOURCES, type HealthPictureFacts } from "./density-health-picture-states";
import type { DensityRegister } from "./density-current";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (name: string) => readFileSync(path.join(root, name), "utf8");
const source = read("e2e/helpers/density-health-picture-state-fixtures.ts");
const states = densityCapturePlan(JSON.parse(read("docs/route-register.json")) as DensityRegister, []).states;
const copy = <T>(value: T): T => structuredClone(value);
const at = "2026-10-11T12:00:00.000Z";
function exactBetween(value: string, start: string, end: string) {
  const from = value.indexOf(start); expect(from).toBeGreaterThanOrEqual(0);
  const to = value.indexOf(end, from); expect(to).toBeGreaterThan(from); return value.slice(from, to);
}
// Exempt only the seven complete, byte-exact source-byte SHA256 expressions.
// An unknown or altered expression, or any changed multiplicity, refuses.
const exactSourceHashes = [
  ['createHash("sha256").update(fs.readFileSync(path.join(input.root, sourcePath))).digest("hex")', 1],
  ['createHash("sha256").update(fs.readFileSync(path.join(input.root, name))).digest("hex")', 1],
  ['createHash("sha256").update(fs.readFileSync(path.join(input.root, source.name))).digest("hex")', 1],
  ['createHash("sha256").update(fs.readFileSync(TINY_FIXTURE)).digest("hex")', 3],
  ['createHash("sha256").update(fs.readFileSync(FIXTURE)).digest("hex")', 1],
] as const;
function checkedHealthPictureWriteGuard(value: string) {
  let remaining = value;
  for (const [expression, multiplicity] of exactSourceHashes) {
    const pieces = remaining.split(expression);
    if (pieces.length - 1 !== multiplicity) throw new Error("health-picture-source-hash-census");
    remaining = pieces.join("");
  }
  if (/\.(?:insert|update|upsert)\(/u.test(remaining)) throw new Error("health-picture-source-write");
  return remaining;
}

function withdrawal() {
  const before = { grants: [{ grant_id: "estimates", purpose: "reports.polygenic", grant_revision: 3, revoked_at: null, revocation_reason: null, signature_id: "signed" },
    { grant_id: "joint", purpose: "family.heritability", grant_revision: 2, revoked_at: null, revocation_reason: null }],
    directions: [{ grant_id: "estimates", grant_revision: 3, direction: "subject_to_recipient", status: "current", ended_at: null, recipient_account_id: "A" },
      { grant_id: "joint", grant_revision: 2, direction: "subject_to_recipient", status: "current", ended_at: null, recipient_account_id: "A" }],
    files: [{ id: "file", sha256: "a".repeat(64), upload_revision: 2 }], signatures: [{ id: "signed", body_sha256: "b".repeat(64) }],
    private_own_runs: [{ rowSha256: "c".repeat(64) }], private_joint_snapshots: [{ rowSha256: "d".repeat(64) }],
    report_observed_calls: [{ file_id: "file", genotype: "A/C" }] };
  const after: Record<string, Record<string, unknown>[]> = copy(before);
  after.grants[0] = { ...after.grants[0], revoked_at: at, revocation_reason: "withdrawn" };
  after.directions[0] = { ...after.directions[0], status: "revoked", ended_at: at };
  return { before, after };
}
function preparation(): HealthPictureFacts {
  return { files: [{ id: "held", subject_id: "a", status: "uploaded", sha256: "a".repeat(64), normalization_completed_at: null,
    normalization_source_revision: null, single_logical_sample_verified_at: at, upload_revision: 1 },
    { id: "ready", subject_id: "b", status: "stored", sha256: "b".repeat(64), normalization_completed_at: at,
      normalization_source_revision: 2, upload_revision: 2 }],
    own_completions: [{ fileId: "ready", purpose: "reports.polygenic", complete: true, completed_at: at }],
    user_prs: [{ file_id: "ready", id: "real" }], user_variants: [{ file_id: "ready", id: "call" }],
    report_observed_calls: [{ file_id: "ready", genotype: "A/C" }], ancestry_results: [] };
}
const checkHold = (facts: ReturnType<typeof preparation>) => checkedHealthPicturePreparationHold(facts, "held", "a", "ready", "b",
  { heldSha256: "a".repeat(64), readySha256: "b".repeat(64) });

describe("genuine additional Health Picture density states", () => {
  it("maps only the four real registered states without adopting old Family providers", () => {
    const actual = states.filter(row => healthPictureDensityRecipe(row));
    expect(actual.map(row => row.state).sort()).toEqual(["complete", "not-covered", "partial-coverage", "processing"]);
    expect(actual.every(row => familyDensityRecipe(row) === null)).toBe(true);
  });
  it.each(["empty", "consent-required", "awaiting-choice", "jurisdiction-unavailable", "unknown"])("leaves unsupported %s held", state => {
    const row = states.find(row => row.route.id === "family.health-picture")!;
    expect(healthPictureDensityRecipe({ ...row, state })).toBeNull();
  });
  it.each(["id", "path", "kind", "auth", "stateProfile"])("refuses foreign route %s", field => {
    const row = states.find(row => row.route.id === "family.health-picture" && row.state === "complete")!;
    expect(healthPictureDensityRecipe({ ...row, route: { ...row.route, [field]: "foreign" } })).toBeNull();
  });
  it("retains the complete original report and partial audits and all not-covered assertions", () => {
    const original = read("e2e/family-health-picture.spec.ts");
    expect(source).toContain(exactBetween(original, "  await expect(page.locator('nav[aria-label=\"Breadcrumb\"]'))", "\n});\n\n/**"));
    expect(source).toContain(exactBetween(original, '  // B withdraws the estimates layer toward A;', '\n});\n\ntest("with fewer legacy labels'));
    expect(source).toContain(exactBetween(original, "  await signIn(page, A.email, A.password);\n  await passGate(page);\n  const panel = page.locator('[data-slot=\"carrier-panel\"]');\n  await expect(panel).toHaveCount(1);", "\n});\n\n/**"));
  });
  it("preserves the original complete processing audit and the finalized sample premise", () => {
    const original = read("e2e/family-processing-states.spec.ts");
    expect(source).toContain(exactBetween(original, '  await signIn(page, B.email, B.password);\n  await page.goto("/family/health-picture");', '\n});\n\ntest("/family/portrait/[pairId] processing'));
    for (const text of ['single_logical_sample_verified_at', 'heldFileId = await uploadOwnFileThroughUi(page, TINY_FIXTURE)',
      'viewingContext = await input.browser.newContext(options)', 'subjectProcessingReceipt.parse(await response.json()).fileId === fileId',
      'await held.settle()', '"Preparation did not invent an unchosen report"']) expect(source).toContain(text);
    expect(source.indexOf('await held.settle()')).toBeLessThan(source.indexOf('await viewingContext?.close()'));
  });
  it("keeps the entire original protected Family row reader and real native completion checks", () => {
    const original = read("e2e/helpers/density-family-state-fixtures.ts");
    expect(source).toContain(exactBetween(original, 'async function fullPair(', '\nfunction directionalPurposes('));
    for (const text of ['select("*", { count: "exact" })', 'to_jsonb(r)::text', 'private.health_picture_grant_snapshots',
      'private.own_normalization_batches', 'private.own_analysis_runs', 'private.own_normalization_runs',
      'expect(nativeSnapshot, "Every complete actual Health Picture protected row remains current around capture").toEqual(fixed)',
      '"/api/family/acknowledge"', 'acknowledgement: "tier2-result-gate"', 'httpOnly: true, secure: true',
      'input.withFreshNativeRuntime(row, viewport', 'ownedLinuxEnvironment(operator)', 'input.findActualInvitation(B.email)?.html']) expect(source).toContain(text);
    for (const name of HEALTH_PICTURE_DENSITY_NATIVE_SOURCES) expect(read(name).length).toBeGreaterThan(0);
  });
  it("does not create clinical labels, mock responses, manufacture statuses or copy screenshots", () => {
    expect(source).not.toMatch(/\.fulfill\(|\.abort\(|\.setContent\(|\.addInitScript\(|\.listen\(|test\.setTimeout/u);
    expect(checkedHealthPictureWriteGuard(source)).not.toMatch(/\.(?:insert|update|upsert)\(/u);
    expect(source).not.toContain('async function declassify(');
    expect(source).not.toContain('from("ref_variants")');
    expect(source).not.toContain('from("condition_registry")');
    expect(source).not.toContain('import_clinical_assertion_release_v1');
    expect(source).not.toContain('review_carrier_condition_v1');
    expect(source).not.toMatch(/readFileSync\([^)]*\.png/);
  });
  it("keeps each original audit in a real independent session and binds the mailed token to the actual runtime origin", () => {
    expect(source).toContain('adultInvitationUrl(token, origin.origin)');
    expect(source).toContain('await establishPair(page);\n            await page.request.post("/auth/sign-out")');
    expect(source).toContain('if (recipe === "partial" || recipe === "uncovered") await capturedPage.request.post("/auth/sign-out")');
    expect(source).not.toContain('await page.context().clearCookies()');
  });
  it("accepts the exact one-layer native withdrawal without changing sources or the joint grant", () => {
    const { before, after } = withdrawal(); expect(checkedHealthPictureLayerWithdrawal(before, after, "estimates")).toBe(after);
  });
  it.each(["own-source", "signature", "private-result", "private-endpoint", "revision", "joint", "direction-body", "extra-row", "bad-time", "wrong-layer"])("refuses withdrawal %s drift", fault => {
    const { before, after } = withdrawal();
    if (fault === "own-source") after.files[0].sha256 = "e".repeat(64);
    else if (fault === "signature") after.signatures[0].body_sha256 = "e".repeat(64);
    else if (fault === "private-result") after.private_own_runs[0].rowSha256 = "e".repeat(64);
    else if (fault === "private-endpoint") after.private_joint_snapshots[0].rowSha256 = "e".repeat(64);
    else if (fault === "revision") after.grants[0].grant_revision = 9;
    else if (fault === "joint") after.grants[1].revoked_at = at;
    else if (fault === "direction-body") after.directions[0].recipient_account_id = "foreign";
    else if (fault === "extra-row") after.files.push({ id: "extra" });
    else if (fault === "bad-time") after.grants[0].revoked_at = "not-a-time";
    else before.grants[0].purpose = "family.heritability";
    expect(() => checkedHealthPictureLayerWithdrawal(before, after, "estimates")).toThrow();
  });
  it("accepts a real finalized held source beside one genuinely completed viewer report", () => {
    const facts = preparation(); expect(checkHold(facts)).toBe(facts);
  });
  it.each(["already-prepared", "sample-unverified", "source-changed", "foreign-subject", "viewer-incomplete", "stale-revision", "held-result", "held-journal", "no-real-report"])("refuses processing %s", fault => {
    const facts = preparation();
    if (fault === "already-prepared") facts.files[0].normalization_completed_at = at;
    else if (fault === "sample-unverified") facts.files[0].single_logical_sample_verified_at = undefined;
    else if (fault === "source-changed") facts.files[0].sha256 = "e".repeat(64);
    else if (fault === "foreign-subject") facts.files[0].subject_id = "foreign";
    else if (fault === "viewer-incomplete") facts.own_completions[0].complete = false;
    else if (fault === "stale-revision") facts.files[1].normalization_source_revision = 9;
    else if (fault === "held-result") facts.report_observed_calls.push({ file_id: "held", genotype: "A/C" });
    else if (fault === "held-journal") facts.own_completions.push({ fileId: "held", purpose: "reports.polygenic", complete: true, completed_at: at });
    else facts.own_completions = [];
    expect(() => checkHold(facts)).toThrow();
  });
  it.each(["insert", "update", "upsert"] as const)("refuses an actual planted database %s in the whole provider source", operation => {
    const planted = `${source}\nclient.from("health_picture_labels").${operation}({ value: "invented" });\n`;
    expect(() => checkedHealthPictureWriteGuard(planted)).toThrow("health-picture-source-write");
  });
  it.each(["algorithm", "argument", "digest", "chain"] as const)("refuses an altered complete source-hash %s", fault => {
    const expression = exactSourceHashes[0][0];
    const altered = fault === "algorithm" ? expression.replace('"sha256"', '"sha512"')
      : fault === "argument" ? expression.replace("input.root, sourcePath", "input.root, unregisteredPath")
      : fault === "digest" ? expression.replace('digest("hex")', 'digest("base64")')
      : expression.replace('.digest("hex")', '.update(extraBytes).digest("hex")');
    expect(altered).not.toBe(expression);
    expect(() => checkedHealthPictureWriteGuard(source.replace(expression, altered))).toThrow("health-picture-source-hash-census");
  });
  it("refuses an extra unallowed update after all seven exact source hashes", () => {
    expect(() => checkedHealthPictureWriteGuard(`${source}\nunregistered.update(payload);\n`)).toThrow("health-picture-source-write");
  });
  it("refuses a duplicated allowed expression rather than exempting an eighth update", () => {
    expect(() => checkedHealthPictureWriteGuard(`${source}\n${exactSourceHashes[0][0]};\n`)).toThrow("health-picture-source-hash-census");
  });
  it("refuses a missing original source-hash expression instead of relaxing its census", () => {
    expect(() => checkedHealthPictureWriteGuard(source.replace(exactSourceHashes[0][0], "removedSourceHash"))).toThrow("health-picture-source-hash-census");
  });

});
