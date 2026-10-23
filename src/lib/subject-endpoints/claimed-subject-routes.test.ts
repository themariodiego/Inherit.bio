import { beforeEach, describe, expect, it, vi } from "vitest";
// The one-time X-Inherit-CSRF gate is driven on this route by
// src/lib/security/session-csrf-routes.test.ts; here it admits every request.
vi.mock("@/lib/security/session-csrf", async (importOriginal) =>
  (await import("@/lib/security/session-csrf.test-support")).admitEverySessionCsrf(await importOriginal()));

/**
 * api.claimed-subject-analysis-stop and api.claimed-subject-correction
 * (owner decision 2026-10-22): while claimant binding is closed, both answer
 * the register's exact resource-not-found-v1, before any body is read and
 * without touching the database. Test doubles only.
 */
const mocks = vi.hoisted(() => ({ account: vi.fn(), database: vi.fn() }));
vi.mock("@/lib/account-deletion", async original => ({
  ...(await original<typeof import("@/lib/account-deletion")>()), getSensitiveAccountContext: mocks.account }));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.database }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.database }));
vi.stubEnv("BYOK_ENCRYPTION_KEY", Buffer.alloc(32, 61).toString("base64"));
const { DELETE } = await import("@/app/api/subjects/[id]/analysis/route");
const { POST } = await import("@/app/api/subjects/[id]/corrections/route");
const { claimedSubjectCorrectionBody, claimedSubjectAnalysisNonce, CLAIMED_SUBJECT_NONCE_HEADER } = await import("./claimed-subject");

const SUBJECT = "88000000-0000-4000-8000-000000000001";
const ACCOUNT = "88000000-0000-4000-8000-000000000002";
const origin = "https://test.e2e.local";
const context = (id = SUBJECT) => ({ params: Promise.resolve({ id }) });
const statement = "The display label on this record is not the one I was given.";
function stop(headers: Record<string, string> = {}, id = SUBJECT) {
  return new Request(`${origin}/api/subjects/${id}/analysis`, { method: "DELETE",
    headers: { origin, "sec-fetch-site": "same-origin", [CLAIMED_SUBJECT_NONCE_HEADER]: "n".repeat(40), ...headers } });
}
function correct(body: unknown, headers: Record<string, string> = {}, id = SUBJECT) {
  return new Request(`${origin}/api/subjects/${id}/corrections`, { method: "POST", body: JSON.stringify(body),
    headers: { origin, "sec-fetch-site": "same-origin", "content-type": "application/json", ...headers } });
}
async function expectNotFound(response: Response, label: string) {
  expect(response.status, label).toBe(404);
  expect(response.headers.get("content-type"), label).toMatch(/^application\/json/u);
  expect(response.headers.get("cache-control"), label).toBe("private, no-store");
  expect(await response.json(), label).toEqual({ error: "not_found" });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.account.mockResolvedValue({ user: { id: ACCOUNT }, sessionId: "88000000-0000-4000-8000-000000000003" });
});

describe("DELETE /api/subjects/[id]/analysis while claimant binding is closed", () => {
  it("answers resource-not-found-v1 to a well-formed request from a signed-in account, reading nothing", async () => {
    const request = stop();
    await expectNotFound(await DELETE(request, context()), "well-formed");
    expect(request.bodyUsed).toBe(false);
    expect(mocks.database).not.toHaveBeenCalled();
  });
  it("is the same 404 with a missing nonce, a body or a non-canonical segment", async () => {
    await expectNotFound(await DELETE(stop({ [CLAIMED_SUBJECT_NONCE_HEADER]: "" }), context()), "no nonce");
    const withBody = new Request(`${origin}/api/subjects/${SUBJECT}/analysis`, { method: "DELETE", body: "{}",
      headers: { origin, "sec-fetch-site": "same-origin" } });
    await expectNotFound(await DELETE(withBody, context()), "body");
    expect(withBody.bodyUsed).toBe(false);
    await expectNotFound(await DELETE(stop({}, SUBJECT.toUpperCase()), context(SUBJECT.toUpperCase())), "uppercase");
    await expectNotFound(await DELETE(stop({}, "bind"), context("bind")), "static sibling");
    expect(mocks.database).not.toHaveBeenCalled();
  });
  it("keeps the authenticated and same-origin contracts", async () => {
    mocks.account.mockResolvedValue(null);
    const signedOut = await DELETE(stop(), context());
    expect(signedOut.status).toBe(401);
    expect(await signedOut.json()).toEqual({ error: "unauthenticated" });
    mocks.account.mockResolvedValue({ user: { id: ACCOUNT }, sessionId: "s" });
    const crossSite = await DELETE(stop({ origin: "https://elsewhere.example" }), context());
    expect(crossSite.status).toBe(403);
    expect(await crossSite.json()).toEqual({ error: "request_forbidden" });
  });
});

describe("POST /api/subjects/[id]/corrections while claimant binding is closed", () => {
  it("answers resource-not-found-v1 before the body is read, valid or not", async () => {
    for (const [label, body] of [
      ["valid", { field: "display-label", statement, nonce: "n".repeat(40) }],
      ["forbidden field", { field: "variant-call-source", statement, nonce: "n".repeat(40), genotype: "AG" }],
      ["short statement", { field: "display-label", statement: "too short", nonce: "n".repeat(40) }],
      ["unknown field", { field: "display-label", statement, nonce: "n".repeat(40), approved: true }],
    ] as const) {
      const request = correct(body);
      await expectNotFound(await POST(request, context()), label);
      expect(request.bodyUsed, label).toBe(false);
    }
    await expectNotFound(await POST(correct({}, { "content-type": "text/plain" }), context()), "content type");
    expect(mocks.database).not.toHaveBeenCalled();
  });
  it("keeps the authenticated and same-origin contracts", async () => {
    mocks.account.mockResolvedValue(null);
    expect((await POST(correct({}), context())).status).toBe(401);
    mocks.account.mockResolvedValue({ user: { id: ACCOUNT }, sessionId: "s" });
    expect((await POST(correct({}, { origin: "https://elsewhere.example" }), context())).status).toBe(403);
  });
});

describe("the closed request contracts kept for the binding release", () => {
  it("accepts exactly field, a 20-through-4000-character statement and a nonce", () => {
    expect(claimedSubjectCorrectionBody.safeParse({ field: "report-provenance", statement, nonce: "n" }).success).toBe(true);
    expect(claimedSubjectCorrectionBody.safeParse({ field: "report-provenance", statement: "x".repeat(4000), nonce: "n" }).success).toBe(true);
    expect(claimedSubjectCorrectionBody.safeParse({ field: "report-provenance", statement: "x".repeat(4001), nonce: "n" }).success).toBe(false);
    expect(claimedSubjectCorrectionBody.safeParse({ field: "report-provenance", statement: "x".repeat(19), nonce: "n" }).success).toBe(false);
    expect(claimedSubjectCorrectionBody.safeParse({ field: "genotype", statement, nonce: "n" }).success).toBe(false);
    expect(claimedSubjectCorrectionBody.safeParse({ field: "display-label", statement }).success).toBe(false);
    for (const forbidden of ["claimId", "newVariant", "genotype", "reviewer", "approved", "parentId"]) {
      expect(claimedSubjectCorrectionBody.safeParse({ field: "display-label", statement, nonce: "n", [forbidden]: "x" }).success,
        forbidden).toBe(false);
    }
  });
  it("requires a bounded operation nonce header for the analysis stop", () => {
    expect(CLAIMED_SUBJECT_NONCE_HEADER).toBe("x-inherit-operation-nonce");
    expect(claimedSubjectAnalysisNonce.safeParse("n".repeat(40)).success).toBe(true);
    expect(claimedSubjectAnalysisNonce.safeParse("").success).toBe(false);
    expect(claimedSubjectAnalysisNonce.safeParse("n".repeat(2049)).success).toBe(false);
  });
});
