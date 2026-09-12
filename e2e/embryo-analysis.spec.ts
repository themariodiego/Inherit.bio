import { expect, test } from "@playwright/test";

/**
 * `/embryo-analysis jurisdiction-unavailable`, proven signed out on the MAIN
 * server — the one running with `INHERIT_TEST_JURISDICTION=1`.
 *
 * THAT CHOICE IS THE PROOF, not a convenience. The TEST-LOCAL fixture row
 * marks `embryo_analysis` as `permitted`, so any resolver call on this server
 * answers "permitted". This page still states the production position, because
 * it is a public page describing the catalog rather than a viewer: its
 * register profile carries `zeroUserDataRule`, and a public page that changed
 * its legal claim according to an acceptance fixture would be telling a
 * stranger something about a test switch. Running it here rather than on the
 * jurisdiction-off server is what demonstrates that.
 *
 * WHY A HARDCODED SENTENCE IS THE RIGHT DESIGN HERE, having just removed one
 * elsewhere. `/settings/people` was rendering a jurisdiction refusal with no
 * jurisdiction guard behind it, and that sentence was false — the feature was
 * simply unbuilt. This one is true: no committed real jurisdiction permits
 * embryo analysis, and `defaultRealJurisdiction` does not either. The
 * difference is not the hardcoding, it is whether the sentence corresponds to
 * anything. What hardcoding does cost is staleness, so the claim is held by
 * `src/app/(marketing)/embryo-analysis/page.test.ts`, which fails the build
 * the day a determination permits it and the copy has not moved with it.
 *
 * WHAT IS ASSERTED, against the register's `stateProjection` for this state
 * ("show-the-exact-fail-closed-capability-copy-and-future-person-rights-link"):
 * the fail-closed copy, the rights link, and no user-data fetch — proven by
 * the page answering identically with no session at all.
 */

const FAIL_CLOSED_HEADING = "Not available in any production jurisdiction yet";
const WHY = "Embryo tools need a review by a legal expert and a list of approved";
const RIGHTS_LINK = "Read the Future Person Charter";

test("/embryo-analysis jurisdiction-unavailable: the fail-closed copy and the future-person rights link, signed out", async ({ page, context }) => {
  // No session, and prove it rather than assume it: the zero-user-data rule is
  // half of what this state means on a public route.
  await context.clearCookies();
  const response = await page.goto("/embryo-analysis");
  expect(response?.status()).toBe(200);
  expect(await context.cookies(), "a public projection sets no session cookie")
    .toEqual([]);

  await expect(page.getByRole("heading", { name: FAIL_CLOSED_HEADING })).toBeVisible();
  await expect(page.getByText(WHY)).toBeVisible();

  const rights = page.getByRole("link", { name: RIGHTS_LINK });
  await expect(rights).toBeVisible();
  await expect(rights).toHaveAttribute("href", "/legal/future-person");

  // Nothing about an individual, and no per-viewer decision: the two ways this
  // page could stop being a public projection.
  await expect(page.locator("[data-claim-block], [data-figure-kind]")).toHaveCount(0);
  await expect(page.locator('[data-jurisdiction-source]'), "no resolved per-account decision")
    .toHaveCount(0);
  await expect(page.getByText("TEST-LOCAL"), "the acceptance fixture never reaches a public page")
    .toHaveCount(0);
});
