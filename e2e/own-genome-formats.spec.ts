import { expect, test } from "@playwright/test";
import { createHash, randomUUID } from "node:crypto";
import { gzipSync } from "node:zlib";
import AdmZip from "adm-zip";
import { syntheticOwnUploadFormats } from "../scripts/synthetic-own-upload-formats";
import { subjectFinalizationReceipt, subjectNormalizationReceipt } from "../src/lib/uploads/subject-upload-contract";
import { adminClient, completeOwnUploadConsent, createConfirmedUser, signIn } from "./helpers";
import { generateOwnFileWithChosenReports } from "./own-report-helpers";

// Real picker, Storage, preparation and explicit report choice for every
// admitted content format. No result rows or consent grants are inserted.
for (const fixture of syntheticOwnUploadFormats) {
  for (const encoding of ["plain", "gzip", "zip"]) {
    test(`${fixture.id} ${encoding}: own entry to prepared source and report`, async ({ page }) => {
      const user = { email: `own-formats-${randomUUID()}@e2e.local`, password: "e2e-own-formats-password" };
      await createConfirmedUser(user.email, user.password);
      await signIn(page, user.email, user.password);
      const errors: string[] = [];
      page.on("pageerror", error => errors.push(error.message));
      await page.goto(encoding === "plain" ? "/overview" : "/genome/me");
      if (encoding === "plain") {
        await page.getByRole("link", { name: "I have a DNA file", exact: true }).click();
      } else {
        // The subject bar has a second, outline upload link. Exercise the
        // hub's primary action while preserving both entry points.
        await page.getByRole("link", { name: "Add a file", exact: true })
          .and(page.locator('main [data-variant="default"]')).click();
      }
      await expect(page).toHaveURL(/\/files\/upload(?:\?|$)/);
      await completeOwnUploadConsent(page, page.url());

      const finalizing = page.waitForResponse(response => /\/api\/files\/[0-9a-f-]{36}\/finalize$/.test(response.url())
        && response.request().method() === "POST");
      const preparing = page.waitForResponse(response => /\/api\/files\/[0-9a-f-]{36}\/process$/.test(response.url())
        && response.request().method() === "POST");
      for (const promise of [finalizing, preparing]) void promise.catch(() => {});
      const decoded = Buffer.from(fixture.text), bytes = encoding === "gzip" ? gzipSync(decoded) : decoded;
      const zip = new AdmZip(); zip.addFile("synthetic-dna.txt", decoded);
      const selected = encoding === "zip" ? zip.toBuffer() : bytes;
      // Deliberately uninformative name and MIME: content selects the parser.
      await page.locator('input[type="file"]').setInputFiles({ name: "synthetic.data", mimeType: "application/octet-stream", buffer: selected });
      const finalized = await finalizing;
      expect(finalized.status()).toBe(200);
      const { fileId } = subjectFinalizationReceipt.parse(await finalized.json());
      const prepared = await preparing;
      expect(prepared.status()).toBe(200);
      expect(subjectNormalizationReceipt.parse(await prepared.json()).fileId).toBe(fileId);
      await expect(page.getByText("Your file is stored and prepared. Reports have not been generated yet.", { exact: false })).toBeVisible();

      const admin = adminClient();
      const source = await admin.from("genome_files").select("file_type,bucket_path,sha256,subject_id,normalization_completed_at")
        .eq("id", fileId).single();
      expect(source.error).toBeNull();
      expect(source.data!.file_type).toBe(fixture.kind);
      expect(source.data!.sha256).toBe(createHash("sha256").update(bytes).digest("hex"));
      expect(source.data!.normalization_completed_at).not.toBeNull();
      const original = await admin.storage.from("genomes").download(source.data!.bucket_path);
      expect(original.error).toBeNull();
      expect(Buffer.from(await original.data!.arrayBuffer())).toEqual(bytes);
      const grants = await admin.from("purpose_grants").select("grant_id").eq("target_id", source.data!.subject_id);
      expect(grants.error).toBeNull();
      expect(grants.data).toEqual([]);

      await page.goto("/overview");
      const choice = page.locator('section[aria-labelledby="prepared-reports-title"]');
      await expect(choice).toBeVisible();
      await choice.getByRole("link", { name: "Choose reports", exact: true }).click();
      await expect(page).toHaveURL(/\/genome\/me\/reports$/);
      await generateOwnFileWithChosenReports(page, fileId, ["reports.polygenic"]);
      await page.goto("/genome/me");
      await page.getByRole("link", { name: "Open Reports", exact: true }).click();
      await expect(page).toHaveURL(/\/genome\/me\/reports$/);
      await page.goto("/genome/me/reports/caffeine-metabolism-cyp1a2-rs762551");
      const result = page.locator('[data-variant-result="762551"]');
      await expect(result.locator('[data-figure-kind="genotype"][data-figure-basis="observed"] [data-slot="figure-value"]')).toHaveText("A/C");
      await expect(result.locator("[data-outcome]")).toHaveCount(0);
      await page.goto("/overview");
      await expect(page.locator('section[aria-labelledby="prepared-reports-title"]')).toHaveCount(0);
      expect(errors).toEqual([]);
    });
  }
}
