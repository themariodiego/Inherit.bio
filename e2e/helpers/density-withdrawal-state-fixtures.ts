import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { expect, type Browser, type Page, type Response, type Route } from "@playwright/test";
import { adminClient, adultInvitationToken, adultInvitationUrl, createConfirmedUser, drainMailUntil, signIn } from "../helpers";
import { densityCapturePlan, type DensityStateCase } from "../../scripts/density-capture-plan";
import { withdrawalDensityRecipe } from "../../scripts/density-withdrawal-states";
import type { DensityRegister } from "../../scripts/density-current";
import type { DensityStateFixture } from "./density-current-capture";
import { signOut } from "./session-csrf";

interface ActualEmail { to: string[] | string; subject: string; html?: string }
type Facts = Record<string, Record<string, unknown>[]>;
type Scope = { inviterId: string; invitationId: string; subjectId: string; tokenId: string; candidateId: string; emailHmac: string };
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;

async function fullInvitation(scope: Scope): Promise<Facts> {
  assert([scope.inviterId, scope.invitationId, scope.subjectId, scope.tokenId, scope.candidateId].every(id => UUID.test(id))
    && /^[a-f0-9]{64}$/.test(scope.emailHmac), "Exact native invitation scope required");
  const admin = adminClient(), facts: Facts = {};
  for (const [name, query] of [
    ["profiles", admin.from("profiles").select("*", { count: "exact" }).eq("id", scope.inviterId)],
    ["subjects", admin.from("subjects").select("*", { count: "exact" }).or(`owner_account_id.eq.${scope.inviterId},id.eq.${scope.subjectId}`)],
    ["principals", admin.from("subject_principals").select("*", { count: "exact" }).or(`account_id.eq.${scope.inviterId},subject_id.eq.${scope.subjectId}`)],
    ["invitations", admin.from("subject_invitations").select("*", { count: "exact" }).eq("id", scope.invitationId)],
    ["tokens", admin.from("token_hashes").select("*", { count: "exact" }).eq("id", scope.tokenId)],
    ["candidates", admin.from("token_candidates").select("*", { count: "exact" }).eq("id", scope.candidateId)],
    ["sessions", admin.from("rights_sessions").select("*", { count: "exact" }).eq("token_hash_id", scope.tokenId)],
    ["drafts", admin.from("adult_subject_drafts").select("*", { count: "exact" }).eq("subject_id", scope.subjectId)],
    ["refusals", admin.from("invitation_refusal_hmacs").select("*", { count: "exact" }).eq("email_hmac", scope.emailHmac)],
    ["bars", admin.from("contact_refusal_bars").select("*", { count: "exact" }).eq("target_kind", "subject").eq("target_id", scope.subjectId)],
    ["artifacts", admin.from("consent_artifacts").select("*", { count: "exact" }).eq("artifact_key", "consent.subject-adult")],
  ] as const) {
    const result = await query;
    expect(result.error === null, `complete native withdrawal ${name}`).toBe(true);
    expect(result.count).not.toBeNull(); expect(result.data!.length).toBe(result.count); facts[name] = result.data!;
  }
  const subjectIds = facts.subjects.map(subject => subject.id as string);
  assert(subjectIds.length === 2 && subjectIds.every(id => UUID.test(id)), "Only actual inviter/self and reserved subject required");
  for (const [name, query] of [
    ["files", admin.from("genome_files").select("*", { count: "exact" }).in("subject_id", subjectIds)],
    ["grants", admin.from("purpose_grants").select("*", { count: "exact" }).eq("target_kind", "subject").in("target_id", subjectIds)],
    ["variant_calls", admin.from("user_variants").select("*", { count: "exact" }).in("subject_id", subjectIds)],
    ["observed_calls", admin.from("report_observed_calls").select("*", { count: "exact" }).in("subject_id", subjectIds)],
    ["scores", admin.from("user_prs").select("*", { count: "exact" }).in("subject_id", subjectIds)],
  ] as const) {
    const result = await query;
    expect(result.error === null, `complete native withdrawal ${name}`).toBe(true);
    expect(result.count).not.toBeNull(); expect(result.data!.length).toBe(result.count); facts[name] = result.data!;
  }
  const sessionIds = facts.sessions.map(row => row.id as string);
  assert(sessionIds.length === 1 && sessionIds.every(id => UUID.test(id)), "One real activated rights session required");
  const nonces = await admin.from("rights_nonces").select("*", { count: "exact" }).in("rights_session_id", sessionIds);
  expect(nonces.error === null).toBe(true); expect(nonces.count).not.toBeNull();
  expect(nonces.data!.length).toBe(nonces.count); facts.nonces = nonces.data!;
  for (const rows of Object.values(facts)) rows.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  return facts;
}

function pendingInvitation(facts: Facts, scope: Scope) {
  for (const name of ["profiles", "invitations", "tokens", "candidates", "sessions", "drafts"]) expect(facts[name]).toHaveLength(1);
  expect(facts.invitations[0]).toMatchObject({ id: scope.invitationId, invitation_kind: "adult_subject", status: "pending",
    terminal_at: null, target_kind: "subject", target_id: scope.subjectId, email_hmac: scope.emailHmac });
  expect(Date.parse(String(facts.invitations[0].expires_at))).toBeGreaterThan(Date.now());
  expect(facts.tokens[0]).toMatchObject({ id: scope.tokenId, candidate_id: scope.candidateId, status: "consumed" });
  expect(facts.candidates[0]).toMatchObject({ id: scope.candidateId, target_kind: "subject_invitation",
    target_id: scope.invitationId, purpose: "adult-subject-invitation", state: "issued" });
  expect(facts.sessions[0]).toMatchObject({ token_hash_id: scope.tokenId, target_kind: "subject", target_id: scope.subjectId,
    purpose: "adult-subject-invitation", status: "active", ended_at: null });
  expect(facts.sessions[0].principal_id).toBe(facts.invitations[0].invitee_principal_id);
  expect(facts.sessions[0].authority_revision).toBe(facts.invitations[0].invitation_revision);
  expect(facts.tokens[0].token_revision).toBe(facts.candidates[0].token_revision);
  expect(facts.principals.find(row => row.id === facts.invitations[0].inviter_principal_id))
    .toMatchObject({ account_id: scope.inviterId, principal_kind: "account_subject", status: "active" });
  expect(facts.principals.find(row => row.id === facts.sessions[0].principal_id))
    .toMatchObject({ subject_id: scope.subjectId, account_id: null, principal_kind: "non_account_subject", status: "pending" });
  expect(facts.artifacts.length).toBeGreaterThan(0);
  expect(Date.parse(String(facts.sessions[0].expires_at))).toBeGreaterThan(Date.now());
  expect(facts.subjects.find(row => row.id === scope.subjectId)).toMatchObject({ owner_account_id: scope.inviterId,
    subject_account_id: null, lifecycle: "draft", subject_class: "other_adult" });
  for (const name of ["files", "grants", "variant_calls", "observed_calls", "scores", "refusals", "bars"]) expect(facts[name]).toEqual([]);
}

function refusedInvitation(before: Facts, after: Facts, scope: Scope) {
  expect(after.invitations).toHaveLength(1);
  expect(after.invitations[0]).toMatchObject({ id: scope.invitationId, target_id: scope.subjectId, status: "refused", accepted_at: null });
  expect(typeof after.invitations[0].terminal_at).toBe("string");
  expect(after.sessions).toHaveLength(1);
  expect(after.sessions[0]).toMatchObject({ id: before.sessions[0].id, token_hash_id: scope.tokenId, status: "consumed" });
  expect(typeof after.sessions[0].ended_at).toBe("string");
  expect(after.subjects.find(row => row.id === scope.subjectId)).toMatchObject({ id: scope.subjectId,
    owner_account_id: scope.inviterId, subject_account_id: null, lifecycle: "purged" });
  expect(after.principals.filter(row => row.subject_id === scope.subjectId)).toHaveLength(1);
  expect(after.principals.find(row => row.subject_id === scope.subjectId)?.status).toBe("deleted");
  expect(after.drafts).toEqual([]); expect(after.candidates[0]).toMatchObject({ id: scope.candidateId, state: "invalidated" });
  expect(after.refusals.length).toBeGreaterThan(0); expect(after.bars.length).toBeGreaterThan(0);
  for (const bar of after.bars) {
    expect(bar).toMatchObject({ target_kind: "subject", target_id: scope.subjectId });
    expect(Date.parse(String(bar.expires_at))).toBeGreaterThan(Date.now());
  }
  for (const name of ["profiles", "tokens", "files", "grants", "variant_calls", "observed_calls", "scores", "artifacts"])
    expect(after[name], "the real refusal does not mutate the inviter or fabricate genetic access/output").toEqual(before[name]);
  expect(after.subjects.filter(row => row.id !== scope.subjectId)).toEqual(before.subjects.filter(row => row.id !== scope.subjectId));
  expect(after.principals.filter(row => row.subject_id !== scope.subjectId)).toEqual(before.principals.filter(row => row.subject_id !== scope.subjectId));
}

async function refusalUi(page: Page, pending: boolean) {
  await expect(page.getByRole("heading", { level: 1, name: "Review invitation", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "No genetic data has been shared", exact: true })).toBeVisible();
  await expect(page.getByText("Accepting creates a reserved subject under your account. It does not give the sender access, permission to upload, or permission to analyse your genetic data.", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Sign in to accept", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Accept through my account", exact: true })).toHaveCount(0);
  const saving = page.locator('[role="status"][data-state="processing"]');
  if (pending) {
    await expect(saving).toHaveText("Saving your choice…"); await expect(saving).toBeVisible();
    await expect(saving).toHaveAttribute("aria-live", "polite");
    await expect(page.getByRole("button", { name: "Refuse", exact: true })).toBeDisabled();
    await expect(page.getByRole("button", { name: "Delete reserved record", exact: true })).toBeDisabled();
  } else {
    await expect(saving).toHaveCount(0); await expect(page.getByRole("button", { name: "Refuse", exact: true })).toBeEnabled();
  }
  await expect(page.getByRole("heading", { name: "Invitation refused", exact: true })).toHaveCount(0);
  await expect(page.locator("main").getByRole("alert")).toHaveCount(0);
  await expect(page.locator("main [data-figure-kind], main [data-personal-preview]")).toHaveCount(0);
}

async function completedUi(page: Page) {
  await expect(page.getByRole("heading", { level: 1, name: "Invitation refused", exact: true })).toBeVisible();
  await expect(page.getByText("The reserved subject was closed. This address will not receive another invitation for this target.", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Refuse", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Delete reserved record", exact: true })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Sign in to accept", exact: true })).toHaveCount(0);
  await expect(page.locator('[role="status"][data-state="processing"]')).toHaveCount(0);
  await expect(page.locator("main").getByRole("alert")).toHaveCount(0);
  await expect(page.locator("main [data-figure-kind], main [data-personal-preview]")).toHaveCount(0);
}

/** The actual signed-out mailbox holder refuses the actual native invitation.
 * The sole barrier continues the original POST; it never supplies a reply. */
export function realWithdrawalDensityFixtures(input: {
  root: string; browser: Browser; origin: string; register: DensityRegister;
  findActualInvitation: (address: string) => ActualEmail | undefined;
  observeState: (row: DensityStateCase, page: Page, sourceSha256: string,
    facts: { scope: Scope; nativeSnapshot: Facts }) => Promise<unknown>;
}): DensityStateFixture[] {
  const origin = new URL(input.origin);
  assert(origin.protocol === "http:" && ["localhost", "127.0.0.1"].includes(origin.hostname)
    && origin.pathname === "/" && !origin.username && !origin.password && !origin.search && !origin.hash,
  "Existing disposable local app required");
  const sourcePath = "e2e/helpers/density-withdrawal-state-fixtures.ts";
  const sourceSha256 = createHash("sha256").update(fs.readFileSync(path.join(input.root, sourcePath))).digest("hex");
  // Main's older component does not expose this live region. Missing exact
  // current T7 source composition stays visible as an absent pending provider.
  const adultForm = fs.readFileSync(path.join(input.root, "src/components/embryo/adult-subject-review-form.tsx"), "utf8");
  const pendingAvailable = adultForm.includes('data-state="processing"') && adultForm.includes("Saving your choice…");
  return densityCapturePlan(input.register, []).states.flatMap(row => {
    const recipe = withdrawalDensityRecipe(row); if (!recipe || recipe === "refuse-pending" && !pendingAvailable) return [];
    return [{ routeId: row.route.id, state: row.state, sourcePath, sourceSha256,
      withState: async ({ viewport }, capture) => {
        const context = await input.browser.newContext({ baseURL: origin.origin, viewport, deviceScaleFactor: 1,
          colorScheme: "light", reducedMotion: "reduce", locale: "en-US", timezoneId: "UTC", serviceWorkers: "block" });
        const page = await context.newPage(), password = "synthetic-density-invitation-password";
        const inviterEmail = `density-inviter-${randomUUID()}@e2e.local`, recipientEmail = `density-refuser-${randomUUID()}@e2e.local`;
        let release: (() => void) | undefined;
        const originalRequest: { continuation?: Promise<Response> } = {};
        const endpoint = `${origin.origin}/api/withdraw/session`;
        let hold: ((route: Route) => Promise<void>) | undefined;
        try {
          const inviterId = await createConfirmedUser(inviterEmail, password); await signIn(page, inviterEmail, password);
          expect((await page.goto("/family/invite"))?.status()).toBe(200);
          await page.getByLabel("Their email address").fill(recipientEmail); await page.getByRole("checkbox").check();
          await page.getByRole("button", { name: "Send invitation", exact: true }).click();
          await expect(page.getByRole("status")).toContainText("Invitation requested");
          const message = await drainMailUntil(page.request, () => input.findActualInvitation(recipientEmail), "this signed-out refuser's actual invitation");
          expect([message.to].flat()).toContain(recipientEmail); expect(message.subject).toBe("You were invited to Inherit");
          const token = adultInvitationToken(message.html); assert(token, "The actual delivered fragment is required");
          expect(/\/withdraw\/[A-Za-z0-9_-]{43}/.test(message.html ?? "")).toBe(false);
          const tokenHash = createHash("sha256").update(token).digest("hex"), admin = adminClient();
          const invited = await admin.from("subject_invitations").select("*", { count: "exact" }).eq("token_hash", tokenHash);
          const credential = await admin.from("token_hashes").select("*", { count: "exact" }).eq("token_hash", tokenHash);
          expect(invited.error === null && invited.count === 1 && invited.data?.length === 1).toBe(true);
          expect(credential.error === null && credential.count === 1 && credential.data?.length === 1).toBe(true);
          const invitation = invited.data![0], tokenRow = credential.data![0];
          const scope: Scope = { inviterId, invitationId: invitation.id, subjectId: invitation.target_id,
            tokenId: tokenRow.id, candidateId: tokenRow.candidate_id, emailHmac: invitation.email_hmac };
          const signedOut = await signOut(page); expect(signedOut.status()).toBeLessThan(400);
          await context.clearCookies(); expect(await context.cookies()).toEqual([]);
          expect((await page.goto(adultInvitationUrl(token, origin.origin)))?.status()).toBe(200);
          await expect(page).toHaveURL(`${origin.origin}/withdraw/request`);
          expect((await admin.from("token_hashes").select("status").eq("id", scope.tokenId).single()).data?.status).toBe("current");
          await page.getByRole("button", { name: "Continue", exact: true }).click();
          await expect(page).toHaveURL(`${origin.origin}/withdraw/session`);
          expect((await context.cookies()).some(cookie => /-auth-token(?:\.\d+)?$/.test(cookie.name))).toBe(false);
          await refusalUi(page, false);
          const before = await fullInvitation(scope); pendingInvitation(before, scope);
          let intercepted = 0;
          const barrier = new Promise<void>(resolve => { release = resolve; });
          hold = async route => {
            if (route.request().method() !== "POST") { await route.continue(); return; }
            intercepted += 1;
            const body = route.request().postDataJSON() as Record<string, unknown>;
            assert(intercepted === 1 && Object.keys(body).sort().join(",") === "nonce,operation"
              && body.operation === "refuse" && typeof body.nonce === "string" && body.nonce.length > 0
              && !route.request().url().includes(token) && !JSON.stringify(body).includes(token), "Only the original purpose-bound refusal may be held");
            originalRequest.continuation = (async () => {
              await barrier; await route.continue(); const response = await route.request().response();
              assert(response && await response.finished() === null, "The original refusal must settle completely"); return response;
            })();
            void originalRequest.continuation.catch(() => {}); await originalRequest.continuation;
          };
          await page.route(endpoint, hold); await page.getByRole("button", { name: "Refuse", exact: true }).click();
          await expect.poll(() => intercepted).toBe(1);
          if (recipe === "refuse-pending") {
            const observe = async () => {
              expect(intercepted).toBe(1); await refusalUi(page, true);
              const facts = await fullInvitation(scope); pendingInvitation(facts, scope);
              expect(facts, "the held refusal has not changed any complete native invitation/subject/session row").toEqual(before);
              return input.observeState(row, page, sourceSha256, { scope, nativeSnapshot: facts });
            };
            await observe(); await capture({ page, observe });
          }
          assert(release && originalRequest.continuation, "Only an actual started refusal may settle");
          release(); const actualResponse = await originalRequest.continuation;
          assert(actualResponse.status() === 202, "Actual native refusal did not finish");
          expect(await actualResponse.json()).toEqual({ status: "accepted", operation: "refuse" });
          expect(actualResponse.headers()["cache-control"]).toContain("no-store"); expect(intercepted).toBe(1);
          await completedUi(page);
          const after = await fullInvitation(scope); refusedInvitation(before, after, scope);
          if (recipe === "refused") {
            const observe = async () => {
              await completedUi(page); const facts = await fullInvitation(scope); refusedInvitation(before, facts, scope);
              expect(facts, "the full committed native refusal stays exact around capture").toEqual(after); expect(intercepted).toBe(1);
              return input.observeState(row, page, sourceSha256, { scope, nativeSnapshot: facts });
            };
            await observe(); await capture({ page, observe });
          }
        } finally {
          release?.();
          try { if (originalRequest.continuation) await originalRequest.continuation; } finally {
            try { if (hold) await page.unroute(endpoint, hold); } finally { await context.close(); }
          }
        }
      } } satisfies DensityStateFixture];
  });
}
