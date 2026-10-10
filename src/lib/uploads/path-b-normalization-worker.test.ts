import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { ArrayKind } from "../genome/parsers/array";
import { gzipSync } from "node:zlib";
import { describe, expect, it, vi } from "vitest";
import { runPathBNormalizationWorker, type PathBNormalizationRpc } from "./path-b-normalization-worker";

const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const vcf = "##fileformat=VCFv4.2\n##reference=GRCh38\n#CHROM\tPOS\tID\tREF\tALT\tQUAL\tFILTER\tINFO\tFORMAT\tSYNTHETIC\n"
  + "15\t74749576\trs762551\tC\tA\t50\tPASS\t.\tGT:GQ:DP\t0/1:50:30\n";
function fixture(gzip = false) {
  const decoded = Buffer.from(vcf), raw = gzip ? gzipSync(decoded) : decoded;
  const claim = { jobId: "11111111-1111-4111-8111-111111111111", claim: "22222222-2222-4222-8222-222222222222",
    claimExpiresAt: new Date(Date.now() + 290_000).toISOString(),
    fileId: "33333333-3333-4333-8333-333333333333", subjectId: "44444444-4444-4444-8444-444444444444",
    sourceRevision: 1, rawSha256: sha(raw), decodedSha256: sha(decoded), bucket: "genomes" as const,
    objectId: "55555555-5555-4555-8555-555555555555", objectKey: "66666666-6666-4666-8666-666666666666",
    sizeBytes: raw.length, maximumDecodedBytes: decoded.length, fileType: "vcf" as const };
  const events: string[] = [];
  const operation = vi.fn<PathBNormalizationRpc["operation"]>(async args => {
    events.push(args.p_operation);
    if (args.p_operation === "claim") return { data: claim, error: null };
    expect(args.p_job_id).toBe(claim.jobId); expect(args.p_claim).toBe(claim.claim);
    expect(args.p_claim_hash).toMatch(/^[0-9a-f]{64}$/); expect(args.p_test_jurisdiction).toBe(true);
    if (args.p_operation === "check") return { data: structuredClone(claim), error: null };
    if (args.p_operation === "complete") return { data: { fileId: claim.fileId,
      status: "normalization_complete", analysisState: "not_generated" }, error: null };
    return { data: true, error: null };
  });
  const register = vi.fn<PathBNormalizationRpc["register"]>(async args => {
    events.push("register");
    return { data: { acceptedVariantOrdinals: args.p_entries.flatMap((entry, ordinal) => entry.variant ? [ordinal] : []),
      attempted: 0, unmapped: 0 }, error: null };
  });
  const readRange = vi.fn(async (_source, start: number, end: number) => {
    events.push("range");
    return new Response(Uint8Array.from(raw.subarray(start, end + 1)), { status: 206,
      headers: { "content-range": `bytes ${start}-${end}/${raw.length}` } });
  });
  const options = { testJurisdiction: true, rpc: { operation, register }, signal: new AbortController().signal,
    readRange, maximumUnmappedFraction: 0.02 };
  return { options, claim, raw, operation, register, readRange, events };
}
describe("Path B normalization worker", () => {
  it.each([false, true])("normalizes real synthetic bytes with exact claim and final EOF fences (gzip=%s)", async gzip => {
    const f = fixture(gzip);
    expect(await runPathBNormalizationWorker(f.options)).toEqual({ status: "normalized" });
    expect(f.readRange).toHaveBeenCalledTimes(2);
    expect(f.register).toHaveBeenCalledTimes(1);
    const stages = f.operation.mock.calls.filter(([args]) => args.p_operation === "stage");
    expect(stages.map(([args]) => args.p_payload)).toMatchObject([
      { kind: "variants", sequence: 0, rows: [{ rsid: 762551, genotype: "A/C" }] },
      { kind: "observed", sequence: 0, rows: [{ source_line: 4, usable: true }] },
    ]);
    const completed = f.operation.mock.calls.find(([args]) => args.p_operation === "complete")![0];
    expect(completed.p_payload).toMatchObject({ sourceBuild: "GRCh38", rawSha256: sha(f.raw),
      decodedSha256: f.claim.decodedSha256, variantCount: 1, observedCallCount: 1 });
    expect(f.events.slice(-2)).toEqual(["check", "complete"]);
    expect(new Set(f.operation.mock.calls.map(([args]) => args.p_claim_hash)).size).toBe(1);
  });
  it("does no I/O when the test jurisdiction is closed", async () => {
    const f = fixture(); f.options.testJurisdiction = false;
    await expect(runPathBNormalizationWorker(f.options)).rejects.toThrow("path_b_normalization_unavailable");
    expect(f.operation).not.toHaveBeenCalled(); expect(f.readRange).not.toHaveBeenCalled();
  });
  it("returns idle without selecting a source or claiming a second job", async () => {
    const f = fixture(); f.operation.mockResolvedValue({ data: null, error: null });
    expect(await runPathBNormalizationWorker(f.options)).toEqual({ status: "idle" });
    expect(f.operation).toHaveBeenCalledTimes(1); expect(f.readRange).not.toHaveBeenCalled();
  });
  it("does not read after a changed confirmation snapshot", async () => {
    const f = fixture(); f.operation.mockImplementation(async args => ({
      data: args.p_operation === "claim" ? f.claim : { ...f.claim, sourceRevision: 2 }, error: null }));
    await expect(runPathBNormalizationWorker(f.options)).rejects.toThrow("path_b_normalization_unavailable");
    expect(f.readRange).not.toHaveBeenCalled(); expect(f.events).not.toContain("complete");
    expect(f.operation.mock.calls.at(-1)![0].p_operation).toBe("fail");
  });
  it("rejects a corrupt actual source before publishing", async () => {
    const f = fixture(); f.claim.rawSha256 = "a".repeat(64);
    await expect(runPathBNormalizationWorker(f.options)).rejects.toThrow("path_b_normalization_unavailable");
    expect(f.register).not.toHaveBeenCalled();
    expect(f.operation.mock.calls.some(([a]) => a.p_operation === "complete")).toBe(false);
  });
  it("never replays an uncertain genetic write", async () => {
    const f = fixture(), original = f.operation.getMockImplementation()!;
    f.operation.mockImplementation(async args => {
      if (args.p_operation === "stage") throw new Error("opaque provider failure");
      return original(args);
    });
    await expect(runPathBNormalizationWorker(f.options)).rejects.toThrow("path_b_normalization_unavailable");
    expect(f.operation.mock.calls.filter(([a]) => a.p_operation === "stage")).toHaveLength(1);
    expect(f.operation.mock.calls.filter(([a]) => a.p_operation === "fail")).toHaveLength(1);
    expect(f.operation.mock.calls.some(([a]) => a.p_operation === "complete")).toBe(false);
  });
  it("rejects expired claims before byte reads", async () => {
    const f = fixture(); f.claim.claimExpiresAt = new Date(Date.now() - 1).toISOString();
    await expect(runPathBNormalizationWorker(f.options)).rejects.toThrow("path_b_normalization_unavailable");
    expect(f.readRange).not.toHaveBeenCalled();
  });
});

// Added arrays use real accepted vendor bytes through the same finite machine claim.
describe("confirmed Path B array worker", () => {
  function arrayFixture(kind: ArrayKind = "array_23andme", text =
    "# This data file generated by 23andMe: synthetic TEST-LOCAL fixture\n# Build 38\n"
      + "# rsid\tchromosome\tposition\tgenotype\nrs762551\t15\t74749576\tCA\n") {
    const f = fixture();
    const bytes = Buffer.from(text);
    const claim = { ...f.claim, fileType: kind,
      rawSha256: sha(bytes), decodedSha256: sha(bytes), sizeBytes: bytes.length, maximumDecodedBytes: bytes.length };
    const events: string[] = [];
    f.operation.mockImplementation(async args => {
      events.push(args.p_operation);
      expect(args.p_test_jurisdiction).toBe(true); expect(args.p_claim_hash).toMatch(/^[0-9a-f]{64}$/);
      if (args.p_operation === "claim") return { data: claim, error: null };
      expect(args.p_job_id).toBe(claim.jobId); expect(args.p_claim).toBe(claim.claim);
      if (args.p_operation === "check") return { data: structuredClone(claim), error: null };
      if (args.p_operation === "complete") return { data: { fileId: claim.fileId,
        status: "normalization_complete", analysisState: "not_generated" }, error: null };
      return { data: true, error: null };
    });
    f.readRange.mockImplementation(async (_source, start, end) => new Response(Uint8Array.from(bytes.subarray(start, end + 1)),
      { status: 206, headers: { "content-range": `bytes ${start}-${end}/${bytes.length}` } }));
    return { ...f, claim, events, bytes };
  }
  it.each([["array_23andme", "23andme.txt"], ["array_ancestry", "ancestry.txt"],
    ["array_myheritage", "myheritage.csv"], ["array_ftdna", "ftdna.csv"]] as const)(
    "processes actual %s fixture bytes through the claimed worker and closed saved receipt", async (kind, name) => {
      const f = arrayFixture(kind, readFileSync(path.join(process.cwd(), "e2e/fixtures", `path-b-reports-grch38-${name}`), "utf8"));
      expect(await runPathBNormalizationWorker(f.options)).toEqual({ status: "normalized" });
      expect(f.readRange).toHaveBeenCalledTimes(2);
      const stages = f.operation.mock.calls.filter(([a]) => a.p_operation === "stage");
      expect(stages.map(([a]) => a.p_payload)).toEqual([{ kind: "variants", sequence: 0, rows: [
        { rsid: 762551, chrom: 15, pos: 74749576, ref: null, alt: null, genotype: "A/C" },
        { rsid: 9923231, chrom: 16, pos: 31096368, ref: null, alt: null, genotype: "C/T" },
      ] }]);
      expect(f.operation.mock.calls.find(([a]) => a.p_operation === "complete")![0].p_payload)
        .toMatchObject({ variantCount: 2, observedCallCount: 0, sourceBuild: "GRCh38" });
      expect(f.events.slice(-2)).toEqual(["check", "complete"]);
    });
  it("publishes exact literal array calls only after whole second EOF and final current fence", async () => {
    const f = arrayFixture(); expect(await runPathBNormalizationWorker(f.options)).toEqual({ status: "normalized" });
    expect(f.readRange).toHaveBeenCalledTimes(2);
    expect(f.operation.mock.calls.filter(([a]) => a.p_operation === "stage").map(([a]) => a.p_payload))
      .toEqual([{ kind: "variants", sequence: 0, rows: [{ rsid: 762551, chrom: 15, pos: 74749576,
        ref: null, alt: null, genotype: "A/C" }] }]);
    expect(f.operation.mock.calls.find(([a]) => a.p_operation === "complete")![0].p_payload)
      .toMatchObject({ rawSha256: sha(f.bytes), decodedSha256: sha(f.bytes), sourceBuild: "GRCh38",
        variantCount: 1, observedCallCount: 0, provenance: { sourceRevision: 1, attempted: 0, unmapped: 0 } });
    expect(f.events.slice(-2)).toEqual(["check", "complete"]);
  });
  it("does not register calls from a corrupted whole first pass", async () => {
    const f = arrayFixture(); f.claim.rawSha256 = "a".repeat(64);
    await expect(runPathBNormalizationWorker(f.options)).rejects.toThrow("path_b_normalization_unavailable");
    expect(f.register).not.toHaveBeenCalled(); expect(f.operation.mock.calls.some(([a]) => a.p_operation === "complete")).toBe(false);
  });
  it("refuses changed authority after native register and never stages its returned ordinals", async () => {
    const f = arrayFixture(); const operation = f.operation.getMockImplementation()!;
    f.operation.mockImplementation(async args => args.p_operation === "check" && f.register.mock.calls.length
      ? { data: { ...f.claim, sourceRevision: 2 }, error: null } : operation(args));
    await expect(runPathBNormalizationWorker(f.options)).rejects.toThrow("path_b_normalization_unavailable");
    expect(f.register).toHaveBeenCalledTimes(1); expect(f.operation.mock.calls.some(([a]) => a.p_operation === "stage")).toBe(false);
    expect(f.operation.mock.calls.at(-1)![0].p_operation).toBe("fail");
  });
  it("keeps staged calls private when confirmation changes before final completion", async () => {
    const f = arrayFixture(); const operation = f.operation.getMockImplementation()!; let staged = false;
    f.operation.mockImplementation(async args => {
      if (args.p_operation === "stage") staged = true;
      if (args.p_operation === "check" && staged) return { data: { ...f.claim, sourceRevision: 2 }, error: null };
      return operation(args);
    });
    await expect(runPathBNormalizationWorker(f.options)).rejects.toThrow("path_b_normalization_unavailable");
    expect(f.operation.mock.calls.filter(([a]) => a.p_operation === "stage")).toHaveLength(1);
    expect(f.operation.mock.calls.some(([a]) => a.p_operation === "complete")).toBe(false);
    expect(f.operation.mock.calls.at(-1)![0].p_operation).toBe("fail");
  });
  it("never retries an uncertain actual array stage", async () => {
    const f = arrayFixture(); const operation = f.operation.getMockImplementation()!;
    f.operation.mockImplementation(async args => {
      if (args.p_operation === "stage") throw new Error("unknown write outcome"); return operation(args);
    });
    await expect(runPathBNormalizationWorker(f.options)).rejects.toThrow("path_b_normalization_unavailable");
    expect(f.operation.mock.calls.filter(([a]) => a.p_operation === "stage")).toHaveLength(1);
    expect(f.operation.mock.calls.filter(([a]) => a.p_operation === "fail")).toHaveLength(1);
    expect(f.operation.mock.calls.some(([a]) => a.p_operation === "complete")).toBe(false);
  });
});
