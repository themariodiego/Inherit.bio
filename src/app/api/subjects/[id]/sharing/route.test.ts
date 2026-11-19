import crypto from "node:crypto";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.stubEnv("BYOK_ENCRYPTION_KEY", crypto.randomBytes(32).toString("base64"));

const mocks = vi.hoisted(() => ({ context: vi.fn(), person: vi.fn(), capability: vi.fn(), rpc: vi.fn() }));
vi.mock("@/lib/account-deletion", async (load) => ({
  ...await load<typeof import("@/lib/account-deletion")>(), getSensitiveAccountContext: mocks.context,
}));
vi.mock("@/lib/family/graph", () => ({ resolveFamilyPerson: mocks.person }));
vi.mock("@/lib/family/access", () => ({
  personCapability: mocks.capability,
  permits: (decision: { status: string }) => decision.status === "permitted",
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc: mocks.rpc }) }));

const { POST } = await import("./route");
const { mintSubjectOperationNonce } = await import("@/lib/subject-endpoints/operation-nonce");
const { hashOperationNonce } = await import("@/lib/account-deletion");
afterAll(() => vi.unstubAllEnvs());

const ACCOUNT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SESSION = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const SUBJECT = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const COUNTERPART = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const OTHER = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const ORIGIN = "http://localhost";

function stopCode(overrides: Partial<{ accountId: string; sessionId: string; subjectId: string }> = {}) {
  return mintSubjectOperationNonce({ accountId: ACCOUNT, sessionId: SESSION, operation: "subject_sharing_stop", subjectId: SUBJECT, ...overrides });
}

function call(body: unknown, options: { id?: string; origin?: string | null; contentType?: string | null } = {}) {
  const headers = new Headers();
  const origin = options.origin === undefined ? ORIGIN : options.origin;
  if (origin !== null) headers.set("origin", origin);
  const contentType = options.contentType === undefined ? "application/json" : options.contentType;
  if (contentType !== null) headers.set("content-type", contentType);
  const id = options.id ?? SUBJECT;
  return POST(new Request(`${ORIGIN}/api/subjects/${id}/sharing`, {
    method: "POST", headers, body: typeof body === "string" ? body : JSON.stringify(body),
  }), { params: Promise.resolve({ id }) });
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.context.mockResolvedValue({ user: { id: ACCOUNT }, sessionId: SESSION });
  mocks.person.mockResolvedValue({ handle: { id: SUBJECT }, counterpartAccountId: COUNTERPART });
  mocks.capability.mockResolvedValue({ status: "permitted", userFacingCopy: "allowed" });
  mocks.rpc.mockImplementation(async (name: string) => name === "stop_subject_sharing_v1"
    ? { data: [{ ended_at: "2026-10-16T12:00:00.000Z", deleted_counts: { portrait_results: 2, chat_messages: 3 } }], error: null }
    : { data: 1, error: null });
});

describe("POST /api/subjects/[id]/sharing", () => {
  it("pauses over the counterpart the route subject resolves to, never a request field", async () => {
    const response = await call({ operation: "pause" });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(Object.keys(body).sort()).toEqual(["effectiveAt", "state"]);
    expect(body.state).toBe("sharing_paused");
    expect(Number.isNaN(Date.parse(body.effectiveAt))).toBe(false);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(mocks.person).toHaveBeenCalledWith(ACCOUNT, `s-${SUBJECT}`);
    expect(mocks.rpc).toHaveBeenCalledWith("pause_family_sharing_v1", { p_account_id: ACCOUNT, p_counterpart_account_id: COUNTERPART });
    expect(mocks.capability).not.toHaveBeenCalled();
  });

  it("resumes only after the jurisdiction recheck permits it", async () => {
    const response = await call({ operation: "resume" });
    expect(response.status).toBe(200);
    expect((await response.json()).state).toBe("sharing_active");
    expect(mocks.capability).toHaveBeenCalledWith(ACCOUNT, expect.objectContaining({ counterpartAccountId: COUNTERPART }), "third_party_adult_analysis");
    expect(mocks.rpc).toHaveBeenCalledWith("resume_family_sharing_v1", { p_account_id: ACCOUNT, p_counterpart_account_id: COUNTERPART });
  });

  it("refuses a resume the jurisdiction does not permit with capability-denied-api-v1 and no write", async () => {
    mocks.capability.mockResolvedValue({ status: "unavailable", userFacingCopy: "Not available here." });
    const response = await call({ operation: "resume" });
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "jurisdiction_unavailable", message: "Not available here." });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("does not gate pause or stop on the jurisdiction: they are rights", async () => {
    mocks.capability.mockResolvedValue({ status: "unavailable", userFacingCopy: "Not available here." });
    expect((await call({ operation: "pause" })).status).toBe(200);
    expect((await call({ operation: "stop", nonce: stopCode() })).status).toBe(200);
    expect(mocks.capability).not.toHaveBeenCalled();
  });

  it("stops with the single-use code, recording its hash in the same database call", async () => {
    const nonce = stopCode();
    const response = await call({ operation: "stop", nonce });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ state: "sharing_ended", effectiveAt: "2026-10-16T12:00:00.000Z", deletedResultCount: 5 });
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    const [name, args] = mocks.rpc.mock.calls[0];
    expect(name).toBe("stop_subject_sharing_v1");
    expect(args).toMatchObject({ p_account_id: ACCOUNT, p_session_id: SESSION, p_subject_id: SUBJECT,
      p_counterpart_account_id: COUNTERPART, p_nonce_hash: hashOperationNonce(nonce) });
    expect(Date.parse(args.p_nonce_expires_at)).toBeGreaterThan(Date.now());
    expect(JSON.stringify(args)).not.toContain(nonce);
  });

  it.each([
    ["another account", { accountId: OTHER }],
    ["another session", { sessionId: OTHER }],
    ["another subject", { subjectId: OTHER }],
  ])("refuses a stop code minted for %s before any write", async (_label, overrides) => {
    const response = await call({ operation: "stop", nonce: stopCode(overrides) });
    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({ error: "invalid_request", issues: ["nonce"] });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("refuses a replayed stop code that the database has already recorded", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: "22023", message: "invalid_operation_nonce" } });
    const response = await call({ operation: "stop", nonce: stopCode() });
    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({ error: "invalid_request", issues: ["nonce"] });
  });

  it.each(["42501", "55000"])("answers an unavailable pair or pause (%s) with the opaque 404", async (code) => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code, message: "private detail" } });
    for (const body of [{ operation: "pause" }, { operation: "resume" }, { operation: "stop", nonce: stopCode() }]) {
      const response = await call(body);
      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ error: "not_found" });
    }
  });

  it("answers an unexpected database failure as unavailable, without detail", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: "XX000", message: "private detail" } });
    const response = await call({ operation: "pause" });
    expect(response.status).toBe(503);
    expect(JSON.stringify(await response.json())).not.toContain("private");
  });

  it("refuses an unknown, foreign or minor record with the same 404 before reading the body", async () => {
    mocks.person.mockResolvedValue(null);
    const response = await call("not json at all");
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "not_found" });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("refuses a resolution that names a different record than the route", async () => {
    mocks.person.mockResolvedValue({ handle: { id: OTHER }, counterpartAccountId: COUNTERPART });
    expect((await call({ operation: "pause" })).status).toBe(404);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it.each(["s-cccccccc-cccc-4ccc-8ccc-cccccccccccc", "bind", "CCCCCCCC-CCCC-4CCC-8CCC-CCCCCCCCCCCC", "me"])(
    "never resolves a non-canonical segment %s", async (id) => {
      const response = await call({ operation: "pause" }, { id });
      expect(response.status).toBe(404);
      expect(mocks.context).not.toHaveBeenCalled();
      expect(mocks.person).not.toHaveBeenCalled();
    });

  it("requires a signed-in session and the same origin before any lookup", async () => {
    mocks.context.mockResolvedValue(null);
    expect((await call({ operation: "pause" })).status).toBe(401);
    mocks.context.mockResolvedValue({ user: { id: ACCOUNT }, sessionId: SESSION });
    const forbidden = await call({ operation: "pause" }, { origin: "https://example.invalid" });
    expect(forbidden.status).toBe(403);
    expect(await forbidden.json()).toEqual({ error: "request_forbidden" });
    expect(mocks.person).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it.each([
    [{}, "body"], [{ operation: "delete" }, "body"], [{ operation: "pause", nonce: "x" }, "body"],
    [{ operation: "stop" }, "body"], [{ operation: "pause", counterpartAccountId: OTHER }, "body"],
    [{ operation: "stop", nonce: "x".repeat(129) }, "body"], ["{", "body"], [[], "body"],
  ])("refuses the closed body %j with invalid-request-v1 and no write", async (body, issue) => {
    const response = await call(body);
    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({ error: "invalid_request", issues: [issue] });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("refuses a body that is not declared as JSON", async () => {
    const response = await call({ operation: "pause" }, { contentType: "text/plain" });
    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({ error: "invalid_request", issues: ["content-type"] });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("refuses a stop result whose time is not a time", async () => {
    mocks.rpc.mockResolvedValue({ data: [{ ended_at: "not a time", deleted_counts: {} }], error: null });
    expect((await call({ operation: "stop", nonce: stopCode() })).status).toBe(503);
  });

  it("counts only non-negative whole numbers in the deleted total", async () => {
    mocks.rpc.mockResolvedValue({ data: [{ ended_at: "2026-10-16T12:00:00Z", deleted_counts: { a: 1, b: -4, c: "9", d: 1.5, e: 2 } }], error: null });
    expect((await (await call({ operation: "stop", nonce: stopCode() })).json()).deletedResultCount).toBe(3);
  });
});
