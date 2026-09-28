import { expect, test } from "./audited-test";
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import type { Page, APIRequestContext } from "@playwright/test";
import {
  acceptAdultInvitation,
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
import { OTHER_ADULT_REVIEW_COPY as REVIEW, OTHER_ADULT_UPLOAD_COPY as COPY } from "../src/copy/upload/other-adult";
import { parseArtifactFile } from "../src/lib/legal/artifact-file";
import { artifactStatements, heldFinalizationReceipt } from "../src/lib/uploads/other-adult-upload";
import { fileStatusLabel } from "../src/lib/uploads/file-status";

/**
 * Another adult's DNA, uploaded by the person who invited them and held
 * until that adult answers (G2.6 adult half, G5.3). TEST-LOCAL only: the
 * permission text is a draft the owner has not approved, installed by the
 * server from `content/legal/consent.upload-other-adult/v1.md`.
 *
 * Two journeys, both through the real screens, Storage and database:
 *   1. upload -> held (nothing readable, by anyone) -> the invited adult
 *      accepts -> the file is theirs and becomes readable under their own
 *      consent, and still not by the uploader;
 *   2. upload -> held -> the invited adult refuses without an account ->
 *      the retention job deletes the source, with a privileged re-query
 *      showing zero rows and zero Storage objects.
 */

const FIXTURE = path.join(process.cwd(), "e2e/fixtures/tiny-grch38.vcf");
const BYTES = fs.readFileSync(FIXTURE);
const SHA256 = createHash("sha256").update(BYTES).digest("hex");
const ARTIFACT = parseArtifactFile(fs.readFileSync(path.join(process.cwd(),
  "content/legal/consent.upload-other-adult/v1.md"), "utf8"))!;
const STATEMENTS = artifactStatements(ARTIFACT.body);
const PASSWORD = "synthetic-held-upload-password";
const UPLOADER = { email: `held-uploader-${randomUUID()}@e2e.local`, password: PASSWORD };
const SUBJECT = { email: `held-subject-${randomUUID()}@e2e.local`, password: PASSWORD };
const REFUSER_EMAIL = `held-refuser-${randomUUID()}@e2e.local`;

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
          .end(JSON.stringify({ id: `held-upload-${captured.length}` }));
        return;
      }
      response.writeHead(200).end("{}");
    });
  });
  await new Promise<void>(resolve => resendMock.listen(8124, "127.0.0.1", resolve));
  await createConfirmedUser(UPLOADER.email, UPLOADER.password);
  await createConfirmedUser(SUBJECT.email, SUBJECT.password);
});

test.afterAll(async () => {
  await new Promise<void>(resolve => resendMock.close(() => resolve()));
});

/** Invite through `/family/invite`, and return the mailed token and the reservation. */
async function invite(page: Page, request: APIRequestContext, address: string) {
  await page.goto("/family/invite");
  await page.getByLabel(EMAIL_LABEL).fill(address);
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: SEND_BUTTON }).click();
  await expect(page.getByRole("status")).toContainText(REQUESTED_HEADING);
  const message = await drainMailUntil(request, () => captured.find(email =>
    (Array.isArray(email.to) ? email.to : [email.to]).includes(address)), `the invitation to ${address}`);
  const token = adultInvitationToken(message.html);
  expect(token, "the invitation mail carries one fragment token").toBeTruthy();
  const tokenHash = createHash("sha256").update(token!).digest("hex");
  const invitation = await adminClient().from("subject_invitations").select("id, target_id")
    .eq("token_hash", tokenHash).eq("invitation_kind", "adult_subject").single();
  expect(invitation.error).toBeNull();
  const subject = await adminClient().from("subjects").select("display_label")
    .eq("id", invitation.data!.target_id).single();
  expect(subject.error).toBeNull();
  return { token: token!, subjectId: invitation.data!.target_id as string, label: subject.data!.display_label as string };
}

/** Sign the draft permission for one reservation and add the file; returns the held upload. */
async function signAndHold(page: Page, subjectId: string, label: string) {
  await page.goto("/files/upload");
  const section = page.locator('[data-slot="other-adult-upload"]');
  await expect(section.getByRole("heading", { name: COPY.heading })).toBeVisible();
  await expect(section.getByRole("note")).toHaveText(COPY.draftNote);
  const card = section.locator("article").filter({ hasText: COPY.signHeading });
  await expect(card).toHaveCount(1);
  // Tier 2: every statement is its own checkbox, and the words beside it are
  // the signed artifact's own numbered statements.
  expect(STATEMENTS).toHaveLength(7);
  const sign = card.getByRole("button", { name: COPY.signButton, exact: true });
  for (const statement of STATEMENTS) {
    await expect(sign).toBeDisabled();
    await card.getByRole("checkbox", { name: statement, exact: true }).check();
  }
  await card.getByLabel(COPY.typedNameLabel).fill("Synthetic Uploader");
  const signed = page.waitForResponse(response => response.url().endsWith("/api/consents")
    && response.request().method() === "POST");
  await sign.click();
  expect((await signed).status()).toBe(201);

  const finalized = page.waitForResponse(response => /\/api\/files\/[0-9a-f-]{36}\/finalize$/.test(response.url())
    && response.request().method() === "POST");
  await expect(section.getByRole("button", { name: COPY.chooseButton, exact: true })).toBeEnabled();
  await section.locator('[data-slot="other-adult-file"]').setInputFiles(FIXTURE);
  const response = await finalized;
  expect(response.status()).toBe(200);
  const receipt = heldFinalizationReceipt.parse(await response.json());
  await expect(page.getByText(COPY.heldStatus(label), { exact: true }).first()).toBeVisible();
  const held = await adminClient().from("other_adult_held_uploads")
    .select("upload_session_id, subject_id, state, object_name, raw_sha256, fixed_deadline")
    .eq("upload_session_id", receipt.uploadId).single();
  expect(held.error).toBeNull();
  expect(held.data).toMatchObject({ subject_id: subjectId, state: "held", raw_sha256: SHA256 });
  return held.data as { upload_session_id: string; object_name: string; fixed_deadline: string };
}

/** Derived genetic rows for one account, which must stay zero while a file is held. */
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

test("another adult's held upload: stored and unreadable, then accepted and readable only by that adult", async ({ page, request }) => {
  test.setTimeout(300_000);
  const admin = adminClient();
  const uploaderId = (await findUserByEmail(admin, UPLOADER.email))!.id;
  const subjectAccountId = (await findUserByEmail(admin, SUBJECT.email))!.id;

  await signIn(page, UPLOADER.email, UPLOADER.password);
  await completeOwnUploadConsent(page);
  const { token, subjectId, label } = await invite(page, request, SUBJECT.email);
  const held = await signAndHold(page, subjectId, label);

  // Quarantined: the bytes are stored (a privileged read proves it) and
  // nothing anyone can read exists. No file row, no derived row, no job.
  const stored = await admin.storage.from("genomes").download(held.object_name);
  expect(stored.error).toBeNull();
  expect(Buffer.from(await stored.data!.arrayBuffer())).toEqual(BYTES);
  expect(await derivedRows(uploaderId)).toEqual(NONE);
  expect(await derivedRows(subjectAccountId)).toEqual(NONE);
  const byObject = await admin.from("genome_files").select("id", { count: "exact", head: true }).eq("bucket_path", held.object_name);
  expect(byObject.count, "no reader can address a held source").toBe(0);
  const jobs = await admin.from("worker_jobs").select("id", { count: "exact", head: true }).eq("subject_id", subjectId);
  expect(jobs.count).toBe(0);
  // Nor through a file route, by the only identifier the uploader ever saw.
  expect((await page.request.get(`/api/files/${held.upload_session_id}/download`)).ok()).toBe(false);
  // The uploader's files list shows exactly one line for it, and no file.
  await page.goto("/files");
  await expect(page.locator('[data-slot="other-adult-held-rows"]').getByRole("status"))
    .toHaveText(COPY.heldStatus(label));

  // The invited adult reads what was added, then accepts in their own account.
  await page.request.post("/auth/sign-out");
  await page.context().clearCookies();
  await acceptAdultInvitation({ page, invitationUrl: adultInvitationUrl(token), email: SUBJECT.email,
    password: SUBJECT.password, onReview: async review => {
      const block = review.locator('[data-slot="held-upload"]');
      await expect(block.getByRole("heading", { name: REVIEW.heldHeading })).toBeVisible();
      await expect(review.getByText("No genetic data has been shared")).toHaveCount(0);
    } });
  await expect(page.getByText(REVIEW.heldReceipts.accepted, { exact: true })).toBeVisible();

  const released = await admin.from("other_adult_held_uploads").select("state, released_file_id, released_account_id")
    .eq("upload_session_id", held.upload_session_id).single();
  expect(released.error).toBeNull();
  expect(released.data).toMatchObject({ state: "released", released_account_id: subjectAccountId });
  const fileId = released.data!.released_file_id as string;
  const file = await admin.from("genome_files").select("user_id, sha256, status, bucket_path, normalization_completed_at")
    .eq("id", fileId).single();
  expect(file.data).toMatchObject({ user_id: subjectAccountId, sha256: SHA256, status: "uploaded",
    bucket_path: held.object_name, normalization_completed_at: null });
  expect((await derivedRows(uploaderId)).genome_files, "the uploader holds nothing").toBe(0);
  expect((await admin.from("report_observed_calls").select("file_id", { count: "exact", head: true })
    .eq("file_id", fileId)).count, "release analyses nothing").toBe(0);

  // Readable, under the subject's own consent and by the subject's own action.
  await completeOwnUploadConsent(page);
  await page.goto("/files");
  const row = page.getByRole("listitem").filter({ hasText: SHA256.slice(0, 32) });
  await expect(row).toHaveCount(1);
  const awaiting = fileStatusLabel({ status: "uploaded", tier: 1, single_logical_sample_verified_at: "set",
    normalization_completed_at: null });
  await expect(row.getByText(awaiting, { exact: true })).toBeVisible();
  const processed = page.waitForResponse(response => response.url().endsWith(`/api/files/${fileId}/process`)
    && response.request().method() === "POST");
  await row.getByRole("button", { name: "Prepare", exact: true }).click();
  expect((await processed).status()).toBe(200);
  const prepared = fileStatusLabel({ status: "stored", tier: 1, single_logical_sample_verified_at: "set",
    normalization_completed_at: "set" });
  await expect(row.getByText(prepared, { exact: true })).toBeVisible();
  const after = await admin.from("genome_files").select("normalization_completed_at").eq("id", fileId).single();
  expect(after.data!.normalization_completed_at).not.toBeNull();
  expect((await admin.from("report_observed_calls").select("file_id", { count: "exact", head: true })
    .eq("file_id", fileId)).count).toBeGreaterThan(0);

  // And still nothing for the uploader, whose reservation is gone.
  await page.request.post("/auth/sign-out");
  await page.context().clearCookies();
  await signIn(page, UPLOADER.email, UPLOADER.password);
  await page.goto("/files/upload");
  await expect(page.locator('[data-slot="other-adult-upload"]')).toHaveCount(0);
  expect((await derivedRows(uploaderId)).genome_files).toBe(0);
});

test("another adult's held upload: refused without an account, then deleted with nothing left", async ({ page, request }) => {
  test.setTimeout(300_000);
  const admin = adminClient();
  await signIn(page, UPLOADER.email, UPLOADER.password);
  const { token, subjectId, label } = await invite(page, request, REFUSER_EMAIL);
  const held = await signAndHold(page, subjectId, label);
  const session = await admin.from("upload_sessions").select("staging_object_name").eq("id", held.upload_session_id).single();
  expect(session.error).toBeNull();
  const staging = session.data!.staging_object_name as string;

  await page.request.post("/auth/sign-out");
  await page.context().clearCookies();
  await page.goto(adultInvitationUrl(token));
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page).toHaveURL("http://localhost:3100/withdraw/session");
  await expect(page.locator('[data-slot="held-upload"]').getByRole("heading", { name: REVIEW.heldHeading })).toBeVisible();
  await page.getByRole("button", { name: "Refuse", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Invitation refused" })).toBeVisible();
  await expect(page.getByText(REVIEW.heldReceipts.refused, { exact: true })).toBeVisible();

  const refused = await admin.from("other_adult_held_uploads").select("state").eq("upload_session_id", held.upload_session_id).single();
  expect(refused.data?.state).toBe("refused");

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
    ["other_adult_held_uploads", "upload_session_id", held.upload_session_id],
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
