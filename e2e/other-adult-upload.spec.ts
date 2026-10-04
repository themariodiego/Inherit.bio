import { expect, test } from "./audited-test";
import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
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
  SUPABASE_URL,
  SERVICE_KEY,
} from "./helpers";
import { route } from "../src/lib/primary-routes";
import { GATE_BUTTON, GATE_CHECKBOX_LABEL } from "../src/copy/family/person";
import { EMAIL_LABEL, REQUESTED_HEADING, SEND_BUTTON } from "../src/copy/family/invite";
import { JURISDICTION_AFFIRM, JURISDICTION_SELECT_LABEL } from "../src/copy/settings/jurisdiction";
import {
  ADULT_UPLOAD_REVISION_COPY as REVISION,
  HELD_FOR_YOU_COPY as HELD,
  OTHER_ADULT_UPLOAD_COPY as COPY,
  PATH_B_REQUEST_COPY as REQUEST,
} from "../src/copy/upload/other-adult";
import { day } from "../src/components/uploads/other-adult-lines";
import { observeNativeResponses } from "./helpers/native-response-observer";
import { PATH_B_CHOICES_COPY as CHOICES } from "../src/copy/upload/other-adult";
import { parseArtifactFile } from "../src/lib/legal/artifact-file";
import { artifactStatements, heldFinalizationReceipt } from "../src/lib/uploads/other-adult-upload";
import { directUploadReceipt } from "../src/lib/uploads/subject-upload-contract";

/**
 * Another adult's DNA under the register's Path B, "I have their file"
 * (G2.6 adult half, G5.3; owner decision of 2026-09-28). TEST-LOCAL only.
 *
 * These journeys go through the real screens, Storage, mail and database:
 *   1. a Path A invitation offers its inviter nothing to upload; then the
 *      uploader asks a person to sign, the person signs with no account, the
 *      uploader adds a file, which is stored with no readable row and a notice
 *      queued in the same commit; the notice reaches the person, who says yes
 *      to that one file, and still nothing reads it;
 *   2. a second person signs, a file is added, the person says no to it with
 *      no account, and the retention job deletes it, with a privileged
 *      re-query showing zero rows and zero Storage objects;
 *   3. Path B's account branch: a person signed in with the invited address
 *      signs with that account (its declared country counts), sees the file
 *      on their own Files page, and says yes to it signed in; only an unreadable
 *      descriptor and pending normalization job exist until the worker runs;
 *   4. completed normalization and queued reports reach only the explicitly
 *      selected readers, through the real session gate and revocation.
 */

const FIXTURE = path.join(process.cwd(), "e2e/fixtures/tiny-grch38.vcf");
const BYTES = fs.readFileSync(FIXTURE);
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
const ACCOUNT_PERSON = { email: `path-b-account-${randomUUID()}@e2e.local`, name: "Synthetic Accountholder",
  password: PASSWORD };
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
async function pathBPerson(page: Page, request: APIRequestContext,
  person: { email: string; name: string; password?: string }) {
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
  // Path B's account branch: a person with an account signs in first, and
  // then signs with that account; their declared country counts.
  if (person.password) await signIn(page, person.email, person.password);
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
  if (person.password) {
    await expect(review.locator('[data-slot="path-b-account"]')).toHaveText(REQUEST.accountNote("United Kingdom"));
    await expect(review.getByLabel(JURISDICTION_SELECT_LABEL)).toHaveCount(0);
  } else {
    await review.getByLabel(JURISDICTION_SELECT_LABEL).selectOption("GB");
    await review.getByRole("checkbox", { name: JURISDICTION_AFFIRM, exact: true }).check();
  }
  await review.getByLabel(REQUEST.typedNameLabel).fill(person.name);
  await sign.click();
  await expect(page.getByRole("heading", { name: REQUEST.receipts.confirm.title })).toBeVisible();

  // An uploader-owned other_adult subject: with no account of its own, or
  // bound to the person's own account.
  const admin = adminClient();
  const uploaderId = (await findUserByEmail(admin, UPLOADER.email))!.id;
  const personId = person.password ? (await findUserByEmail(admin, person.email))!.id : null;
  const subject = await admin.from("subjects").select("id, lifecycle, subject_account_id")
    .eq("owner_account_id", uploaderId).eq("display_label", person.name).eq("subject_class", "other_adult").single();
  expect(subject.error).toBeNull();
  expect(subject.data).toMatchObject({ lifecycle: "active", subject_account_id: personId });
  return subject.data!.id as string;
}

/** Add the fixture for one person as the signed-in uploader; returns the held revision. */
async function addFile(page: Page, person: { name: string }, fixture = FIXTURE) {
  const section = await openPathB(page);
  const card = section.locator('[data-slot="other-adult-ready"]').filter({ hasText: person.name });
  await expect(card.getByRole("button", { name: COPY.chooseButton, exact: true })).toBeEnabled();
  const observation = await observeNativeResponses(page, { issued: "^/api/files/upload-session$",
    finalize: "^/api/files/[0-9a-f-]{36}/finalize$" });
  const issuedHeaders = page.waitForResponse(response => response.url() === `${ORIGIN}/api/files/upload-session`
    && response.request().method() === "POST");
  const storedResponse = page.waitForResponse(response => {
    const url = new URL(response.url());
    return url.origin === SUPABASE_URL && /^\/storage\/v1\/object\/genomes\/[0-9a-f-]{36}$/.test(url.pathname)
      && !url.search && response.request().method() === "POST";
  });
  // Keep unused observations handled if an earlier stage refuses the upload.
  void issuedHeaders.catch(() => {}); void storedResponse.catch(() => {});
  let receipt: ReturnType<typeof heldFinalizationReceipt.parse>;
  let issued: ReturnType<typeof directUploadReceipt.parse>;
  try {
    const choosing = page.waitForEvent("filechooser");
    await card.getByRole("button", { name: COPY.chooseButton, exact: true }).click();
    await (await choosing).setFiles(fixture);
    const issuance = await observation.read("issued");
    expect(issuance.status, "the real browser must obtain a held-upload lease before finalization").toBe(201);
    issued = directUploadReceipt.parse(JSON.parse(issuance.text));
    expect(issued.maximumBytes).toBe(fs.statSync(fixture).size);
    expect((await issuedHeaders).headers()["cache-control"]).toBe("private, no-store");
    const stored = await storedResponse;
    expect(stored.url()).toBe(`${SUPABASE_URL}/storage/v1/object/genomes/${issued.stagingKey}`);
    expect(stored.status()).toBe(200);
    const response = await observation.read("finalize");
    expect(response.status).toBe(200);
    // The register's file-finalize-v1 other-adult outcome, exactly.
    receipt = heldFinalizationReceipt.parse(JSON.parse(response.text));
  } finally { await observation.dispose(); }
  expect(receipt.noticeState).toBe("queued");
  const held = page.locator('[data-slot="other-adult-held"]').filter({ hasText: person.name });
  await expect(held.getByRole("status")).toHaveText(COPY.pendingStatus(person.name));
  const row = await adminClient().from("other_adult_held_uploads")
    .select("id, upload_session_id, subject_id, state, object_name, raw_sha256, upload_revision, notice_outbox_id")
    .eq("id", receipt.fileId).single();
  expect(row.error).toBeNull();
  expect(row.data).toMatchObject({ state: "pending", upload_session_id: issued.uploadId,
    raw_sha256: createHash("sha256").update(fs.readFileSync(fixture)).digest("hex") });
  return row.data as { id: string; upload_session_id: string; subject_id: string; object_name: string;
    raw_sha256: string; upload_revision: number; notice_outbox_id: string };
}

/** Admission records only this pending source tuple; it cannot expose genetics. */
async function assertPendingNormalization(held: Awaited<ReturnType<typeof addFile>>, uploaderId: string) {
  const admin = adminClient();
  const source = await admin.from("genome_files")
    .select("id,user_id,subject_id,bucket_path,sha256,upload_revision,status,normalization_completed_at,normalization_source_revision")
    .eq("subject_id", held.subject_id);
  expect(source.error).toBeNull();
  expect(source.data).toEqual([{ id: held.id, user_id: uploaderId, subject_id: held.subject_id,
    bucket_path: held.object_name, sha256: held.raw_sha256, upload_revision: held.upload_revision,
    status: "uploaded", normalization_completed_at: null, normalization_source_revision: null }]);
  const jobs = await admin.from("worker_jobs")
    .select("kind,output_kind,status,user_id,file_id,subject_id,source_binding_kind,source_binding_id,source_binding_revision,file_sha256,computation_revision,attempts")
    .eq("subject_id", held.subject_id);
  expect(jobs.error).toBeNull();
  expect(jobs.data).toEqual([{ kind: "annotate_vcf", output_kind: "ingest.normalize", status: "queued",
    user_id: uploaderId, file_id: held.id, subject_id: held.subject_id, source_binding_kind: "genome-file",
    source_binding_id: held.id, source_binding_revision: held.upload_revision, file_sha256: held.raw_sha256,
    computation_revision: "path-b-normalization-v1", attempts: 0 }]);
  for (const table of ["user_variants", "report_observed_calls", "user_prs", "ancestry_results"] as const) {
    const result = await admin.from(table).select("*", { count: "exact", head: true }).eq("file_id", held.id);
    expect(result.error, table).toBeNull();
    expect(result.count, `${table} before the actual worker`).toBe(0);
  }
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
  // no-account mitigation remains closed, so the register's
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

test("another adult's file under Path B: confirmed into the person's own account, listed on their Files page, answered signed in", async ({ page, request }) => {
  test.setTimeout(360_000);
  const admin = adminClient();
  const personId = await createConfirmedUser(ACCOUNT_PERSON.email, ACCOUNT_PERSON.password);
  const uploaderId = (await findUserByEmail(admin, UPLOADER.email))!.id;
  await signIn(page, UPLOADER.email, UPLOADER.password);
  const subjectId = await pathBPerson(page, request, ACCOUNT_PERSON);

  // The subject stays the uploader's; only its one confirmation principal
  // became the person's account, and nothing grants or binds more.
  const principal = await admin.from("subject_principals").select("principal_kind, account_id, status")
    .eq("subject_id", subjectId).eq("status", "active").single();
  expect(principal.data).toEqual({ principal_kind: "account_subject", account_id: personId, status: "active" });
  expect((await admin.from("subject_account_bindings").select("id", { count: "exact", head: true })
    .eq("subject_id", subjectId)).count).toBe(0);

  await signIn(page, UPLOADER.email, UPLOADER.password);
  const held = await addFile(page, ACCOUNT_PERSON);
  expect(held.subject_id).toBe(subjectId);
  const dates = await admin.from("other_adult_held_uploads").select("held_at, fixed_deadline").eq("id", held.id).single();
  const added = day(dates.data!.held_at as string);

  // The person's own account lists the file: the name, the kind, the dates.
  await signOut(page);
  await signIn(page, ACCOUNT_PERSON.email, ACCOUNT_PERSON.password);
  await page.goto("/files");
  const mine = page.locator('[data-slot="held-for-you"]');
  await expect(mine.getByRole("heading", { name: HELD.heading })).toBeVisible();
  await expect(mine.getByText(HELD.name(ACCOUNT_PERSON.name), { exact: true })).toBeVisible();
  await expect(mine.getByRole("status")).toHaveText(HELD.pending(added, "vcf", day(dates.data!.fixed_deadline as string)));

  // The notice, answered while signed in as the person.
  const noticeMail = await drainMailUntil(request, mailTo(ACCOUNT_PERSON.email, "A DNA file was added for you on Inherit"),
    `the upload-time notice to ${ACCOUNT_PERSON.email}`);
  await openRightsLink(page, noticeMail.html);
  const screen = page.locator('[data-slot="adult-upload-revision"]');
  const confirmation = await observeNativeResponses(page, { confirm: "^/api/withdraw/session$" });
  try {
    await screen.getByRole("button", { name: REVISION.confirmButton, exact: true }).click();
    const response = await confirmation.read("confirm");
    expect(response).toEqual({ status: 202, text: JSON.stringify({ status: "accepted", operation: "confirm" }) });
    await expect(page.getByRole("heading", { name: REVISION.receipts.confirm.title })).toBeVisible();
  } finally { await confirmation.dispose(); }
  const confirmed = await admin.from("other_adult_held_uploads").select("state, analysis_state").eq("id", held.id).single();
  expect(confirmed.data).toEqual({ state: "confirmed", analysis_state: "confirmed_awaiting_purpose" });

  await page.goto("/files");
  await expect(page.locator('[data-slot="held-for-you"]').getByRole("status")).toHaveText(HELD.confirmed(added, "vcf"));
  // Seeing the file is not reading it: its one queued descriptor is unreadable.
  expect(await derivedRows(personId)).toEqual(NONE);
  await assertPendingNormalization(held, uploaderId);
  expect((await page.request.get(`/api/files/${held.id}/download`)).status()).toBe(404);
  expect((await page.request.get(route("genome.reports", { subject: `s-${subjectId}` }))).status()).toBe(404);

  // The reading layer records each explicit choice, while the source gate
  // remains closed for the person and the uploader alike.
  const choices = page.locator('[data-slot="path-b-choices"]');
  await expect(choices.getByRole("heading", { name: CHOICES.heading, exact: true })).toBeVisible();
  await expect(choices.getByText(CHOICES.detail, { exact: true })).toBeVisible();
  const grants: { id: string; direction: "self" | "uploader" }[] = [];
  for (const direction of ["self", "uploader"] as const) {
    const row = choices.locator(`[data-purpose="reports.monogenic"][data-direction="${direction}"]`);
    const who = direction === "self" ? CHOICES.forYou : CHOICES.forThem;
    const on = `${CHOICES.turnOn}: ${CHOICES.layers["reports.monogenic"]}, ${who.toLowerCase()}`;
    const off = `${CHOICES.turnOff}: ${CHOICES.layers["reports.monogenic"]}, ${who.toLowerCase()}`;
    await expect(row.getByRole("button", { name: on, exact: true })).toBeDisabled();
    await row.getByRole("checkbox").check();
    await expect(row.getByRole("button", { name: on, exact: true })).toBeEnabled();
    const observation = await observeNativeResponses(page, { grant: "^/api/consents$" });
    await row.getByRole("button", { name: on, exact: true }).click();
    const response = await observation.read("grant");
    expect(response.status).toBe(201);
    const receipt = JSON.parse(response.text) as { recordId: string };
    expect(Object.keys(receipt).sort()).toEqual(["artifactKey", "artifactVersion", "purposeKey", "recordId", "recordKind", "signedAt"]);
    expect(receipt).toMatchObject({ recordKind: "purpose_grant", purposeKey: "reports.monogenic",
      artifactKey: direction === "self" ? "consent.own-monogenic" : "consent.share-with-adult" });
    await expect(row.getByRole("button", { name: off, exact: true })).toBeVisible();
    await observation.dispose();
    const grant = await admin.from("directional_grants").select("direction, recipient_account_id, status")
      .eq("grant_id", receipt.recordId).single();
    expect(grant.error).toBeNull();
    expect(grant.data).toEqual({ direction: direction === "self" ? "self" : "subject_to_recipient",
      recipient_account_id: direction === "self" ? personId : (await findUserByEmail(admin, UPLOADER.email))!.id,
      status: "current" });
    grants.push({ id: receipt.recordId, direction });
    // Choosing a layer cannot run normalization or manufacture an analytic result.
    expect(await derivedRows(personId)).toEqual(NONE);
    await assertPendingNormalization(held, uploaderId);
    expect((await page.request.get(`/api/files/${held.id}/download`)).status()).toBe(404);
  }
  for (const grant of grants) {
    const row = choices.locator(`[data-purpose="reports.monogenic"][data-direction="${grant.direction}"]`);
    const who = grant.direction === "self" ? CHOICES.forYou : CHOICES.forThem;
    const observation = await observeNativeResponses(page, { revoke: `^/api/consents/${grant.id}/revoke$` });
    await row.getByRole("button", { name: `${CHOICES.turnOff}: ${CHOICES.layers["reports.monogenic"]}, ${who.toLowerCase()}`, exact: true }).click();
    const response = await observation.read("revoke");
    expect(response.status).toBe(200);
    const receipt = JSON.parse(response.text) as { effectiveAt: string };
    expect(Object.keys(receipt).sort()).toEqual(["effectiveAt", "revoked"]);
    expect(receipt).toMatchObject({ revoked: true });
    expect(Number.isFinite(Date.parse(receipt.effectiveAt))).toBe(true);
    await expect(row.getByRole("button", { name: `${CHOICES.turnOn}: ${CHOICES.layers["reports.monogenic"]}, ${who.toLowerCase()}`, exact: true })).toBeVisible();
    await observation.dispose();
    const ended = await admin.from("purpose_grants").select("revoked_at").eq("grant_id", grant.id).single();
    expect(ended.error).toBeNull();
    expect(ended.data?.revoked_at).not.toBeNull();
    const direction = await admin.from("directional_grants").select("status").eq("grant_id", grant.id).single();
    expect(direction.error).toBeNull();
    expect(direction.data?.status).toBe("revoked");
  }
  await signOut(page);
  await signIn(page, UPLOADER.email, UPLOADER.password);
  expect((await page.request.get(`/api/files/${held.id}/download`)).status()).toBe(404);
  expect((await page.request.get(route("genome.reports", { subject: `s-${subjectId}` }))).status()).toBe(404);
});

/** Use the registered operator doors, with real loopback storage/RPC reads.
 * No invented genotype/result row, generic worker or synchronous exception. */
async function runPathBOperator(kind: "normalization" | "report") {
  const script = kind === "normalization" ? "scripts/path-b-normalization-worker.run.mts" : "scripts/path-b-report-worker.run.mts";
  // The same selected loopback fixture environment the real admin re-queries
  // use. Only the operator process receives its service role; no browser does.
  const env = { apiOrigin: SUPABASE_URL, serviceRoleKey: SERVICE_KEY };
  let stdout: string;
  try {
    ({ stdout } = await promisify(execFile)(process.execPath, ["--conditions=react-server",
      "--import", "./scripts/server-only-shim.mjs", "--import", "tsx", script], {
      cwd: process.cwd(), timeout: 300_000, maxBuffer: 4096,
      env: { ...process.env, INHERIT_TEST_JURISDICTION: "1", NEXT_PUBLIC_SUPABASE_URL: env.apiOrigin,
        SUPABASE_SERVICE_ROLE_KEY: env.serviceRoleKey },
    }));
  } catch { throw new Error("The registered local Path B operator did not complete."); }
  expect(stdout).toBe(kind === "normalization" ? "path_b_normalization_normalized\n" : "path_b_report_complete\n");
}

async function choosePathBReport(page: Page, subjectId: string, purpose: "reports.monogenic" | "reports.polygenic", direction: "self" | "uploader") {
  await page.goto(route("files.index"));
  const row = page.locator(`[data-slot="path-b-choice"][data-purpose="${purpose}"][data-direction="${direction}"]`);
  const who = direction === "self" ? CHOICES.forYou : CHOICES.forThem;
  await row.getByRole("checkbox").check();
  const observation = await observeNativeResponses(page, { grant: "^/api/consents$" });
  await row.getByRole("button", { name: `${CHOICES.turnOn}: ${CHOICES.layers[purpose]}, ${who.toLowerCase()}`, exact: true }).click();
  const response = await observation.read("grant");
  expect(response.status).toBe(201);
  const receipt = JSON.parse(response.text) as { recordId: string; purposeKey: string };
  expect(Object.keys(receipt).sort()).toEqual(["artifactKey", "artifactVersion", "purposeKey", "recordId", "recordKind", "signedAt"]);
  expect(receipt.purposeKey).toBe(purpose);
  const grant = await adminClient().from("purpose_grants").select("target_id").eq("grant_id", receipt.recordId).single();
  expect(grant.error).toBeNull(); expect(grant.data?.target_id).toBe(subjectId);
  await expect(row.getByRole("button", { name: `${CHOICES.turnOff}: ${CHOICES.layers[purpose]}, ${who.toLowerCase()}`, exact: true })).toBeVisible();
  await observation.dispose();
  return receipt.recordId;
}

test("Path B queued reports: real confirmed source and operators, separate self/share readers, session gate and immediate revocation", async ({ page, browser, request }) => {
  test.setTimeout(600_000);
  const person = { email: `path-b-reader-${randomUUID()}@e2e.local`, name: "Synthetic Reportreader", password: PASSWORD };
  const personId = await createConfirmedUser(person.email, person.password);
  await signIn(page, UPLOADER.email, UPLOADER.password);
  const subjectId = await pathBPerson(page, request, person);
  await signOut(page);
  await signIn(page, UPLOADER.email, UPLOADER.password);
  const held = await addFile(page, person, path.join(process.cwd(), "e2e/fixtures/path-b-reports-grch38.vcf"));
  const personContext = await browser.newContext({ baseURL: ORIGIN });
  const reader = await personContext.newPage();
  try {
    await signIn(reader, person.email, person.password);
    // Real current insurance acknowledgement; no personal DNA file is added.
    await completeOwnUploadConsent(reader);
    const mail = await drainMailUntil(request, mailTo(person.email, "A DNA file was added for you on Inherit"), "the real report-source confirmation notice");
    await openRightsLink(reader, mail.html);
    await reader.getByRole("button", { name: REVISION.confirmButton, exact: true }).click();
    await expect(reader.getByRole("heading", { name: REVISION.receipts.confirm.title })).toBeVisible();
    const admin = adminClient();
    const sourceBefore = await admin.from("genome_files").select("normalization_completed_at").eq("id", held.id).single();
    expect(sourceBefore.error).toBeNull(); expect(sourceBefore.data?.normalization_completed_at).toBeNull();
    const selfVariant = await choosePathBReport(reader, subjectId, "reports.monogenic", "self");
    await choosePathBReport(reader, subjectId, "reports.polygenic", "self");
    const sharedVariant = await choosePathBReport(reader, subjectId, "reports.monogenic", "uploader");
    // Neither choice manufactures a result before complete byte normalization.
    const variantsBefore = await admin.from("user_variants").select("id", { count: "exact", head: true }).eq("subject_id", subjectId);
    expect(variantsBefore.error).toBeNull(); expect(variantsBefore.count).toBe(0);
    // The registered worker consumes the global queue in FIFO order. Earlier
    // genuine confirmation journeys intentionally left their jobs queued.
    // Process each actual queued job once and independently check its exact
    // job/source transition; a completed different file is never a receipt
    // that this file was normalized. No queue row is removed or fabricated.
    const normalizationQueue = await admin.from("worker_jobs")
      .select("id,file_id,created_at,attempts,max_attempts,not_before")
      .eq("status", "queued").eq("kind", "annotate_vcf").eq("output_kind", "ingest.normalize")
      .eq("computation_revision", "path-b-normalization-v1").order("created_at").order("id");
    expect(normalizationQueue.error).toBeNull();
    expect(normalizationQueue.data?.filter(job => job.file_id === held.id)).toHaveLength(1);
    for (const job of normalizationQueue.data!) {
      expect(job.attempts).toBeLessThan(job.max_attempts);
      expect(Date.parse(job.not_before)).toBeLessThanOrEqual(Date.now());
      await runPathBOperator("normalization");
      const normalizedJob = await admin.from("worker_jobs").select("status,file_id,attempts")
        .eq("id", job.id).single();
      expect(normalizedJob.error).toBeNull();
      expect(normalizedJob.data).toEqual({ status: "done", file_id: job.file_id, attempts: job.attempts + 1 });
      const normalizedSource = await admin.from("genome_files").select("normalization_completed_at,status")
        .eq("id", job.file_id!).single();
      expect(normalizedSource.error).toBeNull();
      expect(normalizedSource.data?.status).toBe("stored");
      expect(normalizedSource.data?.normalization_completed_at).not.toBeNull();
    }
    const calls = await admin.from("user_variants").select("rsid,genotype,file_id,subject_id").eq("subject_id", subjectId).order("rsid");
    expect(calls.error).toBeNull();
    expect(calls.data).toEqual([{ rsid: 762551, genotype: "A/C", file_id: held.id, subject_id: subjectId },
      { rsid: 9923231, genotype: "C/T", file_id: held.id, subject_id: subjectId }]);
    const reportList = route("genome.reports", { subject: `s-${subjectId}` });
    expect((await reader.request.get(reportList)).status()).toBe(404);
    for (let job = 0; job < 3; job++) await runPathBOperator("report");
    const jobs = await admin.from("worker_jobs").select("kind,output_kind,status").eq("subject_id", subjectId)
      .like("computation_revision", "path-b-reports-v1:%").order("kind");
    expect(jobs.error).toBeNull();
    expect(jobs.data).toEqual([
      { kind: "compute_monogenic_report", output_kind: "report.monogenic", status: "done" },
      { kind: "compute_monogenic_report", output_kind: "report.monogenic", status: "done" },
      { kind: "compute_polygenic_report", output_kind: "report.polygenic", status: "done" },
    ]);
    await reader.goto(route("files.index"));
    await reader.getByRole("link", { name: CHOICES.readResults(CHOICES.layers["reports.monogenic"]), exact: true }).click();
    await expect(reader).toHaveURL(/\/reports\?layer=variant_call$/);
    const variantUrl = route("genome.report", { subject: `s-${subjectId}`, slug: "vkorc1-rs9923231-one-position" }, { query: { source: held.id } });
    const estimateUrl = route("genome.report", { subject: `s-${subjectId}`, slug: "caffeine-metabolism-cyp1a2-rs762551" }, { query: { source: held.id } });
    await reader.goto(variantUrl);
    await expect(reader.locator('[data-figure-kind="genotype"] [data-slot="figure-value"]')).toHaveText("C/T");
    await expect(reader.getByText("Your file shows C on one copy and T on the other. CPIC calls T the variant form of VKORC1. This says nothing about how any medicine works in you, and it is not a dose.", { exact: true })).toBeVisible();
    await reader.goto(estimateUrl);
    await expect(reader.locator('[data-figure-kind="genotype"] [data-slot="figure-value"]')).toHaveText("A/C");
    await page.goto(route("files.index"));
    const sharedReportsLink = page.getByRole("link", { name: CHOICES.openShared, exact: true })
      .and(page.locator(`a[href="${reportList}"]`));
    await expect(sharedReportsLink).toHaveCount(1);
    await sharedReportsLink.click();
    await expect(page).toHaveURL(new URL(reportList, ORIGIN).href);
    const gate = page.locator('[data-slot="result-gate"]');
    await expect(gate).toBeVisible();
    expect(await page.content()).not.toContain('data-figure-kind="genotype"');
    await gate.getByRole("checkbox", { name: GATE_CHECKBOX_LABEL, exact: true }).check();
    await gate.getByRole("button", { name: GATE_BUTTON, exact: true }).click();
    await expect(gate).toHaveCount(0);
    await page.goto(variantUrl);
    await expect(page.locator('[data-figure-kind="genotype"] [data-slot="figure-value"]')).toHaveText("C/T");
    // A completed personal estimate is not implicitly a shared estimate.
    expect((await page.request.get(estimateUrl)).status()).toBe(404);
    for (const viewer of [page, reader]) {
      expect((await viewer.request.get(route("genome.browser", { subject: `s-${subjectId}` }))).status()).toBe(404);
      expect((await viewer.request.get(route("genome.ancestry", { subject: `s-${subjectId}` }))).status()).toBe(404);
    }
    const otherSource = route("genome.report", { subject: `s-${subjectId}`, slug: "vkorc1-rs9923231-one-position" }, { query: { source: randomUUID() } });
    expect((await reader.request.get(otherSource)).status()).toBe(404);
    await reader.goto(route("files.index"));
    const row = reader.locator('[data-slot="path-b-choice"][data-purpose="reports.monogenic"][data-direction="uploader"]');
    const observation = await observeNativeResponses(reader, { revoke: `^/api/consents/${sharedVariant}/revoke$` });
    await row.getByRole("button", { name: `${CHOICES.turnOff}: ${CHOICES.layers["reports.monogenic"]}, ${CHOICES.forThem.toLowerCase()}`, exact: true }).click();
    const response = await observation.read("revoke"); expect(response.status).toBe(200);
    expect(JSON.parse(response.text)).toMatchObject({ revoked: true }); await observation.dispose();
    expect((await page.request.get(variantUrl)).status()).toBe(404);
    await reader.goto(variantUrl);
    await expect(reader.locator('[data-figure-kind="genotype"] [data-slot="figure-value"]')).toHaveText("C/T");
    const unchanged = await admin.from("purpose_grants").select("revoked_at").eq("grant_id", selfVariant).single();
    expect(unchanged.error).toBeNull(); expect(unchanged.data?.revoked_at).toBeNull();
    // A new share must queue and compute its own result; it cannot revive one.
    await choosePathBReport(reader, subjectId, "reports.monogenic", "uploader");
    expect((await page.request.get(variantUrl)).status()).toBe(404);
    await runPathBOperator("report");
    await page.goto(variantUrl);
    await expect(page.locator('[data-figure-kind="genotype"] [data-slot="figure-value"]')).toHaveText("C/T");
    expect((await admin.from("genome_files").select("user_id").eq("id", held.id).single()).data?.user_id)
      .toBe((await findUserByEmail(admin, UPLOADER.email))!.id);
    expect(personId).not.toBe((await findUserByEmail(admin, UPLOADER.email))!.id);
  } finally { await personContext.close(); }
});

// All original VCF journeys remain exact; these add actual accepted array formats.
for (const arrayFixture of ["23andme.txt", "ancestry.txt", "myheritage.csv", "ftdna.csv"] as const) {
  test(`Path B confirmed array ${arrayFixture}: real source operators, isolated saved readers and revoke/re-share`, async ({ page, browser, request }) => {
  test.setTimeout(600_000);
  const person = { email: `path-b-reader-${randomUUID()}@e2e.local`, name: `Synthetic Reportreader ${arrayFixture}`, password: PASSWORD };
  const personId = await createConfirmedUser(person.email, person.password);
  await signIn(page, UPLOADER.email, UPLOADER.password);
  const subjectId = await pathBPerson(page, request, person);
  await signOut(page);
  await signIn(page, UPLOADER.email, UPLOADER.password);
  const held = await addFile(page, person, path.join(process.cwd(), `e2e/fixtures/path-b-reports-grch38-${arrayFixture}`));
  const personContext = await browser.newContext({ baseURL: ORIGIN });
  const reader = await personContext.newPage();
  try {
    await signIn(reader, person.email, person.password);
    // Real current insurance acknowledgement; no personal DNA file is added.
    await completeOwnUploadConsent(reader);
    const mail = await drainMailUntil(request, mailTo(person.email, "A DNA file was added for you on Inherit"), "the real report-source confirmation notice");
    await openRightsLink(reader, mail.html);
    await reader.getByRole("button", { name: REVISION.confirmButton, exact: true }).click();
    await expect(reader.getByRole("heading", { name: REVISION.receipts.confirm.title })).toBeVisible();
    const admin = adminClient();
    const sourceBefore = await admin.from("genome_files").select("normalization_completed_at").eq("id", held.id).single();
    expect(sourceBefore.error).toBeNull(); expect(sourceBefore.data?.normalization_completed_at).toBeNull();
    const selfVariant = await choosePathBReport(reader, subjectId, "reports.monogenic", "self");
    await choosePathBReport(reader, subjectId, "reports.polygenic", "self");
    const sharedVariant = await choosePathBReport(reader, subjectId, "reports.monogenic", "uploader");
    // Neither choice manufactures a result before complete byte normalization.
    const variantsBefore = await admin.from("user_variants").select("id", { count: "exact", head: true }).eq("subject_id", subjectId);
    expect(variantsBefore.error).toBeNull(); expect(variantsBefore.count).toBe(0);
    // The registered worker consumes the global queue in FIFO order. Earlier
    // genuine confirmation journeys intentionally left their jobs queued.
    // Process each actual queued job once and independently check its exact
    // job/source transition; a completed different file is never a receipt
    // that this file was normalized. No queue row is removed or fabricated.
    const normalizationQueue = await admin.from("worker_jobs")
      .select("id,file_id,created_at,attempts,max_attempts,not_before")
      .eq("status", "queued").eq("kind", "annotate_vcf").eq("output_kind", "ingest.normalize")
      .eq("computation_revision", "path-b-normalization-v1").order("created_at").order("id");
    expect(normalizationQueue.error).toBeNull();
    expect(normalizationQueue.data?.filter(job => job.file_id === held.id)).toHaveLength(1);
    for (const job of normalizationQueue.data!) {
      expect(job.attempts).toBeLessThan(job.max_attempts);
      expect(Date.parse(job.not_before)).toBeLessThanOrEqual(Date.now());
      await runPathBOperator("normalization");
      const normalizedJob = await admin.from("worker_jobs").select("status,file_id,attempts")
        .eq("id", job.id).single();
      expect(normalizedJob.error).toBeNull();
      expect(normalizedJob.data).toEqual({ status: "done", file_id: job.file_id, attempts: job.attempts + 1 });
      const normalizedSource = await admin.from("genome_files").select("normalization_completed_at,status")
        .eq("id", job.file_id!).single();
      expect(normalizedSource.error).toBeNull();
      expect(normalizedSource.data?.status).toBe("stored");
      expect(normalizedSource.data?.normalization_completed_at).not.toBeNull();
    }
    const calls = await admin.from("user_variants").select("rsid,genotype,file_id,subject_id,ref,alt").eq("subject_id", subjectId).order("rsid");
    expect(calls.error).toBeNull();
    expect(calls.data).toEqual([{ rsid: 762551, genotype: "A/C", file_id: held.id, subject_id: subjectId, ref: null, alt: null },
      { rsid: 9923231, genotype: "C/T", file_id: held.id, subject_id: subjectId, ref: null, alt: null }]);
    const observed = await admin.from("report_observed_calls").select("file_id", { count: "exact", head: true }).eq("file_id", held.id);
    expect(observed.error).toBeNull(); expect(observed.count).toBe(0);
    const reportList = route("genome.reports", { subject: `s-${subjectId}` });
    expect((await reader.request.get(reportList)).status()).toBe(404);
    for (let job = 0; job < 3; job++) await runPathBOperator("report");
    const jobs = await admin.from("worker_jobs").select("kind,output_kind,status").eq("subject_id", subjectId)
      .like("computation_revision", "path-b-reports-v1:%").order("kind");
    expect(jobs.error).toBeNull();
    expect(jobs.data).toEqual([
      { kind: "compute_monogenic_report", output_kind: "report.monogenic", status: "done" },
      { kind: "compute_monogenic_report", output_kind: "report.monogenic", status: "done" },
      { kind: "compute_polygenic_report", output_kind: "report.polygenic", status: "done" },
    ]);
    await reader.goto(route("files.index"));
    await reader.getByRole("link", { name: CHOICES.readResults(CHOICES.layers["reports.monogenic"]), exact: true }).click();
    await expect(reader).toHaveURL(/\/reports\?layer=variant_call$/);
    const variantUrl = route("genome.report", { subject: `s-${subjectId}`, slug: "vkorc1-rs9923231-one-position" }, { query: { source: held.id } });
    const estimateUrl = route("genome.report", { subject: `s-${subjectId}`, slug: "caffeine-metabolism-cyp1a2-rs762551" }, { query: { source: held.id } });
    await reader.goto(variantUrl);
    await expect(reader.locator('[data-figure-kind="genotype"] [data-slot="figure-value"]')).toHaveText("C/T");
    await expect(reader.getByText("Your file shows C on one copy and T on the other. CPIC calls T the variant form of VKORC1. This says nothing about how any medicine works in you, and it is not a dose.", { exact: true })).toBeVisible();
    await reader.goto(estimateUrl);
    await expect(reader.locator('[data-figure-kind="genotype"] [data-slot="figure-value"]')).toHaveText("A/C");
    await page.goto(route("files.index"));
    await page.getByRole("link", { name: CHOICES.openShared, exact: true }).click();
    const gate = page.locator('[data-slot="result-gate"]');
    await expect(gate).toBeVisible();
    expect(await page.content()).not.toContain('data-figure-kind="genotype"');
    await gate.getByRole("checkbox", { name: GATE_CHECKBOX_LABEL, exact: true }).check();
    await gate.getByRole("button", { name: GATE_BUTTON, exact: true }).click();
    await expect(gate).toHaveCount(0);
    await page.goto(variantUrl);
    await expect(page.locator('[data-figure-kind="genotype"] [data-slot="figure-value"]')).toHaveText("C/T");
    // A completed personal estimate is not implicitly a shared estimate.
    expect((await page.request.get(estimateUrl)).status()).toBe(404);
    for (const viewer of [page, reader]) {
      expect((await viewer.request.get(route("genome.browser", { subject: `s-${subjectId}` }))).status()).toBe(404);
      expect((await viewer.request.get(route("genome.ancestry", { subject: `s-${subjectId}` }))).status()).toBe(404);
    }
    const otherSource = route("genome.report", { subject: `s-${subjectId}`, slug: "vkorc1-rs9923231-one-position" }, { query: { source: randomUUID() } });
    expect((await reader.request.get(otherSource)).status()).toBe(404);
    await reader.goto(route("files.index"));
    const row = reader.locator('[data-slot="path-b-choice"][data-purpose="reports.monogenic"][data-direction="uploader"]');
    const observation = await observeNativeResponses(reader, { revoke: `^/api/consents/${sharedVariant}/revoke$` });
    await row.getByRole("button", { name: `${CHOICES.turnOff}: ${CHOICES.layers["reports.monogenic"]}, ${CHOICES.forThem.toLowerCase()}`, exact: true }).click();
    const response = await observation.read("revoke"); expect(response.status).toBe(200);
    expect(JSON.parse(response.text)).toMatchObject({ revoked: true }); await observation.dispose();
    expect((await page.request.get(variantUrl)).status()).toBe(404);
    await reader.goto(variantUrl);
    await expect(reader.locator('[data-figure-kind="genotype"] [data-slot="figure-value"]')).toHaveText("C/T");
    const unchanged = await admin.from("purpose_grants").select("revoked_at").eq("grant_id", selfVariant).single();
    expect(unchanged.error).toBeNull(); expect(unchanged.data?.revoked_at).toBeNull();
    // A new share must queue and compute its own result; it cannot revive one.
    await choosePathBReport(reader, subjectId, "reports.monogenic", "uploader");
    expect((await page.request.get(variantUrl)).status()).toBe(404);
    await runPathBOperator("report");
    await page.goto(variantUrl);
    await expect(page.locator('[data-figure-kind="genotype"] [data-slot="figure-value"]')).toHaveText("C/T");
    expect((await admin.from("genome_files").select("user_id").eq("id", held.id).single()).data?.user_id)
      .toBe((await findUserByEmail(admin, UPLOADER.email))!.id);
    expect(personId).not.toBe((await findUserByEmail(admin, UPLOADER.email))!.id);
  } finally { await personContext.close(); }
  });
}
