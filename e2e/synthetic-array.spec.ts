import { randomUUID } from "node:crypto";
import path from "node:path";
import { expect, test } from "@playwright/test";
import bindings from "../scripts/comprehension/bindings.json";
import recipe from "../data/samples/synthetic-array-recipe.json";
import metabolicTemplates from "../data/templates/metabolic-obesity.json";
import { createConfirmedUser, signIn } from "./helpers";
import { uploadOwnFileWithChosenReports } from "./own-report-helpers";

// Exercise D-133 through the real upload/preparation/report path. The separate
// task-depth journeys retain their original fixtures and action assertions.
test("the synthetic GRCh37 array prepares and preserves the T1 and T3 report states", async ({ page }) => {
  const user = { email: `synthetic-array-${randomUUID()}@e2e.local`, password: "e2e-synthetic-array-pw" };
  await createConfirmedUser(user.email, user.password);
  await signIn(page, user.email, user.password);
  await uploadOwnFileWithChosenReports(page, path.resolve("data/samples/synthetic_23andme.txt"), {
    fileType: "array_23andme", purposes: ["reports.polygenic", "reports.monogenic"],
  });

  const t1 = bindings.tasks.find(task => task.id === "T1")!;
  for (const slug of t1.templateSlugs) {
    await page.goto(`/genome/me/reports/${slug}`);
    const template = metabolicTemplates.find(template => template.slug === slug)!;
    expect(template.variants).toHaveLength(1);
    const rsid = template.variants[0].rsid;
    const call = recipe.calls.find(call => call.rsid === rsid)!;
    // These three bound positions map on the positive strand. The generator's
    // parser/chain test separately asserts their exact target coordinates.
    const result = page.locator(`[data-variant-result="${rsid}"]`);
    const genotype = result.locator('[data-figure-kind="genotype"][data-figure-basis="observed"]');
    await expect(genotype.locator('[data-slot="figure-value"]')).toHaveText(call.genotype.split("").join("/"));
    await expect(result.locator("[data-outcome]")).toHaveCount(0);
  }

  const t3 = bindings.tasks.find(task => task.id === "T3")!;
  for (const slug of t3.templateSlugs) {
    await page.goto(`/genome/me/reports/${slug}`);
    await expect(page.locator('[data-outcome="not-covered"]')).toHaveCount(1);
    await expect(page.locator('[data-figure-kind="genotype"]')).toHaveCount(0);
  }
});
