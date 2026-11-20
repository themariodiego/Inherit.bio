import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { densityCapturePlan, densityStateKey } from "./density-capture-plan";
import { withdrawalDensityRecipe } from "./density-withdrawal-states";
import type { DensityRegister } from "./density-current";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relative: string) => readFileSync(path.join(root, relative), "utf8");
const states = densityCapturePlan(JSON.parse(read("docs/route-register.json")) as DensityRegister, []).states;
const helper = read("e2e/helpers/density-withdrawal-state-fixtures.ts");

describe("real signed-out invitation refusal density boundaries", () => {
  it("covers only the two registered fixed-session states and refuses unrelated or malformed authority", () => {
    const rows = states.filter(row => withdrawalDensityRecipe(row));
    const registered = states.filter(row => row.route.id === "rights.withdraw");
    expect(rows.map(row => densityStateKey(row.route.id, row.state)).sort()).toEqual(
      registered.map(row => densityStateKey(row.route.id, row.state)).sort());
    expect(registered.some(row => row.state === "complete")).toBe(true);
    expect(registered.every(row => ["complete", "processing"].includes(row.state))).toBe(true);
    const row = rows.find(row => row.state === "complete")!;
    expect(withdrawalDensityRecipe({ ...row, state: "processing" })).toBe("refuse-pending");
    expect(withdrawalDensityRecipe({ ...row, state: "complete" })).toBe("refused");
    for (const route of [{ ...row.route, id: "rights.subject-access" }, { ...row.route, path: "/withdraw/request" },
      { ...row.route, stateProfile: "product-result" }, { ...row.route, auth: "authenticated" }])
      expect(withdrawalDensityRecipe({ ...row, route })).toBeNull();
    for (const state of ["complete-malformed", "empty", "consent-required", "jurisdiction-unavailable"])
      expect(withdrawalDensityRecipe({ ...row, state })).toBeNull();
  });
  it("requires real invitation mail, explicit native fragment activation and an independently signed-out recipient", () => {
    for (const text of ["await createConfirmedUser(inviterEmail, password)", "await signIn(page, inviterEmail, password)",
      'name: "Send invitation", exact: true', "await drainMailUntil(page.request, () => input.findActualInvitation(recipientEmail)",
      "adultInvitationToken(message.html)", 'expect(message.subject).toBe("You were invited to Inherit")',
      "const signedOut = await signOut(page)", "await context.clearCookies()", "expect(await context.cookies()).toEqual([])",
      "adultInvitationUrl(token, origin.origin)", 'name: "Continue", exact: true', 'status).toBe("current")',
      'await expect(page).toHaveURL(`${origin.origin}/withdraw/session`)']) expect(helper).toContain(text);
    // G8.5 (2026-10-23): the real sign-out carries its one-time token through the shared helper.
    expect(helper).toMatch(/import \{[^}]*\bsignOut\b[^}]*\} from "\.\/session-csrf";/u);
    expect(helper).not.toContain("await createConfirmedUser(recipientEmail");
    expect(helper).not.toMatch(/\.fulfill\(|\.abort\(|\.setContent\(|\.addInitScript\(/u);
    expect(helper).not.toMatch(/\.from\([^)]*\)\.(?:insert|update|upsert)\(/u);
  });
  it("holds exactly the original purpose-bound POST and settles it even after capture refusal", () => {
    for (const text of ['const endpoint = `${origin.origin}/api/withdraw/session`',
      'Object.keys(body).sort().join(",") === "nonce,operation"', 'body.operation === "refuse"',
      "!route.request().url().includes(token)", "!JSON.stringify(body).includes(token)",
      "await barrier; await route.continue(); const response = await route.request().response()",
      "await response.finished() === null", "void originalRequest.continuation.catch(() => {})", "await originalRequest.continuation",
      "release?.()", "if (originalRequest.continuation) await originalRequest.continuation", "await page.unroute(endpoint, hold)",
      "await context.close()", 'expect(await actualResponse.json()).toEqual({ status: "accepted", operation: "refuse" })'])
      expect(helper).toContain(text);
    expect(helper.indexOf('if (recipe === "refuse-pending")')).toBeLessThan(helper.indexOf("release(); const actualResponse = await originalRequest.continuation"));
    expect(helper.indexOf("release(); const actualResponse = await originalRequest.continuation")).toBeLessThan(helper.indexOf('if (recipe === "refused")'));
    expect(helper).not.toContain("waitForResponse("); // No unstarted response is awaited after an early refusal.
  });
  it("keeps complete native count-checked bags and rejects a progressed pending invitation or foreign target", () => {
    for (const text of ['select("*", { count: "exact" })', 'expect(result.data!.length).toBe(result.count)',
      'target_kind: "subject", target_id: scope.subjectId', 'target_id: scope.invitationId, purpose: "adult-subject-invitation"',
      'purpose: "adult-subject-invitation", status: "active", ended_at: null', 'lifecycle: "draft", subject_class: "other_adult"',
      '"files", "grants", "variant_calls", "observed_calls", "scores", "refusals", "bars"',
      'expect(facts, "the held refusal has not changed any complete native invitation/subject/session row").toEqual(before)'])
      expect(helper).toContain(text);
    expect(helper).not.toMatch(/\.limit\(|\.select\("id"\)/u);
  });
  it("requires the real consumed session, purged reservation and refusal bars while preserving the inviter and genetic absence", () => {
    for (const text of ['status: "refused", accepted_at: null', 'status: "consumed"', 'lifecycle: "purged"',
      '?.status).toBe("deleted")', 'expect(after.drafts).toEqual([])', 'state: "invalidated"',
      "expect(after.refusals.length).toBeGreaterThan(0)", "expect(after.bars.length).toBeGreaterThan(0)",
      'expect(after[name], "the real refusal does not mutate the inviter or fabricate genetic access/output").toEqual(before[name])',
      'expect(facts, "the full committed native refusal stays exact around capture").toEqual(after)']) expect(helper).toContain(text);
  });
  it("retains full pending/terminal copy and keeps missing current pending markup as a visible composition hold", () => {
    for (const text of ['adultForm.includes(\'data-state="processing"\')',
      'recipe === "refuse-pending" && !pendingAvailable', '"Saving your choice…"', '"aria-live", "polite"',
      'name: "Refuse", exact: true })).toBeDisabled()', 'name: "Delete reserved record", exact: true })).toBeDisabled()',
      "Accepting creates a reserved subject under your account. It does not give the sender access, permission to upload, or permission to analyse your genetic data.",
      "The reserved subject was closed. This address will not receive another invitation for this target.",
      'main [data-figure-kind], main [data-personal-preview]']) expect(helper).toContain(text);
    expect(helper).not.toMatch(/\.dispatchEvent\(|page\.reload\(|\.request\.post\("\/api\/withdraw\/session"/u);
  });
});
