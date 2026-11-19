import crypto from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The shared evidence and review doors for the reviewed-document Path B's
 * signed-permission documents (20261016190000): the chunk route seals into the
 * legal-evidence store the native session names, the review download issues
 * the decision proofs, and the download chunk route serves the permission
 * transport. TEST-LOCAL only; each closes with the flag.
 */

const mocks = vi.hoisted(() => ({
  admin: vi.fn(),
  own: vi.fn(),
  account: vi.fn(),
  objects: new Map<string, Uint8Array>(),
  buckets: [] as string[],
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/account-deletion", () => ({ getSensitiveAccountContext: () => mocks.account() }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    rpc: (name: string, args: unknown) => {
      const result = Promise.resolve(mocks.admin(name, args));
      return Object.assign(result, { retry: () => ({ abortSignal: () => result }) });
    },
    storage: {
      from: (bucket: string) => {
        mocks.buckets.push(bucket);
        return {
          upload: async (key: string, bytes: Uint8Array) => {
            if (mocks.objects.has(key)) return { data: null, error: { message: "exists" } };
            mocks.objects.set(key, new Uint8Array(bytes));
            return { data: { path: key }, error: null };
          },
          download: async (key: string) => {
            const value = mocks.objects.get(key);
            return value ? { data: new Blob([new Uint8Array(value)]), error: null } : { data: null, error: { message: "missing" } };
          },
          remove: async () => ({ data: [], error: null }),
        };
      },
    },
  }),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    rpc: (name: string, args: unknown) => {
      const result = Promise.resolve(mocks.own(name, args));
      return Object.assign(result, { retry: () => ({ abortSignal: () => result }) });
    },
  }),
}));

const BYOK = crypto.randomBytes(32).toString("base64");
vi.stubEnv("BYOK_ENCRYPTION_KEY", BYOK);
const chunks = await import("@/app/api/evidence/[session]/chunks/[sequence]/route");
const reviewDownload = await import("@/app/api/legal-evidence/[id]/review-download/route");
const downloads = await import("@/app/api/downloads/[session]/chunks/[sequence]/route");
const { sha256Hex } = await import("@/lib/future-person/claim-session");
const { EVIDENCE_COOKIE, evidenceCsrf } = await import("@/lib/future-person/evidence-session");
const { DOWNLOAD_COOKIE, readReviewNonce, reviewCsrfMatches } = await import("@/lib/future-person/review");
const { encryptSecret } = await import("@/lib/crypto");
const { openDocumentBytes, sealDocumentBytes } = await import("@/lib/future-person/document-envelope");

const ORIGIN = "https://inherit.bio";
const SESSION = "44444444-4444-4444-8444-444444444444";
const DOCUMENT = "22222222-2222-4222-8222-222222222222";
const REVIEWER = "33333333-3333-4333-8333-333333333333";
const AUTH_SESSION = "55555555-5555-4555-8555-555555555555";
const OBJECT = `permission/${SESSION}/${DOCUMENT}/66666666-6666-4666-8666-666666666666`;
const EVIDENCE_COOKIE_VALUE = crypto.randomBytes(32).toString("base64url");
const EVIDENCE_HASH = sha256Hex(EVIDENCE_COOKIE_VALUE);
const RAW_KEY = crypto.randomBytes(32);
const WRAPPED = encryptSecret(RAW_KEY.toString("base64")).toString("hex");
const PDF = Buffer.concat([Buffer.from("%PDF-1.4\n"), crypto.randomBytes(5000)]);

beforeEach(() => {
  vi.stubEnv("BYOK_ENCRYPTION_KEY", BYOK);
  vi.stubEnv("INHERIT_TEST_JURISDICTION", "1");
  mocks.admin.mockReset();
  mocks.own.mockReset();
  mocks.account.mockReset().mockResolvedValue({ user: { id: REVIEWER }, sessionId: AUTH_SESSION });
  mocks.objects.clear();
  mocks.buckets.length = 0;
});
afterEach(() => vi.unstubAllEnvs());

describe("PUT /api/evidence/[session]/chunks/[sequence] for a permission session", () => {
  const put = () => chunks.PUT(new Request(`${ORIGIN}/api/evidence/${SESSION}/chunks/0`, {
    method: "PUT", body: new Uint8Array(PDF),
    headers: { origin: ORIGIN, "sec-fetch-site": "same-origin", "content-type": "application/octet-stream",
      cookie: `${EVIDENCE_COOKIE}=${EVIDENCE_COOKIE_VALUE}`, "x-inherit-csrf": evidenceCsrf(SESSION, EVIDENCE_HASH) },
  }), { params: Promise.resolve({ session: SESSION, sequence: "0" }) });

  it("seals the chunk into the legal-evidence store the native session names", async () => {
    mocks.admin.mockImplementation(async (name: string) => name === "reserve_claim_document_chunk_v1"
      ? { data: { status: "reserved", objectKey: OBJECT, wrappedDataKey: WRAPPED, storageKind: "permission" }, error: null }
      : { data: "written", error: null });
    const response = await put();
    expect(response.status).toBe(204);
    expect(mocks.buckets).toEqual(["legal-evidence"]);
    const stored = mocks.objects.get(OBJECT)!;
    expect(Buffer.from(stored).includes(PDF.subarray(0, 32))).toBe(false);
    expect(openDocumentBytes(RAW_KEY, OBJECT, stored)?.equals(PDF)).toBe(true);
    expect(mocks.admin.mock.calls.map(([name]) => name)).toEqual(["reserve_claim_document_chunk_v1", "settle_claim_document_chunk_v1"]);
  });

  it("is the opaque 404 outside TEST-LOCAL, before the database", async () => {
    vi.stubEnv("INHERIT_TEST_JURISDICTION", "");
    expect((await put()).status).toBe(404);
    expect(mocks.admin).not.toHaveBeenCalled();
    expect(mocks.objects.size).toBe(0);
  });
});

describe("GET /api/legal-evidence/[id]/review-download for a permission document", () => {
  const open = () => reviewDownload.GET(new Request(`${ORIGIN}/api/legal-evidence/${DOCUMENT}/review-download`, {
    headers: { "sec-fetch-site": "same-origin" },
  }), { params: Promise.resolve({ id: DOCUMENT }) });
  const opened = { session: SESSION, sizeBytes: PDF.length, sha256: "a".repeat(64), chunkCount: 1,
    mediaType: "application/pdf", documentKind: "adult-signed-permission", reviewRevision: 2 };

  it("opens a revocable session and issues the next decision nonce, its CSRF and the review revision", async () => {
    mocks.own.mockImplementation((name: string) => name === "review_document_domain_v1"
      ? { data: "permission", error: null } : { data: opened, error: null });
    const response = await open();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ session: SESSION, filename: "signed-permission.pdf", sizeBytes: PDF.length,
      sha256: "a".repeat(64), chunkBytes: 4_000_000, chunkCount: 1, chunkRoute: `/api/downloads/${SESSION}/chunks/{sequence}` });
    expect(response.headers.get("set-cookie")).toContain(`${DOWNLOAD_COOKIE}=`);
    expect(reviewCsrfMatches(response.headers.get("x-inherit-csrf"), DOCUMENT, REVIEWER, AUTH_SESSION)).toBe(true);
    expect(readReviewNonce(response.headers.get("x-inherit-review-nonce")!, DOCUMENT, REVIEWER, AUTH_SESSION)).not.toBeNull();
    expect(response.headers.get("x-inherit-review-revision")).toBe("2");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    const [, args] = mocks.own.mock.calls[1]!;
    expect(args).toEqual({ p_document_id: DOCUMENT, p_cookie_hash: expect.stringMatching(/^[0-9a-f]{64}$/) });
  });

  it("issues no decision proof for a session the database does not tie to a review revision", async () => {
    const { reviewRevision: _revision, ...withoutRevision } = opened;
    expect(_revision).toBe(2);
    mocks.own.mockImplementation((name: string) => name === "review_document_domain_v1"
      ? { data: "permission", error: null } : { data: withoutRevision, error: null });
    const response = await open();
    expect(response.status).toBe(503);
    expect(response.headers.get("x-inherit-review-nonce")).toBeNull();
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("answers not-found when the document kind and domain disagree, and outside TEST-LOCAL", async () => {
    mocks.own.mockImplementation((name: string) => name === "review_document_domain_v1"
      ? { data: "permission", error: null } : { data: { ...opened, documentKind: "future-photo-identity" }, error: null });
    expect((await open()).status).toBe(404);
    vi.stubEnv("INHERIT_TEST_JURISDICTION", "");
    mocks.own.mockClear();
    expect((await open()).status).toBe(404);
    expect(mocks.own).not.toHaveBeenCalled();
  });
});

describe("GET /api/downloads/[session]/chunks/[sequence] for the permission transport", () => {
  const COOKIE = crypto.randomBytes(32).toString("base64url");
  const get = () => downloads.GET(new Request(`${ORIGIN}/api/downloads/${SESSION}/chunks/0`, {
    headers: { "sec-fetch-site": "same-origin", cookie: `${DOWNLOAD_COOKIE}=${COOKIE}` },
  }), { params: Promise.resolve({ session: SESSION, sequence: "0" }) });

  it("opens the sealed bytes from the legal-evidence store and reauthorizes before release", async () => {
    mocks.objects.set(OBJECT, sealDocumentBytes(RAW_KEY, OBJECT, PDF));
    const grant = { objectKey: OBJECT, sha256: crypto.createHash("sha256").update(PDF).digest("hex"), byteCount: PDF.length,
      wrappedDataKey: WRAPPED, transport: "permission" };
    mocks.own.mockImplementation(() => ({ data: grant, error: null }));
    const response = await get();
    expect(response.status).toBe(200);
    expect(Buffer.from(await response.arrayBuffer()).equals(PDF)).toBe(true);
    expect(mocks.buckets).toEqual(["legal-evidence"]);
    expect(mocks.own.mock.calls.map(([name]) => name)).toEqual(["authorize_claim_review_chunk_v1", "authorize_claim_review_chunk_v1"]);
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
  });

  it("serves nothing when the review authorizer does not know the session and no other kind claims it", async () => {
    mocks.own.mockImplementation(() => ({ data: null, error: { code: "42501" } }));
    mocks.admin.mockImplementation(async () => ({ data: null, error: null }));
    const response = await get();
    expect(response.status).toBe(404);
    expect(mocks.buckets).toEqual([]);
    // The subject-original dispatcher was asked, under its own authority, and declined.
    expect(mocks.admin.mock.calls.map(([name]) => name)).toEqual(["authorize_subject_original_chunk_v1"]);
  });
});
