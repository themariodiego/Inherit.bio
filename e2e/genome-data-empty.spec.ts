import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { adminClient, createConfirmedUser, signIn } from "./helpers";
import { BROWSER_NO_FILE, SCORE_COVERAGE_NO_FILE } from "../src/copy/genome/data";
import { NO_FILE_YET } from "../src/copy/reports/strings";

/**
 * `empty` on three My Genome routes: an account that has uploaded nothing at
 * all. Two `/genome/[subject]/data*` pages, and — added 2026-09-13 alongside
 * that route's `processing` proof — one report opened directly.
 *
 * THE CAUSE IS ESTABLISHED, NOT INFERRED, for the same reason `/overview
 * empty` now establishes it. Three different situations render almost
 * nothing on these pages — no file, a file still being prepared, and a
 * prepared file that covers nothing — and they owe the reader three
 * different sentences. Two of them were the same sentence until earlier
 * today, when the preparing case was split out; asserting only on the
 * rendered copy would not notice if they collapsed back together. So each
 * test first asserts, from the database, that this account holds no file,
 * and then asserts that the page says exactly the no-file sentence and NOT
 * the preparing one.
 *
 * A fresh account rather than a shared fixture, because "has uploaded
 * nothing" is the whole precondition and any other test in the same file
 * would destroy it.
 */

/** The same trait report the a11y and first-glance sweeps open; not gated. */
const REPORT = "/genome/me/reports/caffeine-metabolism-cyp1a2-rs762551";

test("/genome/[subject]/data empty: no file, so the coverage section says to add one", async ({ page }) => {
  const email = `genome-data-empty-${randomUUID()}@e2e.local`;
  const password = "synthetic-genome-data-empty-password";
  const accountId = await createConfirmedUser(email, password);
  await signIn(page, email, password);

  const { data: files, error } = await adminClient()
    .from("genome_files").select("id").eq("user_id", accountId);
  expect(error).toBeNull();
  expect(files, "empty because nothing was uploaded").toEqual([]);

  await page.goto("/genome/me/data");
  await expect(page.getByText(SCORE_COVERAGE_NO_FILE, { exact: true })).toBeVisible();
  // The neighbouring state, which this account is not in. A page that said
  // both, or said the wrong one, would be telling a reader results are coming
  // when nothing was ever sent.
  await expect(page.getByText("A file is still being prepared", { exact: false })).toHaveCount(0);
  // The page still works: the subject bar counts honestly rather than hiding.
  await expect(page.locator('[data-slot="subject-files"]')).toHaveText("0 files");
});

test("/genome/[subject]/data/browser empty: no file, so the search box is absent and the page says why", async ({ page }) => {
  const email = `genome-browser-empty-${randomUUID()}@e2e.local`;
  const password = "synthetic-genome-browser-empty-password";
  const accountId = await createConfirmedUser(email, password);
  await signIn(page, email, password);

  const { data: files, error } = await adminClient()
    .from("genome_files").select("id").eq("user_id", accountId);
  expect(error).toBeNull();
  expect(files, "empty because nothing was uploaded").toEqual([]);

  await page.goto("/genome/me/data/browser");
  await expect(page.getByText(BROWSER_NO_FILE, { exact: true })).toBeVisible();
  await expect(page.getByText("A file is still being prepared", { exact: false })).toHaveCount(0);
  // No box to type into: the page does not offer a search it cannot answer.
  // Scoped to `main` on purpose — the app shell's banner carries its own
  // global "Search" control on every page, and an unscoped query finds that
  // one and says nothing about this page.
  await expect(page.locator("main").getByRole("searchbox")).toHaveCount(0);
  await expect(page.locator("main form"), "no search form to submit").toHaveCount(0);
});

test("/genome/[subject]/reports/[slug] empty: no file, so one report says to add one rather than to choose it", async ({ page }) => {
  const email = `genome-report-empty-${randomUUID()}@e2e.local`;
  const password = "synthetic-genome-report-empty-password";
  const accountId = await createConfirmedUser(email, password);
  await signIn(page, email, password);

  const { data: files, error } = await adminClient()
    .from("genome_files").select("id").eq("user_id", accountId);
  expect(error).toBeNull();
  expect(files, "empty because nothing was uploaded").toEqual([]);

  await page.goto(REPORT);
  await expect(page.getByText(NO_FILE_YET, { exact: true })).toBeVisible();
  // This page holds THREE sentences for three situations, and they are one
  // `fileCount` and one preparation check apart. Neither neighbour may appear
  // for an account that has sent nothing: one would promise results are
  // coming, the other would send the reader to choose from a library that has
  // nothing of theirs in it.
  await expect(page.getByText("A file is still being prepared", { exact: false })).toHaveCount(0);
  await expect(page.getByText("Choose this result type in", { exact: false })).toHaveCount(0);
  // The report itself still renders: the account has no result, not no page.
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
});
