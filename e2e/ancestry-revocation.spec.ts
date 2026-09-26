import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { expect, test } from "@playwright/test";
import { localE2eProject } from "../scripts/local-e2e-project";
import { createConfirmedUser, signIn } from "./helpers";
import { uploadOwnFilePrepared, generateOwnFileWithChosenReports } from "./own-report-helpers";
import { ANCESTRY_NOT_GENERATED, ANCESTRY_OFF, ANCESTRY_REPORTS_LINK, NOTHING_READ } from "../src/copy/ancestry";

/** Aggregate only, and only this file's ancestry journal: no result payload,
 * no genotype, no credential and no other account is read. */
async function ancestryRunCount(fileId: string): Promise<string> {
  if (!/^[0-9a-f-]{36}$/.test(fileId)) throw new Error("Expected a canonical fixture identifier");
  const { stdout } = await promisify(execFile)("docker",
    ["exec", localE2eProject(process.env).dbContainer, "psql", "-U", "postgres", "-d", "postgres",
      "-XAt", "--set=ON_ERROR_STOP=1", "--command",
      `select count(*) from private.own_analysis_runs
        where file_id='${fileId}'::uuid and purpose='ancestry';`],
    { timeout: 10_000, maxBuffer: 8192 });
  return stdout.trim();
}

/**
 * G5.3a, access half: revoking `ancestry` makes the derived result
 * immediately unreadable.
 *
 * The acceptance row records this as verified by reading the code rather than
 * by a test, and says why an earlier attempt was abandoned — the precondition
 * came back denied, and an assertion that the result is absent is worthless if
 * it was never present. So this proves the result readable first, through the
 * real upload and the real explicit choice, and only then revokes.
 *
 * `aims-mixed-grch38.vcf` is the synthetic 168-marker fixture that describes
 * no real person and is the one `ancestry.spec.ts` already drives to the shown
 * state; the tiny fixture renders the grey state and could not tell "revoked"
 * from "too few markers".
 *
 * Two independent protections do this, which planting established and reading
 * alone would not have. Removing `filterOwnAnalysisFiles` outright — the whole
 * purpose filter, at both call sites — changed nothing, and neither did
 * disabling the `clear_revoked_own_report_outputs` trigger. The two that
 * matter are elsewhere: `revoke_directional_purpose_v1` calls
 * `execute_own_report_purge_v1`, which deletes the grant's
 * `private.own_analysis_runs` rows; and the canonical read goes through
 * `own_ancestry_content_v1`, which re-checks the grant in the database. The
 * TypeScript filter is a third layer over both.
 *
 * Suppressing only the purge shows how they divide. The journal assertion
 * fails, because the row survives; every surface assertion still passes,
 * because the read check hides a row that is still there. So the surface
 * assertions here carry the access half and the journal assertion carries the
 * delete half, and neither stands in for the other.
 *
 * The journal is asserted present and then absent. An absence assertion alone
 * would pass on a fixture that never produced a result, which is the trap that
 * stopped the earlier attempt; the presence assertion on the same observable
 * is what makes this self-validating.
 *
 * This covers the canonical path only. Legacy `public.ancestry_results` rows,
 * written by `POST /api/files/[id]/process` for files with a null
 * `single_logical_sample_verified_at`, are gated on read and never deleted —
 * that gap is recorded in the G5.3a row, with the decided exception in
 * `docs/retention.md` and the inconsistent half in D-097.
 */
const RUN_ID = randomUUID();
const USER = { email: `ancestry-revoke-${RUN_ID}@e2e.local`, password: "e2e-ancestry-revoke-pw" };
const ANCESTRY = "/genome/me/ancestry";
const MIXED_FIXTURE = "e2e/fixtures/aims-mixed-grch38.vcf";
const LABEL = "Ancestry";

test.beforeAll(async () => {
  await createConfirmedUser(USER.email, USER.password);
});

/**
 * `/genome/[subject]/ancestry consent-required`. Until 26 September 2026 this
 * same journey proved `empty`, and the reason it no longer does is the
 * product changing, not the reading.
 *
 * The cause here has always been a revoked recorded grant, which is exactly
 * what `consent-required` is made of; it was titled `empty` because the page
 * named no outstanding step and offered no way to give the grant back - it
 * fell back to "Nothing to show until a file has been processed." That
 * sentence was false for this person (a file HAD been processed), and on 26
 * September 2026 it was seen in production saying so. The page now says
 * "Ancestry is off", names where it is turned back on (Reports, in Choose
 * your reports) and links there, in every ancestry panel. That is the
 * register's definition of `consent-required` - a recorded, revocable consent
 * is missing, and the page names the outstanding step and links to where it
 * is given - and it is no longer the definition of `empty`, which has no
 * step. `/genome/[subject]/ancestry empty` is now proven where the sentence
 * is true, by an account that has processed nothing
 * (`e2e/genome-data-empty.spec.ts`).
 *
 * The step is named on this page and taken on the Reports page, as
 * `consent-required-page-v1` allows ("a scoped empty state with consent
 * management navigation"); this page puts no accept control of its own
 * beside it. The link's target is asserted, and so is the control it lands
 * on, so the claim is that the step is really there rather than that a link
 * exists.
 *
 * The map mode and the sentence are asserted rather than the slot's presence
 * alone, so the state is read from the product's own naming of it.
 */
test("/genome/[subject]/ancestry consent-required: revoking ancestry deletes the derived result and every panel says Ancestry is off and links to where it is turned on, on the very next load", async ({ page }) => {
  test.setTimeout(240_000);
  await signIn(page, USER.email, USER.password);
  const fileId = await uploadOwnFilePrepared(page, path.join(process.cwd(), MIXED_FIXTURE), { fileType: "vcf" });
  await generateOwnFileWithChosenReports(page, fileId, ["ancestry"]);

  // Precondition, and the whole point of it: the result is genuinely readable.
  await page.goto(ANCESTRY);
  await expect(page.locator('[data-slot="ancestry-map"]')).toHaveAttribute("data-mode", "shown");
  const percentagesBefore = await page.locator("main").innerText();
  expect(percentagesBefore, "the shown state prints region shares").toMatch(/\d\.\d\s*%/);
  await expect(page.locator('[data-slot="nothing-read"]')).toHaveCount(0);
  await expect(page.locator('[data-slot="ancestry-off"]')).toHaveCount(0);
  expect(await ancestryRunCount(fileId), "the derived result exists before revocation").toBe("1");

  // Revoke the way a person does, through the control that offers it.
  await page.goto("/genome/me/reports");
  const choices = page.getByRole("region", { name: "Choose your reports", exact: true });
  const revoked = page.waitForResponse(response => /\/api\/consents\/[0-9a-f-]{36}\/revoke$/.test(response.url())
    && response.request().method() === "POST");
  await choices.getByRole("button", { name: `Turn off ${LABEL}`, exact: true }).click();
  const receipt = await revoked;
  expect(receipt.status()).toBe(200);
  expect(await receipt.json()).toMatchObject({ revoked: true });

  // Immediately: one navigation, and the checks below take no retry and no
  // polling, so this cannot pass by waiting for a later cleanup to catch up.
  await page.goto(ANCESTRY);
  expect(await page.locator('[data-slot="ancestry-map"][data-mode="shown"]').count(),
    "a revoked result must not still be shown").toBe(0);
  // Three panels - the regions and the two parent lines below them - and each
  // says it for itself, so every ancestry output is accounted for rather than
  // only the first. Counted without waiting, like the check above.
  expect(await page.locator('[data-slot="ancestry-off"]').count(),
    "every ancestry panel says Ancestry is off").toBe(3);
  // Read the state from the product's own naming of it: the map drops to its
  // grey mode, and every panel carries the off sentence verbatim and a link
  // to this subject's Reports page.
  await expect(page.locator('[data-slot="ancestry-map"]')).toHaveAttribute("data-mode", "grey");
  const off = page.locator('[data-slot="ancestry-off"]');
  for (let panel = 0; panel < 3; panel += 1) {
    await expect(off.nth(panel).getByText(ANCESTRY_OFF, { exact: true })).toBeVisible();
    await expect(off.nth(panel).getByRole("link", { name: ANCESTRY_REPORTS_LINK, exact: true }))
      .toHaveAttribute("href", "/genome/me/reports");
  }
  // The no-file sentence would be false here: a file was processed.
  await expect(page.locator('[data-slot="nothing-read"]')).toHaveCount(0);
  await expect(page.getByText(NOTHING_READ, { exact: true })).toHaveCount(0);
  // Nor does a page with no result name the historical five-region map.
  expect(await page.locator("main").innerText(), "no five-region count on an empty page").not.toMatch(/\bfive\b/i);
  expect(await page.locator("main").innerText(),
    "no region share survives the revocation").not.toMatch(/\d\.\d\s*%/);
  expect(await ancestryRunCount(fileId),
    "the derived result is deleted, not merely hidden").toBe("0");

  // The step the page names is really there: its link lands on Choose your
  // reports, where the Ancestry choice is off and offers its own agreement
  // and control to turn it on (both render only while the choice is off).
  await off.first().getByRole("link", { name: ANCESTRY_REPORTS_LINK, exact: true }).click();
  await page.waitForURL(url => url.pathname === "/genome/me/reports");
  const choicesAfter = page.getByRole("region", { name: "Choose your reports", exact: true });
  await expect(choicesAfter.getByRole("checkbox", { name: LABEL, exact: true })).toBeVisible();
  await expect(choicesAfter.getByRole("button", { name: `Enable ${LABEL}`, exact: true })).toBeVisible();

  // Take that step and stop there. Turning Ancestry back on only grants it;
  // the result comes from the separate generate step, so until that is
  // pressed the page must neither say it is off nor say no file was
  // processed. It says Ancestry is on and where the result is made.
  await choicesAfter.getByRole("checkbox", { name: LABEL, exact: true }).check();
  const signed = page.waitForResponse(response => response.url().endsWith("/api/consents")
    && response.request().method() === "POST");
  await choicesAfter.getByRole("button", { name: `Enable ${LABEL}`, exact: true }).click();
  expect((await signed).status()).toBe(201);
  await page.goto(ANCESTRY);
  expect(await ancestryRunCount(fileId), "turning the choice on generates nothing by itself").toBe("0");
  expect(await page.locator('[data-slot="ancestry-not-generated"]').count(),
    "every ancestry panel says the result follows the generate step").toBe(3);
  const notGenerated = page.locator('[data-slot="ancestry-not-generated"]');
  for (let panel = 0; panel < 3; panel += 1) {
    await expect(notGenerated.nth(panel).getByText(ANCESTRY_NOT_GENERATED, { exact: true })).toBeVisible();
    await expect(notGenerated.nth(panel).getByRole("link", { name: ANCESTRY_REPORTS_LINK, exact: true }))
      .toHaveAttribute("href", "/genome/me/reports");
  }
  await expect(page.locator('[data-slot="ancestry-off"]')).toHaveCount(0);
  await expect(page.getByText(NOTHING_READ, { exact: true })).toHaveCount(0);
});
