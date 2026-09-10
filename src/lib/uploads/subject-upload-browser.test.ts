import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { finishStagedUpload, prepareSubjectFile, uploadSubjectFile } from "./subject-upload-browser";
const key = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const uploadId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const fileId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const subjectId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const vcf = "##fileformat=VCFv4.2\n#CHROM\tPOS\tID\tREF\tALT\tQUAL\tFILTER\tINFO\tFORMAT\tSAMPLE\n";
const file = () => new File([vcf], "private-person-name.vcf");
const receipt = { transport: "direct-storage", uploadId, bucket: "genomes", stagingKey: key,
  uploadToken: "synthetic-restricted-upload-bearer", authorizationHeader: "Bearer {uploadToken}",
  maximumBytes: 100_000, expiresAt: new Date(Date.now() + 1_800_000).toISOString() };
const completed = { fileId, status: "finalized_ready_for_processing", analysisState: "ready_for_processing",
  next: { routeId: "api.file-process", operation: "process" } };
const fetchMock = vi.fn(); let requests: FakeXHR[];
class FakeXHR {
  status = 200; timeout = 0; withCredentials = true;
  method = ""; url = ""; headers: Record<string, string> = {}; body: unknown;
  upload: { onprogress?: (value: { lengthComputable: boolean; loaded: number; total: number }) => void } = {};
  onload?: () => void; onerror?: () => void; ontimeout?: () => void; onabort?: () => void;
  constructor() { requests.push(this); }
  open(method: string, url: string) { this.method = method; this.url = url; }
  setRequestHeader(key: string, value: string) { this.headers[key] = value; }
  send(body: unknown) {
    this.body = body; this.upload.onprogress?.({ lengthComputable: true, loaded: 1, total: 2 });
    this.onload?.();
  }
}
beforeEach(() => {
  vi.restoreAllMocks(); requests = []; fetchMock.mockReset();
  vi.stubGlobal("XMLHttpRequest", FakeXHR); vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://storage.example.test");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "synthetic-public-project-key");
  fetchMock.mockResolvedValueOnce(Response.json(receipt, { status: 201 })).mockResolvedValueOnce(Response.json(completed));
});

describe("preparing an already finalized file", () => {
  it("distinguishes exact-file report failure and retries that file without another upload", async () => {
    fetchMock.mockReset().mockResolvedValueOnce(Response.json({ error: "report_generation_unavailable", fileId }, { status: 503 }))
      .mockResolvedValueOnce(Response.json({ fileId, status: "processed", analysisState: "active" }));
    await expect(prepareSubjectFile(fileId)).rejects.toMatchObject({ code: "report_generation_unavailable", message: "report_generation_unavailable" });
    expect(await prepareSubjectFile(fileId)).toEqual({ fileId, status: "processed", analysisState: "active" });
    expect(fetchMock.mock.calls).toEqual(Array.from({ length: 2 }, () => [`/api/files/${fileId}/process`, {
      method: "POST", credentials: "same-origin", cache: "no-store", redirect: "error",
    }]));
    expect(requests).toHaveLength(0);
  });
  it.each([
    { error: "report_generation_unavailable", fileId: subjectId },
    { error: "report_generation_unavailable" },
    { error: "report_generation_unavailable", fileId, analysisState: "not_generated" },
    { error: "report_generation_unavailable", fileId, detail: "private" },
    { error: "another_error", fileId }, null, [],
  ])("cannot claim preparation from a malformed, open or other-file failure (%j)", async body => {
    fetchMock.mockReset().mockResolvedValueOnce(Response.json(body, { status: 503 }));
    await expect(prepareSubjectFile(fileId)).rejects.toMatchObject({ code: "unavailable" });
  });
  it.each([200, 401, 403, 422, 500])("does not accept a report-stage error under status%s", async status => {
    fetchMock.mockReset().mockResolvedValueOnce(Response.json({ error: "report_generation_unavailable", fileId }, { status }));
    await expect(prepareSubjectFile(fileId)).rejects.toMatchObject({ code: "unavailable" });
  });
  it("keeps lost and unreadable responses uncertain without exposing network details", async () => {
    fetchMock.mockReset().mockRejectedValueOnce(new Error("private network detail"))
      .mockResolvedValueOnce(new Response("not JSON", { status: 503 }));
    await expect(prepareSubjectFile(fileId)).rejects.toMatchObject({ code: "unavailable", message: "unavailable" });
    await expect(prepareSubjectFile(fileId)).rejects.toMatchObject({ code: "unavailable", message: "unavailable" });
    expect(requests).toHaveLength(0);
  });
  it.each(["processed", "already_processed"])("preserves the authoritative %s receipt for previously chosen reports", async status => {
    const value = { fileId, status, analysisState: "active" };
    fetchMock.mockReset().mockResolvedValueOnce(Response.json(value));
    expect(await prepareSubjectFile(fileId)).toEqual(value);
    expect(requests).toHaveLength(0);
  });
  it("makes one bodyless request for the exact file, without uploading or claiming reports exist", async () => {
    const normalized = { fileId, status: "normalization_complete", analysisState: "not_generated" };
    fetchMock.mockReset().mockResolvedValueOnce(Response.json(normalized));
    expect(await prepareSubjectFile(fileId)).toEqual(normalized);
    expect(fetchMock.mock.calls).toEqual([[`/api/files/${fileId}/process`, {
      method: "POST", credentials: "same-origin", cache: "no-store", redirect: "error",
    }]]);
    expect(requests).toHaveLength(0);
  });
  it.each([
    { fileId: subjectId, status: "normalization_complete", analysisState: "not_generated" },
    { fileId, status: "processed", analysisState: "not_generated" },
    { fileId, status: "normalization_complete", analysisState: "not_generated", unexpected: true },
  ])("rejects mismatched or open preparation receipts", async receipt => {
    fetchMock.mockReset().mockResolvedValueOnce(Response.json(receipt));
    await expect(prepareSubjectFile(fileId)).rejects.toMatchObject({ code: "unavailable" });
  });
  it("returns only a closed build refusal without provider details", async () => {
    fetchMock.mockReset().mockResolvedValueOnce(Response.json({ error: "build_unknown", detail: "private" }, { status: 422 }));
    await expect(prepareSubjectFile(fileId)).rejects.toMatchObject({ code: "build_unknown", message: "build_unknown" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("rejects an invalid file id before any request", async () => {
    fetchMock.mockReset();
    await expect(prepareSubjectFile("../different-file")).rejects.toMatchObject({ code: "unavailable" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
describe("browser-to-Storage own-subject upload", () => {
  it("sends a closed hash declaration, uses only its restricted bearer, and finalizes without a body", async () => {
    const progress = vi.fn(); const source = file();
    expect(await uploadSubjectFile(source, subjectId, progress)).toEqual(completed);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][0]).toBe("/api/files/upload-session");
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ subjectId, declaredFormat: "VCF", sizeBytes: source.size,
      sha256: createHash("sha256").update(vcf).digest("hex") });
    expect(JSON.stringify(fetchMock.mock.calls)).not.toContain(source.name);
    expect(requests).toHaveLength(1); expect(requests[0]).toMatchObject({ method: "POST", withCredentials: false,
      url: `https://storage.example.test/storage/v1/object/genomes/${key}`, body: source,
      headers: { Authorization: `Bearer ${receipt.uploadToken}`, apikey: "synthetic-public-project-key", "Content-Type": "application/octet-stream", "x-upsert": "false" } });
    expect(Object.keys(requests[0].headers).sort()).toEqual(["Authorization", "Content-Type", "apikey", "x-upsert"]);
    expect(requests[0].timeout).toBeGreaterThan(0);
    expect(fetchMock.mock.calls[1]).toEqual([`/api/files/${uploadId}/finalize`, {
      method: "POST", credentials: "same-origin", cache: "no-store", redirect: "error" }]);
    expect(progress).toHaveBeenCalledWith({ step: "uploading", pct: 50 });
    expect(progress.mock.calls.at(-1)?.[0]).toEqual({ step: "validating", pct: 0 });
    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith("/process"))).toBe(false);
  });
  it("declares gzip by its bytes and hashes the raw compressed file", async () => {
    const gzip = gzipSync(Buffer.from(vcf)); const source = new File([new Uint8Array(gzip)], "arbitrary.txt");
    await uploadSubjectFile(source, "me", vi.fn());
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({ declaredFormat: "VCF.GZ",
      sha256: createHash("sha256").update(gzip).digest("hex") });
  });
  it.each([undefined, "", "public\r\ninjected: header", " ", "a".repeat(4097)])("refuses missing or malformed gateway configuration before issuing a lease", async apiKey => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", apiKey);
    await expect(uploadSubjectFile(file(), "me", vi.fn())).rejects.toMatchObject({ code: "unavailable" });
    expect(fetchMock).not.toHaveBeenCalled(); expect(requests).toHaveLength(0);
  });
  it.each([["%PDF-1.7\n", "pdf_not_data"], ["CRAMunsupported", "unrecognised_format"],
    ["unknown", "unrecognised_format"], [vcf.replace("SAMPLE", "SAMPLE\tSECOND"), "subject_source_not_single_sample"]])(
    "refuses incompatible input before a network call", async (text, code) => {
      await expect(uploadSubjectFile(new File([text], "file.vcf"), "me", vi.fn())).rejects.toMatchObject({ code });
      expect(fetchMock).not.toHaveBeenCalled(); expect(requests).toHaveLength(0);
    });
  it.each([{ maximumBytes: 1 }, { expiresAt: "2000-01-01T00:00:00Z" }, { bucket: "legal-evidence" },
    { stagingKey: "../another-object" }, { extra: "unexpected" }])("refuses a malformed or insufficient lease", async patch => {
    fetchMock.mockReset().mockResolvedValueOnce(Response.json({ ...receipt, ...patch }, { status: 201 }));
    await expect(uploadSubjectFile(file(), "me", vi.fn())).rejects.toMatchObject({ code: "unavailable" });
    expect(requests).toHaveLength(0);
  });
  it("uses the coded size refusal without forwarding server error details", async () => {
    fetchMock.mockReset().mockResolvedValueOnce(Response.json({ error: "too_large", detail: "private provider detail" }, { status: 413 }));
    await expect(uploadSubjectFile(file(), "me", vi.fn())).rejects.toMatchObject({ code: "too_large", message: "too_large" });
    expect(requests).toHaveLength(0);
  });
  it("maps a stale uploader's paused issuance response without starting Storage or finalization", async () => {
    fetchMock.mockReset().mockResolvedValueOnce(Response.json({ error: "uploads_paused", detail: "private" }, { status: 503 }));
    const progress = vi.fn();
    await expect(uploadSubjectFile(file(), "me", progress)).rejects.toMatchObject({ code: "uploads_paused", message: "uploads_paused" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe("/api/files/upload-session");
    expect(requests).toHaveLength(0);
    expect(progress.mock.calls.some(([value]) => value.step === "uploading" || value.step === "validating")).toBe(false);
  });
  it("does not treat another failure status as an operational pause", async () => {
    fetchMock.mockReset().mockResolvedValueOnce(Response.json({ error: "uploads_paused" }, { status: 401 }));
    await expect(uploadSubjectFile(file(), "me", vi.fn())).rejects.toMatchObject({ code: "unauthorized" });
    expect(requests).toHaveLength(0);
  });
  it("does not retry or finalize a failed Storage transfer", async () => {
    vi.spyOn(FakeXHR.prototype, "send").mockImplementation(function(this: FakeXHR) { this.status = 403; this.onload?.(); });
    await expect(uploadSubjectFile(file(), "me", vi.fn())).rejects.toMatchObject({ code: "unavailable" });
    expect(requests).toHaveLength(1); expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("treats a forged completion receipt as failure, never report-ready", async () => {
    fetchMock.mockReset().mockResolvedValueOnce(Response.json(receipt, { status: 201 }))
      .mockResolvedValueOnce(Response.json({ ...completed, status: "reports_ready" }));
    await expect(uploadSubjectFile(file(), "me", vi.fn())).rejects.toMatchObject({ code: "unavailable" });
  });
});


/** The route keeps durable progress for one finalization (ADR-0026), so a
 * second bodyless POST finishes what an interrupted one left. Nothing asks on
 * its own: the uploader performs no background retry, so what matters here is
 * that a person is handed the upload id when, and only when, asking again can
 * still work. */
describe("finishing an upload whose bytes are already stored", () => {
  const finalize = `/api/files/${uploadId}/finalize`;
  it("finishes with one bodyless POST and returns the receipt", async () => {
    fetchMock.mockReset().mockResolvedValueOnce(Response.json(completed));
    expect(await finishStagedUpload(uploadId)).toEqual(completed);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]).toEqual([finalize, { method: "POST",
      credentials: "same-origin", cache: "no-store", redirect: "error" }]);
  });
  it.each([
    ["a dropped connection", () => fetchMock.mockRejectedValueOnce(new TypeError("network error"))],
    ["a killed invocation", () => fetchMock.mockResolvedValueOnce(new Response("", { status: 504 }))],
    ["a gateway with no answer", () => fetchMock.mockResolvedValueOnce(new Response("", { status: 502 }))],
    // The bytes stay staged, so asking later still works; this is also what a
    // live lease on the previous attempt looks like from the browser.
    ["a refusal naming the upload", () => fetchMock.mockResolvedValueOnce(Response.json({ error: "not_found" }, { status: 404 }))],
  ])("keeps the upload askable after %s", async (_case, arrange) => {
    fetchMock.mockReset(); arrange();
    await expect(finishStagedUpload(uploadId)).rejects.toMatchObject({ code: "unavailable", stagedUploadId: uploadId });
  });
  it.each([503, 413, 415, 422, 401])("does not offer to finish an upload the route already refused (%i)", async status => {
    fetchMock.mockReset().mockResolvedValueOnce(Response.json({ error: "unavailable" }, { status }));
    const refusal = await finishStagedUpload(uploadId).catch((error: unknown) => error);
    expect(refusal).toMatchObject({ stagedUploadId: undefined });
  });
  it("rejects a malformed upload id before any request", async () => {
    fetchMock.mockReset();
    await expect(finishStagedUpload("../another-upload")).rejects.toMatchObject({ code: "unavailable" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("hands the whole upload back when its own finalization is interrupted", async () => {
    fetchMock.mockReset().mockResolvedValueOnce(Response.json(receipt, { status: 201 }))
      .mockRejectedValueOnce(new TypeError("network error"));
    await expect(uploadSubjectFile(file(), subjectId, vi.fn()))
      .rejects.toMatchObject({ code: "unavailable", stagedUploadId: uploadId });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("queued preparation polling", () => {
  beforeEach(() => fetchMock.mockReset());
  it("keeps202 pending and requires actual200 completion for the exact file", async () => {
    vi.useFakeTimers();
    try {
      fetchMock.mockResolvedValueOnce(Response.json({ fileId, jobId: uploadId, status: "preparing", analysisState: "not_generated" }, { status: 202 }))
        .mockResolvedValueOnce(Response.json({ fileId, status: "normalization_complete", analysisState: "not_generated" }));
      let finished = false;
      const pending = prepareSubjectFile(fileId).then(value => { finished = true; return value; });
      await vi.advanceTimersByTimeAsync(0); expect(finished).toBe(false); expect(fetchMock).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(2000);
      expect(await pending).toEqual({ fileId, status: "normalization_complete", analysisState: "not_generated" });
      expect(fetchMock).toHaveBeenCalledTimes(2);
    } finally { vi.useRealTimers(); }
  });
  it("rejects a replacementjob during same-file polling", async () => {
    vi.useFakeTimers();
    try {
      fetchMock.mockResolvedValueOnce(Response.json({ fileId, jobId: uploadId, status: "preparing", analysisState: "not_generated" }, { status: 202 }))
        .mockResolvedValueOnce(Response.json({ fileId, jobId: subjectId, status: "preparing", analysisState: "not_generated" }, { status: 202 }));
      const pending = expect(prepareSubjectFile(fileId)).rejects.toMatchObject({ code: "unavailable" });
      await vi.advanceTimersByTimeAsync(2000); await pending;
    } finally { vi.useRealTimers(); }
  });
  it("stops polling on caller cancellation", async () => {
    vi.useFakeTimers();
    try {
      const controller = new AbortController();
      fetchMock.mockResolvedValueOnce(Response.json({ fileId, jobId: uploadId, status: "preparing", analysisState: "not_generated" }, { status: 202 }));
      const pending = expect(prepareSubjectFile(fileId, { signal: controller.signal })).rejects.toMatchObject({ code: "unavailable" });
      await vi.advanceTimersByTimeAsync(0); controller.abort(); await pending;
      await vi.advanceTimersByTimeAsync(5000); expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally { vi.useRealTimers(); }
  });
});

/**
 * Reading a whole genome file locally to hash it takes real time, so a file
 * the deployment cannot accept is refused before that work rather than after
 * it. The server stays the authority; this only saves the wait.
 */
describe("refusing an over-ceiling file before reading all of it", () => {
  const limits = { maximumArrayBytes: 52_428_800, maximumVcfBytes: 25_165_824,
    maximumAccountBytes: 134_217_728, maximumActiveUploads: 2, reservedBytes: 0, activeUploads: 0 };
  const array = () => new File(
    ["# This data file generated by 23andMe\n# rsid\tchromosome\tposition\tgenotype\nrs1\t1\t100\tAA\n"], "private.txt");
  it("refuses a file past its format ceiling with the exact ceiling and no request", async () => {
    await expect(uploadSubjectFile(file(), subjectId, vi.fn(), { ...limits, maximumVcfBytes: 10 }))
      .rejects.toMatchObject({ code: "too_large", limitBytes: 10 });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(requests).toHaveLength(0);
  });
  it("measures a genotype table against the array ceiling, not the VCF one", async () => {
    await expect(uploadSubjectFile(array(), subjectId, vi.fn(), { ...limits, maximumArrayBytes: 5, maximumVcfBytes: 5_000_000 }))
      .rejects.toMatchObject({ code: "too_large", limitBytes: 5 });
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("accepts a file exactly at the ceiling", async () => {
    const source = file();
    expect(await uploadSubjectFile(source, subjectId, vi.fn(), { ...limits, maximumVcfBytes: source.size }))
      .toEqual(completed);
  });
  it.each([null, undefined])("uploads normally when the ceilings could not be read (%j)", async disclosure => {
    expect(await uploadSubjectFile(file(), subjectId, vi.fn(), disclosure)).toEqual(completed);
  });
  it.each(["account_full", "decompressed_too_large"])(
    "keeps the server's own size refusal %s distinct, and carries no invented limit", async error => {
      fetchMock.mockReset().mockResolvedValueOnce(Response.json({ error }, { status: 413 }));
      await expect(uploadSubjectFile(file(), subjectId, vi.fn(), limits))
        .rejects.toMatchObject({ code: error, limitBytes: undefined });
    });
});
