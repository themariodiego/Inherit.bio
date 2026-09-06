import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prepareSubjectFile, uploadSubjectFile } from "./subject-upload-browser";
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
  fetchMock.mockResolvedValueOnce(Response.json(receipt, { status: 201 })).mockResolvedValueOnce(Response.json(completed));
});

describe("preparing an already finalized file", () => {
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
    { fileId, status: "processed", analysisState: "active" },
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
      headers: { Authorization: `Bearer ${receipt.uploadToken}`, "Content-Type": "application/octet-stream", "x-upsert": "false" } });
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
