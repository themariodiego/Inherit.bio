import { localE2eProject } from "../scripts/local-e2e-project";
import { expect, type Page } from "@playwright/test";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { promisify } from "node:util";
import { adminClient, uploadOwnFileThroughUi } from "./helpers";
import { OWN_REPORT_CHOICES, OWN_REPORT_PURPOSES, type OwnReportPurpose } from "../src/lib/uploads/own-report-purpose";
import { subjectProcessingReceipt, subjectSynchronousReportReceipt } from "../src/lib/uploads/subject-upload-contract";

type SupportedPurpose = OwnReportPurpose;
type ChosenPurposes = readonly [SupportedPurpose, ...SupportedPurpose[]];

/** Upload and prepare a real source without creating any report permission.
 * Existing, explicit choices may still run automatically for a later file.
 */
export async function uploadOwnFilePrepared(
  page: Page,
  filePath: string,
  { fileType }: { fileType: string },
): Promise<string> {
  const processed = page.waitForResponse(response => /\/api\/files\/[0-9a-f-]{36}\/process$/.test(response.url())
    && response.request().method() === "POST");
  void processed.catch(() => {});
  const fileId = await uploadOwnFileThroughUi(page, filePath);
  const preparation = await processed;
  expect(preparation.status(), "canonical source preparation").toBe(200);
  // A later file can already have selected results because an earlier,
  // explicit choice is still live. Neither receipt stands in for the exact
  // file/source/purpose completion proof below.
  expect(subjectProcessingReceipt.parse(await preparation.json()).fileId).toBe(fileId);

  const source = await adminClient().from("genome_files")
    .select("file_type,status,sha256,upload_revision,normalization_source_revision,normalization_completed_at,single_logical_sample_verified_at")
    .eq("id", fileId).single();
  expect(source.error).toBeNull();
  expect(source.data).toMatchObject({ file_type: fileType, status: "stored",
    sha256: createHash("sha256").update(readFileSync(filePath)).digest("hex") });
  expect(source.data!.normalization_completed_at).not.toBeNull();
  expect(source.data!.single_logical_sample_verified_at).not.toBeNull();
  expect(source.data!.normalization_source_revision).toBe(source.data!.upload_revision);
  return fileId;
}

/** Prepare a real source, then explicitly choose and generate its reports. */
export async function uploadOwnFileWithChosenReports(
  page: Page,
  filePath: string,
  { fileType, purposes }: { fileType: string; purposes: ChosenPurposes },
): Promise<string> {
  validatePurposes(purposes);
  const fileId = await uploadOwnFilePrepared(page, filePath, { fileType });
  await generateOwnFileWithChosenReports(page, fileId, purposes);
  return fileId;
}

function validatePurposes(purposes: ChosenPurposes) {
  if (!purposes.length || new Set(purposes).size !== purposes.length
    || purposes.some(purpose => !OWN_REPORT_PURPOSES.includes(purpose))) {
    throw new Error("Choose unique, currently supported report purposes explicitly");
  }
}

/** Explicit result precondition for a source already prepared through the UI.
 * No default purpose, grant/file insertion or fabricated completed state.
 * Repeated uploads may reuse a live choice but need their own completion.
 */
export async function generateOwnFileWithChosenReports(
  page: Page,
  fileId: string,
  purposes: ChosenPurposes,
): Promise<void> {
  validatePurposes(purposes);
  if (!/^[0-9a-f-]{36}$/.test(fileId)) throw new Error("Expected a canonical fixture identifier");
  await page.goto("/genome/me/reports");
  const choices = page.getByRole("region", { name: "Choose your reports", exact: true });
  await expect(choices).toBeVisible();
  for (const purpose of OWN_REPORT_PURPOSES.filter(purpose => !purposes.includes(purpose as SupportedPurpose))) {
    const label = OWN_REPORT_CHOICES[purpose].label;
    await expect(choices.getByRole("button", { name: `Turn off ${label}`, exact: true }), "no unrelated live report choice").toHaveCount(0);
    await expect(choices.getByRole("checkbox", { name: label, exact: true })).not.toBeChecked();
  }
  for (const purpose of purposes) {
    const label = OWN_REPORT_CHOICES[purpose].label;
    const enabled = choices.getByRole("button", { name: `Turn off ${label}`, exact: true });
    if (await enabled.count() === 0) {
      await choices.getByRole("checkbox", { name: label, exact: true }).check();
      const signed = page.waitForResponse(response => response.url().endsWith("/api/consents")
        && response.request().method() === "POST");
      // A successful signature precedes a server-rendered presentation refresh.
      // Wait for that actual response before inspecting replacement
      // controls; a consumed permission remains disabled while it is in flight.
      const refreshed = page.waitForResponse(response =>
        new URL(response.url()).pathname === "/genome/me/reports"
        && response.request().method() === "GET" && response.request().headers().rsc === "1");
      void refreshed.catch(() => {});
      await choices.getByRole("button", { name: `Enable ${label}`, exact: true }).click();
      const signature = await signed;
      expect(signature.status()).toBe(201);
      expect(await signature.json()).toMatchObject({ recordKind: "purpose_grant", purposeKey: purpose });
      const presentation = await refreshed;
      expect(presentation.status(), "authoritative report-choice refresh").toBe(200);
      await expect(enabled).toBeVisible();
    }
  }
  const selectedFile = choices.getByRole("combobox", { name: /^File to use\b/ });
  if (await selectedFile.count()) {
    await selectedFile.selectOption(fileId);
    await expect(selectedFile, "the chosen source must be selected before generation").toHaveValue(fileId);
  }
  const generated = page.waitForResponse(response => response.url().endsWith(`/api/files/${fileId}/process`)
    && response.request().method() === "POST");
  await choices.getByRole("button", { name: "Generate selected reports", exact: true }).click();
  const generation = await generated;
  expect(generation.status()).toBe(200);
  expect(subjectSynchronousReportReceipt.parse(await generation.json()).fileId).toBe(fileId);

  // This journal is intentionally private. Read only the canonical fixture's
  // purpose/state/source/grant flags in the exact local Docker database; no
  // result payload, genotype, credential or unrelated account is returned.
  if (!/^[0-9a-f-]{36}$/.test(fileId)) throw new Error("Expected a canonical fixture identifier");
  const { stdout } = await promisify(execFile)("docker", ["exec", localE2eProject(process.env).dbContainer, "psql", "-U", "postgres",
    "-d", "postgres", "-XAt", "--set=ON_ERROR_STOP=1", "--command", `
      select coalesce(json_agg(proof order by purpose),'[]'::json) from (
        select r.purpose,r.state,r.completed_at is not null as completed,
          r.source_revision=f.upload_revision and r.source_sha256=f.sha256 as same_source,
          p.revoked_at is null and p.purpose=r.purpose and p.grant_revision=r.grant_revision as live_exact_purpose
        from private.own_analysis_runs r join public.genome_files f on f.id=r.file_id
        join public.purpose_grants p on p.grant_id=r.grant_id
        where r.file_id='${fileId}'::uuid
      ) proof;`], { timeout: 10_000, maxBuffer: 8192 });
  expect(JSON.parse(stdout.trim())).toEqual([...purposes].sort().map(purpose => ({
    purpose, state: "complete", completed: true, same_source: true, live_exact_purpose: true,
  })));
}

/** A first prepared source has no generated ancestry before explicit choice.
 * Aggregate-only, exact synthetic source proof; no result payload is read. */
export async function expectNoOwnAncestryResult(fileId: string): Promise<void> {
  if (!/^[0-9a-f-]{36}$/.test(fileId)) throw new Error("Expected a canonical fixture identifier");
  const { stdout } = await promisify(execFile)("docker", ["exec", localE2eProject(process.env).dbContainer, "psql", "-U", "postgres",
    "-d", "postgres", "-XAt", "--set=ON_ERROR_STOP=1", "--command", `
      select json_build_object(
        'journal', (select count(*) from private.own_analysis_runs where file_id='${fileId}'::uuid and purpose='ancestry'),
        'legacy', (select count(*) from public.ancestry_results where file_id='${fileId}'::uuid));
    `], { timeout: 10_000, maxBuffer: 8192 });
  expect(JSON.parse(stdout.trim())).toEqual({ journal: 0, legacy: 0 });
}
