import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { assertNoThirdParty, axeViolations, createConfirmedUser, signIn, watchRequests } from "./helpers";
import { PUBLIC_ROUTES, VISIT, authenticatedRoutes } from "./accessibility-sweeps";


/**
 * The fourth dimension of both G1.7 and G1.13a: auth mode.
 *
 * The two sweeps above audit every registered kept page, but each in one auth
 * state — public pages signed out, authenticated pages signed in. No route was
 * checked in both, and the difference is not cosmetic: the marketing chrome
 * swaps two auth controls for one, so a signed-in public page renders a header
 * neither sweep had ever audited. That header is also where the 320px reflow
 * failure lived, on 31 routes.
 *
 * Both halves are answered here rather than one:
 *
 *  - Every public route is swept again with a session, at the full tag,
 *    viewport and theme matrix and with the origin audit, on one page reused
 *    across routes so the pass costs a navigation each rather than a browser
 *    each.
 *  - Every authenticated route is visited **without** a session, and asserted
 *    to land on the sign-in page. That is what "signed out" means for those
 *    routes, and asserting the redirect is a stronger statement than skipping
 *    them: a page that rendered its own content to a signed-out reader would
 *    fail here, which is a disclosure bug before it is an accessibility one.
 */
test("axe and origins: every public page with a session, and every authenticated page without one", async ({ page }) => {
  test.setTimeout(900_000);
  const signedOutOnly = { email: `a11y-both-${randomUUID()}@e2e.local`, password: "e2e-a11y-both-pw" };

  // Signed out first, while the context has no session: an authenticated route
  // must send a signed-out reader to sign in rather than answer them.
  for (const route of authenticatedRoutes().filter(entry => entry in VISIT)) {
    const response = await page.goto(VISIT[route]);
    expect(response?.status(), `${route} answers a signed-out reader`).toBeLessThan(400);
    expect(new URL(page.url()).pathname,
      `${route} must send a signed-out reader to sign in, not render to them`)
      .toMatch(/^\/auth\/sign-in/);
  }

  await createConfirmedUser(signedOutOnly.email, signedOutOnly.password);
  await signIn(page, signedOutOnly.email, signedOutOnly.password);

  const observed = watchRequests(page);
  for (const route of PUBLIC_ROUTES) {
    for (const theme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme: theme });
      observed.origins.clear();
      observed.urls.length = 0;
      await page.goto(route);
      await page.waitForLoadState("networkidle");
      // Soft, so one run names every page that fails rather than the first.
      expect.soft(await axeViolations(page, theme), `${route} (${theme}, signed in)`).toEqual([]);
      await assertNoThirdParty(page, observed, `${route} (${theme}, signed in)`);
    }
  }
});
