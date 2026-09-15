import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { adminClient, axeViolations, createConfirmedUser, signIn } from "./helpers";
import { uploadOwnFileWithChosenReports } from "./own-report-helpers";
import { REGIONAL_FIXTURES } from "./fixtures/generate-regional-aims-vcf";
import { REGIONAL_CAVEAT, REGIONAL_RANGE_NOTE } from "../src/lib/genome/regional-admixture";
import registry from "../data/ref/regions/regions-v3.json";

/** New fixtures use the actual upload → preparation → explicit choice → saved result → withdrawal path. */
for (const fixture of REGIONAL_FIXTURES) test(`seven-region ancestry: ${fixture.merged ? "combined" : "separate"} result, keyboard, phone and withdrawal`, async ({ page }, info) => {
  test.setTimeout(240_000);
  const user = { email: `regional-${randomUUID()}@e2e.local`, password: "e2e-regional-ancestry-pw" };
  await createConfirmedUser(user.email, user.password);
  await signIn(page, user.email, user.password);
  const fileId = await uploadOwnFileWithChosenReports(page, path.join(process.cwd(), "e2e/fixtures", fixture.name), { fileType: "vcf", purposes: ["ancestry"] });
  const sourceBefore = await adminClient().from("genome_files").select("id,status,sha256").eq("id", fileId).single();
  expect(sourceBefore.error).toBeNull(); expect(sourceBefore.data?.id).toBe(fileId);
  await page.goto("/genome/me/ancestry");
  const surface = page.locator('[data-slot="regional-ancestry"]');
  await expect(surface).toHaveAttribute("data-fit-converged", "true");
  await expect(surface).toContainText(registry.panel.version);
  await expect(surface.locator('[data-slot="stored-support-note"]')).toHaveText(REGIONAL_RANGE_NOTE);
  await expect(surface.locator('[data-slot="regional-caveat"]')).toHaveText(REGIONAL_CAVEAT);
  const rows = surface.locator('[data-slot="region-row"]');
  await expect(rows).toHaveCount(fixture.merged ? 5 : 7);
  const combined = surface.locator('[data-slot="region-row"][data-region="EUR-MID-CSA"]');
  await expect(combined).toHaveCount(fixture.merged ? 1 : 0);
  const disclosure = surface.locator('details[data-slot="regional-split"]');
  if (fixture.merged) {
    await expect(disclosure).toHaveCount(1);
    expect(await disclosure.getAttribute("open")).toBeNull();
    await expect(disclosure.locator('[data-split-region="EUR"]')).toBeHidden();
    const summary = disclosure.locator("summary");
    await summary.focus(); await summary.press("Enter");
    await expect(disclosure).toHaveAttribute("open", "");
    await expect(disclosure.locator('[data-slot="regional-split-caveat"]')).toHaveText(REGIONAL_CAVEAT);
    for (const code of ["EUR", "MID", "CSA"]) await expect(disclosure.locator(`[data-split-region="${code}"]`)).toBeVisible();
    const split = await disclosure.locator('[data-slot="figure-value"]').allTextContents();
    const total = split.reduce((sum, value) => sum + Math.round(parseFloat(value) * 10), 0);
    expect(total).toBe(Math.round(parseFloat(await combined.locator('[data-slot="figure-value"]').innerText()) * 10));
    await summary.press("Enter"); await expect(disclosure.locator('[data-split-region="EUR"]')).toBeHidden();
  } else {
    await expect(disclosure).toHaveCount(0);
    expect((await rows.evaluateAll(elements => elements.map(element => element.getAttribute("data-region")))).sort())
      .toEqual(["AFR", "AMR", "CSA", "EAS", "EUR", "MID", "OCE"]);
  }
  const toggle = surface.getByRole("switch");
  await expect(toggle).toHaveAttribute("aria-checked", "true");
  const values = async () => rows.locator('[data-slot="figure-value"]').allTextContents();
  const before = await values();
  for (const filtered of [true, false]) {
    if (!filtered) await toggle.click();
    const visible = surface.locator('[data-slot="region-row"]:not([hidden])');
    const tableCodes = await visible.evaluateAll(elements => elements.map(element => element.getAttribute("data-region")));
    const paths = surface.locator('[data-slot="ancestry-map"] path[role="button"]');
    expect(await paths.evaluateAll(elements => elements.map(element => element.getAttribute("data-region")))).toEqual(tableCodes);
    const figures = [...await visible.locator('[data-slot="figure-value"]').allTextContents(),
      ...await surface.locator('[data-slot="ancestry-chip"] [data-slot="figure-value"]').allTextContents()];
    expect(figures.reduce((sum, value) => sum + Math.round(parseFloat(value) * 10), 0)).toBe(1000);
    expect(await values()).toEqual(before);
  }
  const firstPath = surface.locator('[data-slot="ancestry-map"] path[role="button"]').first();
  await firstPath.focus(); await firstPath.press("Enter");
  const close = surface.getByRole("button", { name: "Close", exact: true });
  await expect(close).toBeFocused(); await close.press("Escape");
  await expect(firstPath).toBeFocused(); await expect(surface.getByRole("dialog")).toHaveCount(0);
  await firstPath.press("Enter"); await expect(close).toBeFocused();
  await page.getByRole("heading", { level: 1 }).click();
  await expect(surface.getByRole("dialog")).toHaveCount(0); await expect(firstPath).toBeFocused();
  await firstPath.press("Enter"); await expect(close).toBeFocused();
  await toggle.click();
  await expect(surface.getByRole("dialog")).toHaveCount(0); await expect(toggle).toBeFocused();
  await expect(toggle).toHaveAttribute("aria-checked", "true");
  await toggle.click(); await expect(toggle).toHaveAttribute("aria-checked", "false");
  const attributions = await surface.locator('[data-figure-kind="ancestry-share"]').evaluateAll(figures => figures.map(figure => {
    let attributed = 0, blocks = 0;
    for (let node: Element | null = figure; node; node = node.parentElement) {
      if (node.hasAttribute("data-subject-id") || node.hasAttribute("data-subject-pair")) attributed++;
      if (node.hasAttribute("data-claim-block")) blocks++;
    }
    return { attributed, blocks, provenance: figure.getAttribute("data-provenance") };
  }));
  expect(attributions.length).toBeGreaterThan(0);
  for (const attribution of attributions) expect(attribution).toEqual({ attributed: 1, blocks: 1,
    provenance: "computed:src/lib/genome/regional-admixture.ts" });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect(await surface.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  expect(await axeViolations(page, "light")).toEqual([]);
  await page.screenshot({ path: info.outputPath("regional-phone.png"), fullPage: true });

  await page.goto("/genome/me/reports");
  const revoked = page.waitForResponse(response => /\/api\/consents\/[0-9a-f-]{36}\/revoke$/.test(response.url()) && response.request().method() === "POST");
  await page.getByRole("region", { name: "Choose your reports", exact: true }).getByRole("button", { name: "Turn off Ancestry", exact: true }).click();
  const receipt = await revoked; expect(receipt.status()).toBe(200); expect(await receipt.json()).toMatchObject({ revoked: true });
  await page.goto("/genome/me/ancestry");
  expect(await page.locator('[data-figure-kind="ancestry-share"]').count()).toBe(0);
  expect(await page.locator('[data-slot="ancestry-map"][data-mode="shown"]').count()).toBe(0);
  expect(await page.locator('details[data-slot="regional-split"]').count()).toBe(0);
  const sourceAfter = await adminClient().from("genome_files").select("id,status,sha256").eq("id", fileId).single();
  expect(sourceAfter.error).toBeNull();
  expect(sourceAfter.data, "turning off ancestry preserves the independently authorized source").toEqual(sourceBefore.data);
});
