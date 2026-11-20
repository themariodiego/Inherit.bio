import { randomUUID } from "node:crypto";
import http from "node:http";
import path from "node:path";
import type { Page } from "@playwright/test";
import { expect, test } from "./audited-test";
import { adminClient, createConfirmedUser, drainMailUntil, signIn } from "./helpers";
import { observeNativeResponses } from "./helpers/native-response-observer";
import { uploadOwnFilePrepared } from "./own-report-helpers";
import { OWN_UPLOAD_COPY } from "../src/copy/upload/consent";
import { OWN_UPLOAD_WITHDRAWAL_COPY as COPY, OWN_UPLOAD_WITHDRAWAL_EMAIL_COPY as EMAIL } from "../src/copy/upload/withdrawal";

/**
 * Withdrawing the consent to store one's own DNA file (owner decision of 19
 * November 2026, "Withdrawing consent for a person's own DNA file deletes the
 * files and all made from them";
 * supabase/migrations/20261119150000_own_upload_consent_withdrawal.sql).
 *
 * One control, on /settings/consents and on /files, leads to the same
 * confirmation, sends the self case of api.subject-delete, and shows a
 * receipt. The record is emptied in the database, the upload consent is
 * marked withdrawn and kept, the account stays, the confirmation email goes
 * out, and the upload page asks for the consent again. Each journey uses its
 * own synthetic account and a real upload through the page.
 *
 * Every selector and sentence here is pinned by
 * src/components/uploads/own-upload-withdrawal.test.ts against the
 * component's own markup.
 */

interface CapturedEmail { to: string[] | string; subject: string; html?: string }
const captured: CapturedEmail[] = [];
let resendMock: http.Server;

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  resendMock = http.createServer((request, response) => {
    let body = "";
    request.on("data", (chunk) => (body += chunk));
    request.on("end", () => {
      if (request.method === "POST" && request.url?.includes("/emails")) {
        captured.push(JSON.parse(body) as CapturedEmail);
        response.writeHead(200, { "content-type": "application/json" })
          .end(JSON.stringify({ id: `own-upload-withdrawal-${captured.length}` }));
        return;
      }
      response.writeHead(200).end("{}");
    });
  });
  await new Promise<void>((resolve) => resendMock.listen(8124, "127.0.0.1", resolve));
});

test.afterAll(async () => {
  await new Promise<void>((resolve) => resendMock.close(() => resolve()));
});

const FIXTURE = path.join(process.cwd(), "e2e/fixtures/tiny-grch38.vcf");

/** A fresh account, signed in, with one prepared own file: the upload consent is live. */
async function accountWithOneFile(page: Page, label: string) {
  const email = `${label}-${randomUUID()}@e2e.local`;
  const password = "synthetic-withdrawal-password";
  const accountId = await createConfirmedUser(email, password);
  await signIn(page, email, password);
  const fileId = await uploadOwnFilePrepared(page, FIXTURE, { fileType: "vcf" });
  const admin = adminClient();
  const subject = await admin.from("subjects").select("id").eq("subject_account_id", accountId).eq("subject_class", "self").single();
  expect(subject.error).toBeNull();
  const consent = await admin.from("subject_consents").select("id,revoked_at")
    .eq("subject_id", subject.data!.id).eq("account_id", accountId).eq("consent_type", "upload_class").is("revoked_at", null);
  expect(consent.error).toBeNull();
  expect(consent.data, "the upload consent is live before the withdrawal").toHaveLength(1);
  return { email, accountId, fileId, subjectId: subject.data!.id as string, consentId: consent.data![0]!.id as string };
}

/** From the control on the page in view: open the confirmation, read it, confirm, and wait for the receipt. */
async function withdrawFromHere(page: Page, subjectId: string) {
  const section = page.locator('[data-slot="own-upload-withdrawal"]');
  await expect(section.getByRole("heading", { name: COPY.heading, exact: true })).toBeVisible();
  await expect(section).toContainText(COPY.summary);
  // Nothing is sent by the trigger: it only opens the confirmation.
  let sent = 0;
  page.on("request", (request) => {
    if (request.method() === "DELETE" && new URL(request.url()).pathname === `/api/subjects/${subjectId}`) sent++;
  });
  await section.getByTestId("own-upload-withdrawal").click();
  const dialog = section.getByRole("alertdialog", { name: COPY.confirmHeading });
  await expect(dialog).toBeVisible();
  for (const line of [...COPY.deletes, ...COPY.keeps, COPY.afterwards, COPY.irreversible]) await expect(dialog).toContainText(line);
  expect(sent).toBe(0);
  // Cancelling closes it and sends nothing.
  await dialog.getByRole("button", { name: COPY.cancelButton, exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(sent).toBe(0);
  await section.getByTestId("own-upload-withdrawal").click();
  // The control reads only the status, and the answer is `no-store`: Chromium
  // never reports the load of an unread no-store fetch body as finished, so
  // `response.json()` would wait for ever. The body is read from the
  // browser's own fetch instead; the app still receives the original answer.
  const observer = await observeNativeResponses(page, { withdrawal: `^/api/subjects/${subjectId}$` }, "DELETE");
  const answered = page.waitForResponse((response) => response.request().method() === "DELETE"
    && new URL(response.url()).pathname === `/api/subjects/${subjectId}`);
  await section.getByTestId("own-upload-withdrawal-confirm").click();
  const response = await answered;
  expect(response.status()).toBe(202);
  const native = await observer.read("withdrawal");
  await observer.dispose();
  expect(native.status).toBe(response.status());
  expect(JSON.parse(native.text)).toEqual({ status: "accepted" });
  const headers = response.request().headers();
  expect(headers["x-inherit-operation-nonce"]).toMatch(/^\d{13}\.[A-Za-z0-9_-]{43}\.[0-9a-f]{64}$/u);
  expect(headers["x-inherit-csrf"]).toMatch(/^\d{13}\.[A-Za-z0-9_-]{43}\.[0-9a-f]{64}$/u);
  expect(response.request().postData()).toBeNull();
  expect(sent).toBe(1);
  const receipt = section.locator('[data-slot="own-upload-withdrawal-receipt"]');
  await expect(receipt.getByRole("heading", { name: COPY.receiptHeading, exact: true })).toBeVisible();
  await expect(receipt).toContainText(COPY.receiptBody);
  await expect(section.getByTestId("own-upload-withdrawal")).toHaveCount(0);
}

/** What the database holds after the withdrawal: the consent kept and withdrawn, the file gone, the account kept. */
async function expectWithdrawn(account: Awaited<ReturnType<typeof accountWithOneFile>>) {
  const admin = adminClient();
  const consent = await admin.from("subject_consents").select("revoked_at,revocation_reason").eq("id", account.consentId).single();
  expect(consent.error).toBeNull();
  expect(consent.data!.revocation_reason).toBe("withdrawn");
  expect(consent.data!.revoked_at).not.toBeNull();
  const live = await admin.from("subject_consents").select("id", { count: "exact", head: true })
    .eq("subject_id", account.subjectId).is("revoked_at", null);
  expect(live.count).toBe(0);
  const signatures = await admin.from("consent_signatures").select("artifact_key")
    .eq("target_kind", "subject").eq("target_id", account.subjectId).eq("artifact_key", "consent.upload-self");
  expect(signatures.data, "the signature stays as it was signed").toHaveLength(1);
  // The route drained the one file through the per-file pipeline before answering.
  expect((await admin.from("genome_files").select("id").eq("id", account.fileId)).data).toEqual([]);
  expect((await admin.from("subjects").select("subject_class,lifecycle").eq("id", account.subjectId).single()).data)
    .toEqual({ subject_class: "self", lifecycle: "active" });
  const user = await admin.auth.admin.getUserById(account.accountId);
  expect(user.error).toBeNull();
  const mail = await admin.from("mail_outbox").select("state,target_kind").eq("template_id", "upload-consent-withdrawn")
    .eq("target_id", account.subjectId);
  expect(mail.error).toBeNull();
  expect(mail.data).toHaveLength(1);
  expect(mail.data![0]!.target_kind).toBe("subject");
}

/** The upload page asks for the own-upload consent again (the insurance disclosure stays read). */
async function expectUploadAsksAgain(page: Page) {
  await page.goto("/files/upload");
  await expect(page.getByRole("heading", { name: OWN_UPLOAD_COPY.ownHeading, exact: true })).toBeVisible();
  await expect(page.getByRole("checkbox", { name: OWN_UPLOAD_COPY.ownCheckbox, exact: true })).toBeVisible();
  // The own-upload stage shows the picker shut until the consent is signed
  // again (own-upload-flow.tsx; e2e/own-upload-consent.spec.ts asserts the same stage).
  await expect(page.getByRole("button", { name: "Choose file", exact: true })).toBeDisabled();
  await expect(page.locator('input[type="file"]')).toBeDisabled();
}

test("own upload withdrawal from Settings: the confirmation, the receipt, the email, an empty Files page and the consent asked again", async ({ page }) => {
  const account = await accountWithOneFile(page, "own-withdraw-settings");
  await page.goto("/settings/consents");
  await expect(page.getByRole("heading", { name: "Consents", exact: true })).toBeVisible();
  await withdrawFromHere(page, account.subjectId);
  await expectWithdrawn(account);

  // The page rendered again without the consent, and the control does not come back.
  await page.reload();
  await expect(page.locator('[data-slot="own-upload-withdrawal"]')).toHaveCount(0);

  const email = await drainMailUntil(page.request, () => captured.find((mail) =>
    (Array.isArray(mail.to) ? mail.to : [mail.to]).includes(account.email) && mail.subject === EMAIL.emailSubject),
  "the withdrawal confirmation");
  for (const line of [EMAIL.heading, EMAIL.deleting, EMAIL.sharing, EMAIL.afterwards]) expect(email.html).toContain(line);

  await page.goto("/files");
  await expect(page.getByRole("heading", { name: "My files", exact: true })).toBeVisible();
  await expect(page.locator(`a[href="/api/files/${account.fileId}/download"]`)).toHaveCount(0);
  await expect(page.locator('[data-slot="own-upload-withdrawal"]')).toHaveCount(0);
  await expectUploadAsksAgain(page);
});

test("own upload withdrawal from the Files page leads to the same confirmation and receipt", async ({ page }) => {
  const account = await accountWithOneFile(page, "own-withdraw-files");
  await page.goto("/files");
  await expect(page.locator(`a[href="/api/files/${account.fileId}/download"]`)).toHaveCount(1);
  await withdrawFromHere(page, account.subjectId);
  await expectWithdrawn(account);
  await expect(page.locator(`a[href="/api/files/${account.fileId}/download"]`)).toHaveCount(0);
  await expectUploadAsksAgain(page);
});

test("own upload withdrawal is not offered without a live upload consent", async ({ page }) => {
  const email = `own-withdraw-none-${randomUUID()}@e2e.local`;
  const password = "synthetic-withdrawal-password";
  await createConfirmedUser(email, password);
  await signIn(page, email, password);
  for (const at of ["/settings/consents", "/files"]) {
    await page.goto(at);
    await expect(page.locator("main")).toBeVisible();
    await expect(page.locator('[data-slot="own-upload-withdrawal"]'), at).toHaveCount(0);
    await expect(page.getByTestId("own-upload-withdrawal"), at).toHaveCount(0);
  }
});
