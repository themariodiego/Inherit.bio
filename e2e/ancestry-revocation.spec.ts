import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { expect, test } from "@playwright/test";
import { localE2eProject } from "../scripts/local-e2e-project";
import { createConfirmedUser, signIn } from "./helpers";
import { uploadOwnFilePrepared, generateOwnFileWithChosenReports } from "./own-report-helpers";
import { NOTHING_READ } from "../src/copy/ancestry";

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
 * `/genome/[subject]/ancestry empty`, and this pair needs its history stated
 * because this register REJECTED it earlier. An ancestry title once read
 * "lineage empty states" and the gate counted this pair by accident; the
 * claim was withdrawn and the title reworded, because on that page the
 * ancestry result was present and it was only the lineage cards below it that
 * had nothing to show. The evidence here is the opposite: after revocation
 * there is no ancestry result at all - the test asserts the derived rows are
 * deleted, not hidden - and the page falls back to the component the product
 * itself calls `NoResult`, a grey map and "Nothing to show until a file has
 * been processed."
 *
 * `empty` rather than `consent-required`, and the distinction is the same one
 * that separated the Health Picture's empty state: this page names no
 * outstanding step and offers no way to give consent back. The CAUSE here is
 * a revoked recorded grant, which is exactly what `consent-required` is made
 * of - but the register names STATES, not causes, and a page that asks for
 * nothing is not asking for consent. Compare
 * `/genome/[subject]/reports consent-required`, where a superseded document
 * makes the library name the version, say what changed and put the accept
 * control in the same block. That page asks. This one shows nothing.
 *
 * The map mode and the sentence are asserted rather than the slot's presence
 * alone, so the state is read from the product's own naming of it.
 */
test("/genome/[subject]/ancestry empty: revoking ancestry deletes the derived result and the surface falls back to nothing read, on the very next load", async ({ page }) => {
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
  expect(await page.locator('[data-slot="nothing-read"]').count(),
    "the surface states that nothing was read").toBe(1);
  // Read the state from the product's own naming of it: the map drops to its
  // grey no-result mode and the paragraph is the NoResult sentence verbatim.
  await expect(page.locator('[data-slot="ancestry-map"]')).toHaveAttribute("data-mode", "grey");
  await expect(page.locator('[data-slot="nothing-read"]')).toHaveText(NOTHING_READ);
  // The sentence is on the page three times, not once: the regions panel and
  // the two outputs below it each say it for themselves, so every ancestry
  // output is empty rather than just the one carrying the slot.
  await expect(page.getByText(NOTHING_READ, { exact: true })).toHaveCount(3);
  expect(await page.locator("main").innerText(),
    "no region share survives the revocation").not.toMatch(/\d\.\d\s*%/);
  expect(await ancestryRunCount(fileId),
    "the derived result is deleted, not merely hidden").toBe("0");
});
