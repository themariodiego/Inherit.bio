import { expect, test } from "./audited-test";
import { ERROR_HEADING } from "../src/copy/error-state";
import { NOT_FOUND_HEADING } from "../src/copy/not-found";
import { AUTH_UNAVAILABLE_HEADER, AUTH_UNAVAILABLE_PATH } from "../src/lib/supabase/auth-check";

/**
 * Owner decision 2026-11-19, "A brief failure of the sign-in service is not
 * treated as signed out" (D-142), and what a browser can and cannot prove of it.
 *
 * The decision's own behaviour needs the Next.js server's call to the auth
 * service to fail, twice, on demand. Nothing in this suite can do that:
 * `page.route` sees only the browser's own requests, the CI relay in front of
 * the auth service is a plain TCP pipe (`scripts/ci-browser/server.mts`), and
 * the product carries no fault seam (see `e2e/error-boundary.spec.ts`). A spec
 * that claimed the error surface after an outage would prove nothing, so the
 * behaviour is proven where the failure can be made: `src/proxy.test.ts`,
 * `src/lib/supabase/auth-check.test.ts` (the real auth client against a stubbed
 * service), and the layout and resolver tests.
 *
 * What a browser can prove is that the one new address the change adds is
 * harmless: it is linked from nowhere, a direct visit is the ordinary
 * not-found page, and a header the browser itself sends cannot make it render
 * the error surface, because the proxy strips it.
 *
 * AUTHORED UNRUN: this container has no Playwright browser build.
 */
test("a direct visit to the sign-in check's internal route is the ordinary not-found page", async ({ page }) => {
  for (const [label, headers] of [["plain", {}], ["with a forged marker", { [AUTH_UNAVAILABLE_HEADER]: "1" }]] as const) {
    await page.setExtraHTTPHeaders(headers);
    const response = await page.goto(AUTH_UNAVAILABLE_PATH);
    expect(response?.status(), `${label}: a direct visit is a 404`).toBe(404);
    expect(new URL(page.url()).pathname, `${label}: no redirect`).toBe(AUTH_UNAVAILABLE_PATH);
    await expect(page.getByRole("heading", { level: 1 }), label).toHaveText(NOT_FOUND_HEADING);
    await expect(page.getByRole("heading", { name: ERROR_HEADING }), `${label}: never the error surface`).toHaveCount(0);
    await expect(page.locator("main"), `${label}: exactly one main landmark`).toHaveCount(1);
  }
});
