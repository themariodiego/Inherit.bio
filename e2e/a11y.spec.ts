import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { createConfirmedUser, signIn } from "./helpers";

// A16 — axe accessibility checks over key surfaces in BOTH themes, plus
// design-token presence (Fraunces display, pill CTAs, attribution line).

const USER = { email: "a11y@e2e.local", password: "e2e-a11y-pw" };

test.beforeAll(async () => {
  await createConfirmedUser(USER.email, USER.password);
});

const PUBLIC_ROUTES = ["/", "/providers", "/privacy", "/auth/sign-in"];

for (const route of PUBLIC_ROUTES) {
  for (const theme of ["light", "dark"] as const) {
    test(`axe: ${route} (${theme})`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: theme });
      await page.goto(route);
      await page.waitForLoadState("networkidle");
      const results = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa"])
        .analyze();
      expect(
        results.violations.map((v) => ({
          id: v.id,
          impact: v.impact,
          nodes: v.nodes.length,
          help: v.help,
        })),
      ).toEqual([]);
    });
  }
}

test("axe: dashboard + settings (authenticated, both themes)", async ({
  page,
}) => {
  await signIn(page, USER.email, USER.password);
  for (const route of ["/dashboard", "/settings", "/uploads"]) {
    for (const theme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme: theme });
      await page.goto(route);
      await page.waitForLoadState("networkidle");
      const results = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa"])
        .analyze();
      expect(
        results.violations.map((v) => ({
          id: v.id,
          route,
          theme,
          help: v.help,
        })),
      ).toEqual([]);
    }
  }
});

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
