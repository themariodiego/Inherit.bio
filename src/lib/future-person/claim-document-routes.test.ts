import crypto from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  objects: new Map<string, Uint8Array>(),
  uploads: [] as { key: string; upsert: unknown }[],
  removed: [] as string[][],
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    rpc: mocks.rpc,
    storage: {
      from: (bucket: string) => {
        if (bucket !== "future-person-identity") throw new Error(`unexpected bucket ${bucket}`);
        return {
          upload: async (key: string, bytes: Uint8Array, options: { upsert?: unknown }) => {
            mocks.uploads.push({ key, upsert: options.upsert });
            if (mocks.objects.has(key)) return { data: null, error: { message: "exists" } };
            mocks.objects.set(key, new Uint8Array(bytes));
            return { data: { path: key }, error: null };
          },
          download: async (key: string) => {
            const value = mocks.objects.get(key);
            return value ? { data: new Blob([new Uint8Array(value)]), error: null } : { data: null, error: { message: "missing" } };
          },
          remove: async (keys: string[]) => {
            mocks.removed.push(keys);
            for (const key of keys) mocks.objects.delete(key);
            return { data: [], error: null };
          },
        };
      },
    },
  }),
}));

const BYOK = crypto.randomBytes(32).toString("base64");
vi.stubEnv("BYOK_ENCRYPTION_KEY", BYOK);
const documents = await import("@/app/api/future-person/claim/session/documents/route");
const chunks = await import("@/app/api/evidence/[session]/chunks/[sequence]/route");
const completion = await import("@/app/api/evidence/[session]/complete/route");
const { CLAIM_SESSION_COOKIE, sha256Hex } = await import("./claim-session");
const { EVIDENCE_COOKIE, evidenceCompleteNonce, evidenceCsrf, mintClaimDocumentNonce } = await import("./evidence-session");
const { encryptSecret } = await import("@/lib/crypto");
const { openDocumentBytes } = await import("./document-envelope");

const ORIGIN = "https://inherit.bio";
const SESSION = "44444444-4444-4444-8444-444444444444";
const INTAKE = "11111111-1111-4111-8111-111111111111";
const DOCUMENT = "22222222-2222-4222-8222-222222222222";
const CLAIM_COOKIE_VALUE = crypto.randomBytes(32).toString("base64url");
const EVIDENCE_COOKIE_VALUE = crypto.randomBytes(32).toString("base64url");
const EVIDENCE_HASH = sha256Hex(EVIDENCE_COOKIE_VALUE);
const RAW_KEY = crypto.randomBytes(32);
const WRAPPED = encryptSecret(RAW_KEY.toString("base64")).toString("hex");
const PDF = Buffer.concat([Buffer.from("%PDF-1.4\n"), crypto.randomBytes(5000)]);
const sha = (bytes: Uint8Array) => crypto.createHash("sha256").update(bytes).digest("hex");

beforeEach(() => {
  vi.stubEnv("BYOK_ENCRYPTION_KEY", BYOK);
  vi.stubEnv("INHERIT_TEST_JURISDICTION", "1");
  mocks.rpc.mockReset();
  mocks.objects.clear();
  mocks.uploads.length = 0;
  mocks.removed.length = 0;
});
afterEach(() => vi.unstubAllEnvs());

function headersFor(extra: Record<string, string | null>, contentType: string) {
  const base: Record<string, string | null> = {
    origin: ORIGIN, "sec-fetch-site": "same-origin", "content-type": contentType, ...extra,
  };
  return Object.fromEntries(Object.entries(base).filter((entry): entry is [string, string] => entry[1] !== null));
}

describe("POST /api/future-person/claim/session/documents", () => {
  const body = (nonce: string, extra: Record<string, unknown> = {}) => JSON.stringify({
    documentKind: "future-photo-identity", mediaType: "application/pdf", sizeBytes: PDF.length, sha256: sha(PDF), nonce, ...extra,
  });
  const post = (payload: string, headers: Record<string, string | null> = {}) =>
    documents.POST(new Request(`${ORIGIN}/api/future-person/claim/session/documents`, {
      method: "POST", body: payload,
      headers: headersFor({ cookie: `${CLAIM_SESSION_COOKIE}=${CLAIM_COOKIE_VALUE}`, ...headers }, "application/json"),
    }));

  it("opens one evidence session and returns its credentials only in headers", async () => {
    mocks.rpc.mockResolvedValue({ data: { status: "open", session: SESSION, documentKind: "future-photo-identity",
      expiresAt: "2026-09-29T12:00:00+00:00" }, error: null });
    const response = await post(body(mintClaimDocumentNonce(CLAIM_COOKIE_VALUE)!));
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({
      session: SESSION, documentKind: "future-photo-identity", chunkBytes: 4_000_000, maximumChunks: 5,
      maximumDocumentBytes: 20_000_000, chunkRoute: `/api/evidence/${SESSION}/chunks/{sequence}`,
      completeRoute: `/api/evidence/${SESSION}/complete`, expiresAt: "2026-09-29T12:00:00.000Z",
    });
    const args = mocks.rpc.mock.calls[0]![1] as Record<string, unknown>;
    expect(mocks.rpc.mock.calls[0]![0]).toBe("open_claim_document_session_v1");
    expect(args.p_claim_session_hash).toBe(sha256Hex(CLAIM_COOKIE_VALUE));
    const cookie = response.headers.getSetCookie()[0]!;
    expect(cookie).toMatch(new RegExp(`^${EVIDENCE_COOKIE}=[A-Za-z0-9_-]{43}; Path=/; Max-Age=\\d+; HttpOnly; SameSite=Strict$`));
    const secret = cookie.slice(cookie.indexOf("=") + 1, cookie.indexOf(";"));
    expect(args.p_cookie_hash).toBe(sha256Hex(secret));
    expect(JSON.stringify(args)).not.toContain(secret);
    expect(response.headers.get("x-inherit-csrf")).toBe(evidenceCsrf(SESSION, sha256Hex(secret)));
    expect(response.headers.get("x-inherit-complete-nonce")).toBe(evidenceCompleteNonce(SESSION, sha256Hex(secret)));
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });

  it.each([
    ["a field the register forbids", { objectPath: "x" }],
    ["a claim id", { claimId: INTAKE }],
    ["a kind outside the claim kinds", { documentKind: "appeal-photo-identity" }],
    ["a GIF", { mediaType: "image/gif" }],
    ["a document over 20,000,000 bytes", { sizeBytes: 20_000_001 }],
  ])("is the opaque 404 for %s, and asks the database nothing", async (_label, extra) => {
    const response = await post(body(mintClaimDocumentNonce(CLAIM_COOKIE_VALUE)!, extra));
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "not_found" });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("refuses a nonce minted for another claim session", async () => {
    const other = crypto.randomBytes(32).toString("base64url");
    expect((await post(body(mintClaimDocumentNonce(other)!))).status).toBe(404);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it.each([
    ["no claim cookie", { cookie: null }],
    ["another origin", { origin: "https://elsewhere.invalid" }],
    ["cross-site metadata", { "sec-fetch-site": "cross-site" }],
  ])("is the opaque 404 with %s", async (_label, headers) => {
    expect((await post(body(mintClaimDocumentNonce(CLAIM_COOKIE_VALUE)!), headers)).status).toBe(404);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("is closed where claims are not open", async () => {
    vi.stubEnv("INHERIT_TEST_JURISDICTION", "");
    expect((await post(body(mintClaimDocumentNonce(CLAIM_COOKIE_VALUE)!))).status).toBe(404);
  });

  it("answers a claim at its limit with the shared 429 and no cookie", async () => {
    mocks.rpc.mockResolvedValue({ data: { status: "capacity_limited" }, error: null });
    const response = await post(body(mintClaimDocumentNonce(CLAIM_COOKIE_VALUE)!));
    expect(response.status).toBe(429);
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it.each(["42501", "23505", "22023"])("maps database refusal %s to the opaque 404", async (code) => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code } });
    expect((await post(body(mintClaimDocumentNonce(CLAIM_COOKIE_VALUE)!))).status).toBe(404);
  });
});

describe("PUT /api/evidence/[session]/chunks/[sequence]", () => {
  const OBJECT = `${INTAKE}/${DOCUMENT}/55555555-5555-4555-8555-555555555555`;
  const put = (bytes: Uint8Array, sequence = "0", headers: Record<string, string | null> = {}, session = SESSION) =>
    chunks.PUT(new Request(`${ORIGIN}/api/evidence/${session}/chunks/${sequence}`, {
      method: "PUT", body: new Uint8Array(bytes),
      headers: headersFor({ cookie: `${EVIDENCE_COOKIE}=${EVIDENCE_COOKIE_VALUE}`,
        "x-inherit-csrf": evidenceCsrf(session, EVIDENCE_HASH), ...headers }, "application/octet-stream"),
    }), { params: Promise.resolve({ session, sequence }) });

  it("seals the chunk under the claim key and writes it create-only where the database says", async () => {
    mocks.rpc.mockImplementation(async (name: string) => name === "reserve_claim_document_chunk_v1"
      ? { data: { status: "reserved", objectKey: OBJECT, wrappedDataKey: WRAPPED }, error: null }
      : { data: "written", error: null });
    const response = await put(PDF);
    expect(response.status).toBe(204);
    expect(mocks.rpc.mock.calls[0]).toEqual(["reserve_claim_document_chunk_v1", {
      p_session_id: SESSION, p_cookie_hash: EVIDENCE_HASH, p_sequence: 0, p_byte_count: PDF.length, p_sha256: sha(PDF),
    }]);
    expect(mocks.uploads).toEqual([{ key: OBJECT, upsert: false }]);
    const stored = mocks.objects.get(OBJECT)!;
    expect(Buffer.from(stored).includes(PDF.subarray(0, 32))).toBe(false);
    expect(openDocumentBytes(RAW_KEY, OBJECT, stored)?.equals(PDF)).toBe(true);
    expect(mocks.rpc.mock.calls[1]).toEqual(["settle_claim_document_chunk_v1", {
      p_session_id: SESSION, p_cookie_hash: EVIDENCE_HASH, p_sequence: 0, p_written: true }]);
  });

  it.each([
    ["no CSRF header", { "x-inherit-csrf": null }],
    ["another session's CSRF", { "x-inherit-csrf": evidenceCsrf("66666666-6666-4666-8666-666666666666", EVIDENCE_HASH) }],
    ["no evidence cookie", { cookie: null }],
    ["an encoded body", { "content-encoding": "gzip" }],
    ["JSON", { "content-type": "application/json" }],
    ["another origin", { origin: "https://elsewhere.invalid" }],
  ])("is the opaque 404 with %s, and asks the database nothing", async (_label, headers) => {
    expect((await put(PDF, "0", headers)).status).toBe(404);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it.each(["5", "01", "-1", "x"])("refuses sequence %s", async (sequence) => {
    expect((await put(PDF, sequence)).status).toBe(404);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("answers a chunk over 4,000,000 bytes with 413 and ends the session", async () => {
    mocks.rpc.mockResolvedValue({ data: { status: "invalid" }, error: null });
    const response = await put(new Uint8Array(4_000_001));
    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({ error: "chunk_too_large" });
    expect((mocks.rpc.mock.calls[0]![1] as Record<string, unknown>).p_byte_count).toBe(4_000_001);
    expect(mocks.uploads).toEqual([]);
  });

  it("answers a sequence written before with a closed issue", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: "23505" } });
    const response = await put(PDF);
    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({ error: "invalid_document_chunk", issues: ["sequence"] });
  });

  it("reports a failed write to the database, which ends the session", async () => {
    mocks.objects.set(OBJECT, new Uint8Array([1]));
    mocks.rpc.mockImplementation(async (name: string) => name === "reserve_claim_document_chunk_v1"
      ? { data: { status: "reserved", objectKey: OBJECT, wrappedDataKey: WRAPPED }, error: null }
      : { data: "failed", error: null });
    expect((await put(PDF)).status).toBe(503);
    expect(mocks.rpc.mock.calls[1]![1]).toMatchObject({ p_written: false });
  });
});

describe("POST /api/evidence/[session]/complete", () => {
  const FINAL = `${INTAKE}/${DOCUMENT}/77777777-7777-4777-8777-777777777777`;
  const nonce = () => evidenceCompleteNonce(SESSION, EVIDENCE_HASH);
  const post = (payload: unknown, headers: Record<string, string | null> = {}) =>
    completion.POST(new Request(`${ORIGIN}/api/evidence/${SESSION}/complete`, {
      method: "POST", body: JSON.stringify(payload),
      headers: headersFor({ cookie: `${EVIDENCE_COOKIE}=${EVIDENCE_COOKIE_VALUE}`,
        "x-inherit-csrf": evidenceCsrf(SESSION, EVIDENCE_HASH), ...headers }, "application/json"),
    }), { params: Promise.resolve({ session: SESSION }) });

  function stage(bytes: Buffer, mediaType = "application/pdf") {
    const fragmentKey = `${INTAKE}/${DOCUMENT}/88888888-8888-4888-8888-888888888888`;
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv("aes-256-gcm", RAW_KEY, iv);
    cipher.setAAD(Buffer.from(fragmentKey));
    const text = Buffer.concat([cipher.update(bytes), cipher.final()]);
    mocks.objects.set(fragmentKey, Buffer.concat([iv, cipher.getAuthTag(), text]));
    return {
      status: "compose", documentId: DOCUMENT, documentKind: "future-birth-record", mediaType, sizeBytes: bytes.length,
      sha256: sha(bytes), objectKey: FINAL, wrappedDataKey: WRAPPED,
      fragments: [{ sequence: 0, objectKey: fragmentKey, byteCount: bytes.length, sha256: sha(bytes) }],
    };
  }

  it("composes, quarantines, deletes the fragments, and says only that the document is being scanned", async () => {
    const plan = stage(PDF);
    mocks.rpc.mockImplementation(async (name: string) => {
      if (name === "begin_claim_document_completion_v1") return { data: plan, error: null };
      if (name === "finish_claim_document_completion_v1") {
        return { data: { status: "scanning", documentId: DOCUMENT, documentKind: "future-birth-record" }, error: null };
      }
      return { data: 1, error: null };
    });
    const response = await post({ chunkCount: 1, nonce: nonce() });
    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ status: "scanning" });
    expect(response.headers.get("retry-after")).toBe("5");
    expect(openDocumentBytes(RAW_KEY, FINAL, mocks.objects.get(FINAL)!)?.equals(PDF)).toBe(true);
    expect(mocks.rpc.mock.calls.map((call) => call[0])).toEqual([
      "begin_claim_document_completion_v1", "finish_claim_document_completion_v1", "confirm_claim_document_objects_deleted_v1",
    ]);
    expect(mocks.rpc.mock.calls[0]![1]).toMatchObject({ p_complete_nonce_hash: sha256Hex(nonce()), p_chunk_count: 1 });
    expect(mocks.rpc.mock.calls[1]![1]).toMatchObject({ p_outcome: "composed", p_object_key: FINAL });
    expect(mocks.removed).toEqual([[plan.fragments[0]!.objectKey]]);
  });

  it("records a type mismatch and returns the closed refusal", async () => {
    const plan = stage(PDF, "image/png");
    mocks.rpc.mockImplementation(async (name: string) => name === "begin_claim_document_completion_v1"
      ? { data: plan, error: null }
      : { data: { status: "refused", reason: "type" }, error: null });
    const response = await post({ chunkCount: 1, nonce: nonce() });
    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({ error: "document_refused", reason: "type" });
    expect(mocks.rpc.mock.calls[1]![1]).toMatchObject({ p_outcome: "type", p_object_key: null });
    expect(mocks.objects.has(FINAL)).toBe(false);
  });

  it("says review_pending only once the database has a clean verdict", async () => {
    mocks.rpc.mockResolvedValue({ data: { status: "review_pending", documentId: DOCUMENT,
      documentKind: "future-birth-record" }, error: null });
    const response = await post({ chunkCount: 1, nonce: nonce() });
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ documentId: DOCUMENT, documentKind: "future-birth-record", status: "review_pending" });
  });

  it.each(["infected", "unscannable", "oversize"])("passes on the %s refusal as one closed reason", async (reason) => {
    mocks.rpc.mockResolvedValue({ data: { status: "refused", reason }, error: null });
    const response = await post({ chunkCount: 1, nonce: nonce() });
    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({ error: "document_refused", reason });
  });

  it("refuses a completion nonce for another session", async () => {
    expect((await post({ chunkCount: 1, nonce: evidenceCompleteNonce(SESSION, sha256Hex("other")) })).status).toBe(404);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("names invalid fields, never values", async () => {
    const response = await post({ chunkCount: 9, nonce: nonce(), path: "x" });
    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({ error: "invalid_request", issues: ["body", "chunkCount"] });
  });
});
