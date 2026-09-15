import { createHash } from "node:crypto";
import { createSHA256 } from "hash-wasm";
import { gzipSync } from "node:zlib";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), getUser: vi.fn(), getClaims: vi.fn(),
  copy: vi.fn(), remove: vi.fn(), info: vi.fn(), fetch: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc: mocks.rpc,
  storage: { from: () => mocks } }) }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: mocks }) }));
import { finalizeSubjectUpload, finalizeSubjectUploadV2 } from "./subject-finalization";
import { INGEST_CHUNK_MAXIMUM_BYTES } from "../genome/ingest-limits";
import { finishStagedUpload } from "./subject-upload-browser";

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
function send(req = request()) { return finalizeSubjectUploadV2(req, uploadId); }
/** The durable progress record, modelled the way the database keeps it. */
let stored: { revision: number; checkpoint: unknown };
let leaseUntil: number, activeClaim: string | null, attempt: number, terminal: boolean;
const denied = () => ({ data: null, error: { code: "42501" } });
function checkpointReceipt() {
  return { data: { version: "own-upload-finalization-checkpoint-receipt-v1", uploadId,
    revision: stored.revision, leaseExpiresAt: null, checkpoint: stored.checkpoint }, error: null };
}
// Transport model only: the pgTAP companion proves the actual SQL fence.
function rpc(name: string, params?: Record<string, unknown>) {
  if (name === "begin_own_upload_finalization_v2") {
    if (terminal || (activeClaim && leaseUntil > Date.now())) return denied();
    activeClaim = `dddddddd-dddd-4ddd-8ddd-${String(++attempt).padStart(12, "0")}`;
    leaseUntil = Date.now() + 60_000;
    return { data: { ...manifest, claim: activeClaim }, error: null };
  }
  if (name === "begin_own_upload_finalization_v1") return { data: manifest, error: null };
  if (params?.p_claim !== activeClaim || leaseUntil <= Date.now()) return denied();
  if (name === "authorize_own_upload_finalization_v2") {
    leaseUntil = Date.now() + 60_000;
    return { data: { ...manifest, claim: activeClaim }, error: null };
  }
  if (name === "read_own_upload_finalization_checkpoint_v1") return checkpointReceipt();
  if (name === "write_own_upload_finalization_checkpoint_v1") {
    stored = { revision: (params!.p_expected_revision as number) + 1, checkpoint: params!.p_checkpoint };
    return checkpointReceipt();
  }
  if (name === "begin_own_upload_finalization_v1" || name === "authorize_own_upload_finalization_v1") return { data: manifest, error: null };
  if (name === "complete_own_upload_finalization_v1") { terminal = true; return { data: receipt, error: null }; }
  if (name === "abort_own_upload_finalization_v1") { terminal = true; return { data: { bucket: "genomes", stagingKey, finalKey }, error: null }; }
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
  stored = { revision: 0, checkpoint: null };
  activeClaim = null; attempt = 0; leaseUntil = 0; terminal = false;
  mocks.rpc.mockImplementation(async (name, params) => rpc(name, params));
  mocks.copy.mockResolvedValue({ data: {}, error: null });
  mocks.remove.mockResolvedValue({ data: [], error: null });
  mocks.info.mockResolvedValue({ data: { id: objectId }, error: null });
  mocks.fetch.mockImplementation(async (url, options) => served(url, options));
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });


function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
function expireAttempt() { leaseUntil = Date.now() - 1; }

it("the current route uses fenced finalization", async () => {
  const { POST } = await import("../../app/api/uploads/[id]/complete/route");
  expect((await POST(request(), { params: Promise.resolve({ id: uploadId }) })).status).toBe(200);
  expect(mocks.rpc).toHaveBeenCalledWith("begin_own_upload_finalization_v2", expect.objectContaining({ p_upload_id: uploadId }));
  expect(mocks.rpc.mock.calls.some(([name]) => name === "begin_own_upload_finalization_v1")).toBe(false);
});

it("keeps the browser's same-upload retry handle through an actual retryable route response", async () => {
  let interrupt = true;
  mocks.fetch.mockImplementation(async (url, options) => {
    if (url === `/api/files/${uploadId}/finalize`) {
      expect(options).toMatchObject({ method: "POST", credentials: "same-origin" });
      return send();
    }
    if (interrupt) { interrupt = false; throw new Error("synthetic transport interruption"); }
    return served(url, options);
  });
  await expect(finishStagedUpload(uploadId)).rejects.toMatchObject({ code: "unavailable", stagedUploadId: uploadId });
  expect(mocks.remove).not.toHaveBeenCalled();
  expireAttempt();
  expect(await finishStagedUpload(uploadId)).toEqual(receipt);
  expect(mocks.copy).toHaveBeenCalledExactlyOnceWith(stagingKey, finalKey);
});

it("restarts interrupted gzip validation without re-uploading or inventing progress", async () => {
  const decoded = Buffer.from(vcf + row);
  setSource(gzipSync(decoded), "VCF.GZ");
  mocks.fetch.mockRejectedValueOnce(new Error("synthetic interrupted read"));
  expect((await send()).status).toBe(503);
  expect(stored).toEqual({ revision: 0, checkpoint: null });
  expect(mocks.copy).not.toHaveBeenCalled();
  expect(mocks.remove).not.toHaveBeenCalled();
  const firstClaim = activeClaim;
  expireAttempt();
  mocks.fetch.mockClear();
  expect((await send()).status).toBe(200);
  expect(activeClaim).not.toBe(firstClaim);
  expect(mocks.fetch.mock.calls[0][0]).toContain(stagingKey);
  expect(new Headers(mocks.fetch.mock.calls[0][1].headers).get("range")).toBe(`bytes=0-${source.length - 1}`);
  expect(mocks.rpc).toHaveBeenCalledWith("complete_own_upload_finalization_v1", expect.objectContaining({
    p_raw_sha256: hash(source), p_decoded_sha256: hash(decoded), p_claim: activeClaim,
  }));
});

it("preserves a valid stored source after a short range response and retries it", async () => {
  mocks.fetch.mockResolvedValueOnce(new Response(new Uint8Array(source.subarray(0, source.length - 1)), {
    status: 206, headers: { "content-range": `bytes 0-${source.length - 1}/${source.length}` },
  }));
  expect((await send()).status).toBe(503);
  expect(mocks.remove).not.toHaveBeenCalled();
  expect(mocks.rpc.mock.calls.some(([name]) => name === "abort_own_upload_finalization_v1")).toBe(false);
  expireAttempt();
  expect((await send()).status).toBe(200);
});

it("writes a real partial digest and resumes from its exact complete-range offset after a lost acknowledgement", async () => {
  setSource(Buffer.from(vcf + row.repeat(Math.ceil(INGEST_CHUNK_MAXIMUM_BYTES / row.length) + 1)));
  let loseAck = true;
  mocks.rpc.mockImplementation(async (name, params) => {
    const result = rpc(name, params);
    if (loseAck && name === "write_own_upload_finalization_checkpoint_v1" && params.p_checkpoint.phase === "verifying") {
      loseAck = false;
      throw new Error("synthetic lost checkpoint response");
    }
    return result;
  });
  expect((await send()).status).toBe(503);
  expect(stored.checkpoint).toMatchObject({ phase: "verifying", verifiedBytes: INGEST_CHUNK_MAXIMUM_BYTES });
  const partial = stored.checkpoint as { digestState: string; verifiedBytes: number };
  const oracle = await createSHA256(); oracle.load(Buffer.from(partial.digestState, "base64"));
  oracle.update(source.subarray(partial.verifiedBytes));
  expect(oracle.digest("hex")).toBe(hash(source));
  expect(mocks.remove).not.toHaveBeenCalled();
  expect(mocks.rpc.mock.calls.some(([name]) => name === "complete_own_upload_finalization_v1")).toBe(false);
  expireAttempt(); mocks.fetch.mockClear(); mocks.copy.mockClear();
  expect((await send()).status).toBe(200);
  expect(mocks.copy).not.toHaveBeenCalled();
  expect(mocks.fetch).toHaveBeenCalledTimes(1);
  expect(mocks.fetch.mock.calls[0][0]).toContain(finalKey);
  expect(new Headers(mocks.fetch.mock.calls[0][1].headers).get("range"))
    .toBe(`bytes=${INGEST_CHUNK_MAXIMUM_BYTES}-${source.length - 1}`);
});

it("keeps a complete-range checkpoint when the browser disconnects", async () => {
  setSource(Buffer.from(vcf + row.repeat(Math.ceil(INGEST_CHUNK_MAXIMUM_BYTES / row.length) + 1)));
  const controller = new AbortController();
  mocks.rpc.mockImplementation(async (name, params) => {
    const result = rpc(name, params);
    if (name === "write_own_upload_finalization_checkpoint_v1" && params.p_checkpoint.phase === "verifying") controller.abort();
    return result;
  });
  expect((await send(new Request(request(), { signal: controller.signal }))).status).toBe(503);
  expect(stored.checkpoint).toMatchObject({ phase: "verifying", verifiedBytes: INGEST_CHUNK_MAXIMUM_BYTES });
  expect(mocks.remove).not.toHaveBeenCalled();
  expect(mocks.rpc.mock.calls.some(([name]) => name === "abort_own_upload_finalization_v1")).toBe(false);
});

it("renews ownership during a pending copy and refuses a competing request", async () => {
  vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
  const started = deferred<void>(), copying = deferred<{ data: object; error: null }>();
  mocks.copy.mockImplementationOnce(() => { started.resolve(); return copying.promise; });
  const first = send(); await started.promise;
  const owner = activeClaim;
  await vi.advanceTimersByTimeAsync(40_000);
  expect(leaseUntil).toBeGreaterThan(Date.now() + 50_000);
  expect((await send()).status).toBe(404);
  expect(activeClaim).toBe(owner);
  expect(mocks.copy).toHaveBeenCalledTimes(1);
  copying.resolve({ data: {}, error: null });
  expect((await first).status).toBe(200);
  const renewalCount = mocks.rpc.mock.calls.filter(([name]) => name === "authorize_own_upload_finalization_v2").length;
  await vi.advanceTimersByTimeAsync(60_000);
  expect(mocks.rpc.mock.calls.filter(([name]) => name === "authorize_own_upload_finalization_v2")).toHaveLength(renewalCount);
});

it("does not let the old v1 catch path delete objects after v2 takes over", async () => {
  activeClaim = claim; leaseUntil = Date.now() + 60_000;
  const started = deferred<void>(), reading = deferred<Response>();
  mocks.fetch.mockImplementationOnce(() => { started.resolve(); return reading.promise; });
  const old = finalizeSubjectUpload(request(), uploadId); await started.promise;
  expireAttempt();
  const next = rpc("begin_own_upload_finalization_v2");
  expect(next.error).toBeNull(); expect(activeClaim).not.toBe(claim);
  reading.resolve(served(`https://storage.example.test/${stagingKey}`, { headers: { Range: `bytes=0-${source.length - 1}` } }));
  expect((await old).status).toBe(503);
  expect(mocks.rpc).toHaveBeenCalledWith("abort_own_upload_finalization_v1", args);
  expect(mocks.remove).not.toHaveBeenCalled();
  expect(terminal).toBe(false);
});

it("marks structural failure terminal before receiving cleanup keys", async () => {
  setSource(Buffer.from("%PDF-1.7\n"));
  mocks.remove.mockImplementationOnce(async () => {
    expect(terminal).toBe(true);
    expect(rpc("begin_own_upload_finalization_v2").error).not.toBeNull();
    return { data: [], error: null };
  });
  expect((await send()).status).toBe(415);
  expect(mocks.remove).toHaveBeenCalledExactlyOnceWith([stagingKey, finalKey]);
});

it("verifies a copy that completed before its checkpoint response was available", async () => {
  mocks.copy.mockResolvedValueOnce({ data: null, error: { message: "synthetic duplicate destination" } });
  expect((await send()).status).toBe(200);
  expect(mocks.fetch.mock.calls.some(([url]) => url.endsWith(finalKey))).toBe(true);
  expect(mocks.rpc).toHaveBeenCalledWith("complete_own_upload_finalization_v1", expect.objectContaining({ p_raw_sha256: hash(source) }));
});

it("does not trust an existing destination whose full hash differs", async () => {
  mocks.copy.mockResolvedValueOnce({ data: null, error: { message: "synthetic duplicate destination" } });
  copiedBytes = Buffer.from(source.toString().replace("opaque", "mutate"));
  expect((await send()).status).toBe(422);
  expect(mocks.rpc.mock.calls.some(([name]) => name === "complete_own_upload_finalization_v1")).toBe(false);
});
