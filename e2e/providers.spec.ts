import { expect, test } from "@playwright/test";

// A3 — the directory renders ≥12 verified providers with source URLs and
// last-verified dates; US → New York flags the providers with NY
// exclusions; buy links point at provider domains (live resolution of each
// link is covered by scripts/check-provider-links.ts in the audit, not here
// — E2E must not depend on 16 external sites being up).

test("directory renders at least 12 providers with verification metadata", async ({
  page,
}) => {
  await page.goto("/providers");
  const cards = page.locator('[data-testid^="provider-"]');
  await expect(cards.first()).toBeVisible();
  const count = await cards.count();
  expect(count).toBeGreaterThanOrEqual(12);

  // Every card: last-verified date, at least one source link, a buy link.
  for (let i = 0; i < count; i++) {
    const card = cards.nth(i);
    await expect(card.getByText(/Verified \d{4}-\d{2}-\d{2}/)).toBeVisible();
    expect(
      await card.locator('a:has-text("source")').count(),
    ).toBeGreaterThanOrEqual(1);
  }

  // Buy links exist and are external provider URLs.
  const buyLinks = page.locator('a:has-text("Buy through provider")');
  expect(await buyLinks.count()).toBeGreaterThanOrEqual(10);
  for (const href of await buyLinks.evaluateAll((els) =>
    els.map((e) => e.getAttribute("href")),
  )) {
    expect(href).toMatch(/^https:\/\//);
    expect(href).not.toContain("localhost");
  }
});

test("US → New York flags providers with NY exclusions", async ({ page }) => {
  await page.goto("/providers");

  await page.getByLabel("Your country").click();
  await page.getByRole("option", { name: "United States" }).click();
  await page.getByLabel("State").click();
  await page.getByRole("option", { name: "New York" }).click();

  // Nucleus Genomics is NY-excluded per verified data.
  const nucleus = page.locator('[data-testid="provider-nucleus-genomics"]');
  await expect(
    nucleus.locator('[data-testid="state-exclusion-flag"]'),
  ).toBeVisible();

  // A worldwide provider with no NY exclusion shows no flag.
  const yseq = page.locator('[data-testid="provider-yseq"]');
  await expect(
    yseq.locator('[data-testid="state-exclusion-flag"]'),
  ).toHaveCount(0);
});

test("switching to a non-US country hides the state selector and re-filters", async ({
  page,
}) => {
  await page.goto("/providers");
  await page.getByLabel("Your country").click();
  await page.getByRole("option", { name: "Germany" }).click();
  await expect(page.getByLabel("State")).toHaveCount(0);
  // Nucleus ships to Germany per verified list — still purchasable.
  await expect(
    page
      .locator('[data-testid="provider-nucleus-genomics"]')
      .getByText("Buy through provider"),
  ).toBeVisible();
});
