import { expect, test, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { adminClient, anonClient, createConfirmedUser, signIn, uploadOwnFileThroughUi } from "./helpers";
import { OWN_REPORT_CHOICES, OWN_REPORT_PURPOSES } from "../src/lib/uploads/own-report-purpose";
import { subjectNormalizationReceipt } from "../src/lib/uploads/subject-upload-contract";
import { NOT_COVERED_VCF } from "../src/copy/reports/strings";

const LIBRARY = "/genome/me/reports";
const SLUG = "lactase-persistence-lct-rs4988235";
const DETAIL = `${LIBRARY}/${SLUG}`;
const PURPOSE = "reports.polygenic";
const LABEL = OWN_REPORT_CHOICES[PURPOSE].label;
const TAKEAWAY = "Your file shows a form linked to keeping the enzyme that breaks down milk sugar active in adulthood.";

/** The completion journal is intentionally not a public Data API resource.
 * This exact synthetic-file read exposes only purpose/state/binding flags,
 * never result payloads, genotypes, tokens or other users' records.
 */
async function completedPurposes(fileId: string) {
  if (!/^[0-9a-f-]{36}$/.test(fileId)) throw new Error("Expected a canonical synthetic file identifier");
  const { stdout } = await promisify(execFile)("docker", ["exec", "supabase_db_sequence", "psql", "-U", "postgres",
    "-d", "postgres", "-XAt", "--set=ON_ERROR_STOP=1", "--command", `
      select coalesce(json_agg(proof order by purpose),'[]'::json) from (
        select r.purpose,r.state,r.completed_at is not null as completed,
          r.source_revision=f.upload_revision and r.source_sha256=f.sha256 as same_source,
          p.revoked_at is null and p.purpose=r.purpose as live_exact_purpose
        from private.own_analysis_runs r join public.genome_files f on f.id=r.file_id
        join public.purpose_grants p on p.grant_id=r.grant_id
        where r.file_id='${fileId}'::uuid
      ) proof;`], { timeout: 10_000, maxBuffer: 8192 });
  return JSON.parse(stdout.trim());
}

/** Inspect both rendered content and the raw document/RSC payload. Public
 * report explanations may remain, but not this account's personal finding.
 * Canonical source calls are a separate store-consent permission, not an
 * analytic output, and must not be erased by a report-purpose withdrawal.
 */
async function expectNoPersonalReport(page: Page) {
  const library = await page.goto(LIBRARY);
  expect(library?.ok()).toBe(true);
  await expect(page.locator("[data-personal-preview]")).toHaveCount(0);
  expect(await library!.text()).not.toContain(TAKEAWAY);
  const detail = await page.goto(DETAIL);
  expect(detail?.ok()).toBe(true);
  await expect(page.locator('[data-figure-kind="genotype"]')).toHaveCount(0);
  const document = await detail!.text();
  expect(document).not.toContain('data-figure-kind="genotype"');
  expect(document).not.toContain(TAKEAWAY);
  expect(document).not.toContain("One A copy marks lactase persistence");
}

test("canonical chosen report gives a real milk-sugar finding and withdrawal removes only analytic access", async ({ page }) => {
  const user = { email: `canonical-report-${randomUUID()}@e2e.local`, password: "synthetic-report-password" };
  const accountId = await createConfirmedUser(user.email, user.password);
  await signIn(page, user.email, user.password);
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  const prepared = page.waitForResponse(response => /\/api\/files\/[0-9a-f-]{36}\/process$/.test(response.url())
    && response.request().method() === "POST");
  void prepared.catch(() => {});
  const fixture = path.join(process.cwd(), "e2e/fixtures/personal-previews-grch38.vcf");
  const fileId = await uploadOwnFileThroughUi(page, fixture);
  const preparation = await prepared;
  expect(preparation.status()).toBe(200);
  expect(subjectNormalizationReceipt.parse(await preparation.json())).toEqual({
    fileId, status: "normalization_complete", analysisState: "not_generated",
  });
  await expect(page.getByRole("link", { name: "Choose your reports", exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Choose your reports", exact: true }).click();
  const choices = page.getByRole("region", { name: "Choose your reports", exact: true });
  await expect(choices).toBeVisible();
  for (const purpose of OWN_REPORT_PURPOSES) {
    await expect(choices.getByRole("checkbox", { name: OWN_REPORT_CHOICES[purpose].label, exact: true })).not.toBeChecked();
  }
  await choices.screenshot({ path: test.info().outputPath("report-choices-desktop.png") });
  const desktopViewport = page.viewportSize();
  try {
    await page.setViewportSize({ width: 390, height: 844 });
    await choices.screenshot({ path: test.info().outputPath("report-choices-mobile.png") });
  } finally {
    if (desktopViewport) await page.setViewportSize(desktopViewport);
  }

  const admin = adminClient();
  const source = await admin.from("genome_files").select("user_id,subject_id,status,normalization_completed_at,upload_revision")
    .eq("id", fileId).single();
  expect(source.error).toBeNull();
  expect(source.data!.user_id).toBe(accountId);
  expect(source.data!.status).toBe("stored");
  await expectNoPersonalReport(page);
  await page.goto("/genome/me/ancestry");
  await expect(page.locator('[data-figure-kind="ancestry-share"]')).toHaveCount(0);

  await page.goto(LIBRARY);
  await choices.getByRole("checkbox", { name: LABEL, exact: true }).check();
  const enabled = page.waitForResponse(response => response.url().endsWith("/api/consents")
    && response.request().method() === "POST");
  await choices.getByRole("button", { name: `Enable ${LABEL}`, exact: true }).click();
  const enabledResponse = await enabled;
  expect(enabledResponse.status()).toBe(201);
  const grant = await enabledResponse.json();
  expect(grant).toMatchObject({ recordKind: "purpose_grant", purposeKey: PURPOSE });
  await expect(choices.getByRole("button", { name: `Turn off ${LABEL}`, exact: true })).toBeVisible();
  for (const purpose of OWN_REPORT_PURPOSES.filter(purpose => purpose !== PURPOSE)) {
    await expect(choices.getByRole("checkbox", { name: OWN_REPORT_CHOICES[purpose].label, exact: true })).not.toBeChecked();
  }
  // Saving permission is not evidence that computation completed. Verify the
  // fresh server response too, so a stale pre-grant DOM cannot satisfy this.
  await expectNoPersonalReport(page);
  expect(await completedPurposes(fileId)).toEqual([]);
  await page.goto(LIBRARY);
  const generated = page.waitForResponse(response => response.url().endsWith(`/api/files/${fileId}/process`)
    && response.request().method() === "POST");
  await choices.getByRole("button", { name: "Generate selected reports", exact: true }).click();
  const generation = await generated;
  expect(generation.status()).toBe(200);
  expect(await generation.json()).toEqual({ fileId, status: "processed", analysisState: "active" });

  await page.getByLabel("Search reports by title, gene, or category").fill("MCM6");
  const preview = page.locator(`[data-personal-preview="${SLUG}"]`);
  await expect(preview).toContainText(TAKEAWAY);
  await expect(preview).toContainText("It does not tell you whether dairy causes symptoms.");
  await page.locator(`[data-card="estimate"]`).filter({ has: preview }).getByRole("link", { name: /Lactose tolerance/ }).click();
  await expect(page).toHaveURL(new RegExp(`${DETAIL}$`));
  const genotype = page.locator('[data-figure-kind="genotype"]');
  await expect(genotype).toHaveCount(1);
  await expect(genotype.locator('[data-slot="figure-value"]')).toHaveText("A/G");
  // This source contains rs4988235, not the second linked position rs182549.
  // Its useful result must retain the missing-input explanation.
  await expect(page.getByText(NOT_COVERED_VCF, { exact: true })).toBeVisible();
  await expect(page.locator('[data-slot="report-skeleton"] h2')).toHaveCount(6);
  await expect(page.locator('a[href="https://pubmed.ncbi.nlm.nih.gov/11788828/"]').first()).toBeVisible();
  await page.screenshot({ path: test.info().outputPath("chosen-milk-sugar-report.png"), fullPage: true });

  const grants = await admin.from("purpose_grants").select("purpose,grant_id,revoked_at").eq("target_id", source.data!.subject_id);
  expect(grants.error).toBeNull();
  expect(grants.data).toEqual([{ purpose: PURPOSE, grant_id: grant.recordId, revoked_at: null }]);
  expect(await completedPurposes(fileId)).toEqual([{
    purpose: PURPOSE, state: "complete", completed: true, same_source: true, live_exact_purpose: true,
  }]);
  const owner = anonClient();
  const auth = await owner.auth.signInWithPassword(user);
  expect(auth.error).toBeNull();
  const generatedScores = await admin.from("user_prs").select("file_id,pgs_id,matched").eq("file_id", fileId).order("pgs_id");
  expect(generatedScores.error).toBeNull();
  expect(generatedScores.data!.length, "real generated score coverage metadata").toBeGreaterThan(0);
  const visibleScores = await owner.from("user_prs").select("file_id,pgs_id,matched").eq("file_id", fileId).order("pgs_id");
  expect(visibleScores.error).toBeNull();
  expect(visibleScores.data).toEqual(generatedScores.data);
  // The published API exposes matched counts plus public score denominators,
  // not a stored coverage fraction or raw score (20260905195248).
  const denominators = await owner.from("prs_scores").select("pgs_id,n_variants")
    .in("pgs_id", visibleScores.data!.map(score => score.pgs_id));
  expect(denominators.error).toBeNull();
  for (const score of visibleScores.data!) {
    const definition = denominators.data!.find(row => row.pgs_id === score.pgs_id);
    expect(definition).toBeDefined();
    expect(definition!.n_variants).toBeGreaterThan(0);
    expect(score.matched).toBeGreaterThanOrEqual(0);
    expect(score.matched).toBeLessThanOrEqual(definition!.n_variants);
  }
  for (const forbiddenColumn of ["raw_score", "coverage"]) {
    const forbidden = await owner.from("user_prs").select(forbiddenColumn).eq("file_id", fileId);
    expect(forbidden.error?.code, `${forbiddenColumn} is deliberately not exposed`).toBe("42501");
    expect(forbidden.data).toBeNull();
  }
  const ancestry = await admin.from("ancestry_results").select("id").eq("file_id", fileId);
  expect(ancestry.error).toBeNull();
  expect(ancestry.data).toEqual([]);
  await page.goto("/genome/me/ancestry");
  await expect(page.locator('[data-figure-kind="ancestry-share"]')).toHaveCount(0);

  await page.goto(LIBRARY);
  const withdrawn = page.waitForResponse(response => response.url().endsWith(`/api/consents/${grant.recordId}/revoke`)
    && response.request().method() === "POST");
  await choices.getByRole("button", { name: `Turn off ${LABEL}`, exact: true }).click();
  const withdrawal = await withdrawn;
  expect(withdrawal.status()).toBe(200);
  expect(await withdrawal.json()).toMatchObject({ revoked: true });
  await expect(choices.getByRole("checkbox", { name: LABEL, exact: true })).not.toBeChecked();
  await expectNoPersonalReport(page);

  // Query through a real authenticated owner session, not the admin client.
  // A still-owned source does not authorize withdrawn analytic rows.
  try {
    for (const table of ["user_prs", "ancestry_results"]) {
      const denied = await owner.from(table).select("file_id").eq("file_id", fileId);
      expect(denied.error).toBeNull();
      expect(denied.data, `${table} after purpose withdrawal`).toEqual([]);
    }
    const retained = await owner.from("genome_files").select("id,status").eq("id", fileId).single();
    expect(retained.error).toBeNull();
    expect(retained.data).toEqual({ id: fileId, status: "stored" });
    // Observed-call REST has a separate legacy-only policy; canonical source
    // browsing uses user_variants. Do not widen that API just for this test.
    const observed = await admin.from("report_observed_calls").select("file_id").eq("file_id", fileId);
    expect(observed.error).toBeNull();
    expect(observed.data).toHaveLength(5);
    const sourceFields = "file_id,rsid,chrom,pos,ref,alt,genotype";
    const storedCalls = await admin.from("user_variants").select(sourceFields).eq("file_id", fileId).order("pos");
    expect(storedCalls.error).toBeNull();
    expect(storedCalls.data).toHaveLength(5);
    const ownerCalls = await owner.from("user_variants").select(sourceFields).eq("file_id", fileId).order("pos");
    expect(ownerCalls.error).toBeNull();
    expect(ownerCalls.data).toEqual(storedCalls.data);
    await page.goto("/genome/me/data");
    await expect(page.getByRole("heading", { name: "Data and methods", exact: true })).toBeVisible();
    await page.getByRole("link", { name: "Open the genome browser", exact: true }).click();
    await page.getByRole("textbox", { name: "Search variants", exact: true }).fill("rs4988235");
    await page.locator("form").filter({ has: page.getByRole("textbox", { name: "Search variants", exact: true }) })
      .getByRole("button", { name: "Search", exact: true }).click();
    const sourceRow = page.locator("#results table tbody tr");
    await expect(sourceRow).toHaveCount(1);
    await expect(sourceRow).toContainText("rs4988235");
    await expect(sourceRow.locator('[data-figure-kind="genotype"] [data-slot="figure-value"]')).toHaveText("A/G");
    // Existing ownership-scoped download route only. This proves original
    // bytes survive report withdrawal, not the future canonical download gate.
    const original = await page.request.get(`/api/files/${fileId}/download`);
    expect(original.status()).toBe(200);
    expect(await original.body()).toEqual(readFileSync(fixture));
  } finally {
    await owner.auth.signOut();
  }
  expect(errors).toEqual([]);
});
