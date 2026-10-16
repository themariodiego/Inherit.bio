import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { densityCapturePlan } from "./density-capture-plan";
import { APPEAL_REVIEW_DENSITY_NATIVE_SOURCES, APPEAL_REVIEW_DENSITY_TABLES, appealReviewDensityFactsSchema,
  isAppealReviewProcessingDensityState } from "./density-appeal-review-states";
import type { DensityRegister } from "./density-current";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = readFileSync(path.join(root, "e2e/helpers/density-appeal-review-state-fixtures.ts"), "utf8");
const states = densityCapturePlan(JSON.parse(readFileSync(path.join(root, "docs/route-register.json"), "utf8")) as DensityRegister, []).states;
const facts = () => ({ completeBags: Object.fromEntries(Object.keys(APPEAL_REVIEW_DENSITY_TABLES)
  .map(name => [name, { count: 0, sha256: "a".repeat(64) }])),
  scope: { count: 1, reviewerMatches: true, liveSession: true, committed: true, sealed: true } });

describe("original held appeal reviewer density state", () => {
  it("derives only the actual reviewer processing pair and refuses familiar labels under another authority", () => {
    const current = states.filter(isAppealReviewProcessingDensityState);
    expect(current).toHaveLength(1);
    expect(current[0].route.id).toBe("reviews.appeal");
    for (const state of ["complete", "empty", "not-covered", "consent-required"])
      expect(isAppealReviewProcessingDensityState({ ...current[0], state })).toBe(false);
    for (const route of [{ ...current[0].route, id: "reviews.future-person-claim" },
      { ...current[0].route, path: "/legal/appeals" }, { ...current[0].route, auth: "authenticated" },
      { ...current[0].route, stateProfile: "product-result" }])
      expect(isAppealReviewProcessingDensityState({ ...current[0], route })).toBe(false);
  });
  it("refuses incomplete, projected, malformed and extra native row bags", () => {
    expect(appealReviewDensityFactsSchema.safeParse(facts()).success).toBe(true);
    for (const name of Object.keys(APPEAL_REVIEW_DENSITY_TABLES)) {
      const missing = facts(); delete missing.completeBags[name];
      expect(appealReviewDensityFactsSchema.safeParse(missing).success).toBe(false);
    }
    for (const bag of [{ count: -1, sha256: "a".repeat(64) }, { count: 0.5, sha256: "a".repeat(64) },
      { count: 0, sha256: "A".repeat(64) }, { count: 0, sha256: "a".repeat(64), ids: [] }])
      expect(appealReviewDensityFactsSchema.safeParse({ ...facts(), completeBags: { ...facts().completeBags, appeals: bag } }).success).toBe(false);
    expect(appealReviewDensityFactsSchema.safeParse({ ...facts(), completeBags: { ...facts().completeBags, omitted: [] } }).success).toBe(false);
    for (const key of ["reviewerMatches", "liveSession", "committed", "sealed"])
      expect(appealReviewDensityFactsSchema.safeParse({ ...facts(), scope: { ...facts().scope, [key]: false } }).success).toBe(false);
    expect(appealReviewDensityFactsSchema.safeParse({ ...facts(), scope: { ...facts().scope, count: 2 } }).success).toBe(false);
  });
  it("binds the existing helper and actual caller before genuine Auth and MFA account setup", () => {
    expect(APPEAL_REVIEW_DENSITY_NATIVE_SOURCES).toContain("e2e/helpers/public-appeal-review-audit.ts");
    for (const text of ["APPEAL_REVIEW_DENSITY_NATIVE_SOURCES.some", "return []", "await input.withFreshNativeRuntime(row, viewport",
      'input.origin === "http://localhost:3102"', "environment[name] === process.env[name]", "localE2eProject(environment).projectId",
      "Object.entries(ownedLinuxEnvironment(operator))", "fs.realpathSync(process.cwd()) === fs.realpathSync(input.root)",
      "await signInReviewer(context, input.origin)", "private.grant_claim_reviewer_v1", "await auth.auth.getClaims()",
      'value.sub === reviewer && value.aal === "aal2"', "Actual reviewer session cannot rotate during density proof"])
      expect(source).toContain(text);
    expect(source.indexOf("environment[name] === process.env[name]")).toBeLessThan(source.indexOf('await import("./claim-review-fixture")'));
    expect(source).not.toMatch(/\.addCookies\(|\.setContent\(|\.addInitScript\(|\.fulfill\(|\b(?:insert into|update public|update private|delete from|truncate)\b/iu);
  });
  it("captures only inside the original pending callback and requires all original assertions and final settlement", () => {
    for (const text of ["await auditAssignedAppeal(page, input.browser, reviewer, async assertions =>",
      "await assertions(); assertSource()", "assert(++captured === 1", "await observe(); await capture({ page, observe }); await observe()",
      "assert(captured === 1", "Original helper has settled the same POST", "restored", "await context.close()"])
      expect(source).toContain(text);
    expect(source.indexOf("await assertions();")).toBeLessThan(source.indexOf("await capture({ page, observe })"));
    expect(source.indexOf("await capture({ page, observe })")).toBeLessThan(source.indexOf("assert(captured === 1"));
    expect(source).not.toMatch(/page\.route\(|\.abort\(|request\.post\(|\.retry\(/u);
  });
  it("keeps every complete case, source, outcome, session and audit row exact around the held request", () => {
    for (const name of ["appealIntakes", "appeals", "appealReviewers", "caseDecisions", "documentDecisions", "rightsSessions", "mail", "legalAudit", "reviewerSessions"])
      expect(Object.hasOwn(APPEAL_REVIEW_DENSITY_TABLES, name)).toBe(true);
    for (const text of ["Object.entries(APPEAL_REVIEW_DENSITY_TABLES)", "select to_jsonb(r) row from ${table} r",
      'row::text collate "C"', "'count',count(*)", "'[]'::jsonb", "Every complete case, decision, target, authority, document and audit row remains exact",
      ".toEqual(original)", "assert(await claims() === originalSession", "s.user_id=", "s.not_after>clock_timestamp()",
      "p.account_id=", "i.state='committed'", "i.wrapped_case_key is not null", "i.working_ciphertext is not null"])
      expect(source).toContain(text);
    expect(source).not.toMatch(/limit\s+\d|select\s+(?:r\.)?id\s+from|\.slice\(0/u);
  });
  it("retains actual disabled controls, no outcome or figures, and every review limitation paragraph", () => {
    for (const text of ['name: "Review request", exact: true', 'toHaveAttribute("aria-busy", "true")', "Saving this choice.",
      'getByLabel("Reason", { exact: true })).toBeDisabled()', 'getByRole("checkbox")).toBeDisabled()',
      'name: "Refuse request", exact: true })).toBeDisabled()',
      "This closes only this request. It does not give access or change anyone's data.",
      "Record what you checked. Do not copy file content into the reason.", "I have read this request and the files that are here.",
      'getByText("This request was closed.", { exact: true })', 'name: "Open file", exact: true',
      "main [data-figure-kind], main [data-personal-preview]"])
      expect(source).toContain(text);
  });
});

import { isAppealReviewCompleteDensityState } from "./density-appeal-review-states";
describe("actual assigned complete appeal density boundary", () => {
  it("adds only the real complete reviewer pair and keeps foreign authorities refused", () => {
    const complete = states.filter(isAppealReviewCompleteDensityState);
    expect(complete).toHaveLength(1);
    expect(complete[0].route.id).toBe("reviews.appeal");
    for (const state of ["empty", "processing", "closed", "not-covered"])
      expect(isAppealReviewCompleteDensityState({ ...complete[0], state })).toBe(false);
    for (const route of [{ ...complete[0].route, auth: "public" }, { ...complete[0].route, path: "/legal/appeals" },
      { ...complete[0].route, id: "reviews.future-person-claim" }, { ...complete[0].route, stateProfile: "product-result" }])
      expect(isAppealReviewCompleteDensityState({ ...complete[0], route })).toBe(false);
  });
  it("captures the original loaded page before any decision then retains the entire original pending and final refusal", () => {
    const audit = readFileSync(path.join(root, "e2e/helpers/public-appeal-review-audit.ts"), "utf8");
    expect(audit.indexOf("if(complete)await complete")).toBeGreaterThan(audit.indexOf("const caseBefore="));
    expect(audit.indexOf("if(complete)await complete")).toBeLessThan(audit.indexOf('await refusal.getByLabel("Reason"'));
    for (const text of ['row.state === "complete" ? captureReviewedState : undefined', "else await assertions()",
      "await assertCompleteReview(page)", "await assertions(); assertSource()", ".toEqual(original)", "s.not_after>clock_timestamp()"])
      expect(source).toContain(text);
    for (const text of ['expect((await decided).status()).toBe(200)', 'expect(postCount,"no second decision request or retry").toBe(1)',
      "intake.state='closed'", "intake.wrapped_case_key is null", "intake.working_ciphertext is null", "appeal.state='rejected'",
      "final rejection leaves every subject and cohort row unchanged", "set enabled=false where singleton"])
      expect(audit).toContain(text);
  });
});
