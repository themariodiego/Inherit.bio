import AdmZip from "adm-zip";
import { expect, test, type Page } from "@playwright/test";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { adminClient, createConfirmedUser, signIn } from "./helpers";
import { generateOwnFileWithChosenReports, uploadOwnFilePrepared } from "./own-report-helpers";
import { OWN_REPORT_CHOICES } from "../src/lib/uploads/own-report-purpose";

async function downloadExport(page: Page) {
  await page.goto("/settings/data");
  const transfer = page.waitForEvent("download");
  await page.getByRole("link", { name: "Download export", exact: true }).click();
  const download = await transfer;
  expect(await download.failure()).toBeNull();
  const localPath = await download.path();
  expect(localPath).not.toBeNull();
  return new AdmZip(readFileSync(localPath!));
}

type FileReports = { file_id: string; report_count: number; source_sha256: string; reports: {
  slug: string; purpose: string; completed_at: string; provenance_note: string;
  variants: { rsid: string; genotype: string | null; interpretation: string | null }[];
}[] };

/** Real content proof for the existing synchronous ZIP surface, not evidence
 * that the separate registered large-export delivery lifecycle is complete. */
test("own export keeps both originals, includes only generated findings and preserves the raw right after withdrawal", async ({ page }) => {
  const email = `own-export-${randomUUID()}@e2e.local`;
  const password = "synthetic-own-export-password";
  await createConfirmedUser(email, password);
  await signIn(page, email, password);
  const sources = [] as { id: string; bytes: Buffer }[];
  for (const name of ["tiny-grch38.vcf", "personal-previews-grch38.vcf"]) {
    const fixture = path.join(process.cwd(), "e2e/fixtures", name);
    sources.push({ id: await uploadOwnFilePrepared(page, fixture, { fileType: "vcf" }), bytes: readFileSync(fixture) });
  }
  const admin = adminClient();
  const verifySources = async (zip: AdmZip) => {
    const manifest = JSON.parse(zip.readAsText("manifest.json")) as { files: { id: string; row_count: number; sha256: string }[]; warnings?: string[] };
    expect(manifest.files.map(file => file.id).sort()).toEqual(sources.map(source => source.id).sort());
    expect(manifest.warnings ?? []).toEqual([]);
    expect(zip.getEntries().filter(entry => entry.entryName.startsWith("originals/"))).toHaveLength(2);
    for (const source of sources) {
      expect(zip.readFile(`originals/${source.id}`)).toEqual(source.bytes);
      const variants = await admin.from("user_variants").select("id", { count: "exact", head: true }).eq("file_id", source.id);
      expect(variants.error).toBeNull();
      const csv = zip.readAsText(`variants/${source.id}.csv`).trimEnd().split("\n");
      expect(csv[0]).toBe("rsid,chrom,pos_grch38,ref,alt,genotype");
      expect(csv.length - 1).toBe(variants.count);
      expect(manifest.files.find(file => file.id === source.id)).toMatchObject({ row_count: variants.count,
        sha256: createHash("sha256").update(source.bytes).digest("hex") });
      const observed = await admin.from("report_observed_calls").select("source_line,genotype,source_sha256")
        .eq("file_id", source.id).order("source_line");
      expect(observed.error).toBeNull();
      const exported = JSON.parse(zip.readAsText(`observed/${source.id}.json`));
      expect(exported.map((row: { source_line: number; genotype: string; source_sha256: string }) => ({
        source_line: row.source_line, genotype: row.genotype, source_sha256: row.source_sha256,
      }))).toEqual(observed.data);
    }
  };

  // No report choice is needed to retrieve one's own original and prepared calls.
  const raw = await downloadExport(page);
  await verifySources(raw);
  expect((JSON.parse(raw.readAsText("reports.json")) as FileReports[]).every(file => file.report_count === 0)).toBe(true);
  expect(JSON.parse(raw.readAsText("prs.json"))).toEqual([]);

  await generateOwnFileWithChosenReports(page, sources[0].id, ["reports.polygenic"]);
  const generated = await downloadExport(page);
  await verifySources(generated);
  const results = JSON.parse(generated.readAsText("reports.json")) as FileReports[];
  const selected = results.find(file => file.file_id === sources[0].id)!;
  expect(selected.report_count).toBeGreaterThan(0);
  expect(results.find(file => file.file_id === sources[1].id)?.report_count).toBe(0);
  const caffeine = selected.reports.find(report => report.slug === "caffeine-metabolism-cyp1a2-rs762551")!;
  expect(caffeine).toMatchObject({ purpose: "reports.polygenic" });
  expect(caffeine.variants).toEqual(expect.arrayContaining([expect.objectContaining({ rsid: "rs762551", genotype: "AC" })]));
  expect(Date.parse(caffeine.completed_at)).not.toBeNaN();
  expect(caffeine.provenance_note).toBeTruthy();
  for (const key of ["citations", "evidence", "summary"]) expect(caffeine).not.toHaveProperty(key);
  expect(generated.readAsText("reports.txt")).toContain(caffeine.slug);
  expect(generated.readAsText("reports.txt")).toContain(caffeine.provenance_note);
  const prsText = generated.readAsText("prs.json");
  const scores = JSON.parse(prsText) as { file_id: string; status: string; reason: string }[];
  expect(scores.length).toBeGreaterThan(0);
  expect(scores.every(score => score.file_id === sources[0].id && score.status === "unavailable"
    && score.reason === "no_validated_reference")).toBe(true);
  expect(prsText).not.toMatch(/"(?:raw_score|zscore|percentile|risk)"/);

  await page.goto("/genome/me/reports");
  const revoked = page.waitForResponse(response => /\/api\/consents\/[^/]+\/revoke$/.test(response.url())
    && response.request().method() === "POST");
  await page.getByRole("button", { name: `Turn off ${OWN_REPORT_CHOICES["reports.polygenic"].label}`, exact: true }).click();
  expect((await revoked).status()).toBe(200);
  const withdrawn = await downloadExport(page);
  await verifySources(withdrawn);
  expect((JSON.parse(withdrawn.readAsText("reports.json")) as FileReports[]).every(file => file.report_count === 0)).toBe(true);
  expect(JSON.parse(withdrawn.readAsText("prs.json"))).toEqual([]);
});
