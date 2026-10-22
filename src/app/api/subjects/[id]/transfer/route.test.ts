import crypto from "node:crypto";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.stubEnv("BYOK_ENCRYPTION_KEY", crypto.randomBytes(32).toString("base64"));

const mocks = vi.hoisted(() => ({ context: vi.fn(), rpc: vi.fn(), lookup: vi.fn(), filters: [] as unknown[][] }));
vi.mock("@/lib/account-deletion", async (load) => ({
  ...await load<typeof import("@/lib/account-deletion")>(), getSensitiveAccountContext: mocks.context,
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    rpc: mocks.rpc,
    from: (table: string) => {
      mocks.filters.push(["from", table]);
      const chain = {
        select: (columns: string) => { mocks.filters.push(["select", columns]); return chain; },
        eq: (column: string, value: unknown) => { mocks.filters.push(["eq", column, value]); return chain; },
        maybeSingle: () => mocks.lookup(),
      };
      return chain;
    },
  }),
}));

const { POST } = await import("./route");
const { mintSubjectOperationNonce } = await import("@/lib/subject-endpoints/operation-nonce");
const { hashOperationNonce } = await import("@/lib/account-deletion");
afterAll(() => vi.unstubAllEnvs());

const ACCOUNT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SESSION = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const SUBJECT = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const OTHER = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const ORIGIN = "http://localhost";
const EFFECTIVE = "2026-10-22T12:00:00.123456+00:00";

type CodeContext = Partial<{ accountId: string; sessionId: string; subjectId: string;
  operation: "subject_transfer" | "subject_delete" | "subject_sharing_stop" }>;
function transferCode(overrides: CodeContext = {}) {
  return mintSubjectOperationNonce({ accountId: ACCOUNT, sessionId: SESSION, operation: "subject_transfer", subjectId: SUBJECT, ...overrides });
}

function call(options: { id?: string; origin?: string | null; body?: unknown; raw?: string; contentType?: string | null } = {}) {
  const headers = new Headers();
  const origin = options.origin === undefined ? ORIGIN : options.origin;
  if (origin !== null) headers.set("origin", origin);
  const contentType = options.contentType === undefined ? "application/json" : options.contentType;
  if (contentType !== null) headers.set("content-type", contentType);
  const id = options.id ?? SUBJECT;
  const text = options.raw ?? JSON.stringify(options.body === undefined ? { nonce: transferCode() } : options.body);
  return POST(new Request(`${ORIGIN}/api/subjects/${id}/transfer`, { method: "POST", headers, body: text }),
    { params: Promise.resolve({ id }) });
}

const ok = (overrides: Record<string, unknown> = {}) => ({
  data: { status: "transferred", subjectId: SUBJECT, effectiveAt: EFFECTIVE, relocations: 1, ...overrides }, error: null,
});

beforeEach(() => {
  vi.resetAllMocks();
  mocks.filters.length = 0;
  mocks.context.mockResolvedValue({ user: { id: ACCOUNT }, sessionId: SESSION });
  mocks.lookup.mockResolvedValue({ data: { id: SUBJECT }, error: null });
  mocks.rpc.mockResolvedValue({ data: null, error: { code: "42501" } });
});

describe("POST /api/subjects/[id]/transfer", () => {
  it("is not found while the door is closed, after one call with the code's hash", async () => {
    const code = transferCode();
    const response = await call({ body: { nonce: code } });
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "not_found" });
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    expect(mocks.rpc.mock.calls[0]).toEqual(["transfer_subject_v1", {
      p_account_id: ACCOUNT, p_session_id: SESSION, p_subject_id: SUBJECT,
      p_nonce_hash: hashOperationNonce(code), p_nonce_expires_at: new Date(Number(code.split(".")[0])).toISOString(),
    }]);
  });

  it("answers subject-transfer-v1 exactly when the door commits", async () => {
    mocks.rpc.mockResolvedValue(ok());
    const response = await call();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    const body = await response.json();
    expect(body).toEqual({ status: "transferred", subjectId: SUBJECT, effectiveAt: new Date(EFFECTIVE).toISOString() });
    expect(Object.keys(body)).toEqual(["status", "subjectId", "effectiveAt"]);
  });

  it("checks the record against the session's own person account before the body", async () => {
    expect((await call()).status).toBe(404);
    expect(mocks.filters).toEqual([["from", "subjects"], ["select", "id"], ["eq", "id", SUBJECT],
      ["eq", "subject_account_id", ACCOUNT], ["eq", "subject_class", "other_adult"], ["eq", "lifecycle", "active"]]);
    mocks.rpc.mockClear();
    mocks.lookup.mockResolvedValue({ data: null, error: null });
    for (const options of [{}, { raw: "not json" }, { body: { nonce: transferCode(), extra: 1 } }, { contentType: "text/plain" }]) {
      const response = await call(options);
      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ error: "not_found" });
    }
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("is not found for a segment that is not a canonical record id, before any lookup", async () => {
    for (const id of ["bind", SUBJECT.toUpperCase(), `${SUBJECT}x`]) expect((await call({ id })).status).toBe(404);
    expect(mocks.filters).toEqual([]);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("needs a session and the same origin", async () => {
    mocks.context.mockResolvedValue(null);
    expect((await call()).status).toBe(401);
    mocks.context.mockResolvedValue({ user: { id: ACCOUNT }, sessionId: SESSION });
    expect((await call({ origin: "https://elsewhere.example" })).status).toBe(403);
    expect((await call({ origin: null })).status).toBe(403);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("refuses a body that is not exactly the closed nonce body", async () => {
    const cases: [Parameters<typeof call>[0], string][] = [
      [{ contentType: "text/plain" }, "content-type"], [{ contentType: null }, "content-type"],
      [{ raw: "{" }, "body"], [{ body: {} }, "body"], [{ body: { nonce: transferCode(), subjectId: OTHER } }, "body"],
      [{ body: { nonce: 7 } }, "body"], [{ body: { nonce: "x".repeat(129) } }, "body"], [{ body: [transferCode()] }, "body"],
    ];
    for (const [options, issue] of cases) {
      const response = await call(options);
      expect(response.status).toBe(422);
      expect(await response.json()).toEqual({ error: "invalid_request", issues: [issue] });
    }
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("refuses a code minted for another operation, record, account or session, or one that has expired", async () => {
    const codes = [
      transferCode({ operation: "subject_delete" }), transferCode({ operation: "subject_sharing_stop" }),
      transferCode({ subjectId: OTHER }), transferCode({ accountId: OTHER }), transferCode({ sessionId: OTHER }),
      mintSubjectOperationNonce({ accountId: ACCOUNT, sessionId: SESSION, operation: "subject_transfer", subjectId: SUBJECT },
        Date.now() - 11 * 60 * 1000),
    ];
    for (const nonce of codes) {
      const response = await call({ body: { nonce } });
      expect(response.status).toBe(422);
      expect(await response.json()).toEqual({ error: "invalid_request", issues: ["nonce"] });
    }
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("maps the door's refusals to the register's bound answers", async () => {
    for (const [code, status] of [["42501", 404], ["55000", 404], ["22023", 422], ["23505", 422], ["XX000", 503], [undefined, 503]] as const) {
      mocks.rpc.mockResolvedValue({ data: null, error: code === undefined ? {} : { code } });
      expect((await call()).status).toBe(status);
    }
    mocks.lookup.mockResolvedValue({ data: null, error: { code: "XX000" } });
    expect((await call()).status).toBe(503);
  });

  it("never answers success for a door answer it cannot read, or for another record", async () => {
    for (const answer of [ok({ subjectId: OTHER }), ok({ status: "accepted" }), ok({ effectiveAt: "later" }),
      ok({ formerOwnerAccountId: OTHER }), { data: null, error: null }]) {
      mocks.rpc.mockResolvedValue(answer);
      expect((await call()).status).toBe(503);
    }
  });
});
