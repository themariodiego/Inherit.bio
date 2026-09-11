import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { adminClient, completeOwnUploadConsent, createConfirmedUser, signIn } from "./helpers";

/**
 * `/files/upload processing`. The one state on this route that needs no
 * interpretation at all: the uploader's own state machine has six progress
 * phases, each announced in a single `aria-live="polite"` region, and this
 * test observes two of them in the real browser during a real upload.
 *
 * Both phases are the product's, not the test's. What the test supplies is
 * time: it holds one request in the browser, asserts the phase the page is
 * genuinely in while that request is outstanding, then releases it to the real
 * server, which does the real work. No response is fabricated, no phase is
 * forced, and the upload finishes for real - so a page that announced nothing,
 * announced the wrong phase, or skipped straight to a terminal would fail
 * here. Without the hold these phases pass in milliseconds on a small fixture
 * and could only be caught by chance.
 *
 * The terminal assertion at the end is what makes the holds honest: the same
 * upload that showed the two progress lines goes on to complete normally.
 */
test("/files/upload announces processing: the live region names each phase while the real upload is in flight", async ({ page }) => {
  const email = `upload-progress-${randomUUID()}@e2e.local`;
  const password = "synthetic-upload-progress-password";
  const accountId = await createConfirmedUser(email, password);
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await signIn(page, email, password);
  await completeOwnUploadConsent(page);

  let releaseFinalize!: () => void;
  let releasePreparation!: () => void;
  const finalizeHeld = new Promise<void>(resolve => { releaseFinalize = resolve; });
  const preparationHeld = new Promise<void>(resolve => { releasePreparation = resolve; });
  await page.route("**/api/files/*/finalize", async route => {
    await finalizeHeld;
    await route.continue();
  }, { times: 1 });
  await page.route("**/api/files/*/process", async route => {
    await preparationHeld;
    await route.continue();
  }, { times: 1 });

  // One live region for the whole uploader, so asserting its full text also
  // asserts that two phases are never announced at once. Named rather than
  // selected by `aria-live`: the app shell renders a second polite region for
  // global search, and an unscoped selector resolved to both.
  const announcement = page.locator('[data-slot="upload-progress"][aria-live="polite"]');
  // Next renders one permanently-present, permanently-empty route announcer
  // with `role="alert"`, so "no refusal is showing" has to mean no alert with
  // text in it. `uploadOwnFileThroughUi` filters the same way.
  const refusal = page.getByRole("alert").filter({ hasText: /\S/ });
  await page.locator('input[type="file"]').setInputFiles(path.join(process.cwd(), "e2e/fixtures/tiny-grch38.vcf"));

  await expect(announcement, "the phase while the finalization request is outstanding")
    .toHaveText("Verifying the complete uploaded file…");
  // The picker is closed while work is in flight, so a second selection cannot
  // race the first: this is part of what `processing` means on this route.
  await expect(page.getByRole("button", { name: "Choose file", exact: true })).toBeDisabled();
  await expect(page.locator('input[type="file"]')).toBeDisabled();
  await expect(refusal).toHaveCount(0);
  releaseFinalize();

  await expect(announcement, "the phase while the preparation request is outstanding")
    .toHaveText("Your file is stored. Preparing it for your results…");
  await expect(page.getByRole("button", { name: "Choose file", exact: true })).toBeDisabled();
  await expect(refusal).toHaveCount(0);
  releasePreparation();

  await expect(announcement, "the terminal this same upload reaches once nothing is held")
    .toContainText("Your file is stored and prepared. Reports have not been generated yet.");
  await expect(page.getByRole("button", { name: "Choose file", exact: true })).toBeEnabled();

  /**
   * The confirmation has to still be there after preparation's own
   * `router.refresh()` has landed, not just in the instant before it.
   *
   * It was not. Signing the own-DNA consent used to skip its refresh, so the
   * first refresh of the page came at the END of preparation, changed the
   * server view from `consent` to `ready`, changed the key this flow is
   * mounted under, and remounted the uploader - discarding the finished state
   * it had just reached. The success line and both of its links vanished
   * within a few hundred milliseconds and the person was left looking at a
   * picker that appeared untouched, with nothing on the page saying their
   * genome file had been stored.
   *
   * Polling the server view for the change and then re-asserting is what makes
   * this a real guard: an assertion that only ran before the refresh would
   * have passed against the broken build too, which is exactly how this
   * survived - `own-upload-positive.spec.ts` was passing on that window.
   */
  await expect.poll(() => page.getByRole("checkbox").count(),
    { message: "the server view moves to ready and the consent panel goes" }).toBe(0);
  await expect(announcement, "the confirmation survives the refresh that follows preparation")
    .toContainText("Your file is stored and prepared. Reports have not been generated yet.");
  await expect(page.getByRole("link", { name: "Choose your reports", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "View your file", exact: true })).toBeVisible();

  // The held requests reached the real server: one real source exists.
  const admin = adminClient();
  const files = await admin.from("genome_files").select("id,status,normalization_completed_at")
    .eq("user_id", accountId);
  expect(files.error).toBeNull();
  expect(files.data).toHaveLength(1);
  expect(files.data![0].normalization_completed_at).not.toBeNull();
  expect(errors).toEqual([]);
});
