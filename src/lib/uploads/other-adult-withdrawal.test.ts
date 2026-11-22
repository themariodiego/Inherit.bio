import crypto from "node:crypto";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The server half of the uploader's withdrawal for another adult's file
 * (owner decision of 19 November 2026, "An uploader's withdrawal for another
 * adult's file deletes it, unless that adult holds the record themselves"):
 * what the person's card renders. It runs while the page renders, so it
 * writes nothing (brief X1.5): the only database call is the read, recorded
 * here. The code it mints verifies only for api.subject-delete on this record.
 */
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), calls: [] as [string, unknown][] }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc: (name: string, args: unknown) => {
  mocks.calls.push([name, args]); return Promise.resolve(mocks.rpc(name, args)); } }) }));
vi.stubEnv("BYOK_ENCRYPTION_KEY", crypto.randomBytes(32).toString("base64"));
const { prepareOtherAdultWithdrawal } = await import("./other-adult-upload-server");
const { createAdminClient } = await import("@/lib/supabase/admin");
const { verifySubjectOperationNonce } = await import("@/lib/subject-endpoints/operation-nonce");
afterAll(() => vi.unstubAllEnvs());

const ACCOUNT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SESSION = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const SUBJECT = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const ACTOR = { accountId: ACCOUNT, sessionId: SESSION };
type Target = Parameters<typeof prepareOtherAdultWithdrawal>[2];
const target = (state: Target["state"], signed = true): Target => ({ subjectId: SUBJECT, label: "Synthetic Relative",
  requestedAt: "2026-11-01T10:00:00Z", answerBy: null, state, signed, latest: null });
const prepare = (t: Target) => prepareOtherAdultWithdrawal(createAdminClient(), ACTOR, t);

beforeEach(() => {
  mocks.rpc.mockReset();
  mocks.calls.length = 0;
  mocks.rpc.mockReturnValue({ data: "ready", error: null });
});

describe("prepareOtherAdultWithdrawal", () => {
  it("reads the database's answer for this record, and mints a code only when the request can run", async () => {
    const view = await prepare(target("ready"));
    expect(mocks.calls).toEqual([["other_adult_withdrawal_readiness_v1", { p_account_id: ACCOUNT, p_subject_id: SUBJECT }]]);
    expect(view?.readiness).toBe("ready");
    expect(verifySubjectOperationNonce(view!.nonce, { ...ACTOR, operation: "subject_delete", subjectId: SUBJECT })).not.toBeNull();
    expect(verifySubjectOperationNonce(view!.nonce, { ...ACTOR, operation: "subject_delete",
      subjectId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd" })).toBeNull();
    expect(verifySubjectOperationNonce(view!.nonce, { ...ACTOR, operation: "subject_sharing_stop", subjectId: SUBJECT })).toBeNull();
    for (const readiness of ["account-held", "unsupported"]) {
      mocks.rpc.mockReturnValue({ data: readiness, error: null });
      expect(await prepare(target("pending")), readiness).toEqual({ readiness, nonce: null });
    }
  });

  it("mints the same code for a record its person holds, once the transfer is open and the read says hand-over", async () => {
    mocks.rpc.mockReturnValue({ data: "hand-over", error: null });
    const view = await prepare(target("ready"));
    expect(view?.readiness).toBe("hand-over");
    expect(verifySubjectOperationNonce(view!.nonce, { ...ACTOR, operation: "subject_delete", subjectId: SUBJECT })).not.toBeNull();
    expect(verifySubjectOperationNonce(view!.nonce, { ...ACTOR, operation: "subject_transfer", subjectId: SUBJECT })).toBeNull();
  });

  it("offers nothing for a request not yet confirmed, or without the uploader's live permission", async () => {
    for (const t of [target("awaiting-request"), target("awaiting-signature"), target("ready", false), target("pending", false)]) {
      expect(await prepare(t), JSON.stringify(t)).toBeUndefined();
    }
    expect(mocks.calls).toEqual([]);
  });

  it("offers nothing for a record the read does not find, and no request when the read fails", async () => {
    mocks.rpc.mockReturnValue({ data: null, error: { code: "42501", message: "not_found" } });
    expect(await prepare(target("ready"))).toBeUndefined();
    for (const answer of [{ data: null, error: { code: "PGRST202", message: "missing" } }, { data: "processing", error: null },
      { data: 7, error: null }]) {
      mocks.rpc.mockReturnValue(answer);
      expect(await prepare(target("ready")), JSON.stringify(answer)).toEqual({ readiness: "unavailable", nonce: null });
    }
  });
});
