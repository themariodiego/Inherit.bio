import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { uploadSubjectFile, type UploadProgress } from "./subject-upload-browser";
import { readCallsMarker } from "../genome/reads/read-call-vcf";
import type { ReadCallSummary } from "../genome/reads/read-calls";

/**
 * The own-DNA upload with TEST-LOCAL read calling (G7.4, ADR 0038). Only the
 * VCF Inherit called from the reads is declared and sent; the reads and the
 * reference never reach a request. With read calling off (production), a
 * reads file is refused before any request, exactly as before.
 */

const key = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const uploadId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const fileId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const receipt = { transport: "direct-storage", uploadId, bucket: "genomes", stagingKey: key,
  uploadToken: "synthetic-restricted-upload-bearer", authorizationHeader: "Bearer {uploadToken}",
  maximumBytes: 100_000, expiresAt: new Date(Date.now() + 1_800_000).toISOString() };
const completed = { fileId, status: "finalized_ready_for_processing", analysisState: "ready_for_processing",
  next: { routeId: "api.file-process", operation: "process" } };
const read = (path: string, name: string) => new File([readFileSync(path)], name);
const productBam = () => read("e2e/fixtures/read-calls-product-grch38.bam", "synthetic.bam");
const matrixCram = () => read("src/lib/genome/reads/fixtures/synthetic-matrix.cram", "synthetic.cram");
const reference = () => read("src/lib/genome/reads/fixtures/synthetic-reference.fa", "synthetic.fa");
const vcf = () => new File(["##fileformat=VCFv4.2\n#CHROM\tPOS\tID\tREF\tALT\tQUAL\tFILTER\tINFO\tFORMAT\tSAMPLE\n"], "synthetic.vcf");

const fetchMock = vi.fn();
let sent: unknown[];
class FakeXHR {
  status = 200; timeout = 0; withCredentials = true; headers: Record<string, string> = {};
  upload: { onprogress?: (value: { lengthComputable: boolean; loaded: number; total: number }) => void } = {};
  onload?: () => void;
  open() {}
  setRequestHeader(name: string, value: string) { this.headers[name] = value; }
  send(body: unknown) { sent.push(body); this.onload?.(); }
}
beforeEach(() => {
  sent = []; fetchMock.mockReset();
  vi.stubGlobal("XMLHttpRequest", FakeXHR); vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://storage.example.test");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "synthetic-public-project-key");
  fetchMock.mockResolvedValueOnce(Response.json(receipt, { status: 201 })).mockResolvedValueOnce(Response.json(completed));
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
async function bytesOf(body: unknown) { return new Uint8Array(await (body as Blob).arrayBuffer()); }
async function refusal(work: Promise<unknown>) {
  try { await work; } catch (error) { return (error as { code?: string }).code; }
  return "no refusal";
}

describe("TEST-LOCAL read calling in the own-DNA upload", () => {
  it("off (production): a BAM is refused as an unrecognised file before any request", async () => {
    expect(await refusal(uploadSubjectFile(productBam(), "me", () => {}, null))).toBe("unrecognised_format");
    expect(await refusal(uploadSubjectFile(productBam(), "me", () => {}, null, { readCalling: false }))).toBe("unrecognised_format");
    expect(fetchMock).not.toHaveBeenCalled(); expect(sent).toEqual([]);
  });

  it("on: declares and sends only the VCF called from the BAM, never the reads", async () => {
    const steps: UploadProgress["step"][] = [];
    let summary: ReadCallSummary | null = null;
    const bam = productBam();
    expect(await uploadSubjectFile(bam, "me", (progress) => steps.push(progress.step), null,
      { readCalling: true, onReadCalls: (value) => { summary = value; } })).toEqual(completed);
    expect(summary).toMatchObject({ input: "BAM", called: 3, noCall: 1 });
    expect(steps).toContain("calling");
    expect(steps.indexOf("calling")).toBeLessThan(steps.indexOf("hashing"));
    expect(sent).toHaveLength(1);
    const body = await bytesOf(sent[0]);
    const text = new TextDecoder().decode(body);
    expect(text.startsWith("##fileformat=VCFv4.2\n")).toBe(true);
    expect(text).toContain(readCallsMarker("BAM"));
    expect(body[0]).not.toBe(0x1f); // not BGZF, so not the BAM
    expect(sha256(body)).not.toBe(sha256(new Uint8Array(await bam.arrayBuffer())));
    const declaration = JSON.parse(String(fetchMock.mock.calls[0][1].body));
    expect(declaration).toEqual({ subjectId: "me", declaredFormat: "VCF", sizeBytes: body.length, sha256: sha256(body) });
    for (const [, options] of fetchMock.mock.calls) expect(String(options?.body ?? "")).not.toContain("BAM\u0001");
  });

  it("on: a CRAM needs its reference; with it, the invented contigs still stop at the build check, before any request", async () => {
    expect(await refusal(uploadSubjectFile(matrixCram(), "me", () => {}, null, { readCalling: true })))
      .toBe("reads_reference_required");
    expect(await refusal(uploadSubjectFile(matrixCram(), "me", () => {}, null, { readCalling: true, companions: [reference()] })))
      .toBe("reads_unsupported_build");
    expect(await refusal(uploadSubjectFile(reference(), "me", () => {}, null, { readCalling: true, companions: [matrixCram()] })))
      .toBe("reads_unsupported_build");
    expect(fetchMock).not.toHaveBeenCalled(); expect(sent).toEqual([]);
  });

  it("on: a file that only starts like CRAM keeps the ordinary unrecognised-file refusal", async () => {
    const fake = new File([Buffer.concat([Buffer.from("CRAM\x03\0"), Buffer.alloc(20)])], "synthetic.cram");
    expect(await refusal(uploadSubjectFile(fake, "me", () => {}, null, { readCalling: true }))).toBe("unrecognised_format");
    expect(fetchMock).not.toHaveBeenCalled(); expect(sent).toEqual([]);
  });

  it("on: an ordinary VCF goes through unchanged, and a second file beside it is refused", async () => {
    const original = vcf();
    expect(await uploadSubjectFile(original, "me", () => {}, null, { readCalling: true })).toEqual(completed);
    expect(sha256(await bytesOf(sent[0]))).toBe(sha256(new Uint8Array(await original.arrayBuffer())));
    expect(await refusal(uploadSubjectFile(vcf(), "me", () => {}, null, { readCalling: true, companions: [vcf()] })))
      .toBe("unrecognised_format");
    expect(await refusal(uploadSubjectFile(vcf(), "me", () => {}, null, { companions: [vcf()] }))).toBe("unrecognised_format");
  });
});
