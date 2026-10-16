import crypto from "node:crypto";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ account: vi.fn(), rpc: vi.fn() }));
vi.mock("@/lib/account-deletion", () => ({ getSensitiveAccountContext: mocks.account }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({
  rpc: (name: string, args: unknown) => ({ retry: () => ({ abortSignal: () => mocks.rpc(name, args) }) }) }) }));
vi.stubEnv("BYOK_ENCRYPTION_KEY", Buffer.alloc(32, 41).toString("base64"));
vi.stubEnv("INHERIT_TEST_JURISDICTION", "1");
vi.stubEnv("INHERIT_TEST_REQUESTER_STATEMENTS", "1");
const { GET, POST } = await import("@/app/api/reviews/future-person/corrections/[id]/route");
const { sealNewCorrection, readCorrectionReviewNonce, mintCorrectionReviewNonce } = await import("./correction-case-envelope");
const { correctionReviewCsrf } = await import("./correction-review");
const { unwrapNewCaseKey, openNewCaseBytes } = await import("./new-case-envelope-crypto");
afterAll(() => vi.unstubAllEnvs());

const id = (n: number) => `86000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const CASE = id(1), ACCOUNT = id(2), SESSION = id(3), REVIEWER = id(4), AUTHOR = id(5), SUBJECT = id(6);
const deadline = new Date(Date.now() + 20 * 86_400_000);
const deadlineIso = deadline.toISOString();
const scope = { version: 1 as const, caseKind: "correction" as const, caseId: CASE, originalAuthorPrincipalId: AUTHOR,
  initialStatementRevision: 1 as const, originalSubmittedAt: new Date(deadline.getTime() - 30 * 86_400_000).toISOString(),
  originalDeadline: deadlineIso, requestedField: "display-label" as const, originalSubjectId: SUBJECT };
const statement = "The display label on my record is not the one the clinic recorded.";
const envelope = sealNewCorrection(scope, statement);
const binding = { actor: { accountId: ACCOUNT, sessionId: SESSION, principalId: REVIEWER, principalRevision: 1,
  live: { authorized: true as const, account_auth_session_revision: 1, session_revision: 1 } },
  assignmentRevision: 1, sourceHash: "c".repeat(64) };
const provenance = { fieldVersion: 1, sourceKind: "neutral-display-label", sourceReference: "d".repeat(64),
  provenanceRevision: 1, affectedResultCount: 0, analysisStopped: false };
const caseRow = { correctionId: CASE, field: "display-label", correctionRevision: 1, reviewRevision: 0,
  deadline: deadlineIso, scope, provenance, binding, envelope };
const decisionRow = { correctionId: CASE, correctionRevision: 1, reviewRevision: 0, deadline: deadlineIso, scope, binding,
  wrappedCaseKeyHex: envelope.wrappedCaseKeyHex };
const reason = "The clinic record I reviewed does not support this change yet.";
const url = `https://test.e2e.local/api/reviews/future-person/corrections/${CASE}`;
const context = () => ({ params: Promise.resolve({ id: CASE }) });
function get(headers: Record<string, string> = { "sec-fetch-site": "same-origin" }, target = url) {
  return new Request(target, { headers });
}
function post(given: unknown, headers: Record<string, string> = {}) {
  return new Request(url, { method: "POST", headers: { origin: "https://test.e2e.local", "sec-fetch-site": "same-origin",
    "content-type": "application/json", "x-inherit-csrf": correctionReviewCsrf(CASE, ACCOUNT, SESSION), ...headers },
    body: JSON.stringify(given) });
}
const body = (decision = "reject", extra: Record<string, unknown> = {}) => ({ decision, correctionRevision: 1, reason,
  nonce: mintCorrectionReviewNonce(CASE, binding, deadlineIso), ...extra });

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("INHERIT_TEST_REQUESTER_STATEMENTS", "1");
  mocks.account.mockResolvedValue({ user: { id: ACCOUNT }, sessionId: SESSION });
  mocks.rpc.mockImplementation(async (name: string, args: Record<string, unknown>) => {
    if (name === "read_future_person_correction_review_v1") return { data: caseRow, error: null };
    if (name === "check_future_person_correction_review_v1") return { data: true, error: null };
    if (name === "future_person_correction_decision_context_v1") return { data: decisionRow, error: null };
    if (name === "decide_future_person_correction_review_v1") return { data: { correctionId: CASE,
      state: args.p_decision === "reject" ? "rejected" : "more_information_required", reviewRevision: 1 }, error: null };
    return { data: null, error: { code: "42883" } };
  });
});

describe("GET /api/reviews/future-person/corrections/[id]", () => {
  it("returns the closed case after the own-JWT read and rechecks it after serializing", async () => {
    const response = await GET(get(), context());
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(mocks.rpc.mock.calls).toEqual([
      ["read_future_person_correction_review_v1", { p_correction: CASE }],
      ["check_future_person_correction_review_v1", { p_correction: CASE, p_expected: binding }]]);
    const result = await response.json();
    expect(result).toEqual({ correctionId: CASE, field: "display-label", statement, correctionRevision: 1, currentProvenance: provenance });
    expect(JSON.stringify(result)).not.toMatch(/wrapped|ciphertext|contact|parent|rawGenotype|objectPath|bucket|credential|correctedValue/iu);
    expect(readCorrectionReviewNonce(response.headers.get("x-inherit-review-nonce") ?? "", CASE, binding, deadlineIso)).toBeTruthy();
    expect(response.headers.get("x-inherit-csrf")).toBe(correctionReviewCsrf(CASE, ACCOUNT, SESSION));
  });
  it("is one opaque 404 when the TEST switch, segment, query, origin, caller or database refuses", async () => {
    const cases: [string, () => void, Request?][] = [
      ["switch off", () => vi.stubEnv("INHERIT_TEST_REQUESTER_STATEMENTS", "0")],
      ["cross-site", () => undefined, get({ "sec-fetch-site": "cross-site" })],
      ["query", () => undefined, get(undefined, `${url}?x=1`)],
      ["signed out", () => mocks.account.mockResolvedValue(null)],
      ["database refusal", () => mocks.rpc.mockResolvedValue({ data: null, error: { code: "42501" } })],
      ["foreign binding", () => mocks.rpc.mockImplementation(async (name: string) => ({ data: name.startsWith("read")
        ? { ...caseRow, binding: { ...binding, actor: { ...binding.actor, accountId: id(9) } } } : true, error: null }))],
      ["unknown field", () => mocks.rpc.mockImplementation(async (name: string) => ({ data: name.startsWith("read")
        ? { ...caseRow, contact: "x" } : true, error: null }))],
      ["tampered statement", () => mocks.rpc.mockImplementation(async (name: string) => ({ data: name.startsWith("read")
        ? { ...caseRow, envelope: { ...envelope, statementCiphertextHex: "00".repeat(60) } } : true, error: null }))],
      ["changed after serializing", () => mocks.rpc.mockImplementation(async (name: string) => ({
        data: name.startsWith("read") ? caseRow : false, error: null }))],
    ];
    for (const [label, setup, given] of cases) {
      vi.clearAllMocks(); mocks.account.mockResolvedValue({ user: { id: ACCOUNT }, sessionId: SESSION });
      vi.stubEnv("INHERIT_TEST_REQUESTER_STATEMENTS", "1");
      mocks.rpc.mockImplementation(async (name: string) => ({ data: name.startsWith("read") ? caseRow : true, error: null }));
      setup();
      const response = await GET(given ?? get(), context());
      expect(response.status, label).toBe(404);
      expect(await response.json(), label).toEqual({ error: "not_found" });
    }
    vi.clearAllMocks(); mocks.account.mockResolvedValue({ user: { id: ACCOUNT }, sessionId: SESSION });
    expect((await GET(get(), { params: Promise.resolve({ id: `${CASE.slice(0, -1)}A` }) })).status).toBe(404);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});

describe("POST /api/reviews/future-person/corrections/[id]", () => {
  it.each([["reject", "rejected"], ["needs-more-information", "more_information_required"]])(
    "records %s with a sealed reason and the one-time nonce", async (decision, state) => {
      const response = await POST(post(body(decision)), context());
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ correctionId: CASE, state, reviewRevision: 1 });
      expect(mocks.rpc.mock.calls.map(call => call[0])).toEqual(["future_person_correction_decision_context_v1", "decide_future_person_correction_review_v1"]);
      const args = mocks.rpc.mock.calls[1]![1] as Record<string, string>;
      expect(args).toMatchObject({ p_correction: CASE, p_decision: decision, p_correction_revision: 1, p_expected: binding });
      expect(args.p_nonce_hash).toMatch(/^[0-9a-f]{64}$/u);
      expect(JSON.stringify(args)).not.toContain(reason);
      const key = unwrapNewCaseKey(envelope.wrappedCaseKeyHex);
      try {
        const aad = JSON.stringify(["reviewer-only-correction-reason-v1", JSON.stringify(["reviewer-only-case-statement-v1", 1,
          "correction", "display-label", CASE, AUTHOR, 1, scope.originalSubmittedAt, deadlineIso, SUBJECT]), args.p_nonce_hash]);
        const opened = openNewCaseBytes(key, aad, Buffer.from(args.p_reason_ciphertext!.slice(2), "hex"));
        expect(opened?.toString("utf8")).toBe(reason); opened?.fill(0);
      } finally { key.fill(0); }
    });
  it("refuses approval, forbidden fields and every stale or foreign proof before any decision call", async () => {
    const cases: [string, Request, (() => void)?][] = [
      ["approve", post(body("approve"))],
      ["documentary conflict", post(body("rejected-documentary-conflict"))],
      ...["subjectId", "claimantId", "ownerId", "parentId", "newVariant", "genotype", "correctedValue"].map(field =>
        [`forbidden ${field}`, post(body("reject", { [field]: "x" }))] as [string, Request]),
      ["short reason", post(body("reject", { reason: "too short" }))],
      ["missing CSRF", post(body(), { "x-inherit-csrf": "" })],
      ["foreign CSRF", post(body(), { "x-inherit-csrf": correctionReviewCsrf(id(8), ACCOUNT, SESSION) })],
      ["cross-origin", post(body(), { origin: "https://other.example" })],
      ["text body", post(body(), { "content-type": "text/plain" })],
      ["stale correction revision", post(body("reject", { correctionRevision: 2 }))],
      ["nonce from another read", post(body("reject", { nonce: mintCorrectionReviewNonce(CASE, { ...binding, sourceHash: "e".repeat(64) }, deadlineIso) }))],
      ["nonce from another case", post(body("reject", { nonce: mintCorrectionReviewNonce(id(8), binding, deadlineIso) }))],
      ["database refusal", post(body()), () => mocks.rpc.mockResolvedValue({ data: null, error: { code: "42501" } })],
    ];
    for (const [label, given, setup] of cases) {
      mocks.rpc.mockClear(); setup?.();
      const response = await POST(given, context());
      expect(response.status, label).toBe(404);
      expect(mocks.rpc.mock.calls.map(call => call[0]), label).not.toContain("decide_future_person_correction_review_v1");
      mocks.rpc.mockImplementation(async (name: string, args: Record<string, unknown>) => name === "future_person_correction_decision_context_v1"
        ? { data: decisionRow, error: null } : { data: { correctionId: CASE, state: args.p_decision === "reject" ? "rejected" : "more_information_required", reviewRevision: 1 }, error: null });
    }
  });
  it("never reports a decision the database did not commit exactly", async () => {
    for (const data of [{ correctionId: CASE, state: "approved", reviewRevision: 1 }, { correctionId: CASE, state: "rejected", reviewRevision: 2 },
      { correctionId: id(8), state: "rejected", reviewRevision: 1 }, { correctionId: CASE, state: "rejected", reviewRevision: 1, reason }]) {
      mocks.rpc.mockImplementation(async (name: string) => name === "future_person_correction_decision_context_v1"
        ? { data: decisionRow, error: null } : { data, error: null });
      expect((await POST(post(body()), context())).status).toBe(503);
    }
    expect(crypto.randomUUID()).toBeTruthy();
  });
});
