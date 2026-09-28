import { expect, test } from "./audited-test";
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import type { Page, APIRequestContext } from "@playwright/test";
import {
  adminClient,
  adultInvitationToken,
  adultInvitationUrl,
  completeOwnUploadConsent,
  createConfirmedUser,
  drainMailUntil,
  findUserByEmail,
  jobRan,
  JOBS_SECRET,
  signIn,
} from "./helpers";
import { EMAIL_LABEL, REQUESTED_HEADING, SEND_BUTTON } from "../src/copy/family/invite";
import { JURISDICTION_AFFIRM, JURISDICTION_SELECT_LABEL } from "../src/copy/settings/jurisdiction";
import {
  ADULT_UPLOAD_REVISION_COPY as REVISION,
  OTHER_ADULT_UPLOAD_COPY as COPY,
  PATH_B_REQUEST_COPY as REQUEST,
} from "../src/copy/upload/other-adult";
import { day } from "../src/components/uploads/other-adult-lines";
import { parseArtifactFile } from "../src/lib/legal/artifact-file";
import { artifactStatements, heldFinalizationReceipt } from "../src/lib/uploads/other-adult-upload";

/**
 * Another adult's DNA under the register's Path B, "I have their file"
 * (G2.6 adult half, G5.3; owner decision of 2026-09-28). TEST-LOCAL only.
 *
 * Both journeys go through the real screens, Storage, mail and database:
 *   1. a Path A invitation offers its inviter nothing to upload; then the
 *      uploader asks a person to sign, the person signs with no account, the
 *      uploader adds a file, which is stored with no readable row and a notice
 *      queued in the same commit; the notice reaches the person, who says yes
 *      to that one file, and still nothing reads it;
 *   2. a second person signs, a file is added, the person says no to it with
 *      no account, and the retention job deletes it, with a privileged
 *      re-query showing zero rows and zero Storage objects.
 */

const FIXTURE = path.join(process.cwd(), "e2e/fixtures/tiny-grch38.vcf");
const BYTES = fs.readFileSync(FIXTURE);
const SHA256 = createHash("sha256").update(BYTES).digest("hex");
const UPLOADER_ARTIFACT = parseArtifactFile(fs.readFileSync(path.join(process.cwd(),
  "content/legal/consent.upload-other-adult/v2.md"), "utf8"))!;
const PERSON_ARTIFACT = parseArtifactFile(fs.readFileSync(path.join(process.cwd(),
  "content/legal/consent.subject-adult-esignature/v1.md"), "utf8"))!;
const UPLOADER_STATEMENTS = artifactStatements(UPLOADER_ARTIFACT.body);
const PERSON_STATEMENTS = artifactStatements(PERSON_ARTIFACT.body);
const PASSWORD = "synthetic-path-b-password";
const UPLOADER = { email: `path-b-uploader-${randomUUID()}@e2e.local`, password: PASSWORD };
const PATH_A_INVITEE = `path-a-invitee-${randomUUID()}@e2e.local`;
const CONFIRMER = { email: `path-b-confirmer-${randomUUID()}@e2e.local`, name: "Synthetic Confirmer" };
const REFUSER = { email: `path-b-refuser-${randomUUID()}@e2e.local`, name: "Synthetic Refuser" };
const ORIGIN = "http://localhost:3100";

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
          .end(JSON.stringify({ id: `path-b-${captured.length}` }));
        return;
      }
      response.writeHead(200).end("{}");
    });
  });
  await new Promise<void>(resolve => resendMock.listen(8124, "127.0.0.1", resolve));
  await createConfirmedUser(UPLOADER.email, UPLOADER.password);
});

test.afterAll(async () => {
  await new Promise<void>(resolve => resendMock.close(() => resolve()));
});

function mailTo(address: string, subject: string) {
  return () => captured.find(email => (Array.isArray(email.to) ? email.to : [email.to]).includes(address)
    && email.subject === subject);
}

async function signOut(page: Page) {
  await page.request.post("/auth/sign-out");
  await page.context().clearCookies();
}

/** Open a mailed rights link the way a person does: the interstitial, then the session page. */
async function openRightsLink(page: Page, html: string | undefined) {
  const token = adultInvitationToken(html);
  expect(token, "the mail carries one fragment token").toBeTruthy();
  await page.goto(adultInvitationUrl(token!));
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page).toHaveURL(`${ORIGIN}/withdraw/session`);
}

/**
 * The Path B section of the upload page, opened. It is secondary to the
 * person's own upload, so it starts closed until the account has someone in it.
 */
async function openPathB(page: Page) {
  await page.goto("/files/upload");
  const section = page.locator('[data-slot="other-adult-upload"]');
  await expect(section.getByRole("heading", { name: COPY.heading })).toBeVisible();
  if (!(await section.locator("details").evaluate(element => (element as HTMLDetailsElement).open))) {
    await section.locator("summary").click();
  }
  await expect(section.getByRole("note")).toHaveText(COPY.testNote);
  return section;
}

/**
 * The whole Path B setup for one person, through the screens: the uploader
 * reserves the draft, signs, and sends the request; the person signs with no
 * account. Returns the person's subject id.
 */
async function pathBPerson(page: Page, request: APIRequestContext, person: { email: string; name: string }) {
  const section = await openPathB(page);
  const form = section.locator('[data-slot="other-adult-new"]');
  await form.getByLabel(COPY.nameLabel).fill(person.name);
  await form.getByLabel(COPY.emailLabel).fill(person.email);
  await form.getByLabel(COPY.birthLabel).fill("1980-05-05");
  const reserved = page.waitForResponse(response => response.url().endsWith("/api/subject-drafts")
    && response.request().method() === "POST");
  await form.getByRole("button", { name: COPY.detailsButton, exact: true }).click();
  expect((await reserved).status()).toBe(201);

  // Tier 2: every statement is its own checkbox, and the words beside it are
  // the approved artifact's own numbered statements.
  const card = section.locator('[data-slot="other-adult-request"]').filter({ hasText: person.name });
  await expect(card).toHaveCount(1);
  expect(UPLOADER_STATEMENTS).toHaveLength(7);
  const send = card.getByRole("button", { name: COPY.signAndSendButton, exact: true });
  for (const statement of UPLOADER_STATEMENTS) {
    await expect(send).toBeDisabled();
    await card.getByRole("checkbox", { name: statement, exact: true }).check();
  }
  await card.getByLabel(COPY.typedNameLabel).fill("Synthetic Uploader");
  await card.getByLabel(COPY.requestEmailLabel).fill(person.email);
  const signed = page.waitForResponse(response => response.url().endsWith("/api/consents")
    && response.request().method() === "POST");
  const sent = page.waitForResponse(response => response.url().endsWith("/api/invitations")
    && response.request().method() === "POST");
  await send.click();
  expect((await signed).status()).toBe(201);
  expect((await sent).status()).toBe(202);
  const waiting = section.locator('[data-slot="other-adult-awaiting"]').filter({ hasText: person.name });
  await expect(waiting.getByRole("status")).toContainText(`Waiting for ${person.name} to sign.`);

  // The person signs their own artifact from the request mail, with no account.
  const requestMail = await drainMailUntil(request, mailTo(person.email, "A request to add your DNA file to Inherit"),
    `the signature request to ${person.email}`);
  expect(requestMail.html).toContain("you do not need an account");
  await signOut(page);
  await openRightsLink(page, requestMail.html);
  const review = page.locator('[data-slot="path-b-request"]');
  await expect(review.getByRole("heading", { name: REQUEST.heading })).toBeVisible();
  await expect(review.getByText(REQUEST.detail(person.name), { exact: true })).toBeVisible();
  expect(PERSON_STATEMENTS).toHaveLength(4);
  const sign = review.getByRole("button", { name: REQUEST.signButton, exact: true });
  for (const statement of PERSON_STATEMENTS) {
    await expect(sign).toBeDisabled();
    await review.getByRole("checkbox", { name: statement, exact: true }).check();
  }
  await review.getByLabel(JURISDICTION_SELECT_LABEL).selectOption("GB");
  await review.getByRole("checkbox", { name: JURISDICTION_AFFIRM, exact: true }).check();
  await review.getByLabel(REQUEST.typedNameLabel).fill(person.name);
  await sign.click();
  await expect(page.getByRole("heading", { name: REQUEST.receipts.confirm.title })).toBeVisible();

  // An uploader-owned other_adult subject with no account of its own.
  const uploaderId = (await findUserByEmail(adminClient(), UPLOADER.email))!.id;
  const subject = await adminClient().from("subjects").select("id, lifecycle, subject_account_id")
    .eq("owner_account_id", uploaderId).eq("display_label", person.name).eq("subject_class", "other_adult").single();
  expect(subject.error).toBeNull();
  expect(subject.data).toMatchObject({ lifecycle: "active", subject_account_id: null });
  return subject.data!.id as string;
}

/** Add the fixture for one person as the signed-in uploader; returns the held revision. */
async function addFile(page: Page, person: { name: string }) {
  await page.goto("/files/upload");
  const card = page.locator('[data-slot="other-adult-ready"]').filter({ hasText: person.name });
  await expect(card.getByRole("button", { name: COPY.chooseButton, exact: true })).toBeEnabled();
  const finalized = page.waitForResponse(response => /\/api\/files\/[0-9a-f-]{36}\/finalize$/.test(response.url())
    && response.request().method() === "POST");
  await card.locator('[data-slot="other-adult-file"]').setInputFiles(FIXTURE);
  const response = await finalized;
  expect(response.status()).toBe(200);
  // The register's file-finalize-v1 other-adult outcome, exactly.
  const receipt = heldFinalizationReceipt.parse(await response.json());
  expect(receipt.noticeState).toBe("queued");
  const held = page.locator('[data-slot="other-adult-held"]').filter({ hasText: person.name });
  await expect(held.getByRole("status")).toHaveText(COPY.pendingStatus(person.name));
  const row = await adminClient().from("other_adult_held_uploads")
    .select("id, upload_session_id, subject_id, state, object_name, raw_sha256, notice_outbox_id")
    .eq("id", receipt.fileId).single();
  expect(row.error).toBeNull();
  expect(row.data).toMatchObject({ state: "pending", raw_sha256: SHA256 });
  return row.data as { id: string; upload_session_id: string; subject_id: string; object_name: string; notice_outbox_id: string };
}

/** Derived genetic rows for one account, which must stay zero for another adult's file. */
async function derivedRows(accountId: string) {
  const admin = adminClient();
  const counts: Record<string, number> = {};
  for (const table of ["genome_files", "user_variants", "report_observed_calls", "user_prs", "ancestry_results", "worker_jobs"]) {
    const result = await admin.from(table).select("*", { count: "exact", head: true }).eq("user_id", accountId);
    expect(result.error, table).toBeNull();
    counts[table] = result.count ?? 0;
  }
  return counts;
}
const NONE = { genome_files: 0, user_variants: 0, report_observed_calls: 0, user_prs: 0, ancestry_results: 0, worker_jobs: 0 };

test("another adult's file under Path B: signed without an account, held unreadable with its notice, then confirmed file by file", async ({ page, request }) => {
  test.setTimeout(360_000);
  const admin = adminClient();
  const uploaderId = (await findUserByEmail(admin, UPLOADER.email))!.id;
  await signIn(page, UPLOADER.email, UPLOADER.password);
  await completeOwnUploadConsent(page);

  // Path A stays Path A: an invitation to use Inherit offers its inviter
  // nothing to sign and nothing to upload.
  await page.goto("/family/invite");
  await page.getByLabel(EMAIL_LABEL).fill(PATH_A_INVITEE);
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: SEND_BUTTON }).click();
  await expect(page.getByRole("status")).toContainText(REQUESTED_HEADING);
  const section = await openPathB(page);
  await expect(section.locator('[data-slot="other-adult-new"]')).toBeVisible();
  await expect(section.locator("article:not([data-slot='other-adult-new'])")).toHaveCount(0);

  const subjectId = await pathBPerson(page, request, CONFIRMER);
  await signOut(page);
  await signIn(page, UPLOADER.email, UPLOADER.password);
  const held = await addFile(page, CONFIRMER);
  expect(held.subject_id).toBe(subjectId);

  // Quarantined: the bytes are stored (a privileged read proves it), the
  // notice was queued in the same commit, and nothing anyone can read exists.
  const stored = await admin.storage.from("genomes").download(held.object_name);
  expect(stored.error).toBeNull();
  expect(Buffer.from(await stored.data!.arrayBuffer())).toEqual(BYTES);
  const notice = await admin.from("mail_outbox").select("template_id, target_id").eq("id", held.notice_outbox_id).single();
  expect(notice.data).toEqual({ template_id: "adult-upload-notice", target_id: held.id });
  expect(await derivedRows(uploaderId)).toEqual(NONE);
  const byObject = await admin.from("genome_files").select("id", { count: "exact", head: true }).eq("bucket_path", held.object_name);
  expect(byObject.count, "no reader can address a held source").toBe(0);
  const jobs = await admin.from("worker_jobs").select("id", { count: "exact", head: true }).eq("subject_id", subjectId);
  expect(jobs.count).toBe(0);
  // Nor through a file route, by either identifier the uploader could hold.
  for (const id of [held.id, held.upload_session_id]) {
    expect((await page.request.get(`/api/files/${id}/download`)).ok()).toBe(false);
  }
  await page.goto("/files");
  await expect(page.locator('[data-slot="other-adult-held-rows"]').getByRole("status"))
    .toHaveText(COPY.pendingStatus(CONFIRMER.name));

  // The upload-time notice reaches the person; they see what the uploader
  // sees and say yes to this one file, with no account.
  const noticeMail = await drainMailUntil(request, mailTo(CONFIRMER.email, "A DNA file was added for you on Inherit"),
    `the upload-time notice to ${CONFIRMER.email}`);
  expect(noticeMail.html).toContain("If you do nothing, it is deleted on");
  await signOut(page);
  await openRightsLink(page, noticeMail.html);
  const screen = page.locator('[data-slot="adult-upload-revision"]');
  await expect(screen.getByRole("heading", { name: REVISION.heading })).toBeVisible();
  await expect(screen.getByText(REVISION.see(CONFIRMER.name), { exact: true })).toBeVisible();
  await expect(screen.getByText(REVISION.nothingYet, { exact: true })).toBeVisible();
  await screen.getByRole("button", { name: REVISION.confirmButton, exact: true }).click();
  await expect(page.getByRole("heading", { name: REVISION.receipts.confirm.title })).toBeVisible();

  // Confirmed, and the quarantine is lifted only for this revision. The
  // other_adult analysis gate is not built, so the register's
  // confirmed_blocked_current_gate outcome holds: still nothing reads it.
  const confirmed = await admin.from("other_adult_held_uploads").select("state, analysis_state, confirmed_at")
    .eq("id", held.id).single();
  expect(confirmed.data).toMatchObject({ state: "confirmed", analysis_state: "confirmed_blocked_current_gate" });
  expect(confirmed.data!.confirmed_at).not.toBeNull();
  expect(await derivedRows(uploaderId)).toEqual(NONE);
  expect((await admin.from("genome_files").select("id", { count: "exact", head: true })
    .eq("bucket_path", held.object_name)).count).toBe(0);
  expect((await admin.from("worker_jobs").select("id", { count: "exact", head: true }).eq("subject_id", subjectId)).count).toBe(0);

  // The uploader sees one line: the person accepted the file, and nothing is made yet.
  const added = await admin.from("other_adult_held_uploads").select("held_at").eq("id", held.id).single();
  await signIn(page, UPLOADER.email, UPLOADER.password);
  await page.goto("/files");
  await expect(page.locator('[data-slot="other-adult-held-rows"]').getByRole("status"))
    .toHaveText(COPY.confirmedStatus(CONFIRMER.name, day(added.data!.held_at as string)));
});

test("another adult's file under Path B: refused without an account, then deleted with nothing left", async ({ page, request }) => {
  test.setTimeout(360_000);
  const admin = adminClient();
  await signIn(page, UPLOADER.email, UPLOADER.password);
  const subjectId = await pathBPerson(page, request, REFUSER);
  await signIn(page, UPLOADER.email, UPLOADER.password);
  const held = await addFile(page, REFUSER);
  const session = await admin.from("upload_sessions").select("staging_object_name").eq("id", held.upload_session_id).single();
  expect(session.error).toBeNull();
  const staging = session.data!.staging_object_name as string;

  const noticeMail = await drainMailUntil(request, mailTo(REFUSER.email, "A DNA file was added for you on Inherit"),
    `the upload-time notice to ${REFUSER.email}`);
  await signOut(page);
  await openRightsLink(page, noticeMail.html);
  const screen = page.locator('[data-slot="adult-upload-revision"]');
  await expect(screen.getByRole("heading", { name: REVISION.heading })).toBeVisible();
  await screen.getByRole("button", { name: REVISION.refuseButton, exact: true }).click();
  await expect(page.getByRole("heading", { name: REVISION.receipts.refuse.title })).toBeVisible();

  const refused = await admin.from("other_adult_held_uploads").select("state").eq("id", held.id).single();
  expect(refused.data?.state).toBe("refused");
  // Only that file ends: the person's signature and subject stay.
  const subject = await admin.from("subjects").select("lifecycle").eq("id", subjectId).single();
  expect(subject.data?.lifecycle).toBe("active");

  // The retention job's upload cleanup deletes the source. Its drain takes a
  // few due sessions per run, so on a shared database it may take more than one.
  for (let run = 0; run < 10; run++) {
    const remaining = await admin.from("upload_sessions").select("id", { count: "exact", head: true })
      .eq("id", held.upload_session_id);
    if (remaining.count === 0) break;
    await jobRan(await request.post("/api/jobs/retention", { headers: { authorization: `Bearer ${JOBS_SECRET}` } }),
      `retention run ${run + 1}`);
  }
  // Privileged re-query: zero rows and zero Storage objects.
  for (const [table, column, value] of [
    ["upload_sessions", "id", held.upload_session_id],
    ["other_adult_held_uploads", "id", held.id],
    ["genome_files", "bucket_path", held.object_name],
    ["worker_jobs", "subject_id", subjectId],
  ] as const) {
    const result = await admin.from(table).select("*", { count: "exact", head: true }).eq(column, value);
    expect(result.error, table).toBeNull();
    expect(result.count, `${table} after refusal`).toBe(0);
  }
  for (const name of [held.object_name, staging]) {
    const object = await admin.storage.from("genomes").download(name);
    expect(object.error, `Storage object ${name} is gone`).not.toBeNull();
  }
});
