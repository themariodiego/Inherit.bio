import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { densityCapturePlan, densityStateKey } from "./density-capture-plan";
import { assertFreshJurisdictionRows, JURISDICTION_DENSITY_STATES, JURISDICTION_DENSITY_TABLES,
  jurisdictionDensityRecipe, type FreshJurisdictionRows } from "./density-jurisdiction-states";
import { ownedDensityRecipe } from "./density-owned-states";
import { familyDensityRecipe } from "./density-family-states";
import { reportDensityRecipe } from "./density-report-states";
import { cohortEntryDensityRecipe } from "./density-cohort-entry-states";
import { copilotDensityRecipe } from "./density-copilot-states";
import type { DensityRegister } from "./density-current";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (name: string) => readFileSync(path.join(root, name), "utf8");
const register = JSON.parse(read("docs/route-register.json")) as DensityRegister;
const states = densityCapturePlan(register, []).states;
const account = "11111111-1111-4111-8111-111111111111", subject = "22222222-2222-4222-8222-222222222222";
const facts = (): FreshJurisdictionRows => ({
  genome_files: [], subject_consents: [], consent_signatures: [], consent_grants: [],
  directional_grants_received: [], family_sharing_pauses: [], cohorts: [], drafts: [],
  account_operation_nonces: [], family_pairs: [], purpose_grants: [], invitations: [], participant_sets: [],
  profiles: [{ id: account, deletion_requested_at: null, jurisdiction_code: "XX", jurisdiction_subdivision: null,
    jurisdiction_declared_at: "2026-10-10T12:00:00Z", jurisdiction_attestation_version: 1, jurisdiction_attestation_sha256: "a".repeat(64) }],
  subjects: [{ id: subject, owner_account_id: account, subject_account_id: account, subject_class: "self", lifecycle: "active" }],
  subject_principals: [{ id: "33333333-3333-4333-8333-333333333333", account_id: account,
    subject_id: subject, principal_kind: "account_subject", status: "active" }],
  published_attestations: [{ artifact_key: "attestation.jurisdiction", version: 1, body_sha256: "a".repeat(64), superseded_at: null }],
});
const helper = "e2e/helpers/density-jurisdiction-state-fixtures.ts";

describe("real current jurisdiction and unshared Health Picture density providers", () => {
  it("adds exactly nine current pairs without borrowing any prepared provider", () => {
    const actual = states.filter(row => jurisdictionDensityRecipe(row));
    expect(actual).toHaveLength(9);
    expect(new Set(actual.map(row => densityStateKey(row.route.id, row.state)))).toEqual(new Set(
      Object.entries(JURISDICTION_DENSITY_STATES).flatMap(([id, rows]) => Object.keys(rows).map(state => densityStateKey(id, state)))));
    expect(actual.filter(row => row.state === "jurisdiction-unavailable")).toHaveLength(8);
    expect(actual.every(row => !ownedDensityRecipe(row) && !familyDensityRecipe(row) && !reportDensityRecipe(row)
      && !cohortEntryDensityRecipe(row) && !copilotDensityRecipe(row))).toBe(true);
  });
  it("keeps own Genome jurisdiction, absent new routes and advanced family results held", () => {
    const row = states.find(row => row.route.id === "family.health-picture")!;
    for (const state of ["complete", "processing", "partial-coverage", "not-covered", "consent-required"])
      expect(jurisdictionDensityRecipe({ ...row, state })).toBeNull();
    for (const id of ["genome.subject", "genome.report", "composition.new-route", "constructor"])
      expect(jurisdictionDensityRecipe({ ...row, route: { ...row.route, id }, state: "jurisdiction-unavailable" })).toBeNull();
    expect(read("e2e/jurisdiction-declaration.spec.ts")).toContain("Adult self-analysis is the one capability no jurisdiction restricts.");
  });
  it("requires the complete ordinary native fact vector with no accessors or omitted tables", () => {
    expect(() => assertFreshJurisdictionRows(facts(), account, true)).not.toThrow();
    for (const bad of [null, [], {}, { ...facts(), invented: [] }, { ...facts(), cohorts: null }])
      expect(() => assertFreshJurisdictionRows(bad, account, true)).toThrow();
    const missing = facts(); delete (missing as Partial<FreshJurisdictionRows>).drafts;
    expect(() => assertFreshJurisdictionRows(missing, account, true)).toThrow();
    const getter = facts(); Object.defineProperty(getter, "profiles", { enumerable: true, get: () => { throw new Error("not a data row"); } });
    expect(() => assertFreshJurisdictionRows(getter, account, true)).toThrow();
  });
  it("refuses stale, foreign, deleted or malformed native declarations", () => {
    for (const change of [{ id: subject }, { deletion_requested_at: "2026-10-10T12:00:00Z" },
      { jurisdiction_code: "GB" }, { jurisdiction_subdivision: "XX-A" }, { jurisdiction_declared_at: "broken" },
      { jurisdiction_attestation_version: 2 }, { jurisdiction_attestation_sha256: "b".repeat(64) }]) {
      const value = facts(); Object.assign(value.profiles[0], change);
      expect(() => assertFreshJurisdictionRows(value, account, true)).toThrow();
    }
    const superseded = facts(); superseded.published_attestations[0].superseded_at = "2026-10-10T12:00:00Z";
    expect(() => assertFreshJurisdictionRows(superseded, account, true)).toThrow();
    const foreign = facts(); foreign.subject_principals[0].subject_id = account;
    expect(() => assertFreshJurisdictionRows(foreign, account, true)).toThrow();
    expect(() => assertFreshJurisdictionRows(facts(), "invalid", true)).toThrow();
  });
  it("refuses every unexpected source, consent, pair, invitation, cohort and foreign operation row", () => {
    for (const name of JURISDICTION_DENSITY_TABLES.filter(name => !["profiles", "subjects", "subject_principals",
      "published_attestations", "account_operation_nonces"].includes(name))) {
      const value = facts(); value[name] = [{ id: subject }];
      expect(() => assertFreshJurisdictionRows(value, account, true)).toThrow();
    }
    const nonce = facts(); nonce.account_operation_nonces = [{ account_id: subject }];
    expect(() => assertFreshJurisdictionRows(nonce, account, true)).toThrow();
    expect(() => assertFreshJurisdictionRows(facts(), account, false)).toThrow();
    const empty = facts(); empty.profiles[0].jurisdiction_code = "GB";
    expect(() => assertFreshJurisdictionRows(empty, account, false)).not.toThrow();
  });
  it("declares through the real session-bound route and leaves the TEST flag and native records untouched", () => {
    const source = read(helper);
    for (const text of ["await createConfirmedUser(email, password)", "await signIn(page, email, password)",
      'page.request.put("/api/settings/jurisdiction"', 'code: "XX", attestationVersion: artifact.version',
      'attestationHash: artifact.body_sha256, affirmed: true', 'expect(response.status(), "actual TEST jurisdiction admission is mandatory").toBe(200)',
      'expect(declared[name], "declaration creates no source, consent, invitation or cohort").toEqual(original[name])'])
      expect(source).toContain(text);
    expect(source).not.toMatch(/\.fulfill\(|\.abort\(|\.setContent\(|\.addInitScript\(|\.listen\(/u);
    expect(source).not.toMatch(/\.from\([^)]*\)\.(?:insert|update|upsert)\(|process\.env[^\n]*=/u);
  });
  it("retains complete snapshot equality, exact blocked copy and no private value or new authority", () => {
    const source = read(helper);
    for (const text of ['select("*", { count: "exact" })', "expect(result.data!.length).toBe(result.count)",
      "Exact native subject/principal identifiers required before scoped reads",
      'expect(nativeSnapshot, "refused or empty navigation preserves complete native facts").toEqual(before)',
      'expect(apiWrites, "refusal does not create analysis or consent").toEqual([])',
      "toHaveText(DENSITY_TEST_DENY_SENTENCE)", 'toHaveAttribute("data-jurisdiction-source", "test-deny")',
      'tiles.locator("a")).toHaveCount(0)', 'main [data-claim-block]', 'main [data-subject-id]',
      'main [data-cohort-id]', 'main [data-embryo-id]', "return input.observeState(row, page, sourceSha256,"])
      expect(source).toContain(text);
    expect(source).toContain('const UNKNOWN_EMBRYO = "0e000000-0000-4000-8000-0000000000ff"');
    expect(read("e2e/embryos.nojurisdiction.spec.ts")).toContain('const UNKNOWN_UUID = "0e000000-0000-4000-8000-0000000000ff"');
  });
  it("distinguishes an actual one-person empty page from jurisdiction, consent or numeric results", () => {
    const source = read(helper);
    for (const text of ['recipe !== "health-empty"', '[data-slot="health-picture-blocking"][data-state="empty"]',
      "toContainText(needsTwoPeople(1))", "toContainText(EACH_TURNS_IT_ON)",
      '[data-slot="carrier-match-panel"]', 'main [data-figure-kind]',
      'getByText(DENSITY_TEST_DENY_SENTENCE, { exact: true })).toHaveCount(0)']) expect(source).toContain(text);
    const result = densityCapturePlan(register, states.filter(jurisdictionDensityRecipe).map(row => densityStateKey(row.route.id, row.state)));
    expect(result.status).toBe("HOLD_CURRENT_DENSITY_FIXTURES");
    expect(result.holds).toContainEqual({ routeId: "family.health-picture", state: "complete", reason: "native-state-fixture-missing" });
  });
});
