import { expect, test, type Page } from "@playwright/test";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { adminClient, createConfirmedUser, signIn, SUPABASE_URL } from "./helpers";
import { UPLOADS_PAUSED_MESSAGE } from "../src/copy/upload/pause";

// Same hostname shares the browser's existing session cookies across ports.
// This third app instance uses the real build and the main jurisdiction flag.
const PAUSED_ORIGIN = "http://localhost:3102";
// Keep synthetic session credentials out of failure traces.
test.use({ trace: "off" });

async function chooseFixture(page: Page, fixture: string) {
  const picker = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Choose file", exact: true }).click();
  await (await picker).setFiles(fixture);
}

test("upload pause refuses new leases while a real in-flight source still completes and downloads", async ({ page, context }) => {
  const email = `upload-pause-${randomUUID()}@e2e.local`;
  const password = "synthetic-upload-pause-password";
  const accountId = await createConfirmedUser(email, password);
  await signIn(page, email, password);
  await page.goto("/files/upload");
  await expect(page.getByRole("button", { name: "Choose file", exact: true })).toBeEnabled();
  const fixture = path.join(process.cwd(), "e2e/fixtures/tiny-grch38.vcf");
  const bytes = readFileSync(fixture);
  const declaration = { originalName: path.basename(fixture), fileType: "vcf", sizeBytes: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"), contentType: "application/octet-stream" };
  const admin = adminClient();
  async function leaseCount() {
    const result = await admin.from("upload_sessions").select("id", { count: "exact", head: true }).eq("account_id", accountId);
    expect(result.error).toBeNull();
    return result.count;
  }
  expect(await leaseCount()).toBe(0);
  let storageWrites = 0;
  context.on("request", request => {
    if (request.url().startsWith(`${SUPABASE_URL}/storage/v1/`)
      && ["POST", "PUT", "PATCH", "DELETE"].includes(request.method())) storageWrites++;
  });

  const pausedPage = await context.newPage();
  try {
    for (const routePath of ["/files/upload", "/files"]) {
      await pausedPage.goto(`${PAUSED_ORIGIN}${routePath}`);
      await expect(pausedPage).toHaveURL(`${PAUSED_ORIGIN}${routePath}`);
      await expect(pausedPage.getByRole("status")).toHaveText(UPLOADS_PAUSED_MESSAGE);
      await expect(pausedPage.getByRole("button", { name: "Choose file", exact: true })).toBeDisabled();
    }
    // Browser-native same-origin POST: actual authenticated paused app, no
    // APIRequestContext or response/header dumps that could expose cookies.
    for (const routePath of ["/api/uploads", "/api/files/upload-session"]) {
      const denied = await pausedPage.evaluate(async ({ routePath, declaration }) => {
        const response = await fetch(routePath, { method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify(declaration) });
        return { status: response.status, cache: response.headers.get("cache-control"), body: await response.json() };
      }, { routePath, declaration });
      expect(denied).toEqual({ status: 503, cache: "private, no-store", body: { error: "uploads_paused" } });
    }

    // App-server transport relay only: the already-rendered unpaused bridge UI
    // receives the actual paused server response, as after an alias cutover.
    // Auth, refusal, lease database and Storage are never mocked or fabricated.
    await page.route("**/api/files/upload-session", async route => {
      const reply = await pausedPage.evaluate(async body => {
        const response = await fetch("/api/files/upload-session", { method: "POST",
          headers: { "content-type": "application/json" }, body });
        return { status: response.status, body: await response.text() };
      }, route.request().postData());
      await route.fulfill({ status: reply.status, contentType: "application/json", body: reply.body });
    }, { times: 1 });
    await chooseFixture(page, fixture);
    await expect(page.getByRole("alert")).toHaveText(UPLOADS_PAUSED_MESSAGE);
    expect(await leaseCount()).toBe(0);
    expect(storageWrites).toBe(0);
    const refusedFiles = await admin.from("genome_files").select("id", { count: "exact", head: true }).eq("user_id", accountId);
    expect(refusedFiles.error).toBeNull();
    expect(refusedFiles.count).toBe(0);

    // Now start one real source on the unpaused server. Interrupt only its
    // first app finalization request, after TUS has acknowledged actual bytes.
    await page.goto("/files/upload");
    await page.route("**/api/files/*/finalize", route => route.abort("failed"), { times: 1 });
    const issuedResponse = page.waitForResponse(response => response.url().endsWith("/api/files/upload-session")
      && response.request().method() === "POST");
    await chooseFixture(page, fixture);
    const issue = await issuedResponse;
    expect(issue.status()).toBe(200);
    const issued = await issue.json() as { uploadId: string; bucketName: string; objectName: string; tier: number };
    expect(issued.bucketName).toBe("genomes-staging");
    expect(issued.tier).toBe(1);
    expect(issued.objectName).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    await expect(page.getByRole("alert")).toBeVisible();
    expect(storageWrites).toBeGreaterThan(0);
    expect(await leaseCount()).toBe(1);
    const lease = await admin.from("upload_sessions").select("status,consumed_at").eq("id", issued.uploadId).single();
    expect(lease.error).toBeNull();
    expect(lease.data).toEqual({ status: "issued", consumed_at: null });
    const staged = await admin.storage.from(issued.bucketName).download(issued.objectName);
    expect(staged.error).toBeNull();
    expect(Buffer.from(await staged.data!.arrayBuffer())).toEqual(bytes);
    const notFinalized = await admin.from("genome_files").select("id", { count: "exact", head: true }).eq("user_id", accountId);
    expect(notFinalized.error).toBeNull();
    expect(notFinalized.count).toBe(0);

    // The paused application completes the genuinely issued lease using the
    // same browser session. No status/grant/source row is inserted by the test.
    const completed = await pausedPage.evaluate(async ({ uploadId, originalName }) => {
      const response = await fetch(`/api/files/${uploadId}/finalize`, { method: "POST",
        headers: { "content-type": "application/json" }, body: JSON.stringify({ originalName, fileType: "vcf", tier: 1 }) });
      return { status: response.status, body: await response.json() };
    }, { uploadId: issued.uploadId, originalName: declaration.originalName });
    expect(completed.status).toBe(200);
    expect(completed.body.fileId).toMatch(/^[0-9a-f-]{36}$/);
    const fileId = completed.body.fileId as string;
    // Legacy staging keys are root UUID names, so search that exact root
    // name and require a successful provider listing with no matching object.
    const stagingAfter = await admin.storage.from(issued.bucketName).list("", { search: issued.objectName, limit: 100 });
    expect(stagingAfter.error).toBeNull();
    expect(stagingAfter.data?.filter(object => object.name === issued.objectName)).toEqual([]);
    expect(await pausedPage.evaluate(async id => (await fetch(`/api/files/${id}/process`, { method: "POST" })).status, fileId)).toBe(200);
    const file = await admin.from("genome_files").select("status,sha256,bucket_path,storage_object_id")
      .eq("id", fileId).eq("user_id", accountId).single();
    expect(file.error).toBeNull();
    expect(file.data).toMatchObject({ status: "annotated", sha256: declaration.sha256, bucket_path: issued.objectName });
    expect(file.data!.storage_object_id).toBeTruthy();
    expect((await admin.from("upload_sessions").select("status").eq("id", issued.uploadId).single()).data?.status).toBe("promoted");
    await pausedPage.reload();
    const row = pausedPage.locator("li").filter({ has: pausedPage.locator(`a[href="/api/files/${fileId}/download"]`) });
    await expect(pausedPage.getByRole("status")).toHaveText(UPLOADS_PAUSED_MESSAGE);
    await expect(row.getByRole("link", { name: "See your reports →", exact: true })).toBeVisible();
    await expect(row.getByRole("button", { name: "Delete", exact: true })).toBeEnabled();
    await pausedPage.setViewportSize({ width: 1280, height: 800 });
    await pausedPage.screenshot({ path: test.info().outputPath("upload-paused-desktop.png"), fullPage: true });
    await pausedPage.setViewportSize({ width: 390, height: 844 });
    await pausedPage.screenshot({ path: test.info().outputPath("upload-paused-mobile.png"), fullPage: true });
    const downloadReady = pausedPage.waitForEvent("download");
    await row.locator(`a[href="/api/files/${fileId}/download"]`).click();
    const downloadPath = await (await downloadReady).path();
    expect(downloadPath).not.toBeNull();
    expect(readFileSync(downloadPath!)).toEqual(bytes);
    expect(await leaseCount()).toBe(1);
  } finally {
    await pausedPage.close();
  }
});
