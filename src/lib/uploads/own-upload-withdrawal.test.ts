import crypto from "node:crypto";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The server half of withdrawing the own-upload consent (owner decision of
 * 19 November 2026). What a page renders for the control is read while the
 * page renders, so it writes nothing (brief X1.5); the admin client below
 * records every call. The route's sealed address reads the database counter
 * before the address, so an address change can only make it stale.
 */
const mocks = vi.hoisted(() => ({
  calls: [] as string[],
  filters: [] as string[],
  account: vi.fn(),
  subject: vi.fn(),
  rpc: vi.fn(),
  getUser: vi.fn(),
  tables: {} as Record<string, { data: unknown; error: unknown }>,
}));
vi.mock("@/lib/account-deletion", async (load) => ({
  ...await load<typeof import("@/lib/account-deletion")>(), getSensitiveAccountContext: mocks.account,
}));
vi.mock("@/lib/subjects", () => ({ resolveSubjectForAccount: mocks.subject }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { getUser: async () => {
  mocks.calls.push("auth.getUser"); return mocks.getUser(); } } }) }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    rpc: (name: string, args: unknown) => { mocks.calls.push(`rpc(${name})`); return Promise.resolve(mocks.rpc(name, args)); },
    from: (table: string) => {
      mocks.calls.push(`from(${table})`);
      const chain: Record<string, unknown> = {};
      for (const method of ["select", "in", "is", "lte", "eq", "contains", "or", "order", "limit"]) {
        chain[method] = (...args: unknown[]) => { mocks.filters.push(`${table}.${method}(${JSON.stringify(args)})`); return chain; };
      }
      for (const write of ["insert", "upsert", "update", "delete"]) {
        chain[write] = () => { mocks.calls.push(`${write}(${table})`); return chain; };
      }
      chain.maybeSingle = () => Promise.resolve(mocks.tables[table]);
      chain.single = () => Promise.resolve(mocks.tables[table]);
      return chain;
    },
  }),
}));
vi.stubEnv("BYOK_ENCRYPTION_KEY", crypto.randomBytes(32).toString("base64"));
const { prepareOwnUploadWithdrawal, selfWithdrawalNotice } = await import("./own-upload-withdrawal");
const { verifySubjectOperationNonce } = await import("@/lib/subject-endpoints/operation-nonce");
const { decryptSecret, hmacSecret } = await import("@/lib/crypto");
afterAll(() => vi.unstubAllEnvs());

const ACCOUNT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SESSION = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const SUBJECT = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const SIGNATURE = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

const writes = () => mocks.calls.filter(call => /^(insert|upsert|update|delete)\(/u.test(call)
  || (call.startsWith("rpc(") && call !== "rpc(self_subject_withdrawal_readiness_v1)"));

beforeEach(() => {
  mocks.calls.length = 0;
  mocks.filters.length = 0;
  mocks.account.mockReset().mockResolvedValue({ user: { id: ACCOUNT }, sessionId: SESSION });
  mocks.subject.mockReset().mockResolvedValue({ id: SUBJECT, subjectClass: "self", lifecycle: "active" });
  mocks.rpc.mockReset().mockReturnValue({ data: "ready", error: null });
  mocks.getUser.mockReset().mockResolvedValue({ data: { user: { id: ACCOUNT, email: " Person@Example.Invalid ",
    email_confirmed_at: "2026-11-01T00:00:00Z" } } });
  mocks.tables = {
    subject_consents: { data: { signature_id: SIGNATURE }, error: null },
    consent_signatures: { data: { artifact_version: 1, signed_at: "2026-11-02T10:00:00Z" }, error: null },
    profiles: { data: { mail_contact_revision: 4 }, error: null },
  };
});

describe("what a page renders for the control", () => {
  it("with a live upload consent and nothing in the way: the record, the signature and a code for this route and record", async () => {
    const view = await prepareOwnUploadWithdrawal();
    expect(view).toMatchObject({ kind: "live", subjectId: SUBJECT, signedAt: "2026-11-02T10:00:00Z", version: 1, readiness: "ready" });
    const nonce = (view as { nonce: string }).nonce;
    expect(verifySubjectOperationNonce(nonce, { accountId: ACCOUNT, sessionId: SESSION, operation: "subject_delete",
      subjectId: SUBJECT })).not.toBeNull();
    expect(verifySubjectOperationNonce(nonce, { accountId: ACCOUNT, sessionId: SESSION, operation: "subject_sharing_stop",
      subjectId: SUBJECT })).toBeNull();
    expect(mocks.rpc).toHaveBeenCalledWith("self_subject_withdrawal_readiness_v1", { p_account_id: ACCOUNT, p_subject_id: SUBJECT });
    expect(writes()).toEqual([]);
  });

  it("reads exactly the live upload_class row of the account's own record, and its consent.upload-self signature", async () => {
    await prepareOwnUploadWithdrawal();
    for (const filter of [`subject_consents.eq(["subject_id","${SUBJECT}"])`, `subject_consents.eq(["account_id","${ACCOUNT}"])`,
      'subject_consents.eq(["consent_type","upload_class"])', 'subject_consents.is(["revoked_at",null])',
      'subject_consents.contains(["scope",["store"]])', `consent_signatures.eq(["id","${SIGNATURE}"])`,
      'consent_signatures.eq(["artifact_key","consent.upload-self"])', `consent_signatures.eq(["signer_account_id","${ACCOUNT}"])`]) {
      expect(mocks.filters).toContain(filter);
    }
  });

  it("renders nothing without a session, an own active record, a live consent or its signature", async () => {
    mocks.account.mockResolvedValueOnce(null);
    expect(await prepareOwnUploadWithdrawal()).toEqual({ kind: "none" });
    mocks.subject.mockResolvedValueOnce(null);
    expect(await prepareOwnUploadWithdrawal()).toEqual({ kind: "none" });
    mocks.tables.subject_consents = { data: null, error: null };
    expect(await prepareOwnUploadWithdrawal()).toEqual({ kind: "none" });
    mocks.tables.subject_consents = { data: null, error: { message: "unavailable" } };
    expect(await prepareOwnUploadWithdrawal()).toEqual({ kind: "none" });
    mocks.tables.subject_consents = { data: { signature_id: SIGNATURE }, error: null };
    mocks.tables.consent_signatures = { data: null, error: null };
    expect(await prepareOwnUploadWithdrawal()).toEqual({ kind: "none" });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("offers no request while the database would refuse it, and says why", async () => {
    for (const readiness of ["processing", "unsupported"]) {
      mocks.rpc.mockReturnValueOnce({ data: readiness, error: null });
      expect(await prepareOwnUploadWithdrawal()).toMatchObject({ kind: "live", readiness, nonce: null });
    }
  });

  it("fails closed when the database cannot say: before its migration is hosted the read is missing, and no request is offered", async () => {
    for (const answer of [{ data: null, error: { code: "PGRST202", message: "Could not find the function" } },
      { data: null, error: { code: "42501", message: "not_found" } }, { data: "something-else", error: null }]) {
      mocks.rpc.mockReturnValueOnce(answer);
      expect(await prepareOwnUploadWithdrawal()).toMatchObject({ kind: "live", readiness: "unavailable", nonce: null });
    }
    expect(writes()).toEqual([]);
  });
});

describe("the address the confirmation email goes to", () => {
  it("is the signed-in account's own confirmed address, sealed and keyed, with the counter read first", async () => {
    const notice = await selfWithdrawalNotice(ACCOUNT);
    expect(mocks.calls.indexOf("from(profiles)")).toBeLessThan(mocks.calls.indexOf("auth.getUser"));
    expect(notice).toEqual({ contactRevision: 4, contactCiphertext: expect.stringMatching(/^[0-9a-f]+$/u),
      contactHmac: hmacSecret("person@example.invalid", "contact-email-v1") });
    expect(decryptSecret(Buffer.from(notice!.contactCiphertext, "hex"))).toBe("person@example.invalid");
    expect(writes()).toEqual([]);
  });

  it("is none for an account with no confirmed address, or a session for another account", async () => {
    for (const user of [{ id: ACCOUNT, email: "person@example.invalid", email_confirmed_at: null },
      { id: ACCOUNT, email: null, email_confirmed_at: "2026-11-01T00:00:00Z" },
      { id: SUBJECT, email: "person@example.invalid", email_confirmed_at: "2026-11-01T00:00:00Z" }, null]) {
      mocks.getUser.mockResolvedValueOnce({ data: { user } });
      expect(await selfWithdrawalNotice(ACCOUNT)).toBeNull();
    }
  });

  it("throws when the counter cannot be read, so the route answers 503 and deletes nothing", async () => {
    for (const profile of [{ data: null, error: { message: "unavailable" } }, { data: { mail_contact_revision: 0 }, error: null }]) {
      mocks.tables.profiles = profile;
      await expect(selfWithdrawalNotice(ACCOUNT)).rejects.toThrow("unavailable");
    }
  });
});
