import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { adminClient, createConfirmedUser, signIn } from "./helpers";
import { OWN_UPLOAD_COPY as COPY } from "../src/copy/upload/consent";
import { INGEST_REFUSALS, SUBJECT_TARGET_REFUSALS } from "../src/copy/upload/errors";

/**
 * `/files/upload consent-required`. The route's own gate, not a component's:
 * the picker and the file input are absent or disabled until an adult birth
 * date is recorded and two separate consent artifacts are signed, and each
 * step is asserted against the database rather than the screen alone.
 *
 * This is the one state on this route that needs no interpretation. The page
 * exists to require consent before it will take a file, and it says so in
 * those words. Unlike `error`, which this repository has declined across
 * eleven pairs because the register never defines it, `consent-required`
 * names exactly what these three screens are for.
 *
 * The two refusals at the end of this test run on `/files` after an explicit
 * navigation, so they are not claimed for this route.
 */
test("/files/upload reaches consent-required: account details and two separate decisions gate the picker", async ({ page }) => {
  const email = `own-flow-${randomUUID()}@e2e.local`;
  const password = "synthetic-own-flow-password";
  const userId = await createConfirmedUser(email, password);
  const admin = adminClient();
  const profile = () => admin.from("profiles").select("date_of_birth,account_revision").eq("id", userId).single();
  expect((await profile()).data).toEqual({ date_of_birth: null, account_revision: 1 });
  const errors: string[] = [];
  const geneticRequests: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("request", request => {
    const pathname = new URL(request.url()).pathname;
    if (pathname === "/api/files/upload-session" || pathname.startsWith("/storage/v1/")
      || pathname.endsWith("/process")) geneticRequests.push(pathname);
  });
  await signIn(page, email, password);
  await page.goto("/files/upload");
  await expect(page.getByRole("heading", { name: COPY.accountHeading })).toBeVisible();
  await expect(page.locator('input[type="file"]')).toHaveCount(0);
  await expect(page.locator("[data-nextjs-dialog]")).toHaveCount(0);
  await page.getByLabel(COPY.birthDateLabel).fill("1990-01-01");
  const completed = page.waitForResponse(response => response.url().endsWith("/api/account/completion")
    && response.request().method() === "POST");
  await page.getByRole("button", { name: COPY.accountContinue }).click();
  expect((await completed).status()).toBe(200);
  expect((await profile()).data).toEqual({ date_of_birth: "1990-01-01", account_revision: 2 });
  const signatures = () => admin.from("consent_signatures")
    .select("artifact_key").eq("signer_account_id", userId);
  expect((await signatures()).data).toEqual([]);
  await expect(page.getByRole("heading", { name: COPY.insuranceHeading })).toBeVisible();
  await expect(page.locator('input[type="file"]')).toHaveCount(0);
  await page.getByRole("checkbox", { name: COPY.insuranceCheckbox }).check();
  const disclosure = page.waitForResponse(response => response.url().endsWith("/api/consents")
    && response.request().method() === "POST");
  await page.getByRole("button", { name: COPY.insuranceContinue, exact: true }).click();
  expect((await disclosure).status()).toBe(201);
  await expect(page.getByRole("heading", { name: COPY.ownHeading })).toBeVisible();
  await expect(page.getByRole("button", { name: "Choose file", exact: true })).toBeDisabled();
  await expect(page.locator('input[type="file"]')).toBeDisabled();
  expect((await signatures()).data).toEqual([{ artifact_key: "disclosure.insurance-and-discrimination" }]);
  const confirmed = page.waitForResponse(response => response.url().endsWith("/api/consents")
    && response.request().method() === "POST");
  await page.getByRole("checkbox", { name: COPY.ownCheckbox, exact: true }).check();
  expect((await confirmed).status()).toBe(201);
  await expect(page.getByRole("button", { name: "Choose file", exact: true })).toBeEnabled();
  const grants = await admin.from("subject_consents").select("scope").eq("account_id", userId)
    .eq("consent_type", "upload_class").is("revoked_at", null);
  expect(grants.error).toBeNull(); expect(grants.data).toEqual([{ scope: ["store"] }]);
  const subject = await admin.from("subjects").select("id").eq("subject_account_id", userId).eq("subject_class", "self").single();
  expect(subject.error).toBeNull();
  const purposes = await admin.from("purpose_grants").select("target_id").eq("target_id", subject.data!.id);
  expect(purposes.error).toBeNull(); expect(purposes.data).toEqual([]);
  // File selection/transport is not claimed here: that separate journey still
  // needs its live server-side permission and analysis-purpose enforcement.
  expect(geneticRequests).toEqual([]);
  await page.goto("/files");
  await expect(page.getByRole("button", { name: "Choose file", exact: true })).toBeEnabled();
  await expect(page.getByRole("heading", { name: COPY.accountHeading })).toHaveCount(0);
  await expect(page.getByRole("checkbox")).toHaveCount(0);
  expect((await signatures()).data).toHaveLength(2);
  // Real browser preflight: these sources never obtain an upload capability
  // and the same picker remains usable after each refusal. This is not a
  // successful Storage/finalization/report-generation assertion.
  await page.locator('input[type="file"]').setInputFiles({ name: "synthetic.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.7\n") });
  await expect(page.getByRole("alert").filter({ hasText: INGEST_REFUSALS.pdf_not_data })).toBeVisible();
  await expect(page.getByRole("button", { name: "Choose file", exact: true })).toBeEnabled();
  const multi = "##fileformat=VCFv4.2\n#CHROM\tPOS\tID\tREF\tALT\tQUAL\tFILTER\tINFO\tFORMAT\tFIRST\tSECOND\n";
  await page.locator('input[type="file"]').setInputFiles({ name: "synthetic.vcf", mimeType: "text/plain", buffer: Buffer.from(multi) });
  await expect(page.getByRole("alert").filter({ hasText: SUBJECT_TARGET_REFUSALS.subject_source_not_single_sample })).toBeVisible();
  await expect(page.getByRole("button", { name: "Choose file", exact: true })).toBeEnabled();
  expect(geneticRequests).toEqual([]);
  await page.screenshot({ path: test.info().outputPath("own-upload-ready.png"), fullPage: true });
  expect(errors).toEqual([]);
});
