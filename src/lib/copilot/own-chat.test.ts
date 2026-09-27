import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ actor: vi.fn(), subject: vi.fn(), status: vi.fn(), provider: vi.fn(), assert: vi.fn(), rpc: vi.fn(), from: vi.fn(), mint: vi.fn() }));
vi.mock("@/lib/uploads/own-upload-context", () => ({ currentOwnUploadAccount: mocks.actor }));
vi.mock("@/lib/subjects", () => ({ resolveSubjectForAccount: mocks.subject }));
vi.mock("./own-provider-authority", () => ({ prepareOwnCopilotProvider: mocks.provider, ownCopilotProviderStatus: mocks.status, assertOwnCopilotAuthority: mocks.assert }));
vi.mock("./own-chat-token", () => ({ mintOwnChatToken: mocks.mint, snapshotHash: (value: unknown) => JSON.stringify(value) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ from: mocks.from, rpc: mocks.rpc }) }));
import { hasCanonicalCopilotScope, prepareOwnCopilotChat, readOwnChatHistory, ownChatHistorySchema } from "./own-chat";
import { correctionProjection, correctionReport } from "./own-chat-correction.test-fixture";
import { ownChatCorrection } from "./own-chat-correction";
const accountId = "80000000-0000-4000-8000-000000000001", subjectId = "80000000-0000-4000-8000-000000000002", chatId = "80000000-0000-4000-8000-000000000003";
const projection = { sources: [], legacySources: [], unavailableSources: [] };
const citations = [{ id: "pmid:12345678", label: "Captured source", href: "https://pubmed.ncbi.nlm.nih.gov/12345678/" }];
const messages = [{ id: "80000000-0000-4000-8000-000000000004", role: "user", content: [{ type: "text", text: "Question" }], turn_ordinal: 1, citations: [], created_at: "2026-09-07T10:00:00+00:00" },
    { id: "80000000-0000-4000-8000-000000000005", role: "assistant", content: [{ type: "text", text: "Answer" }], turn_ordinal: 1, citations, created_at: "2026-09-07T10:00:01+00:00" }];
let canonical = true;
function query(table: string) {
    const result = { data: table === "consent_signatures" && canonical ? [{ id: accountId }] : [], error: null };
    const q = { select: () => q, eq: () => q, or: () => q, not: () => q, limit: () => q, maybeSingle: async () => ({ data: { subject_id: subjectId, scope_kind: "self", legacy_unverified: false }, error: null }), then: (resolve: (v: unknown) => unknown) => Promise.resolve(result).then(resolve) };
    return q;
}
beforeEach(() => {
    vi.clearAllMocks();
    canonical = true;
    mocks.mint.mockReturnValue("context-token");
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
    it("keeps the client context key across new nonces but changes it for an actually changed projection", async () => {
        let current = correctionProjection;
        mocks.mint.mockReturnValueOnce("first-nonce").mockReturnValueOnce("second-nonce").mockReturnValueOnce("third-nonce");
        mocks.rpc.mockImplementation(async (_name: string, args: { p_operation: string }) => ({ error: null,
            data: args.p_operation === "prepare" ? current : args.p_operation === "list" ? [] : true }));
        const first = await prepareOwnCopilotChat(subjectId), second = await prepareOwnCopilotChat(subjectId);
        current = projection;
        const changed = await prepareOwnCopilotChat(subjectId);
        if (first.kind !== "ready" || second.kind !== "ready" || changed.kind !== "ready") throw new Error("Expected authorized contexts");
        expect(first.contextToken).not.toBe(second.contextToken);
        expect(first.contextHash).toBe(second.contextHash);
        expect(changed.contextHash).not.toBe(first.contextHash);
    });
    it("replays exact citations and normalizes PostgreSQL timestamps to the canonical Z wire format", async () => { expect(await readOwnChatHistory(chatId)).toMatchObject({ chatId, messages: [{ role: "user", citations: [], createdAt: "2026-09-07T10:00:00.000Z" }, { role: "assistant", citations, createdAt: "2026-09-07T10:00:01.000Z" }] }); expect(mocks.from).toHaveBeenCalledTimes(1); });
    it("refuses incomplete or reversed history pairs", () => { expect(ownChatHistorySchema.safeParse({ chatId, projection, lastOrdinal: 1, messages: [messages[1]] }).success).toBe(false); expect(ownChatHistorySchema.safeParse({ chatId, projection, lastOrdinal: 1, messages: [messages[1], messages[0]] }).success).toBe(false); });
    it.each([0, 1])("refuses a purged history even when its authority and last ordinal match: %s", lastOrdinal => {
        expect(ownChatHistorySchema.safeParse({ chatId, projection, lastOrdinal, messages: [] }).success).toBe(false);
    });
    it("never renders an empty database history as an available conversation", async () => {
        mocks.rpc.mockResolvedValue({ error: null, data: { chatId, projection, lastOrdinal: 0, messages: [] } });
        await expect(readOwnChatHistory(chatId)).rejects.toThrow();
        expect(mocks.rpc).toHaveBeenCalledOnce();
    });
    it("cannot restore persisted content after a current authority failure", async () => { mocks.assert.mockResolvedValue(false); await expect(readOwnChatHistory(chatId)).rejects.toThrow("copilot_unavailable"); });
    it.each(["summary", "outcome"] as const)("retains exact authorized historical messages with a correction notice for %s", async field => {
        const row = correctionReport(undefined, field), before = structuredClone(messages);
        mocks.rpc.mockImplementation(async (_name: string, args: { p_operation: string; p_payload: { offset?: number } }) => ({ error: null,
            data: args.p_operation === "history" ? { chatId, messages, projection: correctionProjection, lastOrdinal: 1 }
                : args.p_operation === "reports" ? args.p_payload.offset === 0 ? [row] : [] : true }));
        const result = await readOwnChatHistory(chatId);
        expect(result?.correction).toEqual(ownChatCorrection());
        expect(result?.messages.map(({ content, citations }) => ({ content, citations })))
            .toEqual(messages.map(message => ({ content: message.content[0].text, citations: message.citations })));
        expect(messages).toEqual(before);
        expect(mocks.rpc.mock.calls.some(([, args]) => ["begin", "commit"].includes(args.p_operation))).toBe(false);
    });
    it("withholds both correction status and history after final source authority changes", async () => {
        mocks.rpc.mockImplementation(async (_name: string, args: { p_operation: string; p_payload: { offset?: number } }) => {
            if (args.p_operation === "reports") {
                mocks.assert.mockResolvedValue(false);
                return { error: null, data: [correctionReport()] };
            }
            return { error: null, data: args.p_operation === "history" ? { chatId, messages, projection: correctionProjection, lastOrdinal: 1 } : true };
        });
        await expect(readOwnChatHistory(chatId)).rejects.toThrow("copilot_unavailable");
    });
});
