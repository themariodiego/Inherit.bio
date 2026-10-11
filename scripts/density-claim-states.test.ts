import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { densityCapturePlan } from "./density-capture-plan";
import { CLAIM_DENSITY_NATIVE_SOURCES, CLAIM_DENSITY_PROTECTED_TABLES, claimStartDensityFactsSchema,
  isClaimStartProcessingDensityState } from "./density-claim-states";
import type { DensityRegister } from "./density-current";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (name: string) => readFileSync(path.join(root, name), "utf8");
const states = densityCapturePlan(JSON.parse(read("docs/route-register.json")) as DensityRegister, []).states;
const helper = read("e2e/helpers/density-claim-state-fixtures.ts");
const pending = () => ({ protected: Object.fromEntries(Object.keys(CLAIM_DENSITY_PROTECTED_TABLES)
  .map(name => [name, { count: 0, sha256: "a".repeat(64) }])),
  intakes: { count: 0, sha256: "b".repeat(64) }, counters: { count: 0, sha256: "c".repeat(64) },
  audit: { count: 0, sha256: "d".repeat(64) }, auditMark: "0", intake: null, auditAppend: null });
const committed = () => ({ ...pending(), intakes: { count: 1, sha256: "e".repeat(64) },
  intake: { count: 1, sessionMatches: true, keyMatches: true, mode: "record-key", live: true,
    incomplete: true, sealed: true, hmacRevisionsCurrent: true, deadlineIsOneDay: true, originalClocks: true },
  auditAppend: { prefix: pending().audit, count: 1, exactStart: true } });

describe("actual claim-start processing density provider", () => {
  it("derives the current register state and never upgrades a missing old processing obligation", () => {
    const registered = states.filter(row => row.route.id === "rights.future-person-claim");
    const template = registered.find(row => row.state === "complete")!;
    expect(template).toBeTruthy();
    expect(states.filter(isClaimStartProcessingDensityState)).toEqual(registered.filter(row => row.state === "processing"));
    const row = { ...template, state: "processing" };
    expect(isClaimStartProcessingDensityState(row)).toBe(true);
    for (const state of ["complete", "processing-other", "empty", "jurisdiction-unavailable"])
      expect(isClaimStartProcessingDensityState({ ...row, state })).toBe(false);
    for (const route of [{ ...row.route, id: "reviews.future-person-claim" }, { ...row.route, path: "/future-person/claim/session" },
      { ...row.route, auth: "authenticated" }, { ...row.route, stateProfile: "product-result" }])
      expect(isClaimStartProcessingDensityState({ ...row, route })).toBe(false);
  });
  it("rejects missing, extra, malformed or projected full-row bags rather than treating them as empty", () => {
    expect(claimStartDensityFactsSchema.safeParse(pending()).success).toBe(true);
    for (const name of Object.keys(CLAIM_DENSITY_PROTECTED_TABLES)) {
      const missing = pending(); delete missing.protected[name];
      expect(claimStartDensityFactsSchema.safeParse(missing).success).toBe(false);
    }
    for (const bag of [{ count: -1, sha256: "a".repeat(64) }, { count: 0.5, sha256: "a".repeat(64) },
      { count: 0, sha256: "unknown" }, { count: 0, sha256: "a".repeat(64), projectedIds: [] }])
      expect(claimStartDensityFactsSchema.safeParse({ ...pending(), counters: bag }).success).toBe(false);
    expect(claimStartDensityFactsSchema.safeParse({ ...pending(), protected: { ...pending().protected,
      omittedTable: { count: 0, sha256: "a".repeat(64) } } }).success).toBe(false);
  });
  it("requires exact new session, key, sealed clocks and one coded audit append without any release", () => {
    expect(claimStartDensityFactsSchema.safeParse(committed()).success).toBe(true);
    for (const key of ["sessionMatches", "keyMatches", "live", "incomplete", "sealed", "hmacRevisionsCurrent",
      "deadlineIsOneDay", "originalClocks"])
      expect(claimStartDensityFactsSchema.safeParse({ ...committed(), intake: { ...committed().intake, [key]: false } }).success).toBe(false);
    for (const patch of [{ mode: "keyless" }, { count: 2 }, { finding: "released" }])
      expect(claimStartDensityFactsSchema.safeParse({ ...committed(), intake: { ...committed().intake, ...patch } }).success).toBe(false);
    for (const patch of [{ count: 0 }, { count: 2 }, { exactStart: false }])
      expect(claimStartDensityFactsSchema.safeParse({ ...committed(), auditAppend: { ...committed().auditAppend, ...patch } }).success).toBe(false);
    expect(claimStartDensityFactsSchema.safeParse({ ...pending(), intakes: { count: 1, sha256: "a".repeat(64) } }).success).toBe(false);
    expect(claimStartDensityFactsSchema.safeParse({ ...committed(), intake: null }).success).toBe(false);
    expect(claimStartDensityFactsSchema.safeParse({ ...committed(), auditAppend: null }).success).toBe(false);
  });
  it("requires genuine Core source, fresh native caller and actual original form with no signed-in account", () => {
    expect(CLAIM_DENSITY_NATIVE_SOURCES).toContain("src/app/api/future-person/claim/route.ts");
    for (const text of ["CLAIM_DENSITY_NATIVE_SOURCES.some", "return []", "await input.withFreshNativeRuntime(row, viewport",
      "fs.realpathSync(process.cwd()) === fs.realpathSync(input.root)", "environment[name] === process.env[name]",
      "localE2eProject(environment).projectId", "ownedLinuxEnvironment(operator)", 'await import("./claim-review-fixture")',
      'input.origin === "http://localhost:3100"', 'await page.goto(row.route.path)',
      '`2001:db8:${block.slice(0, 4)}:${block.slice(4)}::1`', "CROCKFORD[randomInt(CROCKFORD.length)]",
      'rsc: "1", "next-router-prefetch": "1"', "?.value === cookies[0].value", 'cookies[0].sameSite === "Strict"',
      '"Pending private form credential changed"', '"Actual native private claim session required"'])
      expect(helper).toContain(text);
    expect(helper).not.toMatch(/createConfirmedUser|signIn\(|\.addCookies\(|\.setContent\(|\.addInitScript\(/u);
    expect(helper).not.toMatch(/\.fulfill\(|\.abort\(|\b(?:insert into|update public|update private|delete from)\b/iu);
  });
  it("holds and later settles the single original request with no unstarted response wait or synthetic reply", () => {
    for (const text of ['route.request().method() === "POST" && ++intercepted === 1',
      'route.request().headers()["sec-fetch-site"] === "same-origin"', 'route.request().headers()["x-inherit-csrf"]',
      "expect(route.request().postDataJSON()).toEqual({ mode: \"record-key\", recordKey: key",
      "await barrier; await route.continue(); const response = await route.request().response()",
      "await response.finished() === null", "void original.continuation.catch(() => {})",
      "await observe(); await capture({ page, observe })", "release(); const response = await original.continuation",
      "release?.()", "if (original.continuation) await original.continuation", "await page.unroute(endpoint, hold)",
      "expect(response.status()).toBe(202)", 'expect(await response.text()).toBe(\'{"status":"received"}\')'])
      expect(helper).toContain(text);
    expect(helper.indexOf("await capture({ page, observe })")).toBeLessThan(helper.indexOf("release(); const response = await original.continuation"));
    expect(helper).not.toContain("waitForResponse(");
  });
  it("hashes every whole current protected row and distinguishes pending absence from genuine committed intake", () => {
    for (const text of ["select to_jsonb(r) row from ${table} r", 'row::text collate "C"', "'count',count(*)",
      "private.claim_intake_live_v1(i)", "i.last_active_at=i.created_at", "i.expires_at=i.created_at+interval '24 hours'",
      "private.hmac_active_revision_v1('rate-limit')", "expect(before.intakes.count).toBe(0)",
      "The held original POST has changed no complete claim, target, audit or quota row",
      "expect(after.intakes.count).toBe(1)", "expect(after.protected", ".toEqual(before.protected)",
      "expect(after.auditAppend?.prefix).toEqual(before.audit)", "event_code='claim.intake.started'",
      "route_id='api.future-person-claim'", "outcome_code='accepted'", "coded_context='{}'::jsonb",
      "sessionHash: digest(session[0].value), keyHash: digest(key)", 'await page.evaluate(() => document.cookie) === ""'])
      expect(helper).toContain(text);
    expect(helper).not.toMatch(/\blimit\s+[0-9]|select\s+(?:r\.)?id\s+from/iu);
  });
  it("keeps the entire refusal and non-identification copy visible in the actual pending and received pages", () => {
    for (const text of ["We release a record only to the adult it was made from.", "we never say whether a record exists.",
      "A parent may have told us the date and place of birth and the parents’ names.", "we will not guess.",
      "If you stop after this step, we delete what you sent within 24 hours.",
      "Questions about a claim go to legal@inherit.bio. Do not send identity papers by email.",
      'name: "Working…", exact: true })).toBeDisabled()', 'name: "We have your request", exact: true })).toHaveCount(0)',
      "Node.DOCUMENT_POSITION_FOLLOWING", 'name: "Send your files", exact: true',
      'name: "We have your claim", exact: true })).toHaveCount(0)', "Nothing you sent says whether a record exists."])
      expect(helper).toContain(text);
  });
});

import { CLAIM_REVIEW_DENSITY_TABLES, checkClaimReviewDensityFacts, isClaimReviewDensityState } from "./density-claim-review-states";
describe("genuine assigned claim reviewer density states", () => {
  const reviewSource = readFileSync(path.join(root, "e2e/helpers/density-claim-review-state-fixtures.ts"), "utf8");
  const audit = readFileSync(path.join(root, "e2e/helpers/density-claim-review-audit.ts"), "utf8");
  const reviewFacts = (state: string) => ({ completeBags: Object.fromEntries(Object.keys(CLAIM_REVIEW_DENSITY_TABLES)
    .map(name => [name, { count: 0, sha256: "a".repeat(64) }])),
    scope: { count: 1, reviewerMatches: true, liveSession: true, currentAssignment: true,
      reviewState: "document_review_pending", reviewRevision: 1, mode: "keyless", caseKind: "keyless_none", sealed: true,
      completedIntake: true, cleanDocuments: 2, decisions: 0, documentReads: state === "complete" ? 3 : 0, currentDocumentReads: true } });
  it("adds only both actual reviewer pairs with exact route and authority", () => {
    const rows = states.filter(isClaimReviewDensityState);
    expect(rows.map(row => [row.route.id, row.state])).toEqual([
      ["reviews.future-person-claim", "processing"], ["reviews.future-person-claim", "complete"]]);
    for (const state of ["empty", "closed", "not-covered"])
      expect(isClaimReviewDensityState({ ...rows[0], state })).toBe(false);
    for (const route of [{ ...rows[0].route, auth: "public" }, { ...rows[0].route, path: "/future-person/claim" },
      { ...rows[0].route, id: "reviews.appeal" }, { ...rows[0].route, stateProfile: "product-result" }])
      expect(isClaimReviewDensityState({ ...rows[0], route })).toBe(false);
  });
  it("refuses every missing full bag, foreign assignment, stale revision and incomplete read as complete", () => {
    for (const state of ["processing", "complete"]) expect(() => checkClaimReviewDensityFacts(reviewFacts(state), state)).not.toThrow();
    for (const name of Object.keys(CLAIM_REVIEW_DENSITY_TABLES)) {
      const bad = reviewFacts("complete"); delete bad.completeBags[name];
      expect(() => checkClaimReviewDensityFacts(bad, "complete")).toThrow();
    }
    for (const [name, value] of Object.entries({ reviewerMatches: false, liveSession: false, currentAssignment: false,
      reviewRevision: 2, completedIntake: false, cleanDocuments: 1, decisions: 1, sealed: false, currentDocumentReads: false }))
      expect(() => checkClaimReviewDensityFacts({ ...reviewFacts("complete"), scope: { ...reviewFacts("complete").scope, [name]: value } }, "complete")).toThrow();
    expect(() => checkClaimReviewDensityFacts(reviewFacts("processing"), "complete")).toThrow();
    expect(() => checkClaimReviewDensityFacts(reviewFacts("complete"), "processing")).toThrow();
    expect(() => checkClaimReviewDensityFacts(reviewFacts("complete"), "unknown")).toThrow();
  });
  it("uses fresh native admission and source-bound actual Auth/MFA without bypass or direct row seed", () => {
    for (const text of ["await input.withFreshNativeRuntime(row, viewport", "environment[name] === process.env[name]",
      "Object.entries(ownedLinuxEnvironment(operator))", "CLAIM_REVIEW_DENSITY_NATIVE_SOURCES.some", "return []",
      "await auth.auth.getClaims()", 'value.aal === "aal2" && value.session_id === session',
      "Original reviewer account, MFA and native session must remain current", "await assertReviewState(page, row.state)",
      "select to_jsonb(r) row from ${table} r", 'row::text collate "C"', ".toEqual(original)", "await capture({ page, observe })"])
      expect(reviewSource).toContain(text);
    expect(reviewSource).not.toMatch(/\.fulfill\(|\.addCookies\(|\.setContent\(|\.addInitScript\(|\b(?:insert into|update public|update private|delete from|truncate)\b/iu);
  });
  it("retains real two-document EOF/ACK, human reads, foreign refusal and final shredding around the new complete callback", () => {
    for (const text of ['createReviewCase(page,context)', 'signInReviewer(context,baseURL)', "private.assign_claim_review_v1",
      'expect(acknowledgements.length).toBe(3)', 'toBe("3/true")', 'await birth.getByRole("checkbox").check()',
      'expect((await otherPage.goto', 'toEqual({status:200,text:JSON.stringify({claimId:claim,state:"refused",reviewRevision:2})})',
      'toBe("refused/true/true")']) expect(audit).toContain(text);
    expect(audit.indexOf("await capture(claim,reviewer,authSession)")).toBeGreaterThan(audit.indexOf("await other.close()"));
    expect(audit.indexOf("await capture(claim,reviewer,authSession)")).toBeLessThan(audit.indexOf('const decision=await observeNativeResponses'));
  });
  it("keeps actual first bytes and original held second chunk, zero receipts and canceled unread refusal", () => {
    for (const text of ['"**/api/downloads/*/chunks/1"', '"content-length"]).toBe("4000000")',
      'toHaveText("Reading file…")', 'expect(acks).toBe(0)', 'await expectCaseAuditWithoutDocumentReceipt',
      'await route.abort("aborted")', 'private.claim_document_fully_read_v1', 'toBe("f")',
      'toBe("document_review_pending/1/0")', 'finally {release();await page.unroute']) expect(audit).toContain(text);
    const processing = audit.slice(audit.indexOf("export async function auditClaimProcessingForDensity"));
    expect(processing.indexOf("await capture(claim,reviewer,authSession)")).toBeLessThan(processing.indexOf('    release();'));
    expect(processing).not.toMatch(/\.fulfill\(|\.retry\(|\.setContent\(/u);
  });
});
