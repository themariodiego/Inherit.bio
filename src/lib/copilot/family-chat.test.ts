import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The Family group scope's server module: who is in the group, what a turn
 * rechecks, and the page's registered order of states. The database, the
 * Family graph, the jurisdiction reader and the Family report reader are
 * replaced at their module boundaries; the module's own logic is real.
 */
const mocks = vi.hoisted(() => ({ actor: vi.fn(), rpc: vi.fn(), people: vi.fn(), capability: vi.fn(), assert: vi.fn(),
  prepare: vi.fn(), subject: vi.fn(), snapshot: vi.fn(), localAllowed: vi.fn(), built: vi.fn(), from: vi.fn() }));
vi.mock("@/lib/uploads/own-upload-context", () => ({ currentOwnUploadAccount: mocks.actor }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc: mocks.rpc, from: mocks.from }) }));
vi.mock("@/lib/family/graph", () => ({ listFamilyPeople: mocks.people }));
vi.mock("@/lib/family/access", () => ({ familyCapability: mocks.capability }));
vi.mock("@/lib/family/shared-report-results", () => ({ loadSharedReportSnapshot: mocks.snapshot }));
vi.mock("@/lib/subjects", () => ({ resolveSubjectForAccount: mocks.subject }));
vi.mock("./own-provider-authority", async () => ({ ...await vi.importActual<object>("./own-provider-authority"),
  assertOwnCopilotAuthority: mocks.assert, prepareOwnCopilotProvider: mocks.prepare }));
vi.mock("./model-endpoint", () => ({ modelRuntime: () => ({ localAllowed: mocks.localAllowed() }) }));
vi.mock("./group-scopes", () => ({ copilotGroupScopes: () => ({ family: mocks.built(), cohort: false }) }));
vi.mock("./family-chat-token", () => ({ mintFamilyChatToken: () => "minted-family-token" }));
import { captureFamilyReports, checkFamilyTurn, prepareFamilyCopilotChat, readFamilyChatHistory, resolveFamilyMembers } from "./family-chat";

const accountId = "80000000-0000-4000-8000-000000000001", sessionId = "80000000-0000-4000-8000-000000000002";
const selfId = "80000000-0000-4000-8000-000000000003";
const actor = { accountId, sessionId };
function authority(n: string) {
  return { subjectId: `10000000-0000-4000-8000-00000000000${n}`, accountId: `40000000-0000-4000-8000-00000000000${n}`, lifecycleRevision: 1,
    relationship: { id: `50000000-0000-4000-8000-00000000000${n}`, revision: 1 },
    copilot: { purpose: "copilot.local", grantId: `60000000-0000-4000-8000-00000000000${n}`, grantRevision: 1 },
    heritability: { purpose: "family.heritability", grantId: `70000000-0000-4000-8000-00000000000${n}`, grantRevision: 1 },
    layers: [{ purpose: "reports.polygenic", grantId: `90000000-0000-4000-8000-00000000000${n}`, grantRevision: 1 }] };
}
const A1 = authority("1"), A2 = authority("2"), A3 = authority("3");
function person(a: ReturnType<typeof authority>, name: string, sharing: "active" | "paused" = "active") {
  return { dataSubjectId: a.subjectId, counterpartAccountId: a.accountId, displayLabel: name, sharing,
    handle: { routeSegment: `s-${a.relationship.id}` } };
}
const provider = { accountId, sessionId, subjectId: selfId, providerClass: "local" };
const permitted = { status: "permitted", userFacingCopy: "" };
/** What every captured read's locked confirmation answers right now. */
let confirmed = true;

beforeEach(() => {
  vi.clearAllMocks();
  confirmed = true;
  mocks.actor.mockResolvedValue(actor);
  mocks.localAllowed.mockReturnValue(true);
  mocks.built.mockReturnValue(true);
  mocks.capability.mockResolvedValue(permitted);
  mocks.assert.mockResolvedValue(true);
  mocks.subject.mockResolvedValue({ id: selfId });
  mocks.prepare.mockResolvedValue({ authority: provider, settings: { provider: "openai_compatible", base_url: "http://127.0.0.1:8127/v1", model: "synthetic" } });
  mocks.people.mockResolvedValue([person(A2, "Zoe"), person(A1, "Bea"), person(A3, "Cal", "paused")]);
  mocks.rpc.mockImplementation(async (name: string, args: Record<string, unknown>) => name === "family_copilot_scope_v1"
    ? { data: [A1, A2, A3], error: null }
    : args.p_operation === "list" ? { data: [], error: null } : { data: true, error: null });
  mocks.snapshot.mockResolvedValue({ authorized: true, access: [{ purpose: "reports.polygenic", kind: "canonical" }], reports: [],
    confirm: async () => ({ authorized: confirmed }) });
});

describe("who is in the group", () => {
  it("is exactly what the database resolves for this session, named by the Family graph, in name order", async () => {
    const members = await resolveFamilyMembers(actor);
    expect(mocks.rpc).toHaveBeenCalledWith("family_copilot_scope_v1", { p_account_id: accountId, p_session_id: sessionId });
    expect(members.map(m => [m.ref, m.displayLabel, m.authority.subjectId])).toEqual([
      ["person-1", "Bea", A1.subjectId], ["person-2", "Zoe", A2.subjectId],
    ]);
  });

  it("leaves out a paused person, a person the graph cannot name, and a person whose jurisdiction refuses", async () => {
    mocks.people.mockResolvedValue([person(A1, "Bea"), { ...person(A2, "Zoe"), counterpartAccountId: A3.accountId }, person(A3, "Cal", "paused")]);
    expect((await resolveFamilyMembers(actor)).map(m => m.displayLabel)).toEqual(["Bea"]);
    mocks.people.mockResolvedValue([person(A1, "Bea"), person(A2, "Zoe")]);
    mocks.capability.mockImplementation(async (_viewer: string, contributors: string[]) =>
      contributors.includes(A2.accountId) ? { status: "unreviewed", userFacingCopy: "Not here." } : permitted);
    expect((await resolveFamilyMembers(actor)).map(m => m.displayLabel)).toEqual(["Bea"]);
  });

  it("fails closed on a malformed scope instead of reading anyone", async () => {
    mocks.rpc.mockResolvedValue({ data: [{ ...A1, layers: [] }], error: null });
    await expect(resolveFamilyMembers(actor)).rejects.toThrow();
    mocks.rpc.mockResolvedValue({ data: null, error: { message: "private" } });
    await expect(resolveFamilyMembers(actor)).rejects.toThrow();
    expect(mocks.people).not.toHaveBeenCalled();
  });
});

describe("what one turn may read", () => {
  it("reads each member through the Family recipient reader for their granted layers only, and drops a refused or legacy member", async () => {
    const members = await resolveFamilyMembers(actor);
    mocks.snapshot.mockImplementation(async (_db: unknown, options: { subjectId: string }) => options.subjectId === A2.subjectId
      ? { authorized: true, access: [{ purpose: "reports.polygenic", kind: "legacy-only" }], reports: [], confirm: async () => ({ authorized: true }) }
      : { authorized: true, access: [{ purpose: "reports.polygenic", kind: "canonical" }], reports: [], confirm: async () => ({ authorized: true }) });
    const capture = await captureFamilyReports(members);
    expect(mocks.snapshot.mock.calls.map(call => call[1])).toEqual([
      { subjectId: A1.subjectId, counterpartAccountId: A1.accountId, purposes: ["reports.polygenic"] },
      { subjectId: A2.subjectId, counterpartAccountId: A2.accountId, purposes: ["reports.polygenic"] },
    ]);
    expect(capture.members.map(m => m.displayLabel)).toEqual(["Bea"]);
  });
});

describe("the recheck every turn repeats", () => {
  async function turn() {
    const members = await resolveFamilyMembers(actor);
    const capture = await captureFamilyReports(members);
    return () => checkFamilyTurn(actor, selfId, provider as never, capture.members, capture.confirm);
  }
  it("passes while everything is current, and hands the database the exact member authorities", async () => {
    await expect((await turn())()).resolves.toBeUndefined();
    expect(mocks.rpc).toHaveBeenCalledWith("family_copilot_chat_v1", { p_operation: "check", p_account_id: accountId,
      p_session_id: sessionId, p_chat_id: null, p_payload: { members: [A1, A2] } });
  });
  it.each([
    ["a member withdrew a grant", () => mocks.rpc.mockImplementation(async (name: string) => name === "family_copilot_chat_v1"
      ? { data: null, error: { code: "42501" } } : { data: [A1, A2], error: null })],
    ["a member's jurisdiction stopped permitting", () => mocks.capability.mockResolvedValue({ status: "prohibited", userFacingCopy: "" })],
    ["the session changed", () => mocks.actor.mockResolvedValue({ accountId, sessionId: "80000000-0000-4000-8000-0000000000ff" })],
    ["the asker's own model permission changed", () => mocks.assert.mockResolvedValue(false)],
    ["a captured read no longer confirms", () => { confirmed = false; }],
    ["the deployment can no longer run a local model", () => mocks.localAllowed.mockReturnValue(false)],
  ])("throws when %s", async (_label, change) => {
    const check = await turn();
    await expect(check()).resolves.toBeUndefined();
    change();
    await expect(check()).rejects.toThrow("copilot_unavailable");
  });
  it("never passes for a cloud model", async () => {
    const members = await resolveFamilyMembers(actor);
    await expect(checkFamilyTurn(actor, selfId, { ...provider, providerClass: "cloud" } as never, members, async () => true))
      .rejects.toThrow("copilot_unavailable");
  });
});

describe("the page's states, in the register's order", () => {
  it("renders the transport refusal before reading anything about the group, even where the scope is not built", async () => {
    mocks.localAllowed.mockReturnValue(false);
    mocks.built.mockReturnValue(false);
    expect(await prepareFamilyCopilotChat()).toEqual({ kind: "transport_unavailable" });
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.capability).not.toHaveBeenCalled();
  });
  it("does not serve the scope on a local deployment where it is not built", async () => {
    mocks.built.mockReturnValue(false);
    expect(await prepareFamilyCopilotChat()).toBeNull();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("renders the asker's jurisdiction refusal before the provider or the group", async () => {
    mocks.capability.mockResolvedValue({ status: "unreviewed", userFacingCopy: "Family is not available where you live." });
    expect(await prepareFamilyCopilotChat()).toEqual({ kind: "jurisdiction_unavailable", copy: "Family is not available where you live." });
    expect(mocks.prepare).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("asks for a local model and its permission before reading the group", async () => {
    mocks.prepare.mockResolvedValue(null);
    expect(await prepareFamilyCopilotChat()).toEqual({ kind: "provider_required" });
    mocks.prepare.mockResolvedValue({ authority: { ...provider, providerClass: "cloud" }, settings: {} });
    expect(await prepareFamilyCopilotChat()).toEqual({ kind: "provider_required" });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("mints a context only when someone shares, and shows only names and report types", async () => {
    const ready = await prepareFamilyCopilotChat();
    expect(ready).toMatchObject({ kind: "ready", contextToken: "minted-family-token",
      members: [{ displayLabel: "Bea", layers: ["estimate"] }, { displayLabel: "Zoe", layers: ["estimate"] }] });
    expect(JSON.stringify(ready)).not.toContain(A1.subjectId);
    mocks.rpc.mockImplementation(async (name: string, args: Record<string, unknown>) => name === "family_copilot_scope_v1"
      ? { data: [], error: null } : args.p_operation === "list" ? { data: [], error: null } : { data: true, error: null });
    expect(await prepareFamilyCopilotChat()).toMatchObject({ kind: "ready", contextToken: null, members: [] });
  });
});

describe("history", () => {
  const chatId = "80000000-0000-4000-8000-000000000009";
  beforeEach(() => {
    const query = { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: { scope_kind: "family", family_pair_id: null, legacy_unverified: false,
        canonical_authority: { scope: "family-group" } }, error: null }) };
    mocks.from.mockReturnValue(query);
  });
  it("answers null, the route's 404, once the database finds the conversation no longer current", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: null });
    expect(await readFamilyChatHistory(chatId)).toBeNull();
    expect(mocks.rpc).toHaveBeenCalledWith("family_copilot_chat_v1", expect.objectContaining({ p_operation: "history", p_chat_id: chatId,
      p_payload: { provider } }));
  });
  it("reads nothing for a chat that is not a family group chat", async () => {
    mocks.from.mockReturnValue({ select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: { scope_kind: "self", family_pair_id: null, legacy_unverified: false,
        canonical_authority: {} }, error: null }) });
    expect(await readFamilyChatHistory(chatId)).toBeNull();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});
