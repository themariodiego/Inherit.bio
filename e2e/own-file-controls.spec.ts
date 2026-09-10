import { expect, test, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { adminClient, createConfirmedUser, signIn } from "./helpers";
import { uploadOwnFileWithChosenReports } from "./own-report-helpers";

const LIBRARY = "/genome/me/reports";
const DETAIL = `${LIBRARY}/lactase-persistence-lct-rs4988235`;

async function downloadOriginal(page: Page, fileId: string, fixture: string) {
  const transfer = page.waitForEvent("download");
  await page.locator(`a[href="/api/files/${fileId}/download"]`).click();
  const download = await transfer;
  const localPath = await download.path();
  expect(localPath).not.toBeNull();
  expect(readFileSync(localPath!)).toEqual(readFileSync(fixture));
}

test("canonical two-file controls retain the other source and its useful findings after deletion retry", async ({ page }) => {
  const email = `own-two-files-${randomUUID()}@e2e.local`;
  const password = "synthetic-file-controls-password";
  const accountId = await createConfirmedUser(email, password);
  await signIn(page, email, password);
  const removedFixture = path.join(process.cwd(), "e2e/fixtures/tiny-grch38.vcf");
  const retainedFixture = path.join(process.cwd(), "e2e/fixtures/personal-previews-grch38.vcf");
  const options = { fileType: "vcf", purposes: ["reports.polygenic"] as const };
  const removedId = await uploadOwnFileWithChosenReports(page, removedFixture, options);
  const retainedId = await uploadOwnFileWithChosenReports(page, retainedFixture, options);
  expect(removedId).not.toBe(retainedId);

  // Discoverability, the half nothing required before. `own-report-helpers.ts`
  // drives this control only when it happens to be there
  // (`if (await selectedFile.count())`), and the component defaults to the
  // newest file — which is the one each upload then generates against. So a
  // regression that dropped the control entirely would have generated against
  // the right file anyway and passed in silence, leaving an account with two
  // files no way to choose between them. Requiring it is what closes that; the
  // deletion half below already requires its absence once one file remains, so
  // the control is now pinned in both directions.
  await page.goto(LIBRARY);
  const sourceChoice = page.getByRole("combobox", { name: /^File to use\b/ });
  await expect(sourceChoice, "two stored files must both be offered as the source").toBeVisible();
  await expect(sourceChoice.locator("option")).toHaveCount(2);
  await expect(sourceChoice.locator(`option[value="${removedId}"]`),
    "the older file must be offered, not only the newest").toHaveCount(1);
  await expect(sourceChoice.locator(`option[value="${retainedId}"]`)).toHaveCount(1);
  // Offered is not the same as told apart: two options a reader cannot
  // distinguish are a choice they cannot make.
  const sourceLabels = await sourceChoice.locator("option").allTextContents();
  expect(new Set(sourceLabels.map(label => label.trim())).size,
    `the two sources must be distinguishable, not two identical labels: ${sourceLabels.join(" / ")}`)
    .toBe(2);

  const admin = adminClient();
  const sources = await admin.from("genome_files").select("id,bucket_path,subject_id,status")
    .eq("user_id", accountId).order("id");
  expect(sources.error).toBeNull();
  expect(sources.data).toHaveLength(2);
  const removed = sources.data!.find(file => file.id === removedId)!;
  const retained = sources.data!.find(file => file.id === retainedId)!;
  expect(removed.subject_id).toBe(retained.subject_id);
  expect(removed.status).toBe("stored");
  expect(retained.status).toBe("stored");
  const retainedCalls = await admin.from("user_variants").select("id,rsid,genotype")
    .eq("file_id", retainedId).order("id");
  expect(retainedCalls.error).toBeNull();
  expect(retainedCalls.data).toHaveLength(5);
  const retainedScores = await admin.from("user_prs").select("id,pgs_id,matched")
    .eq("file_id", retainedId).order("id");
  expect(retainedScores.error).toBeNull();
  expect(retainedScores.data!.length).toBeGreaterThan(0);

  // The two actual fixtures disagree at MCM6. Neither file may silently win.
  await page.goto(DETAIL);
  await expect(page.getByText("Your two files disagree about this position, so Inherit shows no result here.", { exact: true })).toBeVisible();
  await page.goto("/files");
  const removedRow = page.locator("li").filter({ has: page.locator(`a[href="/api/files/${removedId}/download"]`) });
  const retainedRow = page.locator("li").filter({ has: page.locator(`a[href="/api/files/${retainedId}/download"]`) });
  await expect(removedRow.getByRole("link", { name: "Choose reports →", exact: true })).toBeVisible();
  await expect(retainedRow.getByRole("link", { name: "Choose reports →", exact: true })).toBeVisible();
  await downloadOriginal(page, removedId, removedFixture);
  await downloadOriginal(page, retainedId, retainedFixture);
  await page.screenshot({ path: test.info().outputPath("two-files-desktop.png"), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: test.info().outputPath("two-files-mobile.png"), fullPage: true });
  page.on("dialog", dialog => dialog.accept());
  // UI failure/retry assertion only: route units inject actual Storage errors.
  // The subsequent deletion is the real route and real provider boundary.
  await page.route(`**/api/files/${removedId}`, route => route.fulfill({ status: 503,
    contentType: "application/json", body: JSON.stringify({ error: "file_delete_failed" }) }), { times: 1 });
  await removedRow.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(removedRow.getByRole("alert")).toHaveText("Deletion did not finish. Please try Delete again. The file will stay listed until deletion is complete.");
  expect((await admin.storage.from("genomes").download(removed.bucket_path)).error).toBeNull();
  await expect(retainedRow).toBeVisible();
  const deletion = page.waitForResponse(response => response.url().endsWith(`/api/files/${removedId}`)
    && response.request().method() === "DELETE");
  await removedRow.getByRole("button", { name: "Delete", exact: true }).click();
  expect((await deletion).status()).toBe(204);
  await expect(removedRow).toHaveCount(0);
  await expect(retainedRow).toBeVisible();
  expect((await admin.storage.from("genomes").download(removed.bucket_path)).error).not.toBeNull();
  const absentObject = await admin.storage.from("genomes").list("", { search: removed.bucket_path });
  expect(absentObject.error).toBeNull();
  expect(absentObject.data).toEqual([]);
  for (const table of ["user_variants", "user_prs", "ancestry_results", "worker_jobs", "report_observed_calls"] as const) {
    const result = await admin.from(table).select("file_id", { count: "exact", head: true }).eq("file_id", removedId);
    expect(result.error).toBeNull();
    expect(result.count, table).toBe(0);
  }
  const remaining = await admin.from("genome_files").select("id,status").eq("user_id", accountId);
  expect(remaining.error).toBeNull();
  expect(remaining.data).toEqual([{ id: retainedId, status: "stored" }]);
  const actualCalls = await admin.from("user_variants").select("id,rsid,genotype").eq("file_id", retainedId).order("id");
  expect(actualCalls.error).toBeNull();
  expect(actualCalls.data).toEqual(retainedCalls.data);
  const actualScores = await admin.from("user_prs").select("id,pgs_id,matched").eq("file_id", retainedId).order("id");
  expect(actualScores.error).toBeNull();
  expect(actualScores.data).toEqual(retainedScores.data);
  await downloadOriginal(page, retainedId, retainedFixture);
  await retainedRow.getByRole("link", { name: "Choose reports →", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`${LIBRARY}$`));
  await expect(page.getByLabel("File to use", { exact: true })).toHaveCount(0);
  const preview = page.locator('[data-personal-preview="lactase-persistence-lct-rs4988235"]');
  await expect(preview).toContainText("Your file shows a form linked to keeping the enzyme that breaks down milk sugar active in adulthood.");
  await page.goto(DETAIL);
  await expect(page.getByText("Your two files disagree about this position, so Inherit shows no result here.", { exact: true })).toHaveCount(0);
  await expect(page.locator('[data-figure-kind="genotype"] [data-slot="figure-value"]').first()).toHaveText("A/G");
});
