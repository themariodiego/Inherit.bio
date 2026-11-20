import { expect, test } from "./audited-test";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import type { APIRequestContext, Page } from "@playwright/test";
import { adminClient, adultInvitationToken, adultInvitationUrl, createConfirmedUser, drainMailUntil, findUserByEmail,
  signIn } from "./helpers";
import { signOut as signOutWithToken } from "./helpers/session-csrf";
import { JURISDICTION_AFFIRM, JURISDICTION_SELECT_LABEL } from "../src/copy/settings/jurisdiction";
import { ADULT_UPLOAD_REVISION_COPY as REVISION, OTHER_ADULT_UPLOAD_COPY as UPLOAD,
  PATH_B_REQUEST_COPY as REQUEST } from "../src/copy/upload/other-adult";
import { OTHER_ADULT_WITHDRAWAL_COPY as COPY, UPLOAD_PERMISSION_WITHDRAWN_NOTICE_COPY as NOTICE }
  from "../src/copy/upload/other-adult-withdrawal";
import { parseArtifactFile } from "../src/lib/legal/artifact-file";
import { artifactStatements } from "../src/lib/uploads/other-adult-upload";

/**
 * The uploader's withdrawal of its permission for another adult's file
 * (owner decision of 19 November 2026, "An uploader's withdrawal for another
 * adult's file deletes it, unless that adult holds the record themselves";
 * supabase/migrations/20261119160000_other_adult_upload_consent_withdrawal.sql).
 * TEST-LOCAL only, as Path B is.
 *
 * Through the real screens, Storage, mail and database: a person with no
 * account confirms a request and one file and leaves a second unconfirmed;
 * the uploader withdraws from that person's card, every file it added is
 * deleted, confirmed or not, and the person is sent the short notice. A
 * person who holds the record with their own account is shown no request
 * and nothing changes. The setup steps are those of e2e/other-adult-upload.spec.ts.
 *
 * Every selector and sentence of the control is pinned by
 * src/components/uploads/other-adult-withdrawal.test.ts against its markup.
 */

const FIXTURE = path.join(process.cwd(), "e2e/fixtures/tiny-grch38.vcf");
const UPLOADER_STATEMENTS = artifactStatements(parseArtifactFile(fs.readFileSync(path.join(process.cwd(),
  "content/legal/consent.upload-other-adult/v2.md"), "utf8"))!.body);
const PERSON_STATEMENTS = artifactStatements(parseArtifactFile(fs.readFileSync(path.join(process.cwd(),
  "content/legal/consent.subject-adult-esignature/v1.md"), "utf8"))!.body);
const PASSWORD = "synthetic-path-b-withdrawal-password";
const UPLOADER = { email: `path-b-withdraw-uploader-${randomUUID()}@e2e.local`, password: PASSWORD };
const NO_ACCOUNT = { email: `path-b-withdraw-person-${randomUUID()}@e2e.local`, name: "Synthetic Withdrawn" };
const ACCOUNT_PERSON = { email: `path-b-withdraw-account-${randomUUID()}@e2e.local`, name: "Synthetic Holder", password: PASSWORD };
const ORIGIN = "http://localhost:3100";
const CODE = /^\d{13}\.[A-Za-z0-9_-]{43}\.[0-9a-f]{64}$/u;

interface CapturedEmail { to: string[] | string; subject: string; html?: string }
const captured: CapturedEmail[] = [];
let resendMock: http.Server;

test.describe.configure({ mode: "serial" });
test.use({ trace: "off" }); // Never retain the restricted upload bearer.

test.beforeAll(async () => {
  resendMock = http.createServer((request, response) => {
    let body = "";
    request.on("data", chunk => (body += chunk));
    request.on("end", () => {
      if (request.method === "POST" && request.url?.includes("/emails")) {
        captured.push(JSON.parse(body) as CapturedEmail);
        response.writeHead(200, { "content-type": "application/json" })
          .end(JSON.stringify({ id: `path-b-withdrawal-${captured.length}` }));
        return;
      }
      response.writeHead(200).end("{}");
    });
  });
  await new Promise<void>(resolve => resendMock.listen(8124, "127.0.0.1", resolve));
  await createConfirmedUser(UPLOADER.email, UPLOADER.password);
  await createConfirmedUser(ACCOUNT_PERSON.email, ACCOUNT_PERSON.password);
});

test.afterAll(async () => {
  await new Promise<void>(resolve => resendMock.close(() => resolve()));
});

const mailTo = (address: string, subject: string) => () => captured.find(email =>
  (Array.isArray(email.to) ? email.to : [email.to]).includes(address) && email.subject === subject);

async function signOut(page: Page) {
  await signOutWithToken(page);
  await page.context().clearCookies();
}

async function openRightsLink(page: Page, html: string | undefined) {
  const token = adultInvitationToken(html);
  expect(token, "the mail carries one fragment token").toBeTruthy();
  await page.goto(adultInvitationUrl(token!));
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page).toHaveURL(`${ORIGIN}/withdraw/session`);
}

async function openPathB(page: Page) {
  await page.goto("/files/upload");
  const section = page.locator('[data-slot="other-adult-upload"]');
  await expect(section.getByRole("heading", { name: UPLOAD.heading })).toBeVisible();
  if (!(await section.locator("details").evaluate(element => (element as HTMLDetailsElement).open))) {
    await section.locator("summary").click();
  }
  return section;
}

/** The uploader reserves, signs and sends the request; the person signs it, with or without their account. */
async function confirmedPerson(page: Page, request: APIRequestContext, person: { email: string; name: string; password?: string }) {
  await signIn(page, UPLOADER.email, UPLOADER.password);
  const section = await openPathB(page);
  const form = section.locator('[data-slot="other-adult-new"]');
  await form.getByLabel(UPLOAD.nameLabel).fill(person.name);
  await form.getByLabel(UPLOAD.emailLabel).fill(person.email);
  await form.getByLabel(UPLOAD.birthLabel).fill("1980-05-05");
  await form.getByRole("button", { name: UPLOAD.detailsButton, exact: true }).click();
  const card = section.locator('[data-slot="other-adult-request"]').filter({ hasText: person.name });
  for (const statement of UPLOADER_STATEMENTS) await card.getByRole("checkbox", { name: statement, exact: true }).check();
  await card.getByLabel(UPLOAD.typedNameLabel).fill("Synthetic Uploader");
  await card.getByLabel(UPLOAD.requestEmailLabel).fill(person.email);
  await card.getByRole("button", { name: UPLOAD.signAndSendButton, exact: true }).click();
  const waiting = section.locator('[data-slot="other-adult-awaiting"]').filter({ hasText: person.name });
  await expect(waiting).toBeVisible();
  // Before the person answers there is no withdrawal to offer.
  await expect(waiting.locator('[data-slot="other-adult-withdrawal"]')).toHaveCount(0);
  const requestMail = await drainMailUntil(request, mailTo(person.email, "A request to add your DNA file to Inherit"),
    `the signature request to ${person.email}`);
  await signOut(page);
  if (person.password) await signIn(page, person.email, person.password);
  await openRightsLink(page, requestMail.html);
  const review = page.locator('[data-slot="path-b-request"]');
  for (const statement of PERSON_STATEMENTS) await review.getByRole("checkbox", { name: statement, exact: true }).check();
  if (!person.password) {
    await review.getByLabel(JURISDICTION_SELECT_LABEL).selectOption("GB");
    await review.getByRole("checkbox", { name: JURISDICTION_AFFIRM, exact: true }).check();
  }
  await review.getByLabel(REQUEST.typedNameLabel).fill(person.name);
  await review.getByRole("button", { name: REQUEST.signButton, exact: true }).click();
  await expect(page.getByRole("heading", { name: REQUEST.receipts.confirm.title })).toBeVisible();
  await signOut(page);
  const admin = adminClient();
  const uploaderId = (await findUserByEmail(admin, UPLOADER.email))!.id;
  const subject = await admin.from("subjects").select("id, subject_account_id").eq("owner_account_id", uploaderId)
    .eq("display_label", person.name).eq("subject_class", "other_adult").eq("lifecycle", "active").single();
  expect(subject.error).toBeNull();
  return { subjectId: subject.data!.id as string, uploaderId, held: subject.data!.subject_account_id as string | null };
}

/** The signed-in uploader adds the fixture for the person; the card then says it waits for them. */
async function addFile(page: Page, person: { name: string }) {
  const section = await openPathB(page);
  const card = section.locator('[data-slot="other-adult-ready"]').filter({ hasText: person.name });
  const finalized = page.waitForResponse(response => /\/api\/files\/[0-9a-f-]{36}\/finalize$/u.test(new URL(response.url()).pathname)
    && response.request().method() === "POST");
  const choosing = page.waitForEvent("filechooser");
  await card.getByRole("button", { name: UPLOAD.chooseButton, exact: true }).click();
  await (await choosing).setFiles(FIXTURE);
  expect((await finalized).status()).toBe(200);
  await expect(page.locator('[data-slot="other-adult-held"]').filter({ hasText: person.name }).getByRole("status"))
    .toHaveText(UPLOAD.pendingStatus(person.name));
}

/** The person says yes to their latest file from its notice. */
async function confirmFile(page: Page, request: APIRequestContext, person: { email: string; password?: string }) {
  const notice = await drainMailUntil(request, mailTo(person.email, "A DNA file was added for you on Inherit"),
    `the upload-time notice to ${person.email}`);
  captured.splice(captured.indexOf(notice), 1);
  if (person.password) await signIn(page, person.email, person.password);
  await openRightsLink(page, notice.html);
  await page.locator('[data-slot="adult-upload-revision"]').getByRole("button", { name: REVISION.confirmButton, exact: true }).click();
  await expect(page.getByRole("heading", { name: REVISION.receipts.confirm.title })).toBeVisible();
  await signOut(page);
}

test("the uploader withdraws for a person with no account: every file it added goes, confirmed or not, and the person is told", async ({ page, request }) => {
  const record = await confirmedPerson(page, request, NO_ACCOUNT);
  expect(record.held).toBeNull();
  await signIn(page, UPLOADER.email, UPLOADER.password);
  await addFile(page, NO_ACCOUNT);
  await signOut(page);
  await confirmFile(page, request, NO_ACCOUNT);
  await signIn(page, UPLOADER.email, UPLOADER.password);
  await addFile(page, NO_ACCOUNT);
  const admin = adminClient();
  const before = await admin.from("other_adult_held_uploads").select("id,state").eq("subject_id", record.subjectId).order("held_at");
  expect(before.data!.map(row => row.state)).toEqual(["confirmed", "pending"]);
  const consent = await admin.from("subject_consents").select("id").eq("subject_id", record.subjectId)
    .eq("account_id", record.uploaderId).eq("consent_type", "upload_class").is("revoked_at", null).single();
  expect(consent.error).toBeNull();

  const section = await openPathB(page);
  const card = section.locator('[data-slot="other-adult-held"]').filter({ hasText: NO_ACCOUNT.name });
  const control = card.locator('[data-slot="other-adult-withdrawal"]');
  await expect(control.getByRole("heading", { name: COPY.heading, exact: true })).toBeVisible();
  await expect(control).toContainText(COPY.summary(NO_ACCOUNT.name));
  let sent = 0;
  page.on("request", sent_ => {
    if (sent_.method() === "DELETE" && new URL(sent_.url()).pathname === `/api/subjects/${record.subjectId}`) sent++;
  });
  await control.getByTestId("other-adult-withdrawal").click();
  const dialog = control.getByRole("alertdialog", { name: COPY.confirmHeading(NO_ACCOUNT.name) });
  await expect(dialog).toBeVisible();
  for (const line of [...COPY.deletes(NO_ACCOUNT.name), COPY.notice(NO_ACCOUNT.name), COPY.irreversible]) {
    await expect(dialog).toContainText(line);
  }
  expect(sent).toBe(0);
  await dialog.getByRole("button", { name: COPY.cancelButton, exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(sent).toBe(0);
  await control.getByTestId("other-adult-withdrawal").click();
  const answered = page.waitForResponse(response => response.request().method() === "DELETE"
    && new URL(response.url()).pathname === `/api/subjects/${record.subjectId}`);
  await control.getByTestId("other-adult-withdrawal-confirm").click();
  const response = await answered;
  expect(response.status()).toBe(202);
  expect(await response.json()).toEqual({ status: "accepted" });
  expect(response.request().headers()["x-inherit-operation-nonce"]).toMatch(CODE);
  expect(response.request().headers()["x-inherit-csrf"]).toMatch(CODE);
  expect(response.request().postData()).toBeNull();
  expect(sent).toBe(1);
  const receipt = control.locator('[data-slot="other-adult-withdrawal-receipt"]');
  await expect(receipt).toContainText(COPY.receiptHeading);
  await expect(receipt).toContainText(COPY.receiptBody(NO_ACCOUNT.name));
  await expect(control.getByTestId("other-adult-withdrawal")).toHaveCount(0);

  const subject = await admin.from("subjects").select("lifecycle").eq("id", record.subjectId).single();
  expect(subject.data!.lifecycle).toBe("purged");
  const after = await admin.from("other_adult_held_uploads").select("state").eq("subject_id", record.subjectId).order("held_at");
  expect(after.data!.map(row => row.state)).toEqual(["withdrawn", "withdrawn"]);
  const ended = await admin.from("subject_consents").select("revoked_at,revocation_reason").eq("id", consent.data!.id).single();
  expect(ended.data!.revocation_reason).toBe("withdrawn");
  expect(ended.data!.revoked_at).not.toBeNull();

  // The person's short notice, through the terminal-notice queue the mail job drains.
  const mail = await drainMailUntil(request, mailTo(NO_ACCOUNT.email, "An invitation on Inherit has ended"),
    `the withdrawal notice to ${NO_ACCOUNT.email}`);
  expect(mail.html).toContain(NOTICE.heading);
  expect(mail.html).toContain(NOTICE.body);
  expect(mail.html).not.toContain("href=\"http");

  // The card is gone once the page renders again.
  const again = await openPathB(page);
  await expect(again.locator('[data-slot="other-adult-withdrawal"]')).toHaveCount(0);
  await expect(again.getByText(NO_ACCOUNT.name)).toHaveCount(0);
});

test("a person who holds the record with their own account: no request is offered, and nothing changes", async ({ page, request }) => {
  const record = await confirmedPerson(page, request, ACCOUNT_PERSON);
  const personId = (await findUserByEmail(adminClient(), ACCOUNT_PERSON.email))!.id;
  expect(record.held).toBe(personId);
  await signIn(page, UPLOADER.email, UPLOADER.password);
  await addFile(page, ACCOUNT_PERSON);
  const section = await openPathB(page);
  const control = section.locator('[data-slot="other-adult-held"]').filter({ hasText: ACCOUNT_PERSON.name })
    .locator('[data-slot="other-adult-withdrawal"]');
  await expect(control.locator('[data-slot="other-adult-withdrawal-reason"]')).toHaveText(COPY.accountHeldStatus(ACCOUNT_PERSON.name));
  await expect(control.getByRole("button")).toHaveCount(0);
  const admin = adminClient();
  const subject = await admin.from("subjects").select("lifecycle,owner_account_id,subject_account_id").eq("id", record.subjectId).single();
  expect(subject.data).toEqual({ lifecycle: "active", owner_account_id: record.uploaderId, subject_account_id: personId });
  const held = await admin.from("other_adult_held_uploads").select("state").eq("subject_id", record.subjectId);
  expect(held.data!.map(row => row.state)).toEqual(["pending"]);
});
