import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc: mocks.rpc }) }));
vi.stubEnv("BYOK_ENCRYPTION_KEY", Buffer.alloc(32, 19).toString("base64"));
const { POST } = await import("@/app/api/future-person/claim/session/objection/route");
const { ownerObjectionCsrf } = await import("./owner-objection");
const { mintPublicFormToken } = await import("@/lib/embryos/operation-token");
const { rightsSessionHash } = await import("@/lib/embryos/rights-session");
const { claimDataKey, openDocumentBytes } = await import("./document-envelope");
const secret = "x".repeat(43), hash = rightsSessionHash(secret);
const scope = { claimId: "61000000-0000-4000-8000-000000000011", noticeId: "61000000-0000-4000-8000-000000000012", noticeRevision: 2 };
const statement = "Please review the supplied identity documents for this claim.";
function body() { return { statement, nonce: mintPublicFormToken("future-person-claim-objection", Date.now(), hash) }; }
function request(value: unknown = body(), changed: Record<string, string> = {}, query = "") {
  return new Request(`https://test.e2e.local/api/future-person/claim/session/objection${query}`, { method: "POST", headers: {
    origin: "https://test.e2e.local", "sec-fetch-site": "same-origin", "content-type": "application/json",
    cookie: `inherit-rights=${secret}`, "x-inherit-csrf": ownerObjectionCsrf(hash), ...changed,
  }, body: JSON.stringify(value) });
}
beforeEach(() => { mocks.rpc.mockReset(); mocks.rpc.mockImplementation(async name => ({
  data: name === "future_person_objection_statement_scope_v1" ? scope : { status: "suspended_for_review" }, error: null,
})); });
afterAll(() => vi.unstubAllEnvs());
describe("native owner-only objection POST", () => {
  it("persists only an independently sealed exact-scope statement and returns the closed202 receipt", async () => {
    const response = await POST(request()); expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ status: "suspended_for_review" });
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(mocks.rpc.mock.calls.map(call => call[0])).toEqual(["future_person_objection_statement_scope_v1", "submit_future_person_owner_objection_v1"]);
    const args = mocks.rpc.mock.calls[1]![1];
    expect(Object.keys(args).sort()).toEqual(["p_nonce", "p_notice_id", "p_notice_revision", "p_session_hash", "p_statement_ciphertext", "p_wrapped_statement_key"]);
    expect(args.p_notice_id).toBe(scope.noticeId); expect(args.p_notice_revision).toBe(2);
    expect(args.p_session_hash).toBe(hash); expect(args.p_nonce).toMatch(/^[A-Za-z0-9_-]{16,256}$/u);
    expect(JSON.stringify(args)).not.toContain(statement); expect(JSON.stringify(args)).not.toContain(secret);
    const key = claimDataKey(args.p_wrapped_statement_key.slice(2));
    try { const bytes = openDocumentBytes(key, `future-person-owner-objection-v1|${JSON.stringify(scope)}`, Buffer.from(args.p_statement_ciphertext.slice(2), "hex"));
      expect(bytes?.toString()).toBe(statement); bytes?.fill(0);
    } finally { key.fill(0); }
  });
  it("refuses wrong/missing origin, CSRF, cookie, operation and client target before any SQL", async () => {
    const requests = [request(body(), { origin: "https://other.e2e.local" }), request(body(), { "sec-fetch-site": "cross-site" }),
      request(body(), { "x-inherit-csrf": "bad" }), request(body(), { cookie: "" }), request(body(), { cookie: `inherit-rights=${secret}; inherit-rights=${secret}` }),
      request({ ...body(), nonce: mintPublicFormToken("future-person-claim-review", Date.now(), hash) }),
      request({ ...body(), noticeId: scope.noticeId }), request({ ...body(), statement: "short" }), request(body(), {}, "?noticeId=" + scope.noticeId)];
    for (const req of requests) { mocks.rpc.mockClear(); const response = await POST(req); expect(response.status).toBe(404); expect(mocks.rpc).not.toHaveBeenCalled(); }
  });
  it("refuses absent, stale, extra-field or errored scope before sealing/submitting", async () => {
    for (const result of [{ data: null, error: null }, { data: { ...scope, noticeRevision: 0 }, error: null },
      { data: { ...scope, claimant: "Forbidden" }, error: null }, { data: scope, error: { code: "42501" } }]) {
      mocks.rpc.mockReset(); mocks.rpc.mockResolvedValue(result); expect((await POST(request())).status).toBe(404);
      expect(mocks.rpc).toHaveBeenCalledTimes(1);
    }
  });
  it("does not accept a widened or wrong committed receipt", async () => {
    for (const result of [{ data: { status: "suspended_for_review", claimId: scope.claimId }, error: null },
      { data: { status: "approved" }, error: null }, { data: null, error: { code: "42501" } }]) {
      mocks.rpc.mockReset(); mocks.rpc.mockResolvedValueOnce({ data: scope, error: null }).mockResolvedValueOnce(result);
      expect((await POST(request())).status).toBe(404);
    }
  });
});
