import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { adminClient, createConfirmedUser, signIn } from "./helpers";
import { BROWSER_NO_FILE, SCORE_COVERAGE_NO_FILE } from "../src/copy/genome/data";

/**
 * `empty` on the two `/genome/[subject]/data*` routes: an account that has
 * uploaded nothing at all.
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
