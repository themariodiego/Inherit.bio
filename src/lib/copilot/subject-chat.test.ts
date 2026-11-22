import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Copilot for one other adult's record, server side (owner decision of
 * 19 November 2026, "G8.5: Copilot for another adult's record opens"). The
 * database, the Family graph, the readers and the provider are replaced at
 * their module boundaries. Under test: which address names which
 * relationship, the page's states in the register's order with nothing read
 * past the first that fails, the one reader each relationship uses, the
 * per-turn recheck, and the history reader. Every value is synthetic.
 */
const mocks = vi.hoisted(() => ({
  actor: vi.fn(), subject: vi.fn(), people: vi.fn(), capability: vi.fn(), acknowledged: vi.fn(), prepare: vi.fn(),
  assert: vi.fn(), rpc: vi.fn(), shared: vi.fn(), pathB: vi.fn(), localAllowed: vi.fn(), mint: vi.fn(),
}));
vi.mock("@/lib/uploads/own-upload-context", () => ({ currentOwnUploadAccount: mocks.actor }));
vi.mock("@/lib/subjects", () => ({ resolveSubjectForAccount: mocks.subject }));
vi.mock("@/lib/family/graph", () => ({ listFamilyPeople: mocks.people }));
vi.mock("@/lib/family/access", () => ({ familyCapability: mocks.capability }));
vi.mock("@/lib/family/tier2", () => ({ acknowledged: mocks.acknowledged }));
vi.mock("@/lib/family/shared-report-results", () => ({ loadSharedReportSnapshot: mocks.shared }));
vi.mock("@/lib/uploads/path-b-report-reader", () => ({ loadPathBReportSnapshot: mocks.pathB }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc: mocks.rpc, from: () => ({}) }) }));
vi.mock("./own-provider-authority", () => ({ prepareOwnCopilotProvider: mocks.prepare, assertOwnCopilotAuthority: mocks.assert }));
vi.mock("./model-endpoint", () => ({ modelRuntime: () => ({ localAllowed: mocks.localAllowed() }) }));
vi.mock("./subject-chat-token", () => ({ mintSubjectChatToken: mocks.mint }));
vi.mock("./own-chat-token", () => ({ snapshotHash: (value: unknown) => JSON.stringify(value) }));
import { captureSubjectReports, checkSubjectTurn, prepareSubjectCopilotChat, readSubjectChatHistory, resolveSubjectTarget,
  subjectCopilotOpens, subjectMember } from "./subject-chat";

const accountId = "82000000-0000-4000-8000-000000000001", sessionId = "82000000-0000-4000-8000-000000000002";
const selfId = "82000000-0000-4000-8000-000000000003", chatId = "82000000-0000-4000-8000-000000000004";
const B = "12000000-0000-4000-8000-00000000000b", B_ACCOUNT = "42000000-0000-4000-8000-00000000000b";
const HANDLE = "32000000-0000-4000-8000-00000000000b", PATH_B = "12000000-0000-4000-8000-0000000000bb";
const provider = { accountId, sessionId, subjectId: selfId, providerClass: "local" };
const authority = { case: "grantee", subjectId: B, accountId: B_ACCOUNT, lifecycleRevision: 1, subjectBindingRevision: 1,
  relationship: { id: "52000000-0000-4000-8000-00000000000b", revision: 1 },
  copilot: { purpose: "copilot.local", grantId: "62000000-0000-4000-8000-00000000000b", grantRevision: 1 },
  layers: [{ purpose: "reports.polygenic", grantId: "92000000-0000-4000-8000-00000000000b", grantRevision: 1 }] };
const bea = { dataSubjectId: B, counterpartAccountId: B_ACCOUNT, displayLabel: "Bea", sharing: "active",
  handle: { id: HANDLE, routeSegment: `s-${HANDLE}` } };
const rpcCalls = (name: string) => mocks.rpc.mock.calls.filter(call => call[0] === name);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.actor.mockResolvedValue({ accountId, sessionId });
  mocks.localAllowed.mockReturnValue(true);
  mocks.capability.mockResolvedValue({ status: "permitted", userFacingCopy: "" });
  mocks.acknowledged.mockResolvedValue(true);
  mocks.subject.mockImplementation(async (_account: string, segment: string) =>
    segment === "me" ? { id: selfId, subjectClass: "self" } : null);
  mocks.people.mockResolvedValue([bea]);
  mocks.prepare.mockResolvedValue({ authority: provider, settings: { provider: "openai_compatible", base_url: "http://127.0.0.1:8127/v1", model: "synthetic" } });
  mocks.assert.mockResolvedValue(true);
  mocks.mint.mockReturnValue("minted-subject-token");
  mocks.rpc.mockImplementation(async (name: string, args: { p_operation?: string }) => {
    if (name === "subject_copilot_scope_v1") return { data: { state: "ready", authority }, error: null };
    if (args.p_operation === "list") return { data: [{ id: chatId, created_at: "2026-11-20T10:00:00Z" }], error: null };
    if (args.p_operation === "history") return { data: { chatId, lastOrdinal: 1, messages: [
      { id: "a2000000-0000-4000-8000-000000000001", role: "user", content: [{ type: "text", text: "Q" }], citations: [], turn_ordinal: 1, created_at: "2026-11-20T10:00:00Z" },
      { id: "a2000000-0000-4000-8000-000000000002", role: "assistant", content: [{ type: "text", text: "A" }], citations: [], turn_ordinal: 1, created_at: "2026-11-20T10:00:00Z" }] }, error: null };
    return { data: true, error: null };
  });
});

describe("which relationship an address names", () => {
  it("a Path B record the asker added and its person holds is the uploader case; their Family person's own record is the grantee case", async () => {
    mocks.subject.mockImplementation(async (_account: string, segment: string) => segment === `s-${PATH_B}`
      ? { id: PATH_B, subjectClass: "other_adult", ownerAccountId: accountId, subjectAccountId: B_ACCOUNT, displayLabel: "Synthetic Relative" } : null);
    expect(await resolveSubjectTarget(accountId, PATH_B)).toEqual({ case: "uploader", subjectId: PATH_B,
      displayLabel: "Synthetic Relative", handleSegment: `s-${PATH_B}` });
    expect(await resolveSubjectTarget(accountId, B)).toEqual({ case: "grantee", subjectId: B, displayLabel: "Bea",
      handleSegment: `s-${HANDLE}` });
  });

  it("names nothing else: a record with no person account, the asker's own, an unknown id, a malformed id", async () => {
    for (const held of [
      { id: PATH_B, subjectClass: "other_adult", ownerAccountId: accountId, subjectAccountId: null },
      { id: PATH_B, subjectClass: "other_adult", ownerAccountId: B_ACCOUNT, subjectAccountId: accountId },
      { id: PATH_B, subjectClass: "self", ownerAccountId: accountId, subjectAccountId: accountId },
      { id: PATH_B, subjectClass: "minor", ownerAccountId: accountId, subjectAccountId: null },
    ]) {
      mocks.subject.mockResolvedValueOnce(held);
      expect(await resolveSubjectTarget(accountId, PATH_B)).toBeNull();
    }
    expect(await resolveSubjectTarget(accountId, "12000000-0000-4000-8000-0000000000ff")).toBeNull();
    expect(await resolveSubjectTarget(accountId, "not-a-uuid")).toBeNull();
  });
});

describe("the page, in the register's order", () => {
  it("is the same 404 for no relationship, before anything else is read", async () => {
    mocks.people.mockResolvedValue([]);
    expect(await prepareSubjectCopilotChat(B)).toBeNull();
    expect(mocks.capability).not.toHaveBeenCalled();
    expect(mocks.prepare).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("off an attested same-host model: the unavailable page, with no jurisdiction, provider, scope, history or token", async () => {
    mocks.localAllowed.mockReturnValue(false);
    expect(await prepareSubjectCopilotChat(B)).toEqual({ kind: "transport_unavailable" });
    expect(mocks.capability).not.toHaveBeenCalled();
    expect(mocks.prepare).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.mint).not.toHaveBeenCalled();
    expect(await subjectCopilotOpens(B)).toBe(false);
    expect(mocks.people).toHaveBeenCalledOnce();
  });

  it("then the asker's jurisdiction, with the register's own words and nothing about the record read", async () => {
    mocks.capability.mockResolvedValue({ status: "unreviewed", userFacingCopy: "Not available here." });
    expect(await prepareSubjectCopilotChat(B)).toEqual({ kind: "jurisdiction_unavailable", copy: "Not available here.", displayLabel: "Bea" });
    expect(mocks.capability).toHaveBeenCalledWith(accountId, [], "third_party_adult_analysis");
    expect(mocks.prepare).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("then the asker's own local model: a cloud provider, or none, is provider-required", async () => {
    mocks.prepare.mockResolvedValueOnce({ authority: { ...provider, providerClass: "cloud" }, settings: {} });
    expect((await prepareSubjectCopilotChat(B))!.kind).toBe("provider_required");
    mocks.prepare.mockResolvedValueOnce(null);
    expect((await prepareSubjectCopilotChat(B))!.kind).toBe("provider_required");
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("then the database's scope: held says nothing more; permission-missing; a scope the database does not confirm is 404", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: { state: "held" }, error: null });
    expect(await prepareSubjectCopilotChat(B)).toEqual({ kind: "held", displayLabel: "Bea" });
    mocks.rpc.mockResolvedValueOnce({ data: { state: "permission-missing" }, error: null });
    expect(await prepareSubjectCopilotChat(B)).toEqual({ kind: "permission_missing", displayLabel: "Bea" });
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { code: "42501", message: "not_found" } });
    expect(await prepareSubjectCopilotChat(B)).toBeNull();
    mocks.rpc.mockResolvedValueOnce({ data: { state: "ready", authority: { ...authority, subjectId: PATH_B } }, error: null });
    expect(await prepareSubjectCopilotChat(B)).toBeNull();
    expect(rpcCalls("subject_copilot_chat_v1")).toHaveLength(0);
    expect(mocks.mint).not.toHaveBeenCalled();
  });

  it("then the Tier-2 acknowledgement, and only then the thread with one token bound to this record and authority", async () => {
    mocks.acknowledged.mockResolvedValueOnce(false);
    expect(await prepareSubjectCopilotChat(B)).toEqual({ kind: "gated", displayLabel: "Bea" });
    expect(mocks.mint).not.toHaveBeenCalled();
    const view = await prepareSubjectCopilotChat(B);
    expect(view).toMatchObject({ kind: "ready", displayLabel: "Bea", contextToken: "minted-subject-token", layers: ["estimate"],
      chats: [{ id: chatId, createdAt: "2026-11-20T10:00:00.000Z" }], providerInfo: { local: true } });
    expect(mocks.mint).toHaveBeenCalledExactlyOnceWith({ accountId, sessionId, subjectId: B,
      providerHash: JSON.stringify(provider), authorityHash: JSON.stringify(authority) });
    expect(rpcCalls("subject_copilot_scope_v1")[0]![1]).toEqual({ p_account_id: accountId, p_session_id: sessionId, p_subject_id: B });
    expect(await subjectCopilotOpens(B)).toBe(true);
  });
});

describe("one turn", () => {
  const target = { case: "grantee" as const, subjectId: B, displayLabel: "Bea", handleSegment: `s-${HANDLE}` };
  it("reads a grantee's shared reports through the Family recipient reader, for the authority's layers only", async () => {
    const confirm = vi.fn().mockResolvedValue({ authorized: true });
    mocks.shared.mockResolvedValue({ authorized: true, access: [{ purpose: "reports.polygenic", kind: "canonical" }],
      reports: [{ subjectId: B, purpose: "reports.polygenic" }, { subjectId: PATH_B, purpose: "reports.polygenic" }], confirm });
    const member = subjectMember(target, authority as never);
    const capture = await captureSubjectReports(member);
    expect(mocks.shared).toHaveBeenCalledWith(expect.anything(), { subjectId: B, counterpartAccountId: B_ACCOUNT, purposes: ["reports.polygenic"] });
    expect(mocks.pathB).not.toHaveBeenCalled();
    expect(capture.rows.get(B)).toHaveLength(1);
    expect(await capture.confirm()).toBe(true);
    // A layer the reader returns beyond the authority's, or a legacy-only one, ends the turn.
    mocks.shared.mockResolvedValue({ authorized: true, access: [{ purpose: "reports.monogenic", kind: "canonical" }], reports: [], confirm });
    await expect(captureSubjectReports(member)).rejects.toThrow();
    mocks.shared.mockResolvedValue({ authorized: true, access: [{ purpose: "reports.polygenic", kind: "legacy-only" }], reports: [], confirm });
    await expect(captureSubjectReports(member)).rejects.toThrow();
    mocks.shared.mockResolvedValue({ authorized: false, access: [], reports: [], confirm });
    await expect(captureSubjectReports(member)).rejects.toThrow();
  });

  it("reads an uploader's through Path B's own reader, and names no Family page for the record", async () => {
    mocks.pathB.mockResolvedValue({ authorized: true, access: [{ purpose: "reports.polygenic", kind: "canonical" }], reports: [],
      confirm: async () => ({ authorized: false }) });
    const member = subjectMember({ ...target, case: "uploader", subjectId: PATH_B, handleSegment: `s-${PATH_B}` },
      { ...authority, case: "uploader", subjectId: PATH_B } as never);
    expect(member.personHref).toBeNull();
    const capture = await captureSubjectReports(member);
    expect(mocks.pathB).toHaveBeenCalledExactlyOnceWith(PATH_B);
    expect(mocks.shared).not.toHaveBeenCalled();
    expect(await capture.confirm()).toBe(false);
  });

  it("rechecks the session, both jurisdictions, Tier 2, the whole authority, the provider and every read, and only on a local model", async () => {
    const member = subjectMember(target, authority as never);
    const confirm = vi.fn().mockResolvedValue(true);
    await checkSubjectTurn({ accountId, sessionId }, selfId, provider as never, member, confirm);
    expect(mocks.capability).toHaveBeenCalledWith(accountId, [B_ACCOUNT], "third_party_adult_analysis");
    expect(rpcCalls("subject_copilot_chat_v1")[0]![1]).toMatchObject({ p_operation: "check", p_subject_id: B, p_chat_id: null,
      p_payload: { authority } });
    expect(confirm).toHaveBeenCalledOnce();
    for (const fail of [
      () => mocks.localAllowed.mockReturnValueOnce(false),
      () => mocks.actor.mockResolvedValueOnce({ accountId, sessionId: "82000000-0000-4000-8000-0000000000ff" }),
      () => mocks.capability.mockResolvedValueOnce({ status: "prohibited", userFacingCopy: "" }),
      () => mocks.acknowledged.mockResolvedValueOnce(false),
      () => mocks.rpc.mockResolvedValueOnce({ data: null, error: { code: "42501" } }),
      () => mocks.assert.mockResolvedValueOnce(false),
      () => confirm.mockResolvedValueOnce(false),
    ]) {
      fail();
      await expect(checkSubjectTurn({ accountId, sessionId }, selfId, provider as never, member, confirm)).rejects.toThrow();
    }
    await expect(checkSubjectTurn({ accountId, sessionId }, selfId, { ...provider, providerClass: "cloud" } as never, member, confirm))
      .rejects.toThrow();
  });
});

describe("the history reader", () => {
  const chats = { select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { scope_kind: "subject", subject_id: B,
    legacy_unverified: false, canonical_authority: { scope: "subject-adult" } }, error: null }) }) }) }) };
  beforeEach(() => {
    vi.doMock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc: mocks.rpc, from: () => chats }) }));
  });
  it("answers a subject conversation named for its person, and nothing off a local model", async () => {
    vi.resetModules();
    const fresh = await import("./subject-chat");
    expect(await fresh.readSubjectChatHistory(chatId)).toMatchObject({ chatId, scope: { kind: "subject", displayLabel: "Bea" },
      messages: [{ role: "user", content: "Q" }, { role: "assistant", content: "A" }] });
    mocks.localAllowed.mockReturnValue(false);
    expect(await fresh.readSubjectChatHistory(chatId)).toBeNull();
    mocks.localAllowed.mockReturnValue(true);
    mocks.prepare.mockResolvedValueOnce({ authority: { ...provider, providerClass: "cloud" }, settings: {} });
    expect(await fresh.readSubjectChatHistory(chatId)).toBeNull();
    mocks.people.mockResolvedValueOnce([]);
    expect(await fresh.readSubjectChatHistory(chatId)).toBeNull();
    vi.doUnmock("@/lib/supabase/admin");
  });
  it("is null for a conversation the database no longer reads", async () => {
    expect(readSubjectChatHistory).toBeTypeOf("function");
    vi.resetModules();
    const fresh = await import("./subject-chat");
    mocks.rpc.mockResolvedValueOnce({ data: null, error: null });
    expect(await fresh.readSubjectChatHistory(chatId)).toBeNull();
    vi.doUnmock("@/lib/supabase/admin");
  });
});
