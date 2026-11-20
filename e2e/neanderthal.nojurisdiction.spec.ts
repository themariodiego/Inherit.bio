import { expect, test } from "./audited-test";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { createConfirmedUser, signIn } from "./helpers";
import { NEANDERTHAL_BODY } from "../src/copy/ancestry";
import { uploadOwnFilePrepared, generateOwnFileWithChosenReports, expectNoOwnAncestryResult } from "./own-report-helpers";

/**
 * The Neanderthal card in production, with the TEST-LOCAL flag unset (runs in
 * the `jurisdiction-off` Playwright project against the second `next start`,
 * INHERIT_TEST_JURISDICTION=""). The estimate is a TEST-LOCAL capability
 * (owner decision 2026-10-16, G7.4): production keeps it OFF.
 *
 * This signs in, uploads the SAME synthetic file that covers the Neanderthal
 * panel's sites, generates ancestry, and proves that production still shows
 * nothing of the estimate: the panel is never read, no figure renders, and the
 * card shows the production sentence — the new one, which no longer claims the
 * marker list is unbuilt (it is built and licence-checked), only that the
 * estimate is not switched on here. See docs/test-diff-register.md.
 */
const RUN_ID = randomUUID();
const USER = { email: `neanderthal-off-${RUN_ID}@e2e.local`, password: "e2e-neanderthal-off-pw" };
const ANCESTRY = "/genome/me/ancestry";
const NEANDERTHAL_FIXTURE = "e2e/fixtures/neanderthal-grch38.vcf";

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  await createConfirmedUser(USER.email, USER.password);
});

test("/genome/[subject]/ancestry Neanderthal: production (flag off) shows the production body and no estimate, even for a file that covers the panel", async ({
  page,
}) => {
  test.setTimeout(240_000);
  await signIn(page, USER.email, USER.password);
  const fileId = await uploadOwnFilePrepared(page, path.join(process.cwd(), NEANDERTHAL_FIXTURE), { fileType: "vcf" });
  await expectNoOwnAncestryResult(fileId);
  await generateOwnFileWithChosenReports(page, fileId, ["ancestry"]);

  await page.goto(ANCESTRY);
  const card = page.locator("#neanderthal");
  await expect(card).toBeVisible();
  await expect(card).toContainText("How much of your DNA came from Neanderthals");
  // Production: the capability is OFF, so no estimate is computed, stored or
  // shown, and the card renders the production sentence.
  await expect(card.getByText(NEANDERTHAL_BODY, { exact: true })).toBeVisible();
  await expect(card.locator("[data-figure-kind]")).toHaveCount(0);
  await expect(card).not.toContainText("%");
  expect(await page.content()).not.toContain("archaic-hominin");
});
