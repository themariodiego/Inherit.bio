import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ actor: vi.fn(), subject: vi.fn(), status: vi.fn(), provider: vi.fn(), assert: vi.fn(), rpc: vi.fn(), from: vi.fn() }));
vi.mock("@/lib/uploads/own-upload-context", () => ({ currentOwnUploadAccount: mocks.actor }));
vi.mock("@/lib/subjects", () => ({ resolveSubjectForAccount: mocks.subject }));
vi.mock("./own-provider-authority", () => ({ prepareOwnCopilotProvider: mocks.provider, ownCopilotProviderStatus: mocks.status, assertOwnCopilotAuthority: mocks.assert }));
vi.mock("./own-chat-token", () => ({ mintOwnChatToken: () => "context-token", snapshotHash: () => "hash" }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ from: mocks.from, rpc: mocks.rpc }) }));
import { hasCanonicalCopilotScope, prepareOwnCopilotChat, readOwnChatHistory, ownChatHistorySchema } from "./own-chat";
const accountId = "80000000-0000-4000-8000-000000000001", subjectId = "80000000-0000-4000-8000-000000000002", chatId = "80000000-0000-4000-8000-000000000003";
const projection = { sources: [], legacySources: [], unavailableSources: [] };
const citations = [{ id: "pmid:12345678", label: "Captured source", href: "https://pubmed.ncbi.nlm.nih.gov/12345678/" }];
const messages = [{ id: "80000000-0000-4000-8000-000000000004", role: "user", content: [{ type: "text", text: "Question" }], turn_ordinal: 1, citations: [], created_at: "2026-09-07" },
    { id: "80000000-0000-4000-8000-000000000005", role: "assistant", content: [{ type: "text", text: "Answer" }], turn_ordinal: 1, citations, created_at: "2026-09-07" }];
let canonical = true;
function query(table: string) {
    const result = { data: table === "consent_signatures" && canonical ? [{ id: accountId }] : [], error: null };
    const q = { select: () => q, eq: () => q, or: () => q, not: () => q, limit: () => q, maybeSingle: async () => ({ data: { subject_id: subjectId, scope_kind: "self", legacy_unverified: false }, error: null }), then: (resolve: (v: unknown) => unknown) => Promise.resolve(result).then(resolve) };
    return q;
}
beforeEach(() => {
    vi.clearAllMocks();
    canonical = true;
    mocks.actor.mockResolvedValue({ accountId, sessionId: accountId });
    mocks.subject.mockResolvedValue({ id: subjectId, subjectClass: "self", displayLabel: "You" });
    mocks.from.mockImplementation(query);
    mocks.status.mockResolvedValue("ready");
    mocks.assert.mockResolvedValue(true);
    mocks.provider.mockResolvedValue({ authority: { accountId, subjectId, sessionId: accountId, providerClass: "local" }, settings: { provider: "openai_compatible", base_url: "http://localhost/v1", model: "synthetic" } });
    mocks.rpc.mockImplementation(async (_name: string, args: {
        p_operation: string;
    }) => ({ error: null, data: args.p_operation === "prepare" ? projection : args.p_operation === "list" ? [] : args.p_operation === "history" ? { chatId, messages, projection, lastOrdinal: 1 } : true }));
});
describe("own Copilot preparation and durable history", () => {
    it("keeps the configured legacy-only experience behind the same verified classification", async () => { canonical = false; expect(await prepareOwnCopilotChat(subjectId)).toEqual({ kind: "legacy" }); expect(mocks.provider).not.toHaveBeenCalled(); });
    it.each(["provider_unavailable", "transport_unavailable", "consent_required"])("distinguishes %s without fallback", async (reason) => { mocks.status.mockResolvedValue(reason); expect(await prepareOwnCopilotChat(subjectId)).toEqual({ kind: "unavailable", reason }); expect(mocks.provider).not.toHaveBeenCalled(); });
    it("fails closed on classification query errors", async () => { mocks.from.mockImplementation(() => { throw new Error("private detail"); }); await expect(hasCanonicalCopilotScope(subjectId)).rejects.toThrow(); expect(await prepareOwnCopilotChat(subjectId)).toEqual({ kind: "unavailable", reason: "scope_unavailable" }); });
    it("serializes only public provider information and a server context", async () => { expect(await prepareOwnCopilotChat(subjectId)).toMatchObject({ kind: "ready", contextToken: "context-token", providerInfo: { configured: true, local: true, hasConsent: true }, chats: [] }); });
    it("replays the exact persisted citations without a current catalog lookup", async () => { expect(await readOwnChatHistory(chatId)).toMatchObject({ chatId, messages: [{ role: "user", citations: [] }, { role: "assistant", citations }] }); expect(mocks.from).toHaveBeenCalledTimes(1); });
    it("refuses incomplete or reversed history pairs", () => { expect(ownChatHistorySchema.safeParse({ chatId, projection, lastOrdinal: 1, messages: [messages[1]] }).success).toBe(false); expect(ownChatHistorySchema.safeParse({ chatId, projection, lastOrdinal: 1, messages: [messages[1], messages[0]] }).success).toBe(false); });
    it("cannot restore persisted content after a current authority failure", async () => { mocks.assert.mockResolvedValue(false); await expect(readOwnChatHistory(chatId)).rejects.toThrow("copilot_unavailable"); });
});
