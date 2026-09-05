import { test, expect } from "@playwright/test";
import { randomUUID, createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { adminClient, createConfirmedUser, ingestFileAs, signIn } from "./helpers";
import { PERSONAL_PREVIEW_TRAITS } from "../src/copy/reports/personal-previews";

test("explicit VCF reference calls match array findings without entering variant-only analyses", async ({ page }) => {
  const admin = adminClient();
  const texts: string[][] = [];
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  for (const kind of ["vcf", "array_23andme"] as const) {
    const user = { email: `observed-${kind}-${randomUUID()}@e2e.local`, password: "e2e-observed-password" };
    await createConfirmedUser(user.email, user.password);
    await signIn(page, user.email, user.password);
    const fixture = path.join(process.cwd(), `e2e/fixtures/observed-reference-grch38.${kind === "vcf" ? "vcf" : "txt"}`);
    const id = await ingestFileAs(page, user.email, user.password, fixture, kind);
    if (kind === "vcf") {
      const { data: file, error } = await admin.from("genome_files").select("observed_call_sha256,observed_call_version,variant_count").eq("id", id).single();
      expect(error).toBeNull();
      expect(file).toMatchObject({ observed_call_sha256: createHash("sha256").update(readFileSync(fixture)).digest("hex"), observed_call_version: "vcf-literal-diploid-snp-v1", variant_count: 0 });
      const before = await admin.from("report_observed_calls").select("*").eq("file_id", id).order("source_line");
      expect(before.error).toBeNull();
      expect(before.data).toHaveLength(5);
      expect((await admin.from("user_variants").select("id").eq("file_id", id)).data).toEqual([]);
      expect((await page.request.post(`/api/files/${id}/process`)).ok()).toBe(true);
      expect((await admin.from("report_observed_calls").select("*").eq("file_id", id).order("source_line")).data).toEqual(before.data);
    }
    await page.goto("/genome/me/reports");
    const inputs = page.locator('[data-slot="preview-input-provenance"]');
    await expect(inputs).toContainText("Inherit did not create these files");
    await expect(inputs).toContainText("No change of genome coordinates was needed");
    await expect(inputs.locator('[data-slot="input-source"]')).toHaveCount(1);
    const previews: string[] = [];
    for (const trait of PERSONAL_PREVIEW_TRAITS) {
      const preview = page.locator(`[data-personal-preview="${trait.slug}"]`);
      await expect(preview).toBeVisible();
      await expect(page.locator(`#preview-input-${trait.slug}`)).toContainText("File 1");
      await expect(page.locator(`#preview-input-${trait.slug} [data-figure-kind="coverage"]`)).toHaveCount(1);
      previews.push(await preview.innerText());
    }
    texts.push(previews);
    await page.getByLabel("With results", { exact: true }).check();
    for (const trait of PERSONAL_PREVIEW_TRAITS) await expect(page.locator(`[data-personal-preview="${trait.slug}"]`)).toBeVisible();
    await page.goto("/genome/me/reports/alcohol-flush-aldh2-rs671");
    await expect(page.locator('[data-figure-kind="genotype"]')).toHaveCount(1);
    await expect(page.locator('[data-slot="report-skeleton"] h2')).toHaveCount(6);
    const detailInputs = page.locator('[data-slot="input-provenance"]');
    await expect(detailInputs).toContainText("share of listed, supported point records");
    await expect(detailInputs).not.toContainText("were not recorded for this input");
    await expect(detailInputs.locator('details')).toHaveCount(0);
    await page.context().clearCookies();
  }
  expect(texts[0]).toEqual(texts[1]);
  expect(errors).toEqual([]);
});
