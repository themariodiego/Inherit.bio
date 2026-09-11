import { expect, test } from "@playwright/test";

/**
 * Why the error boundary is not exercised in a browser anywhere in this suite,
 * recorded as a test rather than as a claim in a document.
 *
 * There is no fault flag in this product and no route that throws on bad input:
 * the routes that take a parsed parameter call `notFound()` instead, which is
 * the right behaviour and is also why the register's 62 `error` (route, state)
 * pairs have no reader. The remaining test-side lever is transport — abort the
 * React Server Component payload a client-side navigation fetches — and this
 * asserts what actually happens when you pull it: **nothing fails**. Next's
 * client router falls back to a full document load and the destination renders
 * normally.
 *
 * That is good resilience and it is worth pinning: a reader whose RSC fetch is
 * dropped by a flaky network still gets the page. It also closes off the only
 * induction this suite could have used, so the error boundary's correctness
 * rests on `src/components/site/error-content.test.ts` and
 * `src/app/boundaries.test.ts` until a deliberate fault seam exists.
 */
test("a dropped RSC payload falls back to a full load rather than failing", async ({ page }) => {
  await page.goto("/about");
  await page.route("**/*_rsc=*", route => route.abort("failed"));
  await page.getByRole("link", { name: "Changelog" }).first().click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("New reports, continuously.");
  await expect(page.locator("main"), "exactly one main landmark").toHaveCount(1);
});
