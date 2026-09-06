import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), getUser: vi.fn(), getClaims: vi.fn(),
  copy: vi.fn(), remove: vi.fn(), info: vi.fn(), fetch: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc: mocks.rpc,
  storage: { from: () => mocks } }) }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: mocks }) }));
import { finalizeSubjectUpload } from "./subject-finalization";
import { INGEST_CHUNK_MAXIMUM_BYTES } from "../genome/ingest-limits";

const accountId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const sessionId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const uploadId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const claim = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const stagingKey = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const finalKey = "ffffffff-ffff-4fff-8fff-ffffffffffff";
const fileId = "11111111-1111-4111-8111-111111111111";
const objectId = "22222222-2222-4222-8222-222222222222";
const vcf = "##fileformat=VCFv4.2\n#CHROM\tPOS\tID\tREF\tALT\tQUAL\tFILTER\tINFO\tFORMAT\tPRIVATE_SAMPLE\n";
const row = "opaque\topaque\topaque\topaque\topaque\topaque\topaque\topaque\topaque\topaque\n";
const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
let source: Buffer, copiedBytes: Buffer | undefined;
let manifest: { status: string; uploadId: string; claim: string; bucket: string; stagingKey: string;
  finalKey: string; expectedSize: number; expectedSha256: string | null; declaredFormat: string; maximumDecodedBytes: number };
const receipt = { fileId, status: "finalized_ready_for_processing", analysisState: "ready_for_processing",
  next: { routeId: "api.file-process", operation: "process" } };
const args = { p_account_id: accountId, p_session_id: sessionId, p_upload_id: uploadId, p_claim: claim };
function setSource(bytes: Buffer, declaredFormat = "VCF") {
  source = bytes; manifest.expectedSize = bytes.length; manifest.expectedSha256 = hash(bytes);
  manifest.declaredFormat = declaredFormat;
}
function request(body?: string, headers: Record<string, string> = {}) {
  return new Request(`https://inherit.bio/api/files/${uploadId}/finalize`, { method: "POST", body,
    headers: { origin: "https://inherit.bio", "sec-fetch-site": "same-origin", ...headers } });
}
function send(req = request()) { return finalizeSubjectUpload(req, uploadId); }
function rpc(name: string) {
  if (name === "begin_own_upload_finalization_v1" || name === "authorize_own_upload_finalization_v1") return { data: manifest, error: null };
  if (name === "complete_own_upload_finalization_v1") return { data: receipt, error: null };
  if (name === "abort_own_upload_finalization_v1") return { data: { bucket: "genomes", stagingKey, finalKey }, error: null };
  if (name === "ack_own_upload_finalization_cleanup_v1") return { data: true, error: null };
  throw new Error(`Unexpected RPC: ${name}`);
}
function served(url: string, options: RequestInit) {
  const range = new Headers(options.headers).get("range")!;
  const [, first, last] = /^bytes=(\d+)-(\d+)$/.exec(range)!;
  const bytes = url.endsWith(finalKey) ? copiedBytes ?? source : source;
  return new Response(new Uint8Array(bytes.subarray(+first, +last + 1)), { status: 206,
    headers: { "content-range": `bytes ${first}-${last}/${manifest.expectedSize}` } });
}
beforeEach(() => {
  vi.resetAllMocks(); vi.stubGlobal("fetch", mocks.fetch);
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://storage.example.test");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "synthetic-service-key");
  copiedBytes = undefined;
  manifest = { status: "authorized", uploadId, claim, bucket: "genomes", stagingKey, finalKey,
    expectedSize: 1, expectedSha256: null, declaredFormat: "VCF", maximumDecodedBytes: 20_000_000 };
  setSource(Buffer.from(vcf + row));
  mocks.getUser.mockResolvedValue({ data: { user: { id: accountId } } });
  mocks.getClaims.mockResolvedValue({ data: { claims: { sub: accountId, session_id: sessionId } } });
  mocks.rpc.mockImplementation(async name => rpc(name));
  mocks.copy.mockResolvedValue({ data: {}, error: null });
  mocks.remove.mockResolvedValue({ data: [], error: null });
  mocks.info.mockResolvedValue({ data: { id: objectId }, error: null });
  mocks.fetch.mockImplementation(async (url, options) => served(url, options));
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe("subject finalization API boundary", () => {
  it("returns only the canonical receipt, independently hashes both objects and enqueues no work", async () => {
    const response = await send();
    expect(response.status).toBe(200); expect(await response.json()).toEqual(receipt);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(mocks.copy).toHaveBeenCalledExactlyOnceWith(stagingKey, finalKey);
    expect(mocks.remove).toHaveBeenCalledExactlyOnceWith([stagingKey]);
    expect(mocks.rpc).toHaveBeenCalledWith("complete_own_upload_finalization_v1", { ...args,
      p_storage_object_id: objectId, p_raw_sha256: hash(source), p_decoded_sha256: hash(source) });
    expect(mocks.fetch).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(mocks.rpc.mock.calls)).not.toContain("PRIVATE_SAMPLE");
    expect(mocks.rpc.mock.calls.every(([name]) => /^(begin|authorize|complete)_own_upload_finalization_v1$/.test(name))).toBe(true);
  });
  it("uses bounded authenticated ranges for every byte of the source and the fresh copy", async () => {
    setSource(Buffer.from(vcf + row.repeat(Math.ceil(INGEST_CHUNK_MAXIMUM_BYTES / row.length) + 1)));
    expect((await send()).status).toBe(200);
    expect(mocks.fetch).toHaveBeenCalledTimes(4);
    for (const [url, options] of mocks.fetch.mock.calls) {
      expect([stagingKey, finalKey]).toContain(new URL(url).pathname.split("/").at(-1));
      const headers = new Headers(options.headers);
      expect(headers.get("authorization")).toBe("Bearer synthetic-service-key");
      const [, start, end] = /^bytes=(\d+)-(\d+)$/.exec(headers.get("range")!)!;
      expect(+end - +start + 1).toBeLessThanOrEqual(INGEST_CHUNK_MAXIMUM_BYTES);
      expect(options).toMatchObject({ cache: "no-store", redirect: "error" });
    }
  });
  it("records distinct raw and decoded hashes for gzip without persisting its sample label", async () => {
    const decoded = Buffer.from(vcf + row); setSource(gzipSync(decoded), "VCF.GZ");
    expect((await send()).status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith("complete_own_upload_finalization_v1", { ...args,
      p_storage_object_id: objectId, p_raw_sha256: hash(source), p_decoded_sha256: hash(decoded) });
  });
  it.each(["{}", "null", " "])("forbids any request body: %j", async body => {
    expect((await send(request(body))).status).toBe(422); expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it.each(["origin", "sec-fetch-site"])("rejects invalid %s before identity or data access", async name => {
    expect((await send(request(undefined, { [name]: "cross-origin" }))).status).toBe(403);
    expect(mocks.getUser).not.toHaveBeenCalled(); expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("rejects query strings and non-UUID upload ids", async () => {
    const req = request();
    expect((await send(new Request(req.url + "?key=foreign", req))).status).toBe(422);
    expect((await finalizeSubjectUpload(request(), "../foreign")).status).toBe(422);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("rejects a user/claims mismatch and normalizes authentication outages", async () => {
    mocks.getClaims.mockResolvedValueOnce({ data: { claims: { sub: fileId, session_id: sessionId } } });
    expect((await send()).status).toBe(401);
    mocks.getUser.mockRejectedValueOnce(new Error("private auth detail"));
    const res = await send(); expect(res.status).toBe(503); expect(await res.json()).toEqual({ error: "unavailable" });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it.each([["42501", 404], ["XX000", 503]])("distinguishes refusal from unavailable storage authority (%s)", async (code, status) => {
    mocks.rpc.mockResolvedValueOnce({ error: { code, message: "private detail" }, data: null });
    expect((await send()).status).toBe(status); expect(mocks.fetch).not.toHaveBeenCalled();
  });
  it("replays an already-completed receipt without copying or deleting anything", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: { status: "complete", fileId }, error: null });
    const response = await send(); expect(await response.json()).toEqual(receipt);
    expect(mocks.fetch).not.toHaveBeenCalled(); expect(mocks.remove).not.toHaveBeenCalled();
  });
  it.each([{ finalKey: stagingKey }, { uploadId: fileId }, { sample: "not-allowed" }])("refuses invalid manifests before object access", async patch => {
    mocks.rpc.mockResolvedValueOnce({ data: { ...manifest, ...patch }, error: null });
    expect((await send()).status).toBe(503); expect(mocks.fetch).not.toHaveBeenCalled();
    expect(mocks.remove).not.toHaveBeenCalled();
  });
});

describe("finalization failure and cleanup boundaries", () => {
  it.each([
    ["pdf_not_data", 415, "%PDF-1.7\n"], ["unrecognised_format", 415, "a laboratory report"],
    ["subject_source_not_single_sample", 422, vcf + row + vcf + row],
  ])("cleans invalid input (%s) before returning a closed rejection", async (error, status, text) => {
    setSource(Buffer.from(text)); const response = await send();
    expect(response.status).toBe(status); expect(await response.json()).toEqual(error === "subject_source_not_single_sample"
      ? { error, messageCopyId: "upload.subject.single-sample-required" } : { error });
    expect(mocks.copy).not.toHaveBeenCalled();
    expect(mocks.remove).toHaveBeenCalledExactlyOnceWith([stagingKey, finalKey]);
    expect(mocks.rpc).toHaveBeenCalledWith("ack_own_upload_finalization_cleanup_v1", args);
    expect(mocks.rpc.mock.calls.some(([name]) => name === "complete_own_upload_finalization_v1")).toBe(false);
  });
  it.each(["source", "copy"])("rejects a mismatched %s hash without publishing a file", async which => {
    if (which === "source") manifest.expectedSha256 = "0".repeat(64);
    else copiedBytes = Buffer.from(source.toString().replace("opaque", "mutate"));
    const response = await send(); expect(response.status).toBe(422);
    expect(await response.json()).toEqual({ error: "upload_integrity_mismatch" });
    expect(mocks.remove).toHaveBeenCalledWith([stagingKey, finalKey]);
    expect(mocks.rpc.mock.calls.some(([name]) => name === "complete_own_upload_finalization_v1")).toBe(false);
  });
  it("bounds decompression and cleans a refused archive", async () => {
    setSource(gzipSync(Buffer.from(vcf + row)), "VCF.GZ"); manifest.maximumDecodedBytes = 40;
    expect((await send()).status).toBe(413); expect(mocks.copy).not.toHaveBeenCalled();
    expect(mocks.remove).toHaveBeenCalledWith([stagingKey, finalKey]);
  });
  it.each([1, 2, 3, 4, 5])("stops and cleans on authority revocation at recheck %s", async at => {
    let seen = 0;
    mocks.rpc.mockImplementation(async name => name === "authorize_own_upload_finalization_v1" && ++seen === at
      ? { error: { code: "42501" }, data: null } : rpc(name));
    expect((await send()).status).toBe(503);
    expect(mocks.rpc.mock.calls.some(([name]) => name === "complete_own_upload_finalization_v1")).toBe(false);
    expect(mocks.remove).toHaveBeenCalledWith([stagingKey, finalKey]);
  });
  it.each([200, 404, 500])("refuses a non-range Storage response (%s)", async status => {
    mocks.fetch.mockResolvedValueOnce(new Response(new Uint8Array(source), { status }));
    expect((await send()).status).toBe(503); expect(mocks.copy).not.toHaveBeenCalled();
    expect(mocks.remove).toHaveBeenCalledWith([stagingKey, finalKey]);
  });
  it("refuses a lying Content-Range header", async () => {
    mocks.fetch.mockResolvedValueOnce(new Response(new Uint8Array(source), { status: 206,
      headers: { "content-range": `bytes 1-${source.length}/${source.length + 1}` } }));
    expect((await send()).status).toBe(503); expect(mocks.copy).not.toHaveBeenCalled();
  });
  it("treats a truncated range as an integrity failure and a network outage as unavailable", async () => {
    mocks.fetch.mockResolvedValueOnce(new Response(new Uint8Array(source.subarray(0, -1)), { status: 206,
      headers: { "content-range": `bytes 0-${source.length - 1}/${source.length}` } }));
    expect((await send()).status).toBe(422);
    mocks.fetch.mockRejectedValueOnce(new Error("private network detail"));
    const res = await send(); expect(res.status).toBe(503); expect(await res.json()).toEqual({ error: "unavailable" });
  });
  it.each(["copy", "info"] as const)("cleans after a Storage %s failure", async operation => {
    mocks[operation].mockResolvedValueOnce({ data: null, error: { message: "private detail" } });
    expect((await send()).status).toBe(503); expect(mocks.remove).toHaveBeenCalledWith([stagingKey, finalKey]);
  });
  it("retries staging deletion through the recorded abort path", async () => {
    mocks.remove.mockResolvedValueOnce({ data: null, error: { message: "temporary" } });
    expect((await send()).status).toBe(503);
    expect(mocks.remove.mock.calls).toEqual([[[stagingKey]], [[stagingKey, finalKey]]]);
    expect(mocks.rpc).toHaveBeenCalledWith("ack_own_upload_finalization_cleanup_v1", args);
  });
  it("does not claim cleanup succeeded if deletion fails", async () => {
    setSource(Buffer.from("%PDF-1.7\n")); mocks.remove.mockResolvedValue({ error: { message: "unavailable" }, data: null });
    expect((await send()).status).toBe(503);
    expect(mocks.rpc.mock.calls.some(([name]) => name === "ack_own_upload_finalization_cleanup_v1")).toBe(false);
  });
  it("never deletes the final file after an uncertain committed response when abort is refused", async () => {
    mocks.rpc.mockImplementation(async name => ["complete_own_upload_finalization_v1", "abort_own_upload_finalization_v1"].includes(name)
      ? { error: { code: "XX000", message: "response lost" }, data: null } : rpc(name));
    expect((await send()).status).toBe(503);
    expect(mocks.remove).toHaveBeenCalledExactlyOnceWith([stagingKey]);
  });
  it("does not follow a cleanup response to another object's key", async () => {
    setSource(Buffer.from("%PDF-1.7\n"));
    mocks.rpc.mockImplementation(async name => name === "abort_own_upload_finalization_v1"
      ? { data: { bucket: "genomes", stagingKey: fileId, finalKey }, error: null } : rpc(name));
    expect((await send()).status).toBe(503); expect(mocks.remove).not.toHaveBeenCalled();
  });
});
