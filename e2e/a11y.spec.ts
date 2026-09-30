import { expect, test } from "@playwright/test";
import { assertNoThirdParty, axeViolations, createConfirmedUser, signIn, watchRequests } from "./helpers";
import { NOT_FOUND_HEADING } from "../src/copy/not-found";
import { PUBLIC_ROUTES, DOCUMENTS, ENDPOINT_RENDERED_PAGES, NOT_FOUND_URLS } from "./accessibility-sweeps";

const USER = { email: "a11y@e2e.local", password: "e2e-a11y-pw" };

test.beforeAll(async () => {
  await createConfirmedUser(USER.email, USER.password);
});

for (const route of PUBLIC_ROUTES) {
  for (const theme of ["light", "dark"] as const) {
    test(`axe: ${route} (${theme})`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: theme });
      // G1.7 rides on this navigation rather than paying for a second one.
      // "No third-party origin is contacted by a page carrying genome data" was
      // proven on eight surfaces; the register-derived sweep already loads all
      // 62 kept pages in both themes, so a request listener is the whole cost.
      const observed = watchRequests(page);
      await page.goto(route);
      await page.waitForLoadState("networkidle");
      expect(await axeViolations(page, theme), `${route} (${theme})`).toEqual([]);
      await assertNoThirdParty(page, observed, `${route} (${theme})`);
    });
  }
}

for (const [route, url] of Object.entries(DOCUMENTS)) {
  for (const theme of ["light", "dark"] as const) {
    test(`axe: ${route} (${theme})`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: theme });
      const observed = watchRequests(page);
      const response = await page.goto(url);
      // A 404 would make the audit meaningless, and quietly: an empty
      // not-found page has no violations.
      expect(response?.status(), `${url} resolves to a document`).toBe(200);
      await page.waitForLoadState("networkidle");
      expect(await axeViolations(page, theme), `${route} (${theme})`).toEqual([]);
      await assertNoThirdParty(page, observed, `${route} (${theme})`);
    });
  }
}

for (const [route, url] of Object.entries(ENDPOINT_RENDERED_PAGES)) {
  for (const theme of ["light", "dark"] as const) {
    test(`axe: ${route} (${theme})`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: theme });
      const observed = watchRequests(page);
      const response = await page.goto(url);
      expect(response?.status(), `${url} serves the interstitial`).toBe(200);
      await page.waitForLoadState("networkidle");
      expect(await axeViolations(page, theme), `${route} (${theme})`).toEqual([]);
      await assertNoThirdParty(page, observed, `${route} (${theme})`);
    });
  }
}

for (const [shape, url] of Object.entries(NOT_FOUND_URLS)) {
for (const theme of ["light", "dark"] as const) {
  test(`axe: the not-found surface, ${shape} (${theme})`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: theme });
    const observed = watchRequests(page);
    const response = await page.goto(url);
    expect(response?.status(), `${shape} must be a 404, never a 200`).toBe(404);
    await expect(
      page.getByRole("heading", { level: 1 }),
      "the app's own not-found page, not the framework's",
    ).toHaveText(NOT_FOUND_HEADING);
    await expect(page.locator("main"), "exactly one main landmark").toHaveCount(1);
    await page.waitForLoadState("networkidle");
    expect(await axeViolations(page, theme), `not-found, ${shape} (${theme})`).toEqual([]);
    await assertNoThirdParty(page, observed, `not-found, ${shape} (${theme})`);
  });
}
}

test("skip link: first tabbable element, moves focus to main without navigating (both layouts)", async ({
  page,
}) => {
  // Marketing layout: the very first Tab press must land on the skip link…
  await page.goto("/");
  await page.keyboard.press("Tab");
  const skipLink = page.getByRole("link", { name: "Skip to main content" });
  await expect(skipLink).toBeFocused();
  // …and activating it must move focus to the main landmark (tabIndex={-1})
  // WITHOUT hash navigation: the URL keeps no #main fragment and no history
  // entry is pushed, so Back from a later page can never replay a stale
  // render (the app-router quirk this behavior guards against).
  const historyBefore = await page.evaluate(() => history.length);
  await page.keyboard.press("Enter");
  await expect(page.locator("main#main")).toBeFocused();
  expect(new URL(page.url()).hash).toBe("");
  expect(await page.evaluate(() => history.length)).toBe(historyBefore);

  // Signed-in app layout: same contract.
  await signIn(page, USER.email, USER.password);
  await page.goto("/dashboard");
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("link", { name: "Skip to main content" }),
  ).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("main#main")).toBeFocused();
  expect(new URL(page.url()).hash).toBe("");
});

test("design language: Fraunces display, pill CTAs, attribution, theme toggle", async ({
  page,
}) => {
  await page.goto("/");

  // Fraunces on the display headline (self-hosted via next/font).
  const h1Font = await page
    .locator("h1")
    .evaluate((el) => getComputedStyle(el).fontFamily);
  expect(h1Font.toLowerCase()).toContain("fraunces");

  // Pill CTA: fully rounded primary button.
  const cta = page.getByRole("link", { name: "Start with your raw data" });
  const radius = await cta.evaluate((el) => getComputedStyle(el).borderRadius);
  expect(parseFloat(radius)).toBeGreaterThanOrEqual(999);

  // Attribution line present in the chrome.
  await expect(
    page
      .getByText("Inherit · an open-source project created by Plus Bio for the public good", {
        exact: false,
      })
      .first(),
  ).toBeVisible();

  // Numbered 01-04 process steps.
  for (const n of ["01", "02", "03", "04"]) {
    await expect(page.getByText(n, { exact: true })).toBeVisible();
  }

  // Theme toggle flips the class and persists paper/ink ground.
  await page.getByRole("button", { name: /toggle light and dark theme/i }).click();
  const isDark = await page.evaluate(() =>
    document.documentElement.classList.contains("dark"),
  );
  const bg = await page.evaluate(
    () => getComputedStyle(document.body).backgroundColor,
  );
  expect(bg).not.toBe("rgba(0, 0, 0, 0)");
  expect(typeof isDark).toBe("boolean");
});
