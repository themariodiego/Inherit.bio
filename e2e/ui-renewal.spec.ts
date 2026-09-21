import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { createConfirmedUser, signIn } from "./helpers";

// Regressions found during simulated-user review: purchase decisions must
// remain readable on small screens, and navigation must survive enlarged text.
for (const width of [320, 768]) {
  test(`provider compatibility and prices precede purchase at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/providers");
    const provider = page.getByTestId("provider-nucleus-genomics");
    const product = provider.locator("section").first();
    await expect(product.getByText("Price", { exact: true })).toBeVisible();
    await expect(product.getByText("Raw files you get", { exact: true })).toBeVisible();
    await expect(product.getByText("Supported raw file", { exact: true })).toBeVisible();
    const details = await product.boundingBox();
    const purchase = await provider.getByRole("link", { name: "Buy through provider" }).boundingBox();
    expect(details).not.toBeNull();
    expect(purchase).not.toBeNull();
    expect(purchase!.y).toBeGreaterThanOrEqual(details!.y + details!.height);
    expect(await product.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}

test("navigation stays reachable with enlarged text and a short viewport", async ({ page }) => {
  const email = `ui-renewal-${randomUUID()}@e2e.local`;
  const password = "e2e-ui-renewal-password";
  await createConfirmedUser(email, password);
  await signIn(page, email, password);
  await page.setViewportSize({ width: 768, height: 700 });
  await page.goto("/overview");
  await page.evaluate(() => { document.documentElement.style.fontSize = "24px"; });
  const settings = page.locator("aside").getByRole("link", { name: "Settings", exact: true });
  await settings.focus();
  const highlight = page.locator('[data-slot="nav-glide"]');
  await expect.poll(async () => {
    const link = await settings.boundingBox();
    const tint = await highlight.boundingBox();
    return Math.abs(link!.y - tint!.y) + Math.abs(link!.height - tint!.height);
  }).toBeLessThan(2);

  await page.evaluate(() => { document.documentElement.style.fontSize = ""; });
  await page.setViewportSize({ width: 800, height: 300 });
  await settings.blur();
  await settings.focus();
  await expect(settings).toBeInViewport({ ratio: 1 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(highlight).toHaveCSS("transition-duration", "0s");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/settings$/);
  await expect(page.getByRole("heading", { name: "Settings", exact: true })).toBeVisible();
});
