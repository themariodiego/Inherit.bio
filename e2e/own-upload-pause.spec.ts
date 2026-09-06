import { expect, test, type Page } from "@playwright/test";
import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { adminClient, createConfirmedUser, signIn, uploadOwnFileThroughUi, SUPABASE_URL } from "./helpers";
import { OWN_UPLOAD_COPY } from "../src/copy/upload/consent";
import { directUploadReceipt, subjectFinalizationReceipt, subjectNormalizationReceipt } from "../src/lib/uploads/subject-upload-contract";

const PAUSED_ORIGIN = "http://localhost:3102";
test.use({ trace: "off" }); // Never persist a restricted upload bearer or session.

async function chooseFixture(page: Page, fixture: string) {
  const picker = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Choose file", exact: true }).click();
  await (await picker).setFiles(fixture);
}

// Read only the new synthetic account's object identities. No unrelated
// account data, credentials, private grant payload or Storage mutation.
async function storageInventory(accountId: string) {
  if (!/^[0-9a-f-]{36}$/.test(accountId)) throw new Error("Expected a synthetic account identifier");
  const { stdout } = await promisify(execFile)("docker", ["exec", "supabase_db_sequence", "psql", "-U", "postgres",
    "-d", "postgres", "-XAt", "--set=ON_ERROR_STOP=1", "--command", `
      select coalesce(json_agg(proof order by id),'[]'::json) from (
        select o.id,o.name from storage.objects o where o.bucket_id='genomes' and (
          o.owner_id='${accountId}' or o.name in (
            select staging_object_name from public.upload_sessions where account_id='${accountId}'::uuid
            union select final_object_name::text from public.upload_sessions where account_id='${accountId}'::uuid
            union select bucket_path from public.genome_files where user_id='${accountId}'::uuid
          )
        )
      ) proof;`], { timeout: 10_000, maxBuffer: 8192 });
  return JSON.parse(stdout.trim()) as { id: string; name: string }[];
}

test("canonical pause refuses new issuance while an acknowledged source finalizes, prepares and downloads", async ({ page, context }) => {
  const email = `canonical-pause-${randomUUID()}@e2e.local`;
  const password = "synthetic-canonical-pause-password";
  const accountId = await createConfirmedUser(email, password);
  await signIn(page, email, password);
  const retainedFixture = path.join(process.cwd(), "e2e/fixtures/tiny-grch38.vcf");
  const resumedFixture = path.join(process.cwd(), "e2e/fixtures/personal-previews-grch38.vcf");
  const bytes = readFileSync(resumedFixture);
  const declaration = { subjectId: "me", declaredFormat: "VCF", sizeBytes: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex") };
  const prepared = page.waitForResponse(response => /\/api\/files\/[0-9a-f-]{36}\/process$/.test(response.url())
    && response.request().method() === "POST");
  void prepared.catch(() => {});
  const retainedId = await uploadOwnFileThroughUi(page, retainedFixture);
  const preparation = await prepared;
  expect(preparation.status()).toBe(200);
  expect(subjectNormalizationReceipt.parse(await preparation.json()).fileId).toBe(retainedId);

  const admin = adminClient();
  async function leases() {
    const result = await admin.from("upload_sessions").select("id,status,consumed_at,finalized_file_id")
      .eq("account_id", accountId).order("id");
    expect(result.error).toBeNull();
    return result.data!;
  }
  async function sources() {
    const result = await admin.from("genome_files")
      .select("id,bucket_path,sha256,status,normalization_completed_at,normalization_source_revision,upload_revision,single_logical_sample_verified_at")
      .eq("user_id", accountId).order("id");
    expect(result.error).toBeNull();
    return result.data!;
  }
  const retainedSources = await sources();
  expect(retainedSources).toHaveLength(1);
  expect(retainedSources[0]).toMatchObject({ id: retainedId, status: "stored" });
  expect(retainedSources[0].normalization_completed_at).not.toBeNull();
  const beforeLeases = await leases();
  const beforeStorage = await storageInventory(accountId);
  expect(beforeLeases).toHaveLength(1);
  expect(beforeStorage).toHaveLength(1);
  let storageWrites = 0;
  context.on("request", request => {
    if (request.url().startsWith(`${SUPABASE_URL}/storage/v1/`)
      && ["POST", "PUT", "PATCH", "DELETE"].includes(request.method())) storageWrites++;
  });
  // Retain a rendered unpaused entry to exercise stale client error mapping.
  await page.goto("/files/upload");
  await expect(page.getByRole("button", { name: "Choose file", exact: true })).toBeEnabled();
  const pausedPage = await context.newPage(); // Same hostname and native browser session, different app port.
  try {
    for (const routePath of ["/files/upload", "/files"]) {
      await pausedPage.goto(`${PAUSED_ORIGIN}${routePath}`);
      await expect(pausedPage).toHaveURL(`${PAUSED_ORIGIN}${routePath}`);
      await expect(pausedPage.getByRole("status")).toHaveText(OWN_UPLOAD_COPY.uploadsPaused);
      await expect(pausedPage.getByRole("button", { name: "Choose file", exact: true })).toHaveCount(0);
      await expect(pausedPage.locator('input[type="file"]')).toHaveCount(0);
    }
    for (const routePath of ["/api/uploads", "/api/files/upload-session"]) {
      const denied = await pausedPage.evaluate(async ({ routePath, declaration }) => {
        const response = await fetch(routePath, { method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify(declaration) });
        return { status: response.status, cache: response.headers.get("cache-control"), body: await response.json() };
      }, { routePath, declaration });
      expect(denied).toEqual({ status: 503, cache: "private, no-store", body: { error: "uploads_paused" } });
    }
    // App-server transport relay only: the rendered stale entry receives an
    // actual paused server response. Native fetch supplies its same-origin
    // authority. Neither authorization, source state nor Storage is mocked.
    await page.route("**/api/files/upload-session", async route => {
      const reply = await pausedPage.evaluate(async body => {
        const response = await fetch("/api/files/upload-session", { method: "POST",
          headers: { "content-type": "application/json" }, body });
        return { status: response.status, body: await response.text() };
      }, route.request().postData());
      await route.fulfill({ status: reply.status, contentType: "application/json", body: reply.body });
    }, { times: 1 });
    await chooseFixture(page, resumedFixture);
    await expect(page.getByRole("alert")).toHaveText(OWN_UPLOAD_COPY.uploadsPaused);
    expect(await leases()).toEqual(beforeLeases);
    expect(await sources()).toEqual(retainedSources);
    expect(await storageInventory(accountId)).toEqual(beforeStorage);
    expect(storageWrites).toBe(0);

    // Start a second real upload. Abort only the first bodyless application
    // finalization, which the uploader sends after successful Storage ack.
    await page.goto("/files/upload");
    let interruptedUploadId: string | undefined;
    await page.route("**/api/files/*/finalize", async route => {
      expect(route.request().postData()).toBeNull();
      interruptedUploadId = new URL(route.request().url()).pathname.split("/")[3];
      await route.abort("failed");
    }, { times: 1 });
    const issuedResponse = page.waitForResponse(response => response.url().endsWith("/api/files/upload-session")
      && response.request().method() === "POST");
    const storedResponse = page.waitForResponse(response => /\/storage\/v1\/object\/genomes\/[0-9a-f-]{36}$/.test(response.url())
      && response.request().method() === "POST");
    for (const observation of [issuedResponse, storedResponse]) void observation.catch(() => {});
    await chooseFixture(page, resumedFixture);
    const issue = await issuedResponse;
    expect(issue.status()).toBe(201);
    // Keep only closed, nonsensitive receipt fields; never inspect/log the token.
    const issued = directUploadReceipt.pick({ uploadId: true, stagingKey: true, bucket: true }).strip().parse(await issue.json());
    const storageAck = await storedResponse;
    expect(storageAck.ok()).toBe(true);
    expect(storageAck.url()).toBe(`${SUPABASE_URL}/storage/v1/object/genomes/${issued.stagingKey}`);
    await expect(page.getByRole("alert")).toBeVisible();
    expect(interruptedUploadId).toBe(issued.uploadId);
    expect(storageWrites).toBe(1);
    const interrupted = await admin.from("upload_sessions").select("status,consumed_at,finalized_file_id")
      .eq("id", issued.uploadId).eq("account_id", accountId).single();
    expect(interrupted.error).toBeNull();
    expect(interrupted.data).toEqual({ status: "uploaded", consumed_at: null, finalized_file_id: null });
    expect(await leases()).toHaveLength(2);
    expect(await sources()).toEqual(retainedSources);
    const staged = await admin.storage.from(issued.bucket).download(issued.stagingKey);
    expect(staged.error).toBeNull();
    expect(Buffer.from(await staged.data!.arrayBuffer())).toEqual(bytes);
    expect(await storageInventory(accountId)).toHaveLength(2);

    // Actual native, bodyless canonical finalization and preparation on the
    // paused app. The browser retains its original authenticated session.
    const finalized = await pausedPage.evaluate(async uploadId => {
      const response = await fetch(`/api/files/${uploadId}/finalize`, { method: "POST" });
      return { status: response.status, body: await response.json() };
    }, issued.uploadId);
    expect(finalized.status).toBe(200);
    const fileId = subjectFinalizationReceipt.parse(finalized.body).fileId;
    expect(fileId).not.toBe(retainedId);
    const resumed = await pausedPage.evaluate(async id => {
      const response = await fetch(`/api/files/${id}/process`, { method: "POST" });
      return { status: response.status, body: await response.json() };
    }, fileId);
    expect(resumed.status).toBe(200);
    expect(subjectNormalizationReceipt.parse(resumed.body)).toEqual({
      fileId, status: "normalization_complete", analysisState: "not_generated",
    });
    const completedSources = await sources();
    expect(completedSources).toHaveLength(2);
    expect(completedSources.find(source => source.id === retainedId)).toEqual(retainedSources[0]);
    const completed = completedSources.find(source => source.id === fileId)!;
    expect(completed).toMatchObject({ status: "stored", sha256: declaration.sha256 });
    expect(completed.normalization_completed_at).not.toBeNull();
    expect(completed.single_logical_sample_verified_at).not.toBeNull();
    expect(completed.normalization_source_revision).toBe(completed.upload_revision);
    const completedLeases = await leases();
    expect(completedLeases).toHaveLength(2);
    expect(completedLeases.find(lease => lease.id === issued.uploadId)).toMatchObject({ status: "promoted", finalized_file_id: fileId });
    const stagingAfter = await admin.storage.from(issued.bucket).list("", { search: issued.stagingKey, limit: 100 });
    expect(stagingAfter.error).toBeNull();
    expect(stagingAfter.data?.filter(object => object.name === issued.stagingKey)).toEqual([]);
    const stored = await admin.storage.from("genomes").download(completed.bucket_path);
    expect(stored.error).toBeNull();
    expect(Buffer.from(await stored.data!.arrayBuffer())).toEqual(bytes);
    expect(await storageInventory(accountId)).toHaveLength(2);

    await pausedPage.reload();
    await expect(pausedPage.getByRole("status")).toHaveText(OWN_UPLOAD_COPY.uploadsPaused);
    for (const [id, fixture] of [[retainedId, retainedFixture], [fileId, resumedFixture]]) {
      const row = pausedPage.locator("li").filter({ has: pausedPage.locator(`a[href="/api/files/${id}/download"]`) });
      await expect(row.getByRole("link", { name: "Choose reports →", exact: true })).toBeVisible();
      await expect(row.getByRole("button", { name: "Delete", exact: true })).toBeEnabled();
      const downloadReady = pausedPage.waitForEvent("download");
      await row.locator(`a[href="/api/files/${id}/download"]`).click();
      const downloadPath = await (await downloadReady).path();
      expect(downloadPath).not.toBeNull();
      expect(readFileSync(downloadPath!)).toEqual(readFileSync(fixture));
    }
    for (const viewport of [{ width: 1280, height: 800 }, { width: 390, height: 844 }]) {
      await pausedPage.setViewportSize(viewport);
      await expect.poll(() => pausedPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await pausedPage.screenshot({ path: test.info().outputPath(`canonical-paused-${viewport.width}.png`), fullPage: true });
    }
  } finally {
    await pausedPage.close();
  }
});
