import { expect, test } from "@playwright/test";
import { createConfirmedUser, signIn } from "./helpers";
import { HUB_TILES } from "@/copy/embryos/index";

/**
 * The Embryo routes with the TEST-LOCAL jurisdiction flag unset (design
 * w10 §6.2; register `embryos.*` route guards; G5.1b). Runs in the
 * `jurisdiction-off` Playwright project against a second `next start` of
 * the same build on its own port, so a signed-in account resolves to its
 * real jurisdiction, which is unset and therefore unreviewed.
 *
 * What is proven, from the served HTML alone: each of the four routes
 * renders the register's own copy for an unreviewed capability with the
 * decision's `unset` source, every hub tile is blocked with that copy, and
 * no private row reached the page — no cohort card, no embryo column, no
 * figure, no subject attribution. The register's copy is the
 * `defaultRealJurisdiction` sentence in data/jurisdictions.json.
 */

const USER = { email: "embryos-nojurisdiction@e2e.local", password: "e2e-embryos-off-pw" };

/** data/jurisdictions.json → defaultRealJurisdiction.capabilities.*.userFacingCopy. */
const UNREVIEWED_COPY = "This part of Inherit is not available here because its legal review is not complete.";
const UNKNOWN_UUID = "0e000000-0000-4000-8000-0000000000ff";

const PRIVATE_MARKERS = [
  "[data-figure-kind]",
  "[data-subject-id]",
  "[data-cohort-id]",
  "[data-embryo-id]",
  "[data-slot=\"cohort-card\"]",
  "[data-compare-surface]",
  "[data-claim-block]",
] as const;

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  await createConfirmedUser(USER.email, USER.password);
});

async function expectNothingPrivate(page: import("@playwright/test").Page) {
  for (const marker of PRIVATE_MARKERS) await expect(page.locator(marker)).toHaveCount(0);
  const html = await page.content();
  expect(html).not.toMatch(/Embryo \d+/);
}

test("the flag is off: the server resolves a real jurisdiction, not TEST-LOCAL", async ({ page }) => {
  await signIn(page, USER.email, USER.password);
  await page.goto("/embryos");
  // The landing page names the decision's source on every blocked tile's
  // line; `test-local` would mean the flag leaked into this server.
  await expect(page.locator('[data-slot="jurisdiction-line"]')).toHaveText(new RegExp(UNREVIEWED_COPY));
  expect(await page.content()).not.toContain("test-local");
});

test("/embryos renders the register's copy, blocks every tile and fetches no private row", async ({ page }) => {
  await signIn(page, USER.email, USER.password);
  await page.goto("/embryos");
  await expect(page.locator('[data-slot="jurisdiction-line"]')).toContainText(UNREVIEWED_COPY);
  const blocked = page.locator('[data-slot="tile-blocked"]');
  await expect(blocked).toHaveCount(HUB_TILES.length);
  for (let index = 0; index < HUB_TILES.length; index++) {
    await expect(blocked.nth(index)).toHaveText(UNREVIEWED_COPY);
  }
  await expect(page.locator('[data-slot="availability-line"]')).toHaveCount(0);
  await expectNothingPrivate(page);
});

test("/embryos/upload, /embryos/request-data, /embryos/compare and /embryos/{id} render the unset decision's copy and nothing private", async ({
  page,
}) => {
  await signIn(page, USER.email, USER.password);
  for (const path of ["/embryos/upload", "/embryos/request-data", "/embryos/compare", `/embryos/${UNKNOWN_UUID}`]) {
    const response = await page.goto(path);
    expect(response?.status(), path).toBe(200);
    const unavailable = page.locator('[data-slot="jurisdiction-unavailable"]');
    await expect(unavailable, path).toHaveCount(1);
    await expect(unavailable, path).toContainText(UNREVIEWED_COPY);
    await expect(unavailable, path).toHaveAttribute("data-jurisdiction-source", "unset");
    // The upload flow renders no question and no control under a refused jurisdiction.
    await expect(page.locator('[data-slot="upload-flow"]'), path).toHaveCount(0);
    await expect(page.locator("main input, main fieldset, main form"), path).toHaveCount(0);
    await expectNothingPrivate(page);
  }
});
