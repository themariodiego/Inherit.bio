import crypto from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), getUser: vi.fn(), getClaims: vi.fn(), codes: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc: mocks.rpc }) }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: mocks }) }));
vi.mock("@/lib/legal/jurisdictions", async (original) => {
  const actual = await original<typeof import("@/lib/legal/jurisdictions")>();
  return { ...actual, accountCapability: (id: string, capability: string) => mocks.codes(id, capability) };
});

import { encryptSecret } from "@/lib/crypto";
import { legacyContactDigest } from "@/lib/hmac-keyring";
import { mintPathBDraftNonce, mintPathBOperation } from "./other-adult-upload-server";
import {
  createPathBReviewedDocumentDraft,
  finalizeCsrf,
  finalizeReviewedDocumentSubject,
  mintReviewedDocumentOperation,
  openLegalEvidenceUploadSession,
  readReviewedDocumentOperation,
  reviewedDocumentTokens,
} from "./path-b-reviewed-document-server";

const accountId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const sessionId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const subjectId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const documentId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const reviewId = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const requestId = "ffffffff-ffff-4fff-8fff-ffffffffffff";
const evidenceSession = "11111111-1111-4111-8111-111111111111";
const KEY_2 = crypto.randomBytes(32).toString("base64");
const ADDRESS = "relative@e2e.local";

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("BYOK_ENCRYPTION_KEY", crypto.randomBytes(32).toString("base64"));
  vi.stubEnv("INHERIT_TEST_JURISDICTION", "1");
  vi.stubEnv("INHERIT_HMAC_KEYRING", `2:${KEY_2}`);
  mocks.getUser.mockResolvedValue({ data: { user: { id: accountId } } });
  mocks.getClaims.mockResolvedValue({ data: { claims: { sub: accountId, session_id: sessionId } } });
  mocks.codes.mockResolvedValue({ status: "permitted" });
});
afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers(); });

function post(url: string, body: unknown, headers: Record<string, string> = {}) {
  return new Request(url, { method: "POST", body: JSON.stringify(body),
    headers: { origin: "https://inherit.bio", "sec-fetch-site": "same-origin", "content-type": "application/json", ...headers } });
}

/** The address under every held contact revision, never one bare digest or the address itself. */
function expectContactSet(set: unknown) {
  const digests = set as Record<string, string>;
  expect(Object.keys(digests)).toEqual(["1", "2"]);
  expect(digests["1"]).toBe(legacyContactDigest(ADDRESS));
  expect(digests["2"]).toMatch(/^[0-9a-f]{64}$/);
}

describe("POST /api/subject-drafts, the reviewed-document body", () => {
  const body = { kind: "adult", adultFlow: "path-b-reviewed-document", displayName: "Synthetic Relative",
    dateOfBirth: "1980-05-05", contactEmail: "Relative@E2E.local", requestId };
  const receipt = { subjectDraftId: subjectId, state: "awaiting_uploader_artifact", next: "sign_uploader_artifact",
    expiresAt: "2026-11-15T12:00:00+00:00" };
  // 20261023130000 (G5.6): the page renders a one-time draft nonce.
  function draft(overrides: Record<string, unknown> = {}, headers: Record<string, string> = {}, token = mintPathBDraftNonce(accountId, sessionId)) {
    const payload = { ...body, ...overrides };
    return createPathBReviewedDocumentDraft(post("https://inherit.bio/api/subject-drafts", payload,
      { "x-inherit-csrf": token, ...headers }), payload);
  }

  it("reserves the draft with an encrypted, keyed address and answers the register's receipt", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: receipt, error: null });
    const token = mintPathBDraftNonce(accountId, sessionId);
    const response = await draft({}, {}, token);
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual(receipt);
    const [name, args] = mocks.rpc.mock.calls[0]!;
    // The door records the page nonce's hash before the draft is written.
    expect(name).toBe("create_path_b_reviewed_document_draft_with_nonce_v1");
    expect(args.p_nonce_hash).toBe(crypto.createHash("sha256").update(token).digest("hex"));
    expect(JSON.stringify(args)).not.toContain(token);
    expect(args).toMatchObject({ p_account_id: accountId, p_session_id: sessionId, p_display_name: "Synthetic Relative",
      p_date_of_birth: "1980-05-05", p_contact_hmac: null, p_test_jurisdiction: true });
    expectContactSet(args.p_contact_hmac_set);
    expect(args.p_contact_ciphertext).toMatch(/^\\x[0-9a-f]+$/);
    expect(args.p_request_key).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(args).toLowerCase()).not.toContain(ADDRESS);
  });

  it("refuses a person under 18, a foreign origin, a missing page token, and anything outside TEST-LOCAL", async () => {
    expect((await draft({ dateOfBirth: `${new Date().getUTCFullYear() - 10}-01-01` })).status).toBe(422);
    expect((await draft({ evidenceKind: "uploaded_document" })).status).toBe(422);
    expect((await draft({}, { "x-inherit-csrf": "nope" })).status).toBe(403);
    expect((await draft({}, { origin: "https://foreign.example" })).status).toBe(403);
    vi.stubEnv("INHERIT_TEST_JURISDICTION", "");
    expect((await draft()).status).toBe(404);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("refuses a request-send token, another session's nonce and a spent nonce as a missing one", async () => {
    expect((await draft({}, {}, mintPathBOperation(accountId, sessionId, "request-send", subjectId))).status).toBe(403);
    expect((await draft({}, {}, mintPathBDraftNonce(accountId, subjectId))).status).toBe(403);
    expect(mocks.rpc).not.toHaveBeenCalled();
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { code: "22023", message: "invalid_operation_nonce" } });
    expect((await draft()).status).toBe(403);
  });

  it("refuses when the jurisdiction does not permit third-party adult analysis", async () => {
    mocks.codes.mockResolvedValue({ status: "blocked" });
    expect((await draft()).status).toBe(404);
    expect(mocks.codes).toHaveBeenCalledWith(accountId, "third_party_adult_analysis");
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("asks for the uploader's own birth date first, and hides every other refusal", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { code: "55000", message: "adult_account_required" } });
    expect(await (await draft()).json()).toEqual({ error: "adult_account_required" });
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { code: "42501", message: "not_found" } });
    expect((await draft()).status).toBe(404);
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { code: "55000", message: "keyed digest set incomplete" } });
    expect((await draft()).status).toBe(503);
  });
});

describe("POST /api/legal-evidence/upload-session", () => {
  const sha256 = "a".repeat(64);
  const body = { documentKind: "adult-signed-permission", subjectDraftId: subjectId, mediaType: "application/pdf",
    sizeBytes: 5_000_000, sha256 };
  const expiresAt = () => new Date(Date.now() + 60 * 60 * 1000).toISOString();
  function open(overrides: Record<string, unknown> = {}, headers: Record<string, string> = {}, url = "https://inherit.bio/api/legal-evidence/upload-session") {
    return openLegalEvidenceUploadSession(post(url, { ...body, ...overrides },
      { "x-inherit-csrf": mintReviewedDocumentOperation(accountId, sessionId, "document-session", subjectId), ...headers }));
  }

  it("opens evidence-session-v1 with a fresh document key, a session cookie, and the chunk and completion proofs", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: { status: "open", session: evidenceSession,
      documentKind: "adult-signed-permission", expiresAt: expiresAt() }, error: null });
    const response = await open();
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ session: evidenceSession, documentKind: "adult-signed-permission",
      chunkBytes: 4_000_000, maximumChunks: 5, maximumDocumentBytes: 20_000_000,
      chunkRoute: `/api/evidence/${evidenceSession}/chunks/{sequence}`, completeRoute: `/api/evidence/${evidenceSession}/complete`,
      expiresAt: expect.any(String) });
    expect(response.headers.get("set-cookie")).toMatch(/HttpOnly/i);
    expect(response.headers.get("x-inherit-csrf")).toBeTruthy();
    expect(response.headers.get("x-inherit-complete-nonce")).toBeTruthy();
    expect(response.headers.get("cache-control")).toContain("no-store");
    const [name, args] = mocks.rpc.mock.calls[0]!;
    expect(name).toBe("open_permission_document_session_v1");
    expect(args).toMatchObject({ p_account_id: accountId, p_session_id: sessionId, p_subject_id: subjectId,
      p_media_type: "application/pdf", p_size_bytes: 5_000_000, p_sha256: sha256, p_test_jurisdiction: true });
    expect(args.p_cookie_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(args.p_nonce_hash).toMatch(/^[0-9a-f]{64}$/);
    // The wrapped key is the 72-byte envelope, never a bare key.
    expect(args.p_wrapped_document_key).toMatch(/^\\x[0-9a-f]{144}$/);
  });

  it("answers capacity as invalid-request-v1 with the one closed issue", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: { status: "capacity_limited" }, error: null });
    const response = await open();
    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({ error: "invalid_request", issues: ["capacity"] });
  });

  it("refuses every forbidden field and every embryo kind before the database", async () => {
    for (const patch of [{ bucket: "legal-evidence" }, { objectPath: "x" }, { filename: "a.pdf" }, { ownerId: accountId },
      { reviewer: accountId }, { approved: true }, { retentionDeadline: "2030-01-01" }, { sizeBytes: 20_000_001 }]) {
      expect((await open(patch)).status).toBe(422);
    }
    const { subjectDraftId: _draft, ...embryo } = body;
    expect(_draft).toBe(subjectId);
    for (const kind of ["parent-death-certificate", "sole-disposition-authority"]) {
      const response = await openLegalEvidenceUploadSession(post("https://inherit.bio/api/legal-evidence/upload-session",
        { ...embryo, documentKind: kind, cohortDraftId: subjectId }));
      expect(response.status).toBe(404);
    }
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("refuses a token for another draft or operation, a cross-site request, a query and a non-JSON body", async () => {
    expect((await open({}, { "x-inherit-csrf": mintReviewedDocumentOperation(accountId, sessionId, "document-session", documentId) })).status).toBe(403);
    expect((await open({}, { "x-inherit-csrf": mintReviewedDocumentOperation(accountId, sessionId, "finalize", subjectId) })).status).toBe(403);
    expect((await open({}, { "sec-fetch-site": "cross-site" })).status).toBe(403);
    expect((await open({}, {}, "https://inherit.bio/api/legal-evidence/upload-session?bucket=x")).status).toBe(422);
    expect((await open({}, { "content-type": "text/plain" })).status).toBe(422);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("answers resource-not-found-v1 for a draft the database does not grant, and 401 signed out", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { code: "42501", message: "not_found" } });
    expect((await open()).status).toBe(404);
    mocks.getUser.mockResolvedValue({ data: { user: null } });
    expect((await open()).status).toBe(401);
  });
});

describe("POST /api/subjects (closed-subject-finalize-v1)", () => {
  const nonce = () => mintReviewedDocumentOperation(accountId, sessionId, "finalize", subjectId);
  const body = () => ({ subjectDraftId: subjectId, permissionEvidenceDocumentId: documentId, legalReviewId: reviewId, nonce: nonce() });
  const receipt = { status: "received", next: "awaiting_subject_confirmation" };
  function finalize(payload: unknown = body(), headers: Record<string, string> = {}, url = "https://inherit.bio/api/subjects") {
    return finalizeReviewedDocumentSubject(post(url, payload,
      { "x-inherit-csrf": finalizeCsrf(accountId, sessionId, subjectId), "x-real-ip": "192.0.2.44", ...headers }),
      { capability: (id) => mocks.codes(id, "third_party_adult_analysis") });
  }
  function contact() {
    return { data: { contactCiphertext: encryptSecret(ADDRESS).toString("hex") }, error: null };
  }

  it("opens the draft's own address in memory only, bars and keys it, and answers subject-created-v1", async () => {
    mocks.rpc.mockResolvedValueOnce(contact()).mockResolvedValueOnce({ data: receipt, error: null });
    const response = await finalize();
    expect(response.status).toBe(202);
    expect(await response.json()).toEqual(receipt);
    expect(mocks.rpc.mock.calls.map(([name]) => name)).toEqual(["path_b_reviewed_document_contact_v1",
      "finalize_path_b_reviewed_document_v1"]);
    const args = mocks.rpc.mock.calls[1]![1] as Record<string, unknown>;
    expect(args).toMatchObject({ p_account_id: accountId, p_session_id: sessionId, p_subject_id: subjectId,
      p_document_id: documentId, p_review_id: reviewId, p_test_jurisdiction: true });
    expectContactSet(args.p_contact_hmac_set);
    expect(args.p_nonce_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(args.p_idempotency_key).toMatch(/^[0-9a-f]{64}$/);
    expect(Object.keys(args.p_quota_keys as object)).toEqual(["1", "2"]);
    const serialized = JSON.stringify(args);
    for (const plain of [ADDRESS, "192.0.2.44"]) expect(serialized).not.toContain(plain);
  });

  it("answers an eligible and a barred address with byte-identical receipts", async () => {
    // The database decides the bar and returns the same receipt either way.
    mocks.rpc.mockResolvedValueOnce(contact()).mockResolvedValueOnce({ data: receipt, error: null });
    const eligible = await finalize();
    mocks.rpc.mockResolvedValueOnce(contact()).mockResolvedValueOnce({ data: receipt, error: null });
    const barred = await finalize();
    expect(barred.status).toBe(eligible.status);
    expect(await barred.text()).toBe(await eligible.text());
  });

  it("tells an embryo attempt where embryos go, and refuses outside TEST-LOCAL and without the capability", async () => {
    const embryo = await finalize({ kind: "embryo" });
    expect(embryo.status).toBe(422);
    expect(await embryo.json()).toEqual({ error: "embryo_cohort_required" });
    vi.stubEnv("INHERIT_TEST_JURISDICTION", "");
    expect((await finalize()).status).toBe(404);
    vi.stubEnv("INHERIT_TEST_JURISDICTION", "1");
    mocks.codes.mockResolvedValue({ status: "blocked", userFacingCopy: "Not available where you live." });
    const blocked = await finalize();
    expect(blocked.status).toBe(403);
    expect(await blocked.json()).toEqual({ error: "jurisdiction_unavailable", message: "Not available where you live." });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("refuses a new address, an approval field, a wrong CSRF, a spent or foreign nonce, and a cross-site request", async () => {
    expect((await finalize({ ...body(), contactEmail: ADDRESS })).status).toBe(404);
    expect((await finalize({ ...body(), approved: true })).status).toBe(404);
    expect((await finalize(body(), { "x-inherit-csrf": finalizeCsrf(accountId, sessionId, documentId) })).status).toBe(403);
    expect((await finalize({ ...body(), nonce: mintReviewedDocumentOperation(accountId, sessionId, "document-session", subjectId) })).status).toBe(404);
    expect((await finalize({ ...body(), nonce: mintReviewedDocumentOperation(accountId, reviewId, "finalize", subjectId) })).status).toBe(404);
    expect((await finalize(body(), { "sec-fetch-site": "cross-site" })).status).toBe(403);
    expect((await finalize(body(), {}, "https://inherit.bio/api/subjects?x=1")).status).toBe(404);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("answers resource-not-found-v1 when the database refuses the draft, document, review or nonce", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { code: "42501", message: "not_found" } });
    expect((await finalize()).status).toBe(404);
    for (const code of ["42501", "23505", "22023"]) {
      mocks.rpc.mockResolvedValueOnce(contact()).mockResolvedValueOnce({ data: null, error: { code, message: "x" } });
      expect((await finalize()).status).toBe(404);
    }
    mocks.rpc.mockResolvedValueOnce(contact()).mockResolvedValueOnce({ data: { status: "received", subjectId }, error: null });
    expect((await finalize()).status).toBe(503);
  });
});

describe("the reviewed-document one-time tokens", () => {
  const actor = { accountId, sessionId };
  const base = { subjectId, label: "Synthetic Relative", requestedAt: "2026-10-16T12:00:00Z", answerBy: "2026-11-15T12:00:00Z",
    documentId: null, legalReviewId: null };

  it("mints a document-session token only once the uploader signed, bound to this account, session and draft", () => {
    expect(reviewedDocumentTokens(actor, { ...base, signed: false, state: "awaiting-document" })).toEqual({});
    const { documentToken } = reviewedDocumentTokens(actor, { ...base, signed: true, state: "awaiting-document" });
    const expected = { accountId, sessionId, operation: "document-session" as const, targetId: subjectId };
    expect(readReviewedDocumentOperation(documentToken!, expected)).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(readReviewedDocumentOperation(documentToken!, { ...expected, targetId: documentId })).toBeNull();
    expect(readReviewedDocumentOperation(documentToken!, { ...expected, sessionId: reviewId })).toBeNull();
    expect(readReviewedDocumentOperation(documentToken!, { ...expected, operation: "finalize" })).toBeNull();
    expect(readReviewedDocumentOperation(`${documentToken!}x`, expected)).toBeNull();
  });

  it("mints the api.subjects nonce and CSRF only after a named human approved", () => {
    for (const state of ["document-review", "awaiting-signature", "document-refused"] as const) {
      expect(reviewedDocumentTokens(actor, { ...base, signed: true, state })).toEqual({});
    }
    const ready = { ...base, signed: true, state: "awaiting-request" as const, documentId, legalReviewId: reviewId };
    const { finalize } = reviewedDocumentTokens(actor, ready);
    expect(finalize?.csrf).toBe(finalizeCsrf(accountId, sessionId, subjectId));
    expect(readReviewedDocumentOperation(finalize!.nonce, { accountId, sessionId, operation: "finalize", targetId: subjectId }))
      .toMatch(/^[A-Za-z0-9_-]{32}$/);
  });

  it("expires a token after ten minutes", () => {
    const now = Date.now();
    const token = mintReviewedDocumentOperation(accountId, sessionId, "finalize", subjectId, now);
    const expected = { accountId, sessionId, operation: "finalize" as const, targetId: subjectId };
    expect(readReviewedDocumentOperation(token, expected, now + 9 * 60 * 1000)).not.toBeNull();
    expect(readReviewedDocumentOperation(token, expected, now + 10 * 60 * 1000)).toBeNull();
  });
});
