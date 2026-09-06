import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), getUser: vi.fn(), getClaims: vi.fn(), fetch: vi.fn(), remove: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc: mocks.rpc, storage: { from: () => mocks } }) }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: mocks }) }));
import { normalizeSubjectFile } from "./subject-normalization";
import { INGEST_CHUNK_MAXIMUM_BYTES } from "../genome/ingest-limits";

const accountId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", sessionId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const fileId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc", claim = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const objectKey = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", objectId = "ffffffff-ffff-4fff-8fff-ffffffffffff";
const subjectId = "11111111-1111-4111-8111-111111111111";
const receipt = { fileId, status: "normalization_complete", analysisState: "not_generated" };
const cleanup = { fileId, claim, status: "build_cleanup_required", bucket: "genomes", objectKey, objectId };
const header = "##fileformat=VCFv4.2\n##reference=GRCh38\n#CHROM\tPOS\tID\tREF\tALT\tQUAL\tFILTER\tINFO\tFORMAT\tSYNTHETIC\n";
const row = "1\t100000\trs123\tA\tG\t50\tPASS\t.\tGT:GQ:DP\t0/1:50:30\n";
const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
let source: Buffer, manifest: Record<string, unknown>;
function setSource(decoded: Buffer, compressed = false) {
  source = compressed ? gzipSync(decoded) : decoded;
  manifest.sizeBytes = source.length; manifest.rawSha256 = hash(source); manifest.decodedSha256 = hash(decoded);
}
function request(body?: string, headers: Record<string, string> = {}) {
  return new Request(`https://inherit.bio/api/files/${fileId}/process`, { method: "POST", body,
    headers: { origin: "https://inherit.bio", "sec-fetch-site": "same-origin", ...headers } });
}
const send = (req = request()) => normalizeSubjectFile(req, fileId);
function operations() { return mocks.rpc.mock.calls.map(call => call[1].p_operation); }
function served(_url: string, options: RequestInit) {
  const [, first, last] = /^bytes=(\d+)-(\d+)$/.exec(new Headers(options.headers).get("range")!)!;
  return new Response(new Uint8Array(source.subarray(+first, +last + 1)), { status: 206,
    headers: { "content-range": `bytes ${first}-${last}/${source.length}` } });
}
beforeEach(() => {
  vi.resetAllMocks(); vi.stubGlobal("fetch", mocks.fetch);
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://storage.example.test");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "synthetic-service-key");
  manifest = { status: "authorized", fileId, claim, subjectId, bucket: "genomes", objectKey, objectId,
    sizeBytes: 1, rawSha256: "a".repeat(64), decodedSha256: "b".repeat(64), sourceRevision: 1,
    maximumDecodedBytes: 20_000_000, fileType: "vcf" };
  setSource(Buffer.from(header + row));
  mocks.getUser.mockResolvedValue({ data: { user: { id: accountId } } });
  mocks.getClaims.mockResolvedValue({ data: { claims: { sub: accountId, session_id: sessionId } } });
  mocks.rpc.mockImplementation(async (_name, args) => ({ data: args.p_operation === "begin" || args.p_operation === "check"
    ? manifest : args.p_operation === "complete" ? receipt : ["reject-build", "check-rejected"].includes(args.p_operation) ? cleanup : true, error: null }));
  mocks.remove.mockResolvedValue({ data: [], error: null });
  mocks.fetch.mockImplementation(async (url, options) => served(url, options));
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("store-only source normalization", () => {
  it("prepares canonical rows without an analytic purpose, analysis or mail", async () => {
    const response = await send(); expect(response.status).toBe(200); expect(await response.json()).toEqual(receipt);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(operations()).toEqual(["begin", "check", "check", "check", "stage", "stage", "complete"]);
    expect(mocks.rpc.mock.calls.every(call => call[0] === "own_upload_normalization_v1")).toBe(true);
    const variant = mocks.rpc.mock.calls.find(call => call[1].p_payload?.kind === "variants")![1].p_payload.rows[0];
    expect(variant).toEqual({ rsid: 123, chrom: 1, pos: 100000, ref: "A", alt: "G", genotype: "A/G" });
    expect(JSON.stringify(mocks.rpc.mock.calls)).not.toContain("SYNTHETIC");
    expect(JSON.stringify(mocks.rpc.mock.calls)).not.toContain("purpose");
  });
  it("independently checks compressed raw identity and decompressed identity", async () => {
    setSource(Buffer.from(header + row), true);
    expect((await send()).status).toBe(200);
    const complete = mocks.rpc.mock.calls.find(call => call[1].p_operation === "complete")![1].p_payload;
    expect(complete.rawSha256).not.toBe(complete.decodedSha256);
  });
  it("checks each bounded range on both passes and does not fetch whole objects", async () => {
    setSource(Buffer.from(header.replace("#CHROM", `##comment=${"x".repeat(INGEST_CHUNK_MAXIMUM_BYTES - 100)}\n#CHROM`) + row));
    expect((await send()).status).toBe(200);
    expect(mocks.fetch).toHaveBeenCalledTimes(4);
    for (const [, options] of mocks.fetch.mock.calls) {
      const [, first, last] = /^bytes=(\d+)-(\d+)$/.exec(new Headers(options.headers).get("range")!)!;
      expect(+last - +first + 1).toBeLessThanOrEqual(INGEST_CHUNK_MAXIMUM_BYTES);
      expect(options.cache).toBe("no-store"); expect(options.redirect).toBe("error");
    }
  });
  it("returns an idempotent preparation receipt without re-reading source", async () => {
    mocks.rpc.mockResolvedValue({ data: receipt, error: null });
    expect(await (await send()).json()).toEqual(receipt); expect(mocks.fetch).not.toHaveBeenCalled();
  });
  it.each([
    ["body", () => request("{}")], ["origin", () => request(undefined, { origin: "https://other.test" })],
    ["fetch-site", () => request(undefined, { "sec-fetch-site": "cross-site" })],
  ])("refuses %s before source access", async (_name, make) => {
    expect((await send(make())).status).toBeGreaterThanOrEqual(400); expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("requires a verified session matching the account", async () => {
    mocks.getClaims.mockResolvedValue({ data: { claims: { sub: "other", session_id: sessionId } } });
    expect((await send()).status).toBe(401); expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("cannot use a wrong file's manifest", async () => {
    manifest.fileId = subjectId;
    expect((await send()).status).toBe(503); expect(mocks.fetch).not.toHaveBeenCalled();
  });
  it("revocation stops the next range before any canonical staging", async () => {
    mocks.rpc.mockImplementation(async (_name, args) => ({ data: args.p_operation === "begin" ? manifest : null,
      error: args.p_operation === "check" ? { code: "42501" } : null }));
    expect((await send()).status).toBe(503); expect(mocks.fetch).not.toHaveBeenCalled();
    expect(operations()).toEqual(["begin", "check", "fail"]);
  });
  it("unknown build is decided before the genetic parse pass", async () => {
    setSource(Buffer.from(header.replace("##reference=GRCh38\n", "") + row));
    expect(await (await send()).json()).toEqual({ error: "build_unknown",
      next: { labelCopyId: "upload.build.ask-source", routeId: "files.upload" } });
    expect(mocks.fetch).toHaveBeenCalledTimes(1); expect(operations()).not.toContain("stage");
    expect(mocks.remove).toHaveBeenCalledExactlyOnceWith([objectKey]);
    expect(operations()).toContain("finish-rejected");
  });
  it("returns no completed build refusal while rejected-object cleanup is uncertain", async () => {
    setSource(Buffer.from(header.replace("##reference=GRCh38\n", "") + row));
    mocks.remove.mockResolvedValue({ data: null, error: { message: "provider detail" } });
    expect(await (await send()).json()).toEqual({ error: "unavailable" });
    expect(operations()).not.toContain("finish-rejected");
  });
  it("resumes only the frozen rejected object after an interrupted cleanup", async () => {
    mocks.rpc.mockImplementation(async (_name, args) => ({ data: args.p_operation === "begin" || args.p_operation === "check-rejected"
      ? cleanup : true, error: null }));
    expect((await send()).status).toBe(422); expect(mocks.fetch).not.toHaveBeenCalled();
    expect(mocks.remove).toHaveBeenCalledExactlyOnceWith([objectKey]);
  });
  it.each(["rawSha256", "decodedSha256"])("refuses changed %s with zero canonical batches", async field => {
    manifest[field] = "0".repeat(64);
    expect(await (await send()).json()).toEqual({ error: "upload_integrity_mismatch" });
    expect(operations()).not.toContain("stage");
  });
  it("enforces the server-resolved decoded ceiling for gzip", async () => {
    setSource(Buffer.from(header + row), true); manifest.maximumDecodedBytes = 10;
    expect((await send()).status).toBe(413); expect(operations()).not.toContain("stage");
  });
  it("requires exact bounded partial-content responses", async () => {
    mocks.fetch.mockResolvedValue(new Response(new Uint8Array(source), { status: 200 }));
    expect((await send()).status).toBe(503); expect(operations()).not.toContain("stage");
  });
  it("rejects an empty usable call set without creating analytic output", async () => {
    setSource(Buffer.from(header));
    expect(await (await send()).json()).toEqual({ error: "empty_after_parse" });
    expect(operations()).not.toContain("stage");
  });
  it("does not complete after a failed atomic batch", async () => {
    mocks.rpc.mockImplementation(async (_name, args) => ({ data: args.p_operation === "begin" || args.p_operation === "check" ? manifest : true,
      error: args.p_operation === "stage" ? { code: "42501" } : null }));
    expect((await send()).status).toBe(503); expect(operations()).not.toContain("complete");
    expect(operations().at(-1)).toBe("fail");
  });
  it("does not accept a report-ready completion masquerading as normalization", async () => {
    mocks.rpc.mockImplementation(async (_name, args) => ({ data: args.p_operation === "begin" || args.p_operation === "check"
      ? manifest : args.p_operation === "complete" ? { ...receipt, analysisState: "active" } : true, error: null }));
    expect((await send()).status).toBe(503);
  });
});
