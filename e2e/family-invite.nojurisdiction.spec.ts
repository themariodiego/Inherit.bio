import { expect, test } from "@playwright/test";
import { createConfirmedUser, signIn } from "./helpers";
import { INVITE_H1 } from "@/copy/family/invite";

/**
 * `/family/invite jurisdiction-unavailable`, with the TEST-LOCAL jurisdiction
 * flag unset. Runs in the `jurisdiction-off` Playwright project against a
 * second `next start` of the same build on its own port, so the signed-in
 * account resolves to its real jurisdiction - which is unset, and therefore
 * unreviewed.
 *
 * This route was picked because its guard needs nothing set up. The page asks
 * `accountCapability(user.id, "third_party_adult_analysis")` about the viewer
 * alone: no second account, no pairing, no invitation, no subject resolution.
 * `data/jurisdictions.json` gives that capability `status: "unreviewed"` on
 * `defaultRealJurisdiction`, so the refusal is the whole page here. Every
 * other Family jurisdiction state needs two paired accounts, because its guard
 * sits after `resolveFamilyPerson`.
 *
 * What is proven from the served HTML: the refusal renders, the invitation
 * form is not on the page in any form, and the account is genuinely signed in
 * on this server - so a refusal cannot be confused with a redirect, a signed-
 * out shell or a server that failed to start.
 */

const USER = { email: "family-invite-nojurisdiction@e2e.local", password: "e2e-family-invite-off-pw" };

const REFUSAL_HEADING = "Not available in this jurisdiction yet";
// The two sentences that make the refusal honest, asserted apart from the
// heading: one says the limit is the site's and not the reader's, the other
// that refusing created no record of the person they were about to name.
const NOT_ABOUT_YOU = "It says nothing about you or anyone else.";
const NOTHING_RECORDED = "We create no analysis or consent record.";

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  await createConfirmedUser(USER.email, USER.password);
});

test("the signed-in account reaches this server and is not signed out by it", async ({ page }) => {
  await signIn(page, USER.email, USER.password);
  // A route with no jurisdiction guard, so a refusal below is the guard's
  // answer rather than a broken session, a redirect or a dead server.
  const response = await page.goto("/settings");
  expect(response?.status()).toBe(200);
  await expect(page.locator("main").getByText(USER.email, { exact: true })).toBeVisible();
});

test("/family/invite jurisdiction-unavailable: the refusal is the whole page and the invitation form is gone", async ({ page }) => {
  await signIn(page, USER.email, USER.password);
  const response = await page.goto("/family/invite");
  expect(response?.status()).toBe(200);
  await expect(page).toHaveURL(/\/family\/invite$/);

  const refusal = page.getByRole("status").filter({ hasText: REFUSAL_HEADING });
  await expect(refusal).toHaveCount(1);
  await expect(refusal).toContainText(NOTHING_RECORDED);
  await expect(refusal).toContainText(NOT_ABOUT_YOU);
  await expect(page.getByRole("heading", { name: INVITE_H1, exact: true })).toBeVisible();
  await expect(refusal.getByRole("link", { name: "Go back", exact: true }))
    .toHaveAttribute("href", "/family");

  // Nothing of the invitation survives the refusal. The pre-consent statement
  // is checked by its own hook because it is the sentence this page exists to
  // show before anything is typed - it must not appear when there is nothing
  // to type into.
  await expect(page.locator('[data-slot="pre-consent-statement"]')).toHaveCount(0);
  await expect(page.locator("main form, main input, main textarea, main select")).toHaveCount(0);
  await expect(page.locator('[data-surface="flow"]')).toHaveCount(0);
});
