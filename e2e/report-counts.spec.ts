import { expect, test, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { adminClient, ingestFileAs, seededTemplateCount, signIn } from "./helpers";
import { LAYER_DEFINITIONS } from "../src/copy/reports/strings";
import { inspectReportCounts } from "./report-count-audit";

const DEFINITIONS = { estimate: LAYER_DEFINITIONS.estimate, "variant-call": LAYER_DEFINITIONS.variant_call };
const account = { email: `count-contract-${randomUUID()}@e2e.local`, password: "e2e-count-contract-password" };
async function assertCounts(page: Page) {
  expect(await page.evaluate(inspectReportCounts, DEFINITIONS)).toEqual([]);
}

test.beforeAll(async () => {
  const { error } = await adminClient().auth.admin.createUser({ ...account, email_confirm: true });
  expect(error).toBeNull();
});

test("real report counts stay single-layer through upload, Overview, both libraries, filters and search", async ({ page }) => {
  await signIn(page, account.email, account.password);
  await page.goto("/genome/me/reports");
  await assertCounts(page); // no-file library still contains both seeded layers
  await ingestFileAs(page, account.email, account.password,
    path.join(process.cwd(), "e2e/fixtures/tiny-grch38.vcf"), "vcf");
  for (const viewport of [{ width: 1280, height: 800 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    await page.goto("/overview");
    for (const [dbLayer, layer] of [["estimate", "estimate"], ["variant_call", "variant-call"]] as const) {
      await expect(page.locator(`[data-slot="count"][data-figure-class="${layer}"]`).first())
        .toHaveAttribute("data-metric-value", String(seededTemplateCount(dbLayer)));
    }
    await assertCounts(page);
    await page.goto("/genome/me");
    await expect(page.getByRole("heading", { name: "My Genome", exact: true })).toBeVisible();
    await assertCounts(page);
    await expect(page.locator('[data-slot="count"]')).toHaveCount(0);
    for (const [dbLayer, layer] of [["estimate", "estimate"], ["variant_call", "variant-call"]] as const) {
      await page.goto(`/genome/me/reports?layer=${dbLayer}`);
      await expect(page.locator(`[data-library-layer="${layer}"]`)).toBeVisible();
      await assertCounts(page);
      // A mouse/keyboard-operable disclosure exposes the inactive count's exact definition.
      const inactive = page.locator("main header details");
      await expect(inactive).toHaveCount(1);
      await inactive.locator("summary").click();
      const other = layer === "estimate" ? "variant-call" : "estimate";
      await expect(inactive.locator("p")).toHaveText(DEFINITIONS[other]);
      await expect(inactive.locator("p")).toBeVisible();
      await assertCounts(page);
      await inactive.locator("summary").click();
      await page.getByText("Filter reports", { exact: true }).click();
      await assertCounts(page);
      if (layer === "estimate") {
        const more = page.getByRole("button", { name: /^Show all \d[\d,]* statistical estimates$/ }).first();
        await expect(more).toBeVisible();
        await more.click();
        await assertCounts(page);
      }
      const search = page.getByLabel("Search reports by title, gene, or category");
      await search.fill(layer === "estimate" ? "CYP1A2" : "VKORC1");
      await expect(page.locator(`[data-card="${layer}"]`)).toHaveCount(1);
      await assertCounts(page);
      await page.getByLabel("With results", { exact: true }).check();
      await assertCounts(page);
      await search.fill("no-count-contract-match");
      await expect(page.locator(`[data-card="${layer}"]`)).toHaveCount(0);
      await assertCounts(page);
    }
    await page.getByRole("button", { name: "Search", exact: true }).click();
    await page.getByLabel("Find a person, a report or a page").fill("caffeine");
    await expect(page.locator('dialog[open] [data-search-group="reports"]')).toBeVisible();
    await assertCounts(page);
    await expect(page.locator('dialog[open] [data-slot="count"]')).toHaveCount(0);
    await page.keyboard.press("Escape");
  }
  await page.goto("/changelog");
  await assertCounts(page);
});

test("count detector fails injected missing-class, mixed-headline, mixed-token and bare-count mutations", async ({ page }) => {
  await signIn(page, account.email, account.password);
  await page.goto("/genome/me/reports");
  await assertCounts(page);
  for (const [mutation, expected] of [
    ["missing-class", "missing-or-mixed-count-class"],
    ["mixed-headline", "mixed-count-headline"],
    ["mixed-token", "missing-or-mixed-count-class"],
    ["bare-count", "unclassified-report-count"],
    ["dangling-definition", "missing-or-wrong-count-definition"],
    ["legacy-attribute", "legacy-count-attribute"],
  ]) {
    await page.evaluate((kind) => {
      const fixture = document.createElement("section");
      fixture.id = "count-audit-mutation";
      const first = document.querySelector('[data-slot="count"][data-figure-class="estimate"]')!.cloneNode(true) as HTMLElement;
      if (kind === "missing-class") first.removeAttribute("data-figure-class");
      if (kind === "mixed-token") first.setAttribute("data-figure-class", "estimate variant-call");
      if (kind === "dangling-definition") first.setAttribute("aria-describedby", "no-such-definition");
      if (kind === "legacy-attribute") first.setAttribute("data-count-class", "polygenic");
      fixture.append(first);
      if (kind === "mixed-headline") {
        const heading = document.createElement("h2");
        heading.append(first, document.querySelector('[data-slot="count"][data-figure-class="variant-call"]')!.cloneNode(true));
        fixture.append(heading);
      }
      if (kind === "bare-count") {
        const bare = document.createElement("p");
        const number = document.createElement("span");
        number.textContent = "162";
        bare.append(number, " reports");
        fixture.append(bare);
      }
      document.querySelector("main")!.append(fixture);
    }, mutation);
    expect(await page.evaluate(inspectReportCounts, DEFINITIONS)).toContain(expected);
    await page.locator("#count-audit-mutation").evaluate((node) => node.remove());
    await assertCounts(page);
  }
});
