import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { adminClient, completeOwnUploadConsent, createConfirmedUser, signIn } from "./helpers";
import { OWN_UPLOAD_COPY } from "../src/copy/upload/consent";

/**
 * `/files`, the other surface that hosts `OwnUploadEntry`.
 *
 * The reason this file exists is narrower than the four states it proves. The
 * upload confirmation was being destroyed by a remount, and the fix was
 * verified on `/files/upload` only. `/files` renders the same component, so
 * the fix reaches it by construction - but "by construction" is the kind of
 * claim this repository keeps finding to be wrong, and `/files` has a trigger
 * the other surface does not: `AutoRefresh` polls `router.refresh()` every
 * five seconds while a file is in flight.
 *
 * What is NOT proven here, stated rather than left for a reader to assume: an
 * `AutoRefresh` tick landing mid-upload. `inFlight` is true only once a server
 * render has already seen `status: "parsing"`, so making a tick land inside a
 * held request is not reachable without manufacturing a database row, and a
 * seeded row would prove something about the fixture rather than the product.
 * The tick was never observed causing the original defect either; it is
 * recorded as a trigger that exists, not one that was seen to fire.
 */

const PASSWORD = "synthetic-files-index-password";
const EMPTY_LIST = "No files yet.";
const PREPARING = "Your file is stored. Preparing it for your results…";
const PREPARED = "Your file is stored and prepared. Reports have not been generated yet.";
/** What the canonical finalize RPC stores instead of the person's filename. */
const STORED_FILE_NAME = "Genome file";
const FIXTURE_NAME = "tiny-grch38.vcf";

const email = `files-index-${randomUUID()}@e2e.local`;
let accountId: string;

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  accountId = await createConfirmedUser(email, PASSWORD);
});

test("/files empty: a new account is told it has no files, in words", async ({ page }) => {
  await signIn(page, email, PASSWORD);
  const response = await page.goto("/files");
  expect(response?.status()).toBe(200);

  // The distinction this repository keeps warning about: an empty list is only
  // the `empty` state when the list is what the page is for, and when the page
  // says so rather than rendering nothing. `/files` is the file index and it
  // states the absence. The assertion is the sentence, not the absence of rows,
  // because a page that rendered nothing at all would also have no rows.
  const list = page.locator("main ul").first();
  await expect(list.locator("li")).toHaveCount(1);
  await expect(list).toContainText(EMPTY_LIST);
  await expect(page.locator('a[href^="/api/files/"]')).toHaveCount(0);

  const files = await adminClient().from("genome_files").select("id").eq("user_id", accountId);
  expect(files.error).toBeNull();
  expect(files.data, "the page is empty because the account is, not because a query failed").toEqual([]);
});

test("/files consent-required: the picker on this surface is shut until the account's own decisions are recorded", async ({ page }) => {
  await signIn(page, email, PASSWORD);
  await page.goto("/files");

  // The decisions are the account's, but the gate has to hold on whichever
  // page the person met it on. Walked here in full rather than assumed from
  // the other surface.
  await expect(page.getByRole("heading", { name: OWN_UPLOAD_COPY.accountHeading, exact: true })).toBeVisible();
  await expect(page.locator('input[type="file"]')).toHaveCount(0);
  await page.getByLabel(OWN_UPLOAD_COPY.birthDateLabel).fill("1990-01-01");
  const saved = page.waitForResponse(response => response.url().endsWith("/api/account/completion")
    && response.request().method() === "POST");
  await page.getByRole("button", { name: OWN_UPLOAD_COPY.accountContinue, exact: true }).click();
  expect((await saved).status()).toBe(200);

  await expect(page.getByRole("heading", { name: OWN_UPLOAD_COPY.insuranceHeading, exact: true })).toBeVisible();
  await expect(page.locator('input[type="file"]')).toHaveCount(0);
  const signed = page.waitForResponse(response => response.url().endsWith("/api/consents")
    && response.request().method() === "POST");
  await page.getByRole("checkbox", { name: OWN_UPLOAD_COPY.insuranceCheckbox, exact: true }).check();
  await page.getByRole("button", { name: OWN_UPLOAD_COPY.insuranceContinue, exact: true }).click();
  expect((await signed).status()).toBe(201);

  // The last gate: the file input exists now but refuses, which is the state
  // worth pinning - a disabled picker is a different promise from a missing one.
  await expect(page.getByRole("heading", { name: OWN_UPLOAD_COPY.ownHeading, exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Choose file", exact: true })).toBeDisabled();
  await expect(page.locator('input[type="file"]')).toBeDisabled();

  const grants = await adminClient().from("subject_consents").select("scope")
    .eq("account_id", accountId).eq("consent_type", "upload_class").is("revoked_at", null);
  expect(grants.error).toBeNull();
  expect(grants.data, "no upload grant exists while the picker is still shut").toEqual([]);
});

test("/files processing and complete: the live region names the phase, and the confirmation survives the refresh that follows", async ({ page }) => {
  await signIn(page, email, PASSWORD);
  await completeOwnUploadConsent(page, "/files");
  await expect(page).toHaveURL(/\/files$/);

  let releasePreparation!: () => void;
  const preparationHeld = new Promise<void>(resolve => { releasePreparation = resolve; });
  await page.route("**/api/files/*/process", async route => {
    await preparationHeld;
    await route.continue();
  }, { times: 1 });

  const announcement = page.locator('[data-slot="upload-progress"][aria-live="polite"]');
  const refusal = page.getByRole("alert").filter({ hasText: /\S/ });
  await page.locator('input[type="file"]').setInputFiles(path.join(process.cwd(), `e2e/fixtures/${FIXTURE_NAME}`));

  // `processing`: the real phase while the real request is outstanding.
  await expect(announcement, "the phase while the preparation request is held").toHaveText(PREPARING);
  await expect(page.getByRole("button", { name: "Choose file", exact: true })).toBeDisabled();
  await expect(refusal).toHaveCount(0);
  releasePreparation();

  // `complete`: the terminal, and then the same terminal AFTER the refresh
  // that preparation fires has landed and rewritten the server view. Only the
  // second assertion would have failed on the build this fix repaired; an
  // assertion that looks once, before the refresh, passes on a broken page.
  await expect(announcement, "the terminal this upload reaches").toContainText(PREPARED);
  const row = page.locator("main ul li").filter({ hasText: STORED_FILE_NAME });
  await expect.poll(() => row.count(),
    { message: "the refreshed server view lists the stored file" }).toBe(1);
  await expect(announcement, "the confirmation survives that refresh on this surface").toContainText(PREPARED);
  await expect(page.getByRole("link", { name: "Choose your reports", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "View your file", exact: true })).toBeVisible();

  // The row is the page's own record of the same file, so `complete` here is
  // not one component's memory of an upload: the list and the uploader agree.
  await expect(row.getByRole("link", { name: "Choose reports →", exact: true })).toBeVisible();
  await expect(row.locator('a[href$="/download"]')).toHaveCount(1);
  await expect(page.locator("main ul").first().locator("li")).toHaveCount(1);
  await expect(page.locator("main ul").first()).not.toContainText(EMPTY_LIST);

  const files = await adminClient().from("genome_files")
    .select("id,status,original_name,normalization_completed_at").eq("user_id", accountId);
  expect(files.error).toBeNull();
  expect(files.data).toHaveLength(1);
  expect(files.data![0].status).toBe("stored");
  expect(files.data![0].normalization_completed_at).not.toBeNull();

  /**
   * The person's own filename is never kept, and this is the only place that
   * says so. `issue_own_storage_upload_v1` writes the literal `Genome file`
   * (`supabase/migrations/20260906123327_subject_upload_finalization.sql:137`)
   * rather than what was on their disk, so the row shows a constant.
   *
   * That is worth an assertion rather than a shrug, because a filename is
   * rarely just a filename: exports are routinely named after the person, the
   * clinic, the date or the condition tested, and the file list is one of the
   * surfaces a person is most likely to have open in front of someone else.
   * This test originally looked for `tiny-grch38.vcf` and found `Genome file`;
   * the expectation was wrong and the product was right, which is why the
   * discovery is pinned here instead of quietly worked around.
   */
  expect(files.data![0].original_name).toBe(STORED_FILE_NAME);
  expect(await page.content(), "the uploaded filename must not survive anywhere on this page")
    .not.toContain(FIXTURE_NAME);
});
