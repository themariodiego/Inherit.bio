import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { densityCapturePlan } from "./density-capture-plan";
import { SUBJECT_ACCESS_DENSITY_TABLES, isSubjectAccessProcessingDensityState, subjectAccessDensityFactsSchema } from "./density-subject-access-states";
import type { DensityRegister } from "./density-current";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (name: string) => readFileSync(path.join(root, name), "utf8");
const states = densityCapturePlan(JSON.parse(read("docs/route-register.json")) as DensityRegister, []).states;
const facts = () => ({ completeBags: Object.fromEntries(Object.keys(SUBJECT_ACCESS_DENSITY_TABLES)
  .map(name => [name, { count: 0, sha256: "a".repeat(64) }])),
  scope: { reviewerConfigured: true, liveSession: true, noCaseForReviewer: true, intakeEnabled: true } });

describe("real held public subject-access intake density source", () => {
  it("admits exactly the current public intake pair, never a reviewer or familiar state label", () => {
    const actual = states.filter(isSubjectAccessProcessingDensityState); expect(actual).toHaveLength(1);
    expect(actual[0].route.id).toBe("rights.subject-access");
    for (const state of ["complete", "empty", "received", "not-covered"])
      expect(isSubjectAccessProcessingDensityState({ ...actual[0], state })).toBe(false);
    for (const route of [{ ...actual[0].route, id: "reviews.appeal" }, { ...actual[0].route, path: "/reviews/appeals/[id]" },
      { ...actual[0].route, auth: "reviewer" }, { ...actual[0].route, stateProfile: "auth-flow" }])
      expect(isSubjectAccessProcessingDensityState({ ...actual[0], route })).toBe(false);
  });
  it("refuses a missing, extra, malformed or projected full native bag and each false authority boundary", () => {
    expect(subjectAccessDensityFactsSchema.safeParse(facts()).success).toBe(true);
    for (const name of Object.keys(SUBJECT_ACCESS_DENSITY_TABLES)) {
      const missing = facts(); delete missing.completeBags[name];
      expect(subjectAccessDensityFactsSchema.safeParse(missing).success).toBe(false);
    }
    for (const bag of [{ count: -1, sha256: "a".repeat(64) }, { count: 0.5, sha256: "a".repeat(64) },
      { count: 0, sha256: "A".repeat(64) }, { count: 0, sha256: "a".repeat(64), ids: [] }])
      expect(subjectAccessDensityFactsSchema.safeParse({ ...facts(), completeBags: { ...facts().completeBags, appeals: bag } }).success).toBe(false);
    expect(subjectAccessDensityFactsSchema.safeParse({ ...facts(), completeBags: { ...facts().completeBags, omitted: [] } }).success).toBe(false);
    for (const key of ["reviewerConfigured", "liveSession", "noCaseForReviewer", "intakeEnabled"])
      expect(subjectAccessDensityFactsSchema.safeParse({ ...facts(), scope: { ...facts().scope, [key]: false } }).success).toBe(false);
  });
  it("captures only inside the original served POST and releases it before the original full native outcome", () => {
    const source = read("e2e/helpers/public-appeal-review-audit.ts");
    const before = source.indexOf("await intakeProcessing.before()");
    const route = source.indexOf("await page.route(endpoint,hold)");
    const held = source.indexOf("await intakeProcessing.held");
    const release = source.indexOf("finally{release();try{await submitted;}");
    const accepted = source.indexOf("expect((await submitted).status()).toBe(202)");
    expect(before).toBeGreaterThan(0); expect(route).toBeGreaterThan(before); expect(held).toBeGreaterThan(route);
    expect(release).toBeGreaterThan(held); expect(accepted).toBeGreaterThan(release);
    for (const text of ['one original intake POST, never a retry', 'route.request().postDataJSON()', 'headers()["x-inherit-csrf"]',
      'await route.continue()', 'We send your request now', 'no target changes before the real intake POST continues',
      'else await form.getByRole("button",{name:"Send request",exact:true}).click()', 'expect((await decided).status()).toBe(200)',
      'final rejection leaves every subject and cohort row unchanged']) expect(source).toContain(text);
    expect(source).not.toMatch(/\.fulfill\(|\.setContent\(|\.addInitScript\(/u);
  });
  it("retains fresh owned admission, real MFA, exact native bags and missing-source holds", () => {
    const source = read("e2e/helpers/density-subject-access-state-fixtures.ts");
    for (const text of ['SUBJECT_ACCESS_DENSITY_NATIVE_SOURCES.some', 'return []', 'await input.withFreshNativeRuntime(row, viewport',
      'environment[name] === process.env[name]', 'fs.realpathSync(process.cwd()) === fs.realpathSync(input.root)',
      'await signInReviewer(context, input.origin)', 'private.grant_claim_reviewer_v1', 'value.aal === "aal2"',
      'assert(await claims() === originalSession', 'select to_jsonb(r) row from ${table} r', 'row::text collate "C"',
      '.toEqual(original)', 'await observe(); await capture({ page, observe }); await observe()', 'assert(captured === 1',
      'noCaseForReviewer', 's.not_after>clock_timestamp()', 'await context.close()']) expect(source).toContain(text);
    expect(source).not.toMatch(/\.route\(|\.fulfill\(|\.addCookies\(|\.setContent\(|\.addInitScript\(|\.retry\(|\blimit\s+\d/iu);
  });
});
