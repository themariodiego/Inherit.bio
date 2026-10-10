import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ account: vi.fn(), rpc: vi.fn(), open: vi.fn(() => true) }));
vi.mock("@/lib/account-deletion", () => ({ getSensitiveAccountContext: mocks.account }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc: mocks.rpc }) }));
vi.mock("@/lib/future-person/claims-open", () => ({ futurePersonClaimsOpen: mocks.open }));
vi.stubEnv("BYOK_ENCRYPTION_KEY", Buffer.alloc(32, 23).toString("base64"));
const { GET, POST } = await import("@/app/api/reviews/future-person/claim-objections/[id]/route");
const { sealNoticePackage } = await import("./notice-package");
const { sealOwnerObjection } = await import("./owner-objection");
const { mintAssignedObjectionNonce, readAssignedObjectionNonce } = await import("./objection-review");
const { reviewCsrf } = await import("./review");
const { claimDataKey, openDocumentBytes } = await import("./document-envelope");
afterAll(() => vi.unstubAllEnvs());
const id = (n: number) => `62000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const CLAIM = id(1), NOTICE = id(2), OBJECTION = id(5), ACCOUNT = id(6), SESSION = id(7);
const human = { fullName: "Synthetic Claimant", dateOfBirth: "2000-01-01", photoIdentityReviewed: true as const,
  birthRecordReviewed: true as const, adultAgeConfirmed: true as const };
const minimum = sealNoticePackage(human, { childDateOfBirth: human.dateOfBirth, childPlaceOfBirth: "Synthetic City",
  parentNames: ["Synthetic Parent"] }, { reviewId: CLAIM, documentaryRevision: 1, photoDocumentId: id(3),
  photoSha256: "a".repeat(64), birthDocumentId: id(4), birthSha256: "b".repeat(64) });
const statement = sealOwnerObjection("Please consider the complete identity documents again.",
  { claimId: CLAIM, noticeId: NOTICE, noticeRevision: 2 });
const row = { operation: "claim-objection", claimId: CLAIM, reviewRevision: 3, noticeId: NOTICE, noticeRevision: 2,
  noticeDeadline: "2026-10-30T00:00:00.000Z", deadline: "2026-11-15T00:00:00.000Z", documentaryRevision: 1,
  photoDocumentId: id(3), photoSha256: "a".repeat(64), birthDocumentId: id(4), birthSha256: "b".repeat(64),
  comparisonCiphertext: minimum.ciphertext.slice(2), wrappedComparisonKey: minimum.wrappedKey.slice(2),
  objection: { id: OBJECTION, objectionRevision: 1, initialNoticeRevision: 2,
    statementCiphertext: statement.ciphertext.slice(2), wrappedStatementKey: statement.wrappedKey.slice(2) } };
const revisions = { objectionRevision: 1, claimReviewRevision: 3, noticeRevision: 2 };
const states: Record<string, string> = { "uphold-objection": "claim_rejected",
  "overrule-objection": "release_recheck_required", "needs-more-information": "more_information_required" };
function body(decision = "uphold-objection") {
  return { decision, ...revisions, reason: "I read the complete documents and considered the owner statement.",
    nonce: mintAssignedObjectionNonce(OBJECTION, ACCOUNT, SESSION, revisions) };
}
function request(given: unknown = body(), headers: Record<string, string> = {}) {
  return new Request(`https://test.e2e.local/api/reviews/future-person/claim-objections/${OBJECTION}`, { method: "POST",
    headers: { origin: "https://test.e2e.local", "sec-fetch-site": "same-origin", "content-type": "application/json",
      "x-inherit-csrf": reviewCsrf(OBJECTION, ACCOUNT, SESSION), ...headers }, body: JSON.stringify(given) });
}
const context = () => ({ params: Promise.resolve({ id: OBJECTION }) });
beforeEach(() => {
  vi.clearAllMocks(); mocks.open.mockReturnValue(true);
  mocks.account.mockResolvedValue({ user: { id: ACCOUNT }, sessionId: SESSION });
  mocks.rpc.mockImplementation(async (name, args) => ({ data: name === "read_keyless_review_operation_v1" ? row : {
    objectionId: OBJECTION, objectionRevision: 2, state: states[args.p_decision] }, error: null }));
});
describe("native current named objection operation", () => {
  it("reads the registered minimum after own-JWT authorization and issues separate revision-bound stateless proofs", async () => {
    const response = await GET(new Request(`https://test.e2e.local/api/reviews/future-person/claim-objections/${OBJECTION}`), context());
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(mocks.rpc.mock.calls).toEqual([["read_keyless_review_operation_v1", { p_id: OBJECTION, p_operation: "claim-objection" }]]);
    expect(readAssignedObjectionNonce(response.headers.get("x-inherit-review-nonce") ?? "", OBJECTION, ACCOUNT, SESSION, revisions)).toBeTruthy();
    expect(response.headers.get("x-inherit-photo-receipt-nonce")).toBeTruthy();
    const result = await response.json();
    expect(result.objectionId).toBe(OBJECTION); expect(result.statement).toContain("complete identity documents");
    expect(JSON.stringify(result)).not.toMatch(/wrapped|ciphertext|contact|candidate|genotype|objectKey|token/iu);
  });
  it.each(["uphold-objection", "overrule-objection", "needs-more-information"])("consumes a separate nonce for %s and seals the basis with the surviving minimum key", async decision => {
    const response = await POST(request(body(decision)), context()); expect(response.status).toBe(200);
    expect(mocks.rpc.mock.calls.map(call => call[0])).toEqual(["read_keyless_review_operation_v1", "decide_keyless_objection_v1"]);
    const args = mocks.rpc.mock.calls[1]![1];
    expect(args).toMatchObject({ p_objection: OBJECTION, p_objection_revision: 1, p_review_revision: 3, p_notice_revision: 2, p_decision: decision });
    expect(args.p_nonce_hash).toMatch(/^[0-9a-f]{64}$/u);
    const key = claimDataKey(row.wrappedComparisonKey);
    try {
      const opened = openDocumentBytes(key, `claim-review-v1|${CLAIM}|${args.p_nonce_hash}|reason`, Buffer.from(args.p_reason_ciphertext.slice(2), "hex"));
      expect(opened?.toString()).toBe(body().reason); opened?.fill(0);
    } finally { key.fill(0); }
    expect(JSON.stringify(args)).not.toContain(human.fullName);
    expect(JSON.stringify(await response.json())).not.toMatch(/reason|wrapped|ciphertext|contact|candidate|token/iu);
  });
  it("refuses a changed live assignment, minimum, revision, caller or request before decision mutation", async () => {
    for (const changed of [{ ...row, reviewRevision: 4 }, { ...row, noticeRevision: 3 },
      { ...row, objection: { ...row.objection, objectionRevision: 2 } }, { ...row, operation: "claim-release" },
      { ...row, comparisonCiphertext: "00".repeat(128) }]) {
      mocks.rpc.mockClear(); mocks.rpc.mockResolvedValue({ data: changed, error: null });
      expect((await POST(request(), context())).status).toBe(404);
      expect(mocks.rpc.mock.calls.some(call => call[0] === "decide_keyless_objection_v1")).toBe(false);
    }
    mocks.rpc.mockClear();
    for (const req of [request(body(), { origin: "https://foreign.e2e.local" }), request(body(), { "sec-fetch-site": "cross-site" }),
      request(body(), { "content-type": "text/plain" }), request({ ...body(), subjectId: id(99) }),
      request({ ...body(), decision: "approve-release" }), request({ ...body(), noticeRevision: 3 })]) {
      expect((await POST(req, context())).status).toBe(404); expect(mocks.rpc).not.toHaveBeenCalled();
    }
    mocks.account.mockResolvedValue({ user: { id: id(99) }, sessionId: SESSION });
    expect((await POST(request(), context())).status).toBe(404); expect(mocks.rpc).not.toHaveBeenCalled();
    mocks.open.mockReturnValue(false);
    expect((await GET(new Request(`https://test.e2e.local/api/reviews/future-person/claim-objections/${OBJECTION}`), context())).status).toBe(404);
  });
  it("preserves database full-ACK, MFA, stale nonce and source refusals, and rejects malformed receipts", async () => {
    for (const code of ["42501", "22023", "23505", "XX000"]) {
      mocks.rpc.mockImplementation(async name => ({ data: name === "read_keyless_review_operation_v1" ? row : null,
        error: name === "decide_keyless_objection_v1" ? { code } : null }));
      const response = await POST(request(), context()); expect(response.status).toBe(code === "XX000" ? 503 : 404);
    }
    for (const receipt of [{ objectionId: id(99), objectionRevision: 2, state: "claim_rejected" },
      { objectionId: OBJECTION, objectionRevision: 1, state: "claim_rejected" },
      { objectionId: OBJECTION, objectionRevision: 2, state: "release_queued" },
      { objectionId: OBJECTION, objectionRevision: 2, state: "claim_rejected", token: "forbidden" }]) {
      mocks.rpc.mockImplementation(async name => ({ data: name === "read_keyless_review_operation_v1" ? row : receipt, error: null }));
      expect((await POST(request(), context())).status).toBe(503);
    }
  });
});
