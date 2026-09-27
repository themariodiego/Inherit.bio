import { expect, test } from "@playwright/test";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { adminClient, ANON_KEY, completeOwnUploadConsent, createConfirmedUser, signIn, SUPABASE_URL } from "./helpers";
import { directUploadReceipt, subjectFinalizationReceipt } from "../src/lib/uploads/subject-upload-contract";

test.use({ trace: "off" }); // Keep the restricted bearer out of persisted traces.

test("a standard upload grant refuses TUS creation and upsert, then stores and finalizes the same exact source", async ({ page }) => {
  const email = `upload-transport-${randomUUID()}@e2e.local`;
  const password = "synthetic-upload-transport-password";
  const accountId = await createConfirmedUser(email, password);
  await signIn(page, email, password);
  await completeOwnUploadConsent(page);
  const bytes = readFileSync(path.join(process.cwd(), "e2e/fixtures/tiny-grch38.vcf"));
  const declaration = { subjectId: "me", declaredFormat: "VCF", sizeBytes: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex") };
  const issued = await page.evaluate(async declaration => {
    const response = await fetch("/api/files/upload-session", { method: "POST",
      headers: { "content-type": "application/json" }, body: JSON.stringify(declaration) });
    return { status: response.status, body: await response.json() };
  }, declaration);
  expect(issued.status).toBe(201);
  const grant = directUploadReceipt.parse(issued.body);
  const provider = { origin: SUPABASE_URL, apiKey: ANON_KEY, grant };

  // Native browser fetch crosses the same real installed-provider proxy as
  // the standard upload suite. No response, JWT verification or RLS is mocked.
  // Both requests reproduce the valid, empty TUS create that exposed the gap.
  for (const spoof of [false, true]) {
    const denied = await page.evaluate(async ({ origin, apiKey, grant, spoof }) => {
      const authorization = { authorization: `Bearer ${grant.uploadToken}`, apikey: apiKey };
      const metadata = { bucketName: grant.bucket, objectName: grant.stagingKey,
        contentType: "application/octet-stream", ...(spoof ? {
          metadata: JSON.stringify({ "storage.operation": "storage.object.upload", transport: "direct-storage" }),
        } : {}) };
      let location: string | null = null;
      let status = 0;
      let cleanup: string | number = "not-needed";
      try {
        const response = await fetch(`${origin}/storage/v1/upload/resumable`, { method: "POST", redirect: "error",
          signal: AbortSignal.timeout(10_000),
          headers: { ...authorization, "tus-resumable": "1.0.0", "upload-length": String(grant.maximumBytes),
            "upload-metadata": Object.entries(metadata).map(([key, value]) => `${key} ${btoa(value)}`).join(",") } });
        status = response.status;
        location = response.headers.get("location");
        await response.arrayBuffer();
      } finally {
        if (location) {
          // A regressed provider might accept the empty create. Bound cleanup
          // to this exact synthetic resource; never follow a returned origin.
          cleanup = "invalid-location";
          try {
            const url = new URL(location, origin);
            const id = /^\/(?:storage\/v1\/)?upload\/resumable\/([A-Za-z0-9_-]+)$/.exec(url.pathname)?.[1];
            const decoded = id ? atob(id.replace(/-/g, "+").replace(/_/g, "/")) : "";
            const prefix = `${grant.bucket}/${grant.stagingKey}/`;
            if (id && !url.search && !url.hash && decoded.startsWith(prefix)
              && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(decoded.slice(prefix.length))) {
              cleanup = "request-failed";
              const response = await fetch(`${origin}/storage/v1/upload/resumable/${id}`, { method: "DELETE",
                redirect: "error", credentials: "omit", signal: AbortSignal.timeout(10_000),
                headers: { ...authorization, "tus-resumable": "1.0.0" } });
              cleanup = response.status;
              await response.arrayBuffer();
            }
          } catch { /* Sanitized result only; no bearer or resource URL in diagnostics. */ }
        }
      }
      // A DELETE response is protocol hygiene, not physical-deletion evidence.
      return { status, hasLocation: location !== null, cleanup };
    }, { ...provider, spoof });
    expect(denied, spoof ? "TUS metadata spoof refused" : "TUS create refused")
      .toEqual({ status: 403, hasLocation: false, cleanup: "not-needed" });
  }
  const deniedUpsert = await page.evaluate(async ({ origin, apiKey, grant, bytes }) => {
    const authorization = { authorization: `Bearer ${grant.uploadToken}`, apikey: apiKey };
    const upsert = await fetch(`${origin}/storage/v1/object/${grant.bucket}/${grant.stagingKey}`, { method: "POST",
      headers: { ...authorization, "content-type": "application/octet-stream", "x-upsert": "true" },
      body: new Uint8Array(bytes) });
    // Standard Storage uses its legacy HTTP 400 wrapper for a rendered 403;
    // TUS emits the rendered status directly. Require the permission refusal.
    const body = await upsert.json();
    return { status: upsert.status, permissionStatus: body.statusCode, hasLocation: upsert.headers.has("location") };
  }, { ...provider, bytes: [...bytes] });
  expect(deniedUpsert).toEqual({ status: 400, permissionStatus: "403", hasLocation: false });
  const admin = adminClient();
  const pending = await admin.from("upload_sessions").select("status,consumed_at,finalized_file_id")
    .eq("id", grant.uploadId).eq("account_id", accountId).single();
  expect(pending.error).toBeNull();
  expect(pending.data).toEqual({ status: "issued", consumed_at: null, finalized_file_id: null });

  // A success using that SAME grant distinguishes transport refusal from an
  // expired/bad bearer or broken fixture, and observes real operation setting.
  const stored = await page.evaluate(async ({ origin, apiKey, grant, bytes }) => {
    const response = await fetch(`${origin}/storage/v1/object/${grant.bucket}/${grant.stagingKey}`, { method: "POST",
      headers: { authorization: `Bearer ${grant.uploadToken}`, apikey: apiKey,
        "content-type": "application/octet-stream", "x-upsert": "false" }, body: new Uint8Array(bytes) });
    await response.arrayBuffer();
    return response.status;
  }, { ...provider, bytes: [...bytes] });
  expect(stored).toBe(200);
  const uploaded = await admin.from("upload_sessions").select("status").eq("id", grant.uploadId).single();
  expect(uploaded.error).toBeNull();
  expect(uploaded.data).toEqual({ status: "uploaded" });
  const source = await admin.storage.from(grant.bucket).download(grant.stagingKey);
  expect(source.error).toBeNull();
  expect(Buffer.from(await source.data!.arrayBuffer())).toEqual(bytes);

  const finalized = await page.evaluate(async uploadId => {
    const response = await fetch(`/api/files/${uploadId}/finalize`, { method: "POST" });
    return { status: response.status, body: await response.json() };
  }, grant.uploadId);
  expect(finalized.status).toBe(200);
  const { fileId } = subjectFinalizationReceipt.parse(finalized.body);
  const file = await admin.from("genome_files").select("bucket_path,sha256,user_id").eq("id", fileId).single();
  expect(file.error).toBeNull();
  expect(file.data).toMatchObject({ sha256: declaration.sha256, user_id: accountId });
  const finalSource = await admin.storage.from(grant.bucket).download(file.data!.bucket_path);
  expect(finalSource.error).toBeNull();
  expect(Buffer.from(await finalSource.data!.arrayBuffer())).toEqual(bytes);
  const staging = await admin.storage.from(grant.bucket).list("", { search: grant.stagingKey, limit: 100 });
  expect(staging.error).toBeNull();
  expect(staging.data?.some(object => object.name === grant.stagingKey)).toBe(false);
});
