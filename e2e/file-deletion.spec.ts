import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { readFileSync } from "node:fs";
import { uploadOwnFilePrepared, uploadOwnFileWithChosenReports } from "./own-report-helpers";
import { adminClient, anonClient, createConfirmedUser, ingestFileAs, signIn } from "./helpers";

test("file deletion shows failure, retries, and removes the exact source and file-based rows", async ({ page }) => {
  const email = `file-delete-${randomUUID()}@e2e.local`;
  const password = "synthetic-delete-password";
  const userId = await createConfirmedUser(email, password);
  await signIn(page, email, password);
  const fileId = await uploadOwnFileWithChosenReports(page,
    path.join(process.cwd(), "e2e/fixtures/tiny-grch38.vcf"), { fileType: "vcf", purposes: ["reports.polygenic"] });
  const retainedPath = path.join(process.cwd(), "e2e/fixtures/personal-previews-grch38.vcf");
  const retainedId = await uploadOwnFilePrepared(page, retainedPath, { fileType: "vcf" });
  const admin = adminClient();
  const retained = await admin.from("genome_files").select("bucket_path,variant_count").eq("id", retainedId).single();
  expect(retained.error).toBeNull();
  const assertRetained = async () => {
    const source = await admin.storage.from("genomes").download(retained.data!.bucket_path);
    expect(source.error).toBeNull();
    expect(Buffer.from(await source.data!.arrayBuffer())).toEqual(readFileSync(retainedPath));
    const count = await admin.from("user_variants").select("id", { count: "exact", head: true }).eq("file_id", retainedId);
    expect(count.error).toBeNull(); expect(count.count).toBe(retained.data!.variant_count);
  };
  await assertRetained();
  const { data: file, error } = await admin.from("genome_files").select("bucket_path,subject_id,storage_object_id").eq("id", fileId).single();
  expect(error).toBeNull();
  expect(file?.storage_object_id).toBeTruthy();
  const readReadyMail = () => admin.from("mail_outbox").select("id,state")
    .eq("template_id", "report-ready").eq("target_kind", "genome_file").eq("target_id", fileId);
  const readyMail = await readReadyMail();
  expect(readyMail.error).toBeNull();
  expect(readyMail.data).toHaveLength(1);
  expect(readyMail.data![0].state).toBe("queued");
  expect((await admin.storage.from("genomes").download(file!.bucket_path)).error).toBeNull();
  expect((await admin.from("user_variants").select("id", { count: "exact", head: true }).eq("file_id", fileId)).count).toBeGreaterThan(0);
  const readObservedCalls = () => admin.from("report_observed_calls")
    .select("file_id", { count: "exact", head: true }).eq("file_id", fileId);
  const observedBefore = await readObservedCalls();
  expect(observedBefore.error).toBeNull();
  expect(observedBefore.count).toBeGreaterThan(0);
  await page.goto("/files");
  await expect(page.getByRole("heading", { name: "My files", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Complete your account", exact: true })).toHaveCount(0);
  page.on("dialog", (dialog) => dialog.accept());
  const row = page.locator("li").filter({ has: page.locator(`a[href="/api/files/${fileId}/download"]`) });
  await expect(row).toHaveCount(1);
  // Same response contract as an acknowledged Storage failure, without a
  // production-only test switch. Route units separately inject Storage errors.
  await page.route(`**/api/files/${fileId}`, (route) => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "file_delete_failed" }) }), { times: 1 });
  await row.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(row.getByRole("alert")).toContainText("Deletion did not finish. Please try Delete again.");
  await expect(row).toBeVisible();
  expect((await admin.from("genome_files").select("id").eq("id", fileId)).data).toHaveLength(1);
  expect((await admin.storage.from("genomes").download(file!.bucket_path)).error).toBeNull();
  const owner = anonClient();
  expect((await owner.auth.signInWithPassword({ email, password })).error).toBeNull();
  const sessionId = (await owner.auth.getClaims()).data!.claims.session_id as string;
  expect((await admin.rpc("prepare_genome_file_deletion_v1", { p_account_id: userId, p_session_id: sessionId, p_file_id: fileId })).error).toBeNull();
  expect((await readReadyMail()).data).toEqual([{ id: readyMail.data![0].id, state: "invalidated" }]);
  const before = await admin.from("user_variants").select("id", { count: "exact", head: true }).eq("file_id", fileId);
  const processResponse = await page.evaluate(async id => {
    const response = await fetch(`/api/files/${id}/process`, { method: "POST" });
    return { status: response.status, body: await response.json() };
  }, fileId);
  // Canonical preparation refuses the revoked Storage binding before any read.
  expect(processResponse).toEqual({ status: 404, body: { error: "not_found" } });
  expect((await admin.from("user_variants").select("id", { count: "exact", head: true }).eq("file_id", fileId)).count).toBe(before.count);
  const observedAfterBlockedProcess = await readObservedCalls();
  expect(observedAfterBlockedProcess.error).toBeNull();
  expect(observedAfterBlockedProcess.count).toBe(observedBefore.count);
  expect((await admin.from("genome_files").select("status").eq("id", fileId).single()).data?.status).toBe("failed");
  expect((await admin.storage.from("genomes").download(file!.bucket_path)).error).toBeNull();
  await owner.auth.signOut({ scope: "local" });
  // Model a previous acknowledged Storage delete whose database finalization
  // failed. The real route must accept the next empty idempotent ACK and finish.
  expect((await admin.storage.from("genomes").remove([file!.bucket_path])).error).toBeNull();
  expect((await admin.from("genome_files").select("id").eq("id", fileId)).data).toHaveLength(1);
  const deleted = page.waitForResponse((response) => response.url().endsWith(`/api/files/${fileId}`) && response.request().method() === "DELETE");
  await row.getByRole("button", { name: "Delete", exact: true }).click();
  expect((await deleted).status()).toBe(204);
  await expect(row).toHaveCount(0);
  expect((await admin.storage.from("genomes").download(file!.bucket_path)).error).not.toBeNull();
  for (const table of ["user_variants", "user_prs", "ancestry_results", "worker_jobs"] as const) {
    const result = await admin.from(table).select("id", { count: "exact", head: true }).eq("file_id", fileId);
    expect(result.error).toBeNull();
    expect(result.count, table).toBe(0);
  }
  const observedAfterDeletion = await readObservedCalls();
  expect(observedAfterDeletion.error).toBeNull();
  expect(observedAfterDeletion.count).toBe(0);
  expect((await admin.from("genome_storage_objects").select("object_id").eq("genome_file_id", fileId)).data).toHaveLength(0);
  expect((await admin.from("subjects").select("id").eq("id", file!.subject_id).eq("owner_account_id", userId)).data).toHaveLength(1);
  expect((await readReadyMail()).data).toEqual([{ id: readyMail.data![0].id, state: "invalidated" }]);
  await assertRetained();
});

test("foreign account, active processing and another adult cannot use the self-file shortcut", async ({ page, browser }) => {
  const email = `file-guard-${randomUUID()}@e2e.local`;
  const password = "synthetic-delete-password";
  const ownerId = await createConfirmedUser(email, password);
  await signIn(page, email, password);
  const fileId = await ingestFileAs(page, email, password, path.join(process.cwd(), "e2e/fixtures/tiny-grch38.vcf"), "vcf");
  const admin = adminClient();
  const file = (await admin.from("genome_files").select("subject_id,bucket_path").eq("id", fileId).single()).data!;
  const remove = () => page.evaluate(async (id) => (await fetch(`/api/files/${id}`, { method: "DELETE" })).status, fileId);
  await admin.from("genome_files").update({ status: "parsing" }).eq("id", fileId);
  expect(await remove()).toBe(409);
  await admin.from("genome_files").update({ status: "annotated" }).eq("id", fileId);
  const other = { email: `file-other-${randomUUID()}@e2e.local`, password };
  await createConfirmedUser(other.email, other.password);
  const context = await browser.newContext();
  const otherPage = await context.newPage();
  await signIn(otherPage, other.email, other.password);
  expect(await otherPage.evaluate(async (id) => (await fetch(`/api/files/${id}`, { method: "DELETE" })).status, fileId)).toBe(404);
  await context.close();
  const adultId = randomUUID();
  expect((await admin.from("subjects").insert({ id: adultId, owner_account_id: ownerId, subject_class: "other_adult", upload_class: "adult", display_label: "Synthetic adult" })).error).toBeNull();
  await admin.from("genome_files").update({ subject_id: adultId }).eq("id", fileId);
  expect(await remove()).toBe(409);
  await admin.from("genome_files").update({ subject_id: file.subject_id }).eq("id", fileId);
  expect((await admin.storage.from("genomes").download(file.bucket_path)).error).toBeNull();
  expect((await admin.from("genome_files").select("id").eq("id", fileId)).data).toHaveLength(1);
  // A normal successful route call also removes an object that is still there.
  expect(await remove()).toBe(204);
  expect((await admin.storage.from("genomes").download(file.bucket_path)).error).not.toBeNull();
  expect((await admin.from("genome_files").select("id").eq("id", fileId)).data).toHaveLength(0);
});
