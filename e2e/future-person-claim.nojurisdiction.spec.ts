import { expect, test } from "./audited-test";

/**
 * `/future-person/claim complete` on a deployment where claims are not open,
 * which is every deployment but TEST-LOCAL. Moved here unchanged from
 * `e2e/legal.spec.ts` on 2026-09-28, when the TEST-LOCAL build (the one the
 * main browser project runs) began serving the claim form. The open page is
 * proven in `e2e/future-person-claim.spec.ts`.
 *
 * It does NOT use `assertDocumentComplete`. That helper checks a committed
 * legal document is long and placeholder-free; this page is neither long nor
 * a document. It is a rights surface with one render, and what is worth
 * pinning is the two promises that render makes.
 *
 * WHY `complete` RATHER THAN "not built". `/settings/people` renders a
 * not-built placeholder and its `complete` is proposed not-applicable in
 * corrections item 10. This page is the opposite case: it is doing its job.
 * Someone who believes a record was made from their embryo arrives here and
 * is told where they stand, why, and what is NOT being collected from them
 * meanwhile. That is content, not an absence of it — the same distinction
 * `e2e/family.spec.ts` records about the sharing tombstone.
 *
 * The second assertion is the one worth the test. The page says it accepts no
 * claim papers or personal details while records are blocked; a page that said
 * that and still carried an upload control or a name field would be collecting
 * exactly what it promises not to. So the promise is checked structurally,
 * against the DOM, rather than read back as a sentence.
 */
test("/future-person/claim complete: the closed-claims explanation, and no way to submit anything to it", async ({ page, context }) => {
  await context.clearCookies();
  const response = await page.goto("/future-person/claim");
  expect(response?.status()).toBe(200);
  expect(await context.cookies(), "a public rights page sets no session cookie").toEqual([]);

  await expect(page.getByRole("heading", { name: "Claims are not open yet" })).toBeVisible();
  await expect(page.getByText(
    "No embryo records can be made on the hosted service without a legal review by a person.",
    { exact: false },
  )).toBeVisible();
  // The no-guessing promise, which is the Charter's own rule stated where a
  // claimant meets it.
  await expect(page.getByText(
    "we cannot tell which record is yours, and we will not guess", { exact: false },
  )).toBeVisible();

  // The promise kept, not merely made: nothing here can take a claimant's
  // papers or personal details, because there is nothing here to take them.
  await expect(page.getByText("we accept no claim papers or personal details", { exact: false }))
    .toBeVisible();
  await expect(page.locator("main form"), "no form to submit a claim through").toHaveCount(0);
  await expect(page.locator("main input, main textarea, main select"), "no field to type into")
    .toHaveCount(0);
  await expect(page.locator("main button"), "and no control that could send one").toHaveCount(0);
});

test("/future-person/claim complete: where claims are not open, the start endpoint accepts nothing", async ({ page, context }) => {
  await context.clearCookies();
  await page.goto("/future-person/claim");
  const answer = await page.evaluate(async () => {
    const response = await fetch("/api/future-person/claim", {
      method: "POST",
      headers: { "content-type": "application/json", "x-inherit-csrf": "none" },
      body: JSON.stringify({ mode: "keyless-start" }),
    });
    return { status: response.status, body: await response.text(), cookie: response.headers.get("set-cookie") };
  });
  expect(answer).toEqual({ status: 404, body: '{"error":"not_found"}', cookie: null });
  expect(await context.cookies()).toEqual([]);
});
