import { randomUUID } from "node:crypto";
import http from "node:http";
import type { BrowserContext, Page } from "@playwright/test";
import { expect, test } from "./audited-test";
import { adminClient, createConfirmedUser, DEFAULT_TEST_JURISDICTION, drainMailUntil, signIn } from "./helpers";
import { signStatements } from "./embryo-signing-helpers";
import { observeNativeResponses } from "./helpers/native-response-observer";
import { SIGN_BUTTON } from "@/copy/embryos/signing";
import { FINALIZE_BUTTON, parentEmailLabel, SAVE_DRAFT_BUTTON, SEND_INVITATION_BUTTON } from "@/copy/embryos/upload";
import { EMBRYO_UPLOADER_WITHDRAWAL_COPY as COPY } from "@/copy/embryos/uploader-withdrawal";

/**
 * A non-parent uploader's withdrawal of its permission for an embryo upload
 * (owner decision of 19 November 2026, "A non-parent uploader's withdrawal
 * for an embryo upload stops analysis and deletes, as they signed";
 * supabase/migrations/20261119170000_embryo_uploader_consent_withdrawal.sql).
 * TEST-LOCAL only, as embryo upload is.
 *
 * Through the real screens and database: before finalisation the uploader
 * withdraws from /embryos/upload and the draft is cancelled, its invitations
 * end and it is queued for deletion; after finalisation the uploader
 * withdraws from the cohort's card on /embryos, the cohort is restricted under
 * the register's actor case nonparent-required-uploader-basis-loss and both
 * genetic parents are sent the restriction notice, while the uploader gains
 * no parent role. The steps up to finalisation are those of
 * e2e/embryo-third-party-journey.spec.ts, without the file.
 *
 * Every selector and sentence of the control is pinned by
 * src/components/embryo/uploader-withdrawal.test.ts against its markup.
 */

const PASSWORD = "synthetic-embryo-withdrawal-password";
const CODE = /^\d{13}\.[A-Za-z0-9_-]{43}\.[0-9a-f]{64}$/u;
const messages: { to: string | string[]; html?: string; subject?: string }[] = [];
let mail: http.Server;

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  mail = http.createServer((request, response) => {
    let body = "";
    request.on("data", chunk => { body += chunk; });
    request.on("end", () => {
      if (request.method === "POST" && request.url?.includes("/emails")) messages.push(JSON.parse(body));
      response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ id: randomUUID() }));
    });
  });
  await new Promise<void>(resolve => mail.listen(8124, "127.0.0.1", resolve));
});
test.afterAll(async () => { mail?.closeAllConnections(); if (mail) await new Promise<void>(resolve => mail.close(() => resolve())); });

/** A third-party draft through the real screens: the uploader names both parents and signs the uploader form. */
async function signedDraft(page: Page, uploaderEmail: string, parentEmails: readonly string[]) {
  const uploader = await createConfirmedUser(uploaderEmail, PASSWORD);
  await signIn(page, uploaderEmail, PASSWORD);
  await page.goto("/embryos/upload");
  // Before the draft exists, and before it is signed, there is nothing to withdraw.
  await expect(page.locator('[data-slot="embryo-uploader-withdrawal"]')).toHaveCount(0);
  await page.getByRole("radio", { name: "Yes", exact: true }).check();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.locator('button[data-option="one-file-columns"]').click();
  await page.getByRole("radio", { name: "Embryos, with both genetic parents’ permission", exact: true }).check();
  await page.locator('[data-slot="attestation"] input').check();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.locator('button[data-option="two-evidenced-parents"]').click();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByLabel("Number of embryos in the file").fill("2");
  for (const [index, email] of parentEmails.entries()) await page.getByLabel(parentEmailLabel(index, 2), { exact: true }).fill(email);
  await page.getByRole("button", { name: SAVE_DRAFT_BUTTON }).click();
  await expect(page.locator('[data-stage="owner-sign"]')).toBeVisible();
  await expect(page.locator('[data-slot="embryo-uploader-withdrawal"]')).toHaveCount(0);
  await signStatements(page, SIGN_BUTTON, uploader, "Synthetic Uploader");
  await expect(page.locator('[data-stage="invite"]')).toBeVisible();
  for (const [index, email] of parentEmails.entries()) await page.getByLabel(parentEmailLabel(index, 2), { exact: true }).fill(email);
  await page.getByRole("button", { name: SEND_INVITATION_BUTTON }).click();
  await expect(page.locator('[data-stage="waiting"]')).toBeVisible();
  const admin = adminClient();
  const draft = await admin.from("embryo_cohort_drafts").select("id,uploader_principal_id").eq("owner_account_id", uploader).single();
  expect(draft.error).toBeNull();
  const signature = await admin.from("consent_signatures").select("id").eq("target_kind", "cohort_draft").eq("target_id", draft.data!.id)
    .eq("purpose", "embryo-upload-uploader-class").eq("signer_account_id", uploader).single();
  expect(signature.error).toBeNull();
  return { uploader, draftId: draft.data!.id as string, uploaderPrincipal: draft.data!.uploader_principal_id as string,
    signatureId: signature.data!.id as string };
}

/** From the control in view: open the confirmation, read it, cancel once, confirm, and wait for the receipt. */
async function withdrawFromHere(page: Page, signatureId: string, phase: "cohort" | "draft") {
  const section = page.locator(`[data-slot="embryo-uploader-withdrawal"][data-phase="${phase}"]`);
  await expect(section.getByRole("heading", { name: COPY.heading, exact: true })).toBeVisible();
  await expect(section).toContainText(phase === "draft" ? COPY.draftSummary : COPY.cohortSummary);
  let sent = 0;
  page.on("request", request => {
    if (request.method() === "POST" && new URL(request.url()).pathname === `/api/consents/${signatureId}/revoke`) sent++;
  });
  await section.getByTestId("embryo-uploader-withdrawal").click();
  const dialog = section.getByRole("alertdialog", { name: phase === "draft" ? COPY.draftConfirmHeading : COPY.cohortConfirmHeading });
  await expect(dialog).toBeVisible();
  for (const line of [...(phase === "draft" ? COPY.draftDeletes : COPY.cohortDeletes), COPY.noRole, COPY.irreversible]) {
    await expect(dialog).toContainText(line);
  }
  await dialog.getByRole("button", { name: COPY.cancelButton, exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(sent).toBe(0);
  await section.getByTestId("embryo-uploader-withdrawal").click();
  // The control reads only the status of a `no-store` answer, whose unread
  // body Chromium never reports as loaded: read it from the browser's own fetch.
  const observer = await observeNativeResponses(page, { withdrawal: `^/api/consents/${signatureId}/revoke$` }, "POST");
  const answered = page.waitForResponse(response => response.request().method() === "POST"
    && new URL(response.url()).pathname === `/api/consents/${signatureId}/revoke`);
  await section.getByTestId("embryo-uploader-withdrawal-confirm").click();
  const response = await answered;
  expect(response.status()).toBe(202);
  const native = await observer.read("withdrawal");
  await observer.dispose();
  expect(native.status).toBe(response.status());
  expect(JSON.parse(native.text)).toEqual({ status: "accepted" });
  expect(response.request().headers()["x-inherit-operation-nonce"]).toMatch(CODE);
  expect(response.request().headers()["x-inherit-csrf"]).toMatch(CODE);
  expect(response.request().postData()).toBeNull();
  expect(sent).toBe(1);
  const receipt = page.locator('[data-slot="embryo-uploader-withdrawal-receipt"]');
  await expect(receipt).toContainText(COPY.receiptHeading);
  await expect(receipt).toContainText(phase === "draft" ? COPY.draftReceiptBody : COPY.cohortReceiptBody);
  await expect(page.getByTestId("embryo-uploader-withdrawal")).toHaveCount(0);
}

test("before finalisation the uploader withdraws on the upload page: the draft is cancelled and its invitations end", async ({ page }) => {
  const parents = [`embryo-withdraw-draft-a-${randomUUID()}@e2e.local`, `embryo-withdraw-draft-b-${randomUUID()}@e2e.local`];
  const draft = await signedDraft(page, `embryo-withdraw-draft-${randomUUID()}@e2e.local`, parents);
  await withdrawFromHere(page, draft.signatureId, "draft");
  const admin = adminClient();
  expect((await admin.from("embryo_cohort_drafts").select("state").eq("id", draft.draftId).single()).data).toEqual({ state: "cancelled" });
  const invitations = await admin.from("subject_invitations").select("status").eq("target_kind", "cohort_draft").eq("target_id", draft.draftId);
  expect(invitations.error).toBeNull();
  expect(invitations.data!.length).toBeGreaterThan(0);
  expect(invitations.data!.every(row => row.status !== "pending")).toBe(true);
  const due = await admin.from("retention_due_phases").select("status,immutable_envelope")
    .eq("retention_id", "embryo.cohort-draft-30d").eq("target_id", draft.draftId).single();
  expect(due.error).toBeNull();
  expect(due.data!.status).toBe("pending");
  const audit = await admin.from("legal_audit_log").select("coded_context,audit_principal_id").eq("event_code", "embryo.upload-consent.withdrawn")
    .eq("route_id", "api.consent-revoke").order("seq", { ascending: false }).limit(1).single();
  expect(audit.data!.coded_context).toEqual({ phase: "draft", actor_case: "nonparent-required-uploader-basis-loss" });
  expect(audit.data!.audit_principal_id).not.toBeNull();
  // The page now starts again from step 1, and offers nothing to withdraw.
  await page.reload();
  await expect(page.locator('[data-slot="embryo-uploader-withdrawal"]')).toHaveCount(0);
});

test("after finalisation the uploader withdraws on the cohort's card: the cohort is restricted and both parents are told", async ({ page, browser }) => {
  test.setTimeout(240_000);
  const parentEmails = [`embryo-withdraw-parent-a-${randomUUID()}@e2e.local`, `embryo-withdraw-parent-b-${randomUUID()}@e2e.local`];
  const parents = await Promise.all(parentEmails.map(email => createConfirmedUser(email, PASSWORD)));
  const draft = await signedDraft(page, `embryo-withdraw-cohort-${randomUUID()}@e2e.local`, parentEmails);
  const contexts: BrowserContext[] = [];
  try {
    for (const [index, email] of parentEmails.entries()) {
      const context = await browser.newContext();
      contexts.push(context);
      const parent = await context.newPage();
      await signIn(parent, email, PASSWORD);
      const message = await drainMailUntil(page.request, () => messages.find(item => [item.to].flat().includes(email)
        && item.html?.includes("/withdraw/request#")), `the invitation to ${email}`);
      const invitation = message.html!.match(/http:\/\/localhost:\d+\/withdraw\/request#[A-Za-z0-9_-]{43}/u)?.[0];
      expect(invitation).toBeTruthy();
      await parent.goto(new URL(invitation!).pathname + new URL(invitation!).hash);
      await parent.getByRole("button", { name: "Continue", exact: true }).click();
      // `all()` does not wait: the review must be on screen before its boxes are read (as in the third-party journey).
      await expect(parent.getByRole("heading", { name: "Review this invitation before you sign" })).toBeVisible();
      for (const box of await parent.getByRole("checkbox").all()) await box.check();
      await parent.getByLabel("Country where you live").selectOption(DEFAULT_TEST_JURISDICTION);
      await parent.getByLabel("Full legal name").fill(`Synthetic Parent ${index + 1}`);
      await parent.getByRole("button", { name: "Sign and accept invitation" }).click();
      await expect(parent.getByRole("heading", { name: "You have accepted the invitation", exact: true })).toBeVisible();
      await parent.goto("/embryos/upload");
      await expect(parent.locator('[data-stage="co-parent-sign"]')).toBeVisible();
      await signStatements(parent, SIGN_BUTTON, parents[index]!, `Synthetic Parent ${index + 1}`);
      // A genetic parent is never offered the uploader's withdrawal.
      await expect(parent.locator('[data-slot="embryo-uploader-withdrawal"]')).toHaveCount(0);
    }
    await page.reload();
    await expect(page.locator('[data-stage="acknowledge"]')).toBeVisible();
    const finalized = page.waitForResponse(response => new URL(response.url()).pathname === "/api/embryo-cohorts" && response.request().method() === "POST");
    await signStatements(page, FINALIZE_BUTTON, draft.uploader, "Synthetic Uploader");
    expect((await finalized).status()).toBe(201);
    const admin = adminClient();
    const cohort = await admin.from("embryo_cohorts").select("id,status,upload_class").eq("draft_id", draft.draftId).single();
    expect(cohort.error).toBeNull();
    expect(cohort.data).toMatchObject({ upload_class: "embryo_third_party" });
    const cohortId = cohort.data!.id as string;
    const setsBefore = await admin.from("embryo_participant_sets").select("set_kind,principal_id").eq("cohort_id", cohortId).is("revoked_at", null);
    expect(setsBefore.data!.some(row => row.principal_id === draft.uploaderPrincipal)).toBe(false);

    for (const context of contexts) {
      const parent = context.pages()[0]!;
      await parent.goto("/embryos");
      await expect(parent.locator(`[data-slot="cohort-card"][data-cohort-id="${cohortId}"]`)).toHaveCount(1);
      await expect(parent.locator('[data-slot="embryo-uploader-withdrawal"]')).toHaveCount(0);
    }
    await page.goto("/embryos");
    const card = page.locator(`[data-slot="cohort-card"][data-cohort-id="${cohortId}"]`);
    await expect(card).toHaveCount(1);
    await withdrawFromHere(page, draft.signatureId, "cohort");

    expect((await admin.from("embryo_cohorts").select("status").eq("id", cohortId).single()).data).toEqual({ status: "restricted" });
    const subjects = await admin.from("subjects").select("lifecycle").eq("cohort_id", cohortId);
    expect(new Set(subjects.data!.map(row => row.lifecycle))).toEqual(new Set(["restricted"]));
    const notices = await admin.from("mail_outbox").select("recipient_principal_id").eq("template_id", "cohort-restriction-notice")
      .eq("target_id", cohortId);
    expect(notices.error).toBeNull();
    const parentPrincipals = setsBefore.data!.filter(row => row.set_kind === "notice_recipients").map(row => row.principal_id).sort();
    expect(notices.data!.map(row => row.recipient_principal_id).sort()).toEqual(parentPrincipals);
    const setsAfter = await admin.from("embryo_participant_sets").select("set_kind,principal_id").eq("cohort_id", cohortId).is("revoked_at", null);
    expect(setsAfter.data!.some(row => row.principal_id === draft.uploaderPrincipal)).toBe(false);
    expect(setsAfter.data!.length).toBe(setsBefore.data!.length);
    const restricted = await admin.from("legal_audit_log").select("audit_principal_id").eq("event_code", "embryo.cohort.restricted")
      .eq("route_id", "api.consent-revoke").order("seq", { ascending: false }).limit(1).single();
    expect(restricted.data!.audit_principal_id).not.toBeNull();
    // The restricted cohort is no longer listed for anyone.
    await page.reload();
    await expect(page.locator(`[data-slot="cohort-card"][data-cohort-id="${cohortId}"]`)).toHaveCount(0);
  } finally { for (const context of contexts) await context.close(); }
});
