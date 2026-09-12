import { expect, test } from "@playwright/test";
import { createConfirmedUser, signIn } from "./helpers";
import { FAMILY_H1, HUB_TILES } from "@/copy/family/index";
import { HEALTH_PICTURE_H1 } from "@/copy/family/health-picture";

/**
 * `/family` and `/family/health-picture` in an unreviewed jurisdiction, with
 * the TEST-LOCAL flag unset.
 *
 * WHY THESE TWO NEED NO PAIRING, which is why they are here and not in
 * `e2e/genome-family.nojurisdiction.spec.ts` with the routes that do. Both
 * pages call `familyCapability(user.id, contributors, …)`, and with no family
 * yet `contributors` is the empty array — so the call reduces to
 * `resolveCapability` on the VIEWER's own code alone. On this server that code
 * is unset, `defaultRealJurisdiction` gives every Family capability
 * `status: "unreviewed"`, and the refusal renders for a lone signed-in
 * account. Tracing that was the point: the assumption that every Family
 * jurisdiction state needs two paired accounts is true of the guards that sit
 * after `resolveFamilyPerson` and false of these two.
 *
 * WHY THE TWO PAGES ARE ASSERTED DIFFERENTLY, and this is the reason each was
 * traced before being titled rather than after. They do not share a refusal
 * shape:
 *
 *   - `/family/health-picture` replaces its whole result with one `role=status`
 *     card carrying the register's sentence — the same shape the three
 *     `/genome/[subject]/…` routes use.
 *   - `/family` does not. It keeps rendering: the people list stays, every
 *     person's card drops to "waiting", and each of the three hub tiles loses
 *     its link and prints the register's sentence in place of its own blocked
 *     line. There is no banner and no `role=status` anywhere on it.
 *
 * A test written to the first shape would have failed on the second and been
 * "fixed" by loosening it until it passed, which is how a suite ends up
 * proving that some text appeared somewhere.
 *
 * THE DISCRIMINATOR ON `/family` is the tile copy, and it is exact. A blocked
 * tile prints `tile.blocked` when the capability is permitted and there is
 * simply nothing to link to yet, and `decision.userFacingCopy` when the
 * jurisdiction refuses. Same slot, same markup, opposite meanings. So the
 * assertions below require the register's sentence and require each tile's own
 * blocked line to be ABSENT — otherwise this test would pass just as happily
 * against a permitted jurisdiction with an empty family, and prove nothing
 * about jurisdiction at all.
 */

const USER = {
  email: "family-hub-nojurisdiction@e2e.local",
  password: "e2e-family-hub-off-pw",
};

/**
 * `defaultRealJurisdiction` gives the same sentence to every Family
 * capability, so one constant covers both pages. It is retyped here rather
 * than imported from `data/jurisdictions.json`: importing it would make the
 * test agree with the catalog by construction, and this assertion exists to
 * check that the catalog's sentence is what actually reaches the reader.
 */
const REGISTER_SENTENCE =
  "This part of Inherit is not available here because its legal review is not complete.";

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  await createConfirmedUser(USER.email, USER.password);
});

test("the signed-in account reaches this server and is not signed out by it", async ({ page }) => {
  // The control every spec in this project carries: a route with no
  // jurisdiction guard answers 200 with this account's own email on it, so a
  // refusal below is the guard answering rather than a dead session, a
  // redirect or a server that never started.
  await signIn(page, USER.email, USER.password);
  const response = await page.goto("/settings");
  expect(response?.status()).toBe(200);
  await expect(page.locator("main").getByText(USER.email, { exact: true })).toBeVisible();
});

test("/family jurisdiction-unavailable: every hub tile states the refusal and links nowhere", async ({ page }) => {
  await signIn(page, USER.email, USER.password);
  const response = await page.goto("/family");
  expect(response?.status()).toBe(200);

  // The hub still renders. This is not a page-level refusal and must not be
  // asserted as one.
  await expect(page.getByRole("heading", { name: FAMILY_H1, level: 1 })).toBeVisible();

  const blocked = page.locator('[data-slot="tile-blocked"]');
  await expect(blocked).toHaveCount(HUB_TILES.length);
  for (let index = 0; index < HUB_TILES.length; index += 1) {
    await expect(blocked.nth(index)).toHaveText(REGISTER_SENTENCE);
  }
  // The discriminator, stated as an absence: with the capability permitted
  // these are the lines that would render in the same slots.
  for (const tile of HUB_TILES) {
    await expect(page.getByText(tile.blocked, { exact: true })).toHaveCount(0);
  }
  // A refused tile is a heading and nothing more; its label must not be a link
  // to a surface the jurisdiction has just refused.
  for (const tile of HUB_TILES) {
    await expect(page.getByRole("link", { name: tile.label, exact: true })).toHaveCount(0);
  }
});

test("/family/health-picture jurisdiction-unavailable: the refusal replaces the whole comparison", async ({ page }) => {
  await signIn(page, USER.email, USER.password);
  const response = await page.goto("/family/health-picture");
  expect(response?.status()).toBe(200);
  await expect(page.getByRole("heading", { name: HEALTH_PICTURE_H1, level: 1 })).toBeVisible();

  const refusal = page.getByRole("status").filter({ hasText: REGISTER_SENTENCE });
  await expect(refusal).toHaveCount(1);

  // Nothing of the comparison survives it. These are the hooks the populated
  // page carries, so their absence is the refusal being complete rather than a
  // banner added above a table that still rendered.
  await expect(page.locator('[data-slot="comparison-banner"], [data-slot="family-result-inputs"]'))
    .toHaveCount(0);
  await expect(page.locator("[data-claim-block], [data-figure-kind]")).toHaveCount(0);
  await expect(page.locator("main table")).toHaveCount(0);
});
