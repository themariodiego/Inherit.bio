import { expect, test } from "@playwright/test";
import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { promisify } from "node:util";
import { gzipSync } from "node:zlib";
import { ANON_KEY, SUPABASE_URL, adminClient, completeOwnUploadConsent, createConfirmedUser, signIn } from "./helpers";
import { INGEST_REFUSALS } from "../src/copy/upload/errors";
import { sniffV2 } from "../src/lib/genome/parsers/sniff";

// ADR0016 supersedes A10's BAM/CRAM storage and TUS success contract. Historical
// positive evidence and its exact revisions remain in docs/test-diff-register.md.
// These are format-signature rejection fixtures, not valid alignment datasets;
// the historical e2e/fixtures/tiny.bam is neither rewritten nor removed.
const cases = [
  { kind: "bam", format: "BAM", declaration: "VCF.GZ", bytes: gzipSync(Buffer.from("BAM\x01\0\0\0\0\0\0\0\0")) },
  { kind: "cram", format: "CRAM", declaration: "VCF", bytes: Buffer.concat([Buffer.from("CRAM\x03\0"), Buffer.alloc(20)]) },
] as const;

test.use({ trace: "off" }); // Never retain the real restricted upload bearer.

// Read only the new synthetic account. The shared stack and existing fixtures
// are not reset, and only the real finalizer performs Storage cleanup.
async function footprint(accountId: string) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(accountId)) {
    throw new Error("Expected a synthetic account identifier");
  }
  const { stdout } = await promisify(execFile)("docker", ["exec", "supabase_db_sequence", "psql", "-U", "postgres",
    "-d", "postgres", "-XAt", "--set=ON_ERROR_STOP=1", "--command", `
      select json_build_object(
        'files',(select count(*) from public.genome_files where user_id='${accountId}'::uuid),
        'variants',(select count(*) from public.user_variants where user_id='${accountId}'::uuid),
        'observed',(select count(*) from public.report_observed_calls where user_id='${accountId}'::uuid),
        'prs',(select count(*) from public.user_prs where user_id='${accountId}'::uuid),
        'ancestry',(select count(*) from public.ancestry_results where user_id='${accountId}'::uuid),
        'journal',(select count(*) from private.own_analysis_runs where account_id='${accountId}'::uuid),
        'jobs',(select count(*) from public.worker_jobs where user_id='${accountId}'::uuid),
        'notices',(select count(*) from public.mail_outbox m join public.subject_principals sp
          on sp.id=m.recipient_principal_id where sp.account_id='${accountId}'::uuid and m.template_id='report-ready'),
        'storage',(select count(*) from storage.objects o where o.bucket_id='genomes' and
          (o.owner_id='${accountId}' or o.name in(select staging_object_name from public.upload_sessions where account_id='${accountId}'::uuid
           union select final_object_name::text from public.upload_sessions where account_id='${accountId}'::uuid)))
      );`], { timeout: 10_000, maxBuffer: 8192 });
  return JSON.parse(stdout.trim()) as Record<string, number>;
}
const empty = { files: 0, variants: 0, observed: 0, prs: 0, ancestry: 0, journal: 0, jobs: 0, notices: 0, storage: 0 };

for (const sample of cases) {
  test(`${sample.format} is refused before issuance and server finalization cleans a misdeclared real Storage upload`, async ({ page }) => {
    const email = `unsupported-${sample.kind}-${randomUUID()}@e2e.local`;
    const password = "synthetic-unsupported-format-password";
    const accountId = await createConfirmedUser(email, password);
    await signIn(page, email, password);
    await completeOwnUploadConsent(page);
    const admin = adminClient();
    const leases = async () => {
      const result = await admin.from("upload_sessions").select("id,status,consumed_at,finalized_file_id,finalization_cleanup_pending")
        .eq("account_id", accountId).order("id");
      expect(result.error).toBeNull();
      return result.data!;
    };
    expect(sniffV2(sample.bytes).kind).toBe(sample.kind);
    expect(await footprint(accountId)).toEqual(empty);
    expect(await leases()).toEqual([]);
    const requests: string[] = [];
    page.on("request", request => {
      const url = new URL(request.url());
      if (url.pathname.startsWith("/storage/v1/") || url.pathname === "/api/uploads"
        || url.pathname === "/api/files/upload-session" || /\/api\/files\/[^/]+\/(?:finalize|process)$/.test(url.pathname)) {
        requests.push(`${request.method()} ${url.pathname}`);
      }
    });
    // Both the original extension and a misleading supported extension fail
    // from actual bytes, with a reusable picker and no capability or transport.
    for (const name of [`synthetic.${sample.kind}`, "synthetic.vcf"]) {
      await page.locator('input[type="file"]').setInputFiles({ name, mimeType: "application/octet-stream", buffer: sample.bytes });
      await expect(page.getByRole("alert").filter({ hasText: INGEST_REFUSALS.unrecognised_format }))
        .toHaveText(INGEST_REFUSALS.unrecognised_format);
      await expect(page.getByRole("button", { name: "Choose file", exact: true })).toBeEnabled();
      await expect(page.locator('input[type="file"]')).toHaveValue("");
    }
    expect(requests).toEqual([]);
    expect(await leases()).toEqual([]);
    expect(await footprint(accountId)).toEqual(empty);

    const declaration = { subjectId: "me", declaredFormat: sample.format, sizeBytes: sample.bytes.length,
      sha256: createHash("sha256").update(sample.bytes).digest("hex") };
    // Browser-native requests retain real same-origin/session authority. Both
    // registered aliases reject unsupported declarations without issuing a row.
    for (const pathname of ["/api/files/upload-session", "/api/uploads"]) {
      const denied = await page.evaluate(async ({ pathname, declaration }) => {
        const response = await fetch(pathname, { method: "POST", credentials: "same-origin", redirect: "error",
          headers: { "content-type": "application/json" }, body: JSON.stringify(declaration) });
        return { status: response.status, body: await response.json() };
      }, { pathname, declaration });
      expect(denied).toEqual({ status: 422, body: { error: "invalid_request" } });
    }
    expect(await leases()).toEqual([]);
    expect(await footprint(accountId)).toEqual(empty);

    // Deliberately bypass preflight with a supported declaration. The issuer
    // sees only size/hash/format; the real finalizer must inspect Storage bytes.
    // Keep its bearer solely in this native browser closure, never in output.
    const staged = await page.evaluate(async ({ declaration, bytes, storageOrigin, apiKey }) => {
      const response = await fetch("/api/files/upload-session", { method: "POST", credentials: "same-origin", redirect: "error",
        headers: { "content-type": "application/json" }, body: JSON.stringify(declaration) });
      if (response.status !== 201) throw new Error("Expected real upload issuance");
      const issued = await response.json();
      const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
      if (Object.keys(issued).sort().join() !== ["transport", "uploadId", "bucket", "stagingKey", "uploadToken", "authorizationHeader", "maximumBytes", "expiresAt"].sort().join()
        || issued.transport !== "direct-storage" || issued.bucket !== "genomes" || !uuid.test(issued.uploadId) || !uuid.test(issued.stagingKey)
        || typeof issued.uploadToken !== "string" || !issued.uploadToken || issued.authorizationHeader !== "Bearer {uploadToken}"
        || issued.maximumBytes !== bytes.length || !(Date.parse(issued.expiresAt) > Date.now())) throw new Error("Invalid restricted upload receipt");
      const stored = await fetch(`${storageOrigin}/storage/v1/object/genomes/${issued.stagingKey}`, {
        method: "POST", credentials: "omit", redirect: "error", headers: { authorization: `Bearer ${issued.uploadToken}`,
          apikey: apiKey, "content-type": "application/octet-stream", "x-upsert": "false" }, body: new Uint8Array(bytes) });
      await stored.arrayBuffer();
      return { status: stored.status, uploadId: issued.uploadId as string, stagingKey: issued.stagingKey as string };
    }, { declaration: { ...declaration, declaredFormat: sample.declaration }, bytes: [...sample.bytes], storageOrigin: SUPABASE_URL,
      apiKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? ANON_KEY });
    expect(staged.status).toBe(200);
    expect(await footprint(accountId)).toEqual({ ...empty, storage: 1 });
    const original = await admin.storage.from("genomes").download(staged.stagingKey);
    expect(original.error).toBeNull();
    expect(Buffer.from(await original.data!.arrayBuffer())).toEqual(sample.bytes);
    const rejected = await page.evaluate(async uploadId => {
      const response = await fetch(`/api/files/${uploadId}/finalize`, { method: "POST", credentials: "same-origin", redirect: "error" });
      return { status: response.status, body: await response.json() };
    }, staged.uploadId);
    expect(rejected).toEqual({ status: 415, body: { error: "unrecognised_format" } });
    const after = await leases();
    expect(after).toHaveLength(1);
    expect(after[0]).toMatchObject({ id: staged.uploadId, status: "rejected", finalized_file_id: null, finalization_cleanup_pending: false });
    expect(after[0].consumed_at).not.toBeNull();
    expect(await footprint(accountId)).toEqual(empty);
    expect(requests.filter(request => request.endsWith("/process"))).toEqual([]);
    await page.goto("/files");
    await expect(page.locator('a[href^="/api/files/"][href$="/download"]')).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Choose file", exact: true })).toBeEnabled();
  });
}
