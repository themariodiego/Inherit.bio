import { expect, test, type Request } from "@playwright/test";
import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { localE2eProject } from "../scripts/local-e2e-project";
import { adminClient, completeOwnUploadConsent, createConfirmedUser, signIn, uploadOwnFileThroughUi } from "./helpers";
import { generateOwnFileWithChosenReports } from "./own-report-helpers";
import { READ_CALLING_COPY } from "../src/copy/upload/read-calling";
import { INPUT_PROVENANCE_COPY } from "../src/copy/reports/input-provenance";
import { NO_CALL, NOT_COVERED_VCF } from "../src/copy/reports/strings";
import { readCallsMarker } from "../src/lib/genome/reads/read-call-vcf";

/**
 * G7.4 BAM/CRAM read calling under TEST-LOCAL (ADR 0038), on the main
 * server. A synthetic BAM (`e2e/fixtures/read-calls-product-grch38.bam`,
 * invented reads at four report positions; see its receipt) is chosen in
 * the ordinary own-DNA picker. The browser calls genotypes from it on the
 * device and uploads only the VCF that results, through the unchanged VCF
 * path; the report pages then render those calls. Every request body the
 * page sends is recorded, and none carries the reads.
 *
 * The production build's refusal is `e2e/read-calls.nojurisdiction.spec.ts`.
 */

test.use({ trace: "off" }); // Upload bearers never enter a persisted trace.
test.describe.configure({ mode: "serial" });

/** The account and file the first test makes; the second reads them back. */
const account = { email: `read-calls-${randomUUID()}@e2e.local`, password: "e2e-read-calls-password" };
let calledFileId: string | null = null;

const BAM = path.join(process.cwd(), "e2e/fixtures/read-calls-product-grch38.bam");
const CRAM = path.join(process.cwd(), "src/lib/genome/reads/fixtures/synthetic-matrix.cram");
const FASTA = path.join(process.cwd(), "src/lib/genome/reads/fixtures/synthetic-reference.fa");
const UPLOAD_PATHS = /^\/(?:storage\/v1\/|api\/uploads$|api\/files\/upload-session$|api\/files\/[^/]+\/(?:finalize|process)$)/;

/** The private normalization journal is not a Data API resource: read only
 * this synthetic file's recorded read-calling object, nothing else. */
async function recordedReadCalls(fileId: string): Promise<unknown> {
  if (!/^[0-9a-f-]{36}$/.test(fileId)) throw new Error("Expected a synthetic file identifier");
  const { stdout } = await promisify(execFile)("docker", ["exec", localE2eProject(process.env).dbContainer, "psql", "-U", "postgres",
    "-d", "postgres", "-XAt", "--set=ON_ERROR_STOP=1", "--command",
    `select coalesce(provenance->'readCalls','null'::jsonb) from private.own_normalization_runs where file_id='${fileId}'::uuid;`],
  { timeout: 10_000, maxBuffer: 8192 });
  return JSON.parse(stdout.trim());
}

test("a synthetic BAM is called on the device, only the VCF it yields is uploaded, and the report pages render its calls", async ({ page }) => {
  test.setTimeout(300_000);
  await createConfirmedUser(account.email, account.password);
  await signIn(page, account.email, account.password);
  await completeOwnUploadConsent(page);
  await expect(page.locator('[data-slot="read-calling-available"]')).toHaveText(READ_CALLING_COPY.available);

  const bam = readFileSync(BAM);
  // Chromium does not hand a Blob request body to Playwright, so the page's
  // own XMLHttpRequest.send is observed: every Blob it is given is hashed in
  // the page, before it is sent. Fetch bodies are strings and are read below.
  await page.addInitScript(() => {
    const seen: Promise<{ size: number; sha256: string; head: number[] }>[] = [];
    (window as unknown as { __xhrBlobBodies: typeof seen }).__xhrBlobBodies = seen;
    const send = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.send = function (body?: Document | XMLHttpRequestBodyInit | null) {
      if (body instanceof Blob) {
        seen.push(body.arrayBuffer().then(async (buffer) => ({ size: buffer.byteLength,
          sha256: [...new Uint8Array(await crypto.subtle.digest("SHA-256", buffer))].map((byte) => byte.toString(16).padStart(2, "0")).join(""),
          head: [...new Uint8Array(buffer.slice(0, 64))] })));
      }
      return send.call(this, body);
    };
  });
  await page.goto("/files/upload");
  const sent: { method: string; pathname: string; body: Buffer | null }[] = [];
  const record = (request: Request) => {
    sent.push({ method: request.method(), pathname: new URL(request.url()).pathname, body: request.postDataBuffer() });
  };
  page.on("request", record);
  const prepared = page.waitForResponse(response => /\/api\/files\/[0-9a-f-]{36}\/process$/.test(response.url())
    && response.request().method() === "POST");
  const fileId = await uploadOwnFileThroughUi(page, BAM);
  expect((await prepared).status(), "canonical preparation of the called VCF").toBe(200);
  await expect(page.locator('[data-slot="read-calls-saved"]')).toContainText(READ_CALLING_COPY.saved(3, 1));
  await expect(page.locator('[data-slot="read-calls-saved"]')).toContainText(READ_CALLING_COPY.unreviewed);

  // What was stored is the called VCF, byte for byte what the page sent.
  const admin = adminClient();
  const { data: file, error } = await admin.from("genome_files").select("file_type,status,sha256,bucket_path,size_bytes")
    .eq("id", fileId).single();
  expect(error).toBeNull();
  expect(file).toMatchObject({ file_type: "vcf", status: "stored" });
  const stored = await admin.storage.from("genomes").download(file!.bucket_path);
  expect(stored.error).toBeNull();
  const vcf = Buffer.from(await stored.data!.arrayBuffer());
  expect(createHash("sha256").update(vcf).digest("hex")).toBe(file!.sha256);
  expect(vcf.toString("utf8")).toContain(readCallsMarker("BAM"));
  expect(vcf.length).toBeLessThan(bam.length);

  // The reads stay on the device: no request body carries them, and the one
  // Storage upload carries exactly the VCF.
  page.off("request", record);
  const uploads = sent.filter(item => UPLOAD_PATHS.test(item.pathname) && item.method === "POST");
  const storagePosts = uploads.filter(item => item.pathname.startsWith("/storage/v1/object/genomes/"));
  expect(storagePosts).toHaveLength(1);
  const xhrBodies = await page.evaluate(() =>
    Promise.all((window as unknown as { __xhrBlobBodies: Promise<{ size: number; sha256: string; head: number[] }>[] }).__xhrBlobBodies));
  expect(xhrBodies, "the one Blob the page sent is the called VCF").toEqual([{ size: vcf.length, sha256: file!.sha256,
    head: [...vcf.subarray(0, 64)] }]);
  expect(Buffer.from(xhrBodies[0].head).toString("utf8").startsWith("##fileformat=VCFv4.2\n")).toBe(true);
  const declaration = JSON.parse(uploads.find(item => item.pathname === "/api/files/upload-session")!.body!.toString("utf8"));
  expect(declaration).toMatchObject({ declaredFormat: "VCF", sizeBytes: vcf.length, sha256: file!.sha256 });
  for (const item of sent) {
    expect(item.body?.includes(bam.subarray(0, 64)) ?? false, `${item.method} ${item.pathname} carries no BAM bytes`).toBe(false);
    expect(item.body?.includes(Buffer.from("BAM\u0001")) ?? false, `${item.method} ${item.pathname} carries no BAM payload`).toBe(false);
  }

  // The canonical rows are the VCF path's own.
  const observed = await admin.from("report_observed_calls").select("rsid,chrom,pos,genotype,usable,read_depth,extraction_version")
    .eq("file_id", fileId).order("source_line");
  expect(observed.error).toBeNull();
  expect(observed.data).toEqual([
    { rsid: 4988235, chrom: 2, pos: 135851076, genotype: "A/A", usable: true, read_depth: 16, extraction_version: "vcf-literal-diploid-snp-v1" },
    { rsid: 1815739, chrom: 11, pos: 66560624, genotype: "--", usable: false, read_depth: 4, extraction_version: "vcf-literal-diploid-snp-v1" },
    { rsid: 671, chrom: 12, pos: 111803962, genotype: "G/G", usable: true, read_depth: 14, extraction_version: "vcf-literal-diploid-snp-v1" },
    { rsid: 762551, chrom: 15, pos: 74749576, genotype: "A/C", usable: true, read_depth: 22, extraction_version: "vcf-literal-diploid-snp-v1" },
  ]);
  expect(await recordedReadCalls(fileId)).toEqual({ version: "inherit-read-calls-v1", input: "BAM", minimumDepth: 10,
    minimumBaseQuality: 20, minimumMappingQuality: 20, heterozygousLow: 0.25, heterozygousHigh: 0.75, homozygousMinimum: 0.9,
    reviewed: false });

  // The result surfaces render from it, unchanged.
  await generateOwnFileWithChosenReports(page, fileId, ["reports.polygenic"]);
  await page.goto("/genome/me/reports/lactase-persistence-lct-rs4988235");
  const lactase = page.locator('[data-variant-result="4988235"]');
  await expect(lactase.locator('[data-figure-kind="genotype"]')).toHaveCount(1);
  await expect(lactase).toContainText("Two A copies are linked to full lactase persistence.");

  await page.goto("/genome/me/reports/caffeine-metabolism-cyp1a2-rs762551");
  await expect(page.locator('[data-variant-result="762551"]')).toContainText("Your file shows one A and one C copy.");
  await page.goto("/genome/me/reports/alcohol-flush-aldh2-rs671");
  await expect(page.locator('[data-variant-result="671"]')).toContainText("Your file shows two G copies, which encode Glu504.");
  await page.goto("/genome/me/reports/muscle-composition-actn3-rs1815739");
  await expect(page.locator('[data-variant-result="1815739"] [data-outcome="no-call"]')).toContainText(NO_CALL);
  await page.goto("/genome/me/reports/bitter-taste-tas2r38");
  await expect(page.locator('[data-outcome="not-covered"]').first()).toContainText(NOT_COVERED_VCF);
  calledFileId = fileId;
});

// Needs 20261022110000_read_called_input_provenance.sql, which projects the
// recorded readCalls object into the display read; hosted CI applies it.
test("the report's source facts say plainly that Inherit called the file from reads it did not create, under unreviewed thresholds", async ({ page }) => {
  expect(calledFileId, "the file the previous test called and prepared").not.toBeNull();
  await signIn(page, account.email, account.password);
  await page.goto("/genome/me/reports/lactase-persistence-lct-rs4988235");
  const provenance = page.locator('[data-slot="input-provenance"]');
  await expect(provenance.locator('[data-slot="read-called-provenance"]')).toContainText(INPUT_PROVENANCE_COPY.readCalled);
  await expect(provenance.locator('[data-slot="read-called-provenance"]')).toContainText(INPUT_PROVENANCE_COPY.readCalledNoGuess);
  await expect(provenance.locator('[data-slot="read-called-thresholds"]')).toContainText(
    "Each position needed at least 10 counted reads. A read counted only with base quality 20 and mapping quality 20 or more.");
  await expect(provenance.locator('[data-slot="read-called-thresholds"]')).toContainText(INPUT_PROVENANCE_COPY.readCalledUnreviewed);
  await expect(provenance).toContainText("VCF file · made by Inherit from BAM sequencing data");
  await expect(provenance).not.toContainText("Inherit did not create these files");
});

test("under TEST-LOCAL a CRAM asks for its reference, and with it reaches the build check, before anything is sent", async ({ page }) => {
  const email = `read-calls-cram-${randomUUID()}@e2e.local`, password = "e2e-read-calls-password";
  await createConfirmedUser(email, password);
  await signIn(page, email, password);
  await completeOwnUploadConsent(page);
  const requests: string[] = [];
  page.on("request", request => {
    const url = new URL(request.url());
    if (UPLOAD_PATHS.test(url.pathname)) requests.push(`${request.method()} ${url.pathname}`);
  });
  const input = page.locator('input[type="file"]');
  const refusal = page.getByRole("alert").filter({ hasText: /\S/ });
  await input.setInputFiles(CRAM);
  await expect(refusal).toHaveText(READ_CALLING_COPY.refusals.reads_reference_required);
  await input.setInputFiles([CRAM, FASTA]);
  await expect(refusal).toHaveText(READ_CALLING_COPY.refusals.reads_unsupported_build);
  await expect(page.getByRole("button", { name: "Choose file", exact: true })).toBeEnabled();
  expect(requests).toEqual([]);
});
