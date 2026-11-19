import crypto from "node:crypto";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.stubEnv("BYOK_ENCRYPTION_KEY", crypto.randomBytes(32).toString("base64"));

const mocks = vi.hoisted(() => ({ context: vi.fn(), rpc: vi.fn(), drain: vi.fn() }));
vi.mock("@/lib/account-deletion", async (load) => ({
  ...await load<typeof import("@/lib/account-deletion")>(), getSensitiveAccountContext: mocks.context,
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc: mocks.rpc }) }));
vi.mock("@/lib/subject-endpoints/file-drain", () => ({ drainSubjectFileDeletions: mocks.drain }));

const { DELETE } = await import("./route");
const { mintSubjectOperationNonce } = await import("@/lib/subject-endpoints/operation-nonce");
const { hashOperationNonce } = await import("@/lib/account-deletion");
afterAll(() => vi.unstubAllEnvs());

const ACCOUNT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SESSION = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const SUBJECT = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const OTHER = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const FILES = ["11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222"];
const ORIGIN = "http://localhost";

type CodeContext = Partial<{ accountId: string; sessionId: string; subjectId: string; operation: "subject_delete" | "subject_sharing_stop" }>;
function deleteCode(overrides: CodeContext = {}) {
  return mintSubjectOperationNonce({ accountId: ACCOUNT, sessionId: SESSION, operation: "subject_delete", subjectId: SUBJECT, ...overrides });
}

function call(options: { id?: string; origin?: string | null; nonce?: string | null; body?: string } = {}) {
  const headers = new Headers();
  const origin = options.origin === undefined ? ORIGIN : options.origin;
  if (origin !== null) headers.set("origin", origin);
  const nonce = options.nonce === undefined ? deleteCode() : options.nonce;
  if (nonce !== null) headers.set("x-inherit-operation-nonce", nonce);
  if (options.body !== undefined) headers.set("content-length", String(options.body.length));
  const id = options.id ?? SUBJECT;
  return DELETE(new Request(`${ORIGIN}/api/subjects/${id}`, { method: "DELETE", headers, body: options.body }),
    { params: Promise.resolve({ id }) });
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.context.mockResolvedValue({ user: { id: ACCOUNT }, sessionId: SESSION });
  mocks.rpc.mockResolvedValue({ data: { case: "adult" }, error: null });
  mocks.drain.mockResolvedValue({ finished: 0, deferred: 0 });
});

describe("DELETE /api/subjects/[id]", () => {
  it("answers lifecycle-accepted-v1 exactly, after one call to the delete door with the code's hash", async () => {
    const code = deleteCode();
    const response = await call({ nonce: code });
    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ status: "accepted" });
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    const [name, args] = mocks.rpc.mock.calls[0];
    expect(name).toBe("delete_subject_v1");
    expect(args).toEqual({
      p_account_id: ACCOUNT, p_session_id: SESSION, p_subject_id: SUBJECT,
      p_nonce_hash: hashOperationNonce(code), p_nonce_expires_at: new Date(Number(code.split(".")[0])).toISOString(),
    });
  });

  it("finishes the emptied self record's files through the per-file pipeline, and only for the self case", async () => {
    mocks.rpc.mockResolvedValue({ data: { case: "self", files: FILES }, error: null });
    expect((await call()).status).toBe(202);
    expect(mocks.drain).toHaveBeenCalledTimes(1);
    expect(mocks.drain.mock.calls[0].slice(1, 3)).toEqual([{ accountId: ACCOUNT, sessionId: SESSION }, FILES]);
    for (const data of [{ case: "adult" }, { case: "embryo-other" }, { case: "embryo-transferred-unclaimed", sources: 1 }]) {
      mocks.drain.mockClear();
      mocks.rpc.mockResolvedValue({ data, error: null });
      expect((await call()).status).toBe(202);
      expect(mocks.drain).not.toHaveBeenCalled();
    }
  });

  it("still answers accepted when a file is left for the backstop", async () => {
    mocks.rpc.mockResolvedValue({ data: { case: "self", files: FILES }, error: null });
    mocks.drain.mockResolvedValue({ finished: 1, deferred: 1 });
    expect((await call()).status).toBe(202);
  });

  it("treats an answer it cannot read as committed work: accepted, and nothing is drained", async () => {
    mocks.rpc.mockResolvedValue({ data: { case: "self", files: ["not-a-uuid"] }, error: null });
    expect((await call()).status).toBe(202);
    mocks.rpc.mockResolvedValue({ data: { case: "self", files: FILES, extra: true }, error: null });
    expect((await call()).status).toBe(202);
    expect(mocks.drain).not.toHaveBeenCalled();
  });

  it("answers an id that is not one canonical UUID with 404 before any lookup", async () => {
    for (const id of ["bind", SUBJECT.toUpperCase(), `s-${SUBJECT}`, "00000000-0000-0000-0000-000000000000"]) {
      const response = await call({ id, nonce: null });
      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ error: "not_found" });
    }
    expect(mocks.context).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("needs a signed-in sensitive session and the same origin", async () => {
    mocks.context.mockResolvedValue(null);
    expect((await call()).status).toBe(401);
    mocks.context.mockResolvedValue({ user: { id: ACCOUNT }, sessionId: SESSION });
    expect((await call({ origin: "https://attacker.example" })).status).toBe(403);
    expect((await call({ origin: null })).status).toBe(403);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("forbids a body: the same 404, and nothing is written", async () => {
    const response = await call({ body: "{}" });
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "not_found" });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("answers a missing, foreign or other-operation code with the same 404 and no write", async () => {
    const codes = [null, "", "not-a-code", deleteCode({ subjectId: OTHER }), deleteCode({ accountId: OTHER }),
      deleteCode({ sessionId: OTHER }), deleteCode({ operation: "subject_sharing_stop" }), `${deleteCode()}x`];
    for (const nonce of codes) {
      const response = await call({ nonce });
      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ error: "not_found" });
    }
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("maps every refusal the caller can cause to the opaque 404, and anything else to 503", async () => {
    for (const code of ["42501", "55000", "22023", "23505", "P0002"]) {
      mocks.rpc.mockResolvedValue({ data: null, error: { code, message: "refused" } });
      const response = await call();
      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ error: "not_found" });
    }
    for (const error of [{ code: "XX000", message: "boom" }, { message: "network" }]) {
      mocks.rpc.mockResolvedValue({ data: null, error });
      expect((await call()).status).toBe(503);
    }
    expect(mocks.drain).not.toHaveBeenCalled();
  });
});
