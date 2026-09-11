import { expect, test } from "@playwright/test";
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { ANON_KEY, adminClient, createConfirmedUser, signIn, uploadOwnFileThroughUi } from "./helpers";
import { directUploadReceipt, subjectNormalizationReceipt } from "../src/lib/uploads/subject-upload-contract";

/**
 * `/files/upload complete`. This route's product is a stored, prepared source,
 * and this test walks the whole of it in one browser: consent, a real
 * cross-origin Storage PUT with the restricted bearer, server finalization,
 * normalization, then the terminal success line the uploader renders.
 *
 * Why `complete` and not something weaker. The page deliberately stops with
 * "Reports have not been generated yet" - choosing results is a separate,
 * separately consented act - so the fullest outcome this route can reach is
 * exactly the one asserted here, down to byte-for-byte equality with the
 * original through an unproxied download.
 *
 * Worth stating that the uploader has a SECOND success terminal,
 * `results-ready`, reached only when a purpose grant already existed before
 * the upload. A reader could argue that one is `complete` and this one is
 * not. The argument against is that `results-ready` describes another
 * surface's outcome arriving here, while a route with no purpose grant has no
 * further state to reach - and if `prepared` were not `complete`, no state id
 * could ever name this route succeeding. The claim is made on that reasoning
 * rather than left implicit, so it can be disagreed with on the record.
 */
test("/files/upload reaches complete: exact source bytes stored and prepared, with no unchosen results generated", async ({ page }) => {
  const user = { email: `canonical-upload-${randomUUID()}@e2e.local`, password: "synthetic-upload-password" };
  const accountId = await createConfirmedUser(user.email, user.password);
  await signIn(page, user.email, user.password);
  const fixture = path.join(process.cwd(), "e2e/fixtures/tiny-grch38.vcf");
  const bytes = fs.readFileSync(fixture);
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  const issued = page.waitForResponse(response => response.url().endsWith("/api/files/upload-session")
    && response.request().method() === "POST");
  const stored = page.waitForResponse(response => /\/storage\/v1\/object\/genomes\/[0-9a-f-]{36}$/.test(response.url())
    && response.request().method() === "POST");
  const prepared = page.waitForResponse(response => /\/api\/files\/[0-9a-f-]{36}\/process$/.test(response.url())
    && response.request().method() === "POST");
  // The first UI boundary failure is reported by the upload helper. Keep
  // later observers handled if the test stops before those requests occur.
  for (const observation of [issued, stored, prepared]) void observation.catch(() => {});
  const fileId = await uploadOwnFileThroughUi(page, fixture);
  const issuance = await issued;
  expect(issuance.status()).toBe(201);
  const lease = directUploadReceipt.parse(await issuance.json());
  const declaration = issuance.request().postDataJSON();
  expect(Object.keys(declaration).sort()).toEqual(["declaredFormat", "sha256", "sizeBytes", "subjectId"]);
  expect(declaration).toMatchObject({ declaredFormat: "VCF", sizeBytes: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex") });
  const storage = await stored;
  expect(storage.ok()).toBe(true);
  expect(storage.url()).toBe(`http://127.0.0.1:54321/storage/v1/object/genomes/${lease.stagingKey}`);
  // This File-backed XHR has no body in the browser debugging protocol.
  // Verify exact bytes through the real, unproxied Storage download below.
  expect(storage.request().headers()["content-type"]).toBe("application/octet-stream");
  const storageHeaders = await storage.request().allHeaders();
  // Compare locally without rendering the restricted bearer in assertion output.
  expect(storageHeaders.authorization === `Bearer ${lease.uploadToken}`).toBe(true);
  const expectedGatewayKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? ANON_KEY;
  expect(Boolean(storageHeaders.apikey) && storageHeaders.apikey === expectedGatewayKey).toBe(true);
  expect(storageHeaders.cookie).toBeUndefined();
  const preparation = await prepared;
  expect(preparation.status()).toBe(200);
  expect(subjectNormalizationReceipt.parse(await preparation.json())).toEqual({
    fileId, status: "normalization_complete", analysisState: "not_generated",
  });
  await expect(page.getByText("Your file is stored and prepared. Reports have not been generated yet.", { exact: false })).toBeVisible();

  const admin = adminClient();
  const file = await admin.from("genome_files").select("user_id,subject_id,bucket_path,sha256,status,normalization_completed_at,normalization_source_revision,upload_revision,single_logical_sample_verified_at")
    .eq("id", fileId).single();
  expect(file.error).toBeNull();
  expect(file.data!.user_id).toBe(accountId);
  expect(file.data!.sha256).toBe(declaration.sha256);
  expect(file.data!.single_logical_sample_verified_at).not.toBeNull();
  expect(file.data!.normalization_completed_at).not.toBeNull();
  expect(file.data!.normalization_source_revision).toBe(file.data!.upload_revision);
  expect(file.data!.status).not.toBe("annotated");
  // Download through the original, unproxied local Storage endpoint. This
  // proves the app and isolated upload provider use identical real bytes.
  const source = await admin.storage.from("genomes").download(file.data!.bucket_path);
  expect(source.error).toBeNull();
  expect(Buffer.from(await source.data!.arrayBuffer())).toEqual(bytes);
  const observed = await admin.from("report_observed_calls").select("file_id", { count: "exact", head: true }).eq("file_id", fileId);
  expect(observed.error).toBeNull(); expect(observed.count).toBeGreaterThan(0);
  const purposes = await admin.from("purpose_grants").select("grant_id").eq("target_id", file.data!.subject_id);
  expect(purposes.error).toBeNull(); expect(purposes.data).toEqual([]);
  for (const table of ["user_prs", "ancestry_results", "worker_jobs"]) {
    const result = await admin.from(table).select("id", { count: "exact", head: true }).eq("file_id", fileId);
    expect(result.error).toBeNull(); expect(result.count, table).toBe(0);
  }
  const notices = await admin.from("mail_outbox").select("id").eq("target_id", fileId).eq("template_id", "report-ready");
  expect(notices.error).toBeNull(); expect(notices.data).toEqual([]);
  expect(errors).toEqual([]);
  await page.screenshot({ path: test.info().outputPath("canonical-upload-prepared.png"), fullPage: true });
});
