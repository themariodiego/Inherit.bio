import crypto from "node:crypto";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
// The one-time X-Inherit-CSRF gate is driven on this route by
// src/lib/security/session-csrf-routes.test.ts; here it admits every request.
vi.mock("@/lib/security/session-csrf", async (importOriginal) =>
  (await import("@/lib/security/session-csrf.test-support")).admitEverySessionCsrf(await importOriginal()));

vi.stubEnv("BYOK_ENCRYPTION_KEY", crypto.randomBytes(32).toString("base64"));

const mocks = vi.hoisted(() => ({ context: vi.fn(), rpc: vi.fn(), drain: vi.fn(), subject: vi.fn(), notice: vi.fn(),
  reads: [] as unknown[][] }));
vi.mock("@/lib/account-deletion", async (load) => ({
  ...await load<typeof import("@/lib/account-deletion")>(), getSensitiveAccountContext: mocks.context,
}));
// The route reads the record's class to choose its door (20261119150000):
// every read is recorded, and answers what `mocks.subject` says.
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc: mocks.rpc,
  from: (table: string) => ({ select: (columns: string) => ({ eq: (column: string, value: string) => ({
    maybeSingle: () => { mocks.reads.push([table, columns, column, value]); return mocks.subject(); } }) }) }) }) }));
vi.mock("@/lib/subject-endpoints/file-drain", () => ({ drainSubjectFileDeletions: mocks.drain }));
vi.mock("@/lib/uploads/own-upload-withdrawal", () => ({ selfWithdrawalNotice: mocks.notice }));

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
const NOTICE = { contactRevision: 3, contactCiphertext: "ab".repeat(40), contactHmac: "c".repeat(64) };

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
  mocks.reads.length = 0;
  mocks.context.mockResolvedValue({ user: { id: ACCOUNT }, sessionId: SESSION });
  mocks.rpc.mockResolvedValue({ data: { case: "adult" }, error: null });
  mocks.drain.mockResolvedValue({ finished: 0, deferred: 0 });
  // Every test written before the self door reads a record that is not a self record.
  mocks.subject.mockResolvedValue({ data: { subject_class: "other_adult" }, error: null });
  mocks.notice.mockResolvedValue(NOTICE);
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

/**
 * The self case is the withdrawal of the account's consent to store its own
 * DNA file (owner decision of 19 November 2026, "Withdrawing consent for a
 * person's own DNA file deletes the files and all made from them"). It goes
 * to its own door, which runs delete_subject_v1 unchanged and queues the
 * confirmation email in the same transaction (20261119150000).
 */
describe("DELETE /api/subjects/[id] for the account's own record: the withdrawal", () => {
  beforeEach(() => {
    mocks.subject.mockResolvedValue({ data: { subject_class: "self" }, error: null });
    mocks.rpc.mockResolvedValue({ data: { case: "self", files: FILES }, error: null });
  });

  it("calls only the notice door, with the code's hash and the sealed address, then drains the files", async () => {
    const code = deleteCode();
    const response = await call({ nonce: code });
    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ status: "accepted" });
    expect(mocks.reads).toEqual([["subjects", "subject_class, owner_account_id, subject_account_id", "id", SUBJECT]]);
    expect(mocks.notice).toHaveBeenCalledWith(ACCOUNT);
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    expect(mocks.rpc).toHaveBeenCalledWith("empty_self_subject_with_notice_v1", {
      p_account_id: ACCOUNT, p_session_id: SESSION, p_subject_id: SUBJECT,
      p_nonce_hash: hashOperationNonce(code), p_nonce_expires_at: new Date(Number(code.split(".")[0])).toISOString(),
      p_notice: NOTICE,
    });
    expect(mocks.drain).toHaveBeenCalledTimes(1);
    expect(mocks.drain.mock.calls[0].slice(1, 3)).toEqual([{ accountId: ACCOUNT, sessionId: SESSION }, FILES]);
  });

  it("never sends a self record to delete_subject_v1, so no emptying goes without its email", async () => {
    mocks.notice.mockResolvedValue(null);
    const response = await call();
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "not_found" });
    expect(mocks.rpc).not.toHaveBeenCalled();
    mocks.notice.mockRejectedValue(new Error("unavailable"));
    expect((await call()).status).toBe(503);
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.drain).not.toHaveBeenCalled();
  });

  it("answers 503 and writes nothing when the record's class cannot be read", async () => {
    mocks.subject.mockResolvedValue({ data: null, error: { message: "unavailable" } });
    expect((await call()).status).toBe(503);
    expect(mocks.notice).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("answers every database refusal of the withdrawal with the opaque 404, and drains nothing", async () => {
    for (const message of ["subject_delete_processing", "subject_delete_unsupported_graph", "file_delete_processing",
      "withdrawal_notice_unavailable", "withdrawal_notice_recipient_stale", "invalid_request", "not_found"]) {
      mocks.rpc.mockResolvedValue({ data: null, error: { code: message === "not_found" ? "42501"
        : message === "invalid_request" ? "22023" : "55000", message } });
      const response = await call();
      expect(response.status, message).toBe(404);
      expect(await response.json()).toEqual({ error: "not_found" });
    }
    expect(mocks.drain).not.toHaveBeenCalled();
  });

  it("checks the code, the origin and the session before it reads anything", async () => {
    expect((await call({ nonce: null })).status).toBe(404);
    expect((await call({ origin: "https://attacker.example" })).status).toBe(403);
    mocks.context.mockResolvedValue(null);
    expect((await call()).status).toBe(401);
    expect(mocks.reads).toEqual([]);
    expect(mocks.notice).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("still sends a record that is not a self record to delete_subject_v1, with no address", async () => {
    for (const subjectClass of ["other_adult", "embryo", null]) {
      mocks.rpc.mockClear();
      mocks.subject.mockResolvedValue({ data: subjectClass ? { subject_class: subjectClass } : null, error: null });
      mocks.rpc.mockResolvedValue({ data: { case: "adult" }, error: null });
      expect((await call()).status).toBe(202);
      expect(mocks.rpc.mock.calls.map(([name, args]) => [name, "p_notice" in args])).toEqual([["delete_subject_v1", false]]);
    }
    expect(mocks.notice).not.toHaveBeenCalled();
  });
});

/**
 * The uploader's withdrawal of its permission for another adult's file (owner
 * decision of 19 November 2026, "An uploader's withdrawal for another adult's
 * file deletes it, unless that adult holds the record themselves"). The
 * owning uploader's request goes only to its own door, which runs
 * delete_subject_v1 unchanged and queues the adult's notice in the same
 * transaction, and refuses a record the adult holds with their own account
 * (20261119160000). The adult's own delete still goes to delete_subject_v1.
 */
describe("DELETE /api/subjects/[id] for another adult's record the uploader owns: the withdrawal", () => {
  const PERSON = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
  beforeEach(() => {
    mocks.subject.mockResolvedValue({ data: { subject_class: "other_adult", owner_account_id: ACCOUNT, subject_account_id: null },
      error: null });
    mocks.rpc.mockResolvedValue({ data: { case: "adult" }, error: null });
  });

  it("calls only the withdrawal door, with the code's hash and no address, and drains nothing", async () => {
    const code = deleteCode();
    const response = await call({ nonce: code });
    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ status: "accepted" });
    expect(mocks.reads).toEqual([["subjects", "subject_class, owner_account_id, subject_account_id", "id", SUBJECT]]);
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    expect(mocks.rpc).toHaveBeenCalledWith("withdraw_other_adult_upload_v1", {
      p_account_id: ACCOUNT, p_session_id: SESSION, p_subject_id: SUBJECT,
      p_nonce_hash: hashOperationNonce(code), p_nonce_expires_at: new Date(Number(code.split(".")[0])).toISOString(),
    });
    expect(mocks.notice).not.toHaveBeenCalled();
    expect(mocks.drain).not.toHaveBeenCalled();
  });

  it("never sends the uploader's request to delete_subject_v1, so no delete goes without the notice", async () => {
    // A record the adult holds with their own account is still the door's to refuse.
    mocks.subject.mockResolvedValue({ data: { subject_class: "other_adult", owner_account_id: ACCOUNT, subject_account_id: PERSON },
      error: null });
    mocks.rpc.mockResolvedValue({ data: null, error: { code: "42501", message: "other_adult_withdrawal_account_held" } });
    const response = await call();
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "not_found" });
    expect(mocks.rpc.mock.calls.map(([name]) => name)).toEqual(["withdraw_other_adult_upload_v1"]);
  });

  it("answers every database refusal of the withdrawal with the opaque 404", async () => {
    for (const [code, message] of [["42501", "not_found"], ["42501", "other_adult_withdrawal_account_held"],
      ["55000", "withdrawal_notice_unavailable"], ["55000", "other_adult_withdrawal_case_differs"],
      ["22023", "invalid_operation_nonce"]] as const) {
      mocks.rpc.mockResolvedValue({ data: null, error: { code, message } });
      const response = await call();
      expect(response.status, message).toBe(404);
      expect(await response.json()).toEqual({ error: "not_found" });
    }
  });

  it("answers 503 when the door is missing, before its migration, and never falls back to delete_subject_v1", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: "PGRST202", message: "Could not find the function" } });
    const response = await call();
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "unavailable" });
    expect(mocks.rpc.mock.calls.map(([name]) => name)).toEqual(["withdraw_other_adult_upload_v1"]);
  });

  it("still sends the adult's own delete, and anyone else's request, to delete_subject_v1", async () => {
    for (const data of [
      { subject_class: "other_adult", owner_account_id: OTHER, subject_account_id: ACCOUNT },
      { subject_class: "other_adult", owner_account_id: ACCOUNT, subject_account_id: ACCOUNT },
      { subject_class: "other_adult", owner_account_id: OTHER, subject_account_id: null },
      { subject_class: "other_adult", owner_account_id: null, subject_account_id: ACCOUNT },
    ]) {
      mocks.rpc.mockClear();
      mocks.subject.mockResolvedValue({ data, error: null });
      expect((await call()).status).toBe(202);
      expect(mocks.rpc.mock.calls.map(([name]) => name), JSON.stringify(data)).toEqual(["delete_subject_v1"]);
    }
  });

  it("checks the code, the origin and the session before it reads anything", async () => {
    expect((await call({ nonce: deleteCode({ subjectId: OTHER }) })).status).toBe(404);
    expect((await call({ origin: "https://attacker.example" })).status).toBe(403);
    mocks.context.mockResolvedValue(null);
    expect((await call()).status).toBe(401);
    expect(mocks.reads).toEqual([]);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});
