import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ actor: vi.fn(), subject: vi.fn(), prepare: vi.fn(), check: vi.fn(), rpc: vi.fn(), token: vi.fn(), stream: vi.fn(), providerFetch: vi.fn(), from: vi.fn(), scope: vi.fn(), capturedFetch: null as typeof fetch | null }));
vi.mock("@/lib/uploads/own-upload-context", () => ({ currentOwnUploadAccount: mocks.actor }));
vi.mock("@/lib/subjects", () => ({ resolveSubjectForAccount: mocks.subject }));
vi.mock("./own-provider-authority", () => ({ prepareOwnCopilotProvider: mocks.prepare }));
vi.mock("./own-chat", async () => { const { z } = await import("zod"); return { checkOwnChat: mocks.check, ownChatRpc: mocks.rpc, ownChatSubject: mocks.scope, ownChatHistorySchema: z.any() }; });
vi.mock("./own-chat-token", () => ({ readOwnChatToken: mocks.token, snapshotHash: (v: unknown) => JSON.stringify(v) }));
vi.mock("@/lib/account-deletion", () => ({ isSameOrigin: (r: Request) => r.headers.get("origin") === "https://inherit.test" }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ from: mocks.from }) }));
vi.mock("@ai-sdk/anthropic", () => ({ createAnthropic: (o: {
        fetch: typeof fetch;
    }) => { mocks.capturedFetch = o.fetch; return () => ({}); } }));
vi.mock("@ai-sdk/openai-compatible", () => ({ createOpenAICompatible: (o: {
        fetch: typeof fetch;
    }) => { mocks.capturedFetch = o.fetch; return () => ({}); } }));
vi.mock("ai", () => ({ tool: (x: unknown) => x, stepCountIs: () => 8, streamText: mocks.stream, toUIMessageStream: ({ stream }: {
        stream: ReadableStream;
    }) => stream }));
import { ownChatResponse } from "./own-chat-route";
const accountId = "80000000-0000-4000-8000-000000000001", sessionId = "80000000-0000-4000-8000-000000000002", subjectId = "80000000-0000-4000-8000-000000000003", chatId = "80000000-0000-4000-8000-000000000004";
const authority = { accountId, sessionId, subjectId, providerClass: "local" };
const projection = { sources: [], legacySources: [], unavailableSources: [] };
const options = { systemPrompt: "Answer from tools.", refusal: (id: string, text: string) => new Response(text, { headers: { "x-copilot-refusal": id } }) };
const request = (body: unknown = { contextToken: "valid-context-token", message: "What does my file cover?" }) => new Request("https://inherit.test/api/chat", { method: "POST", headers: { origin: "https://inherit.test", "Content-Type": "application/json" }, body: JSON.stringify(body) });
type Flow = {
    prepareStep: () => Promise<unknown>;
    tools: Record<string, {
        execute: (x: unknown) => Promise<unknown>;
    }>;
};
let run: (flow: Flow) => Promise<string>;
beforeEach(() => {
    vi.clearAllMocks();
    mocks.capturedFetch = null;
    mocks.actor.mockResolvedValue({ accountId, sessionId });
    mocks.subject.mockResolvedValue({ id: subjectId, subjectClass: "self", displayLabel: "You" });
    mocks.scope.mockImplementation(mocks.subject);
    mocks.prepare.mockResolvedValue({ authority, settings: { provider: "openai_compatible", base_url: "http://localhost:8123/v1", model: "synthetic" }, fetch: mocks.providerFetch, createFetch: (authorize: () => Promise<boolean>) => async (...args: Parameters<typeof fetch>) => { if (!await authorize())
            throw new Error("unavailable"); return mocks.providerFetch(...args); } });
    mocks.token.mockReturnValue({ authority, projectionHash: JSON.stringify(projection), nonce: "nonce", expiresAt: Date.now() + 500000 });
    mocks.check.mockResolvedValue(undefined);
    mocks.providerFetch.mockResolvedValue(new Response("{}"));
    mocks.rpc.mockImplementation(async (op: string) => op === "prepare" ? projection : op === "begin" ? true : op === "commit" ? { chatId } : op === "history" ? { projection, lastOrdinal: 1, messages: [{ role: "user", content: [{ text: "Previous question" }] }, { role: "assistant", content: [{ text: "Previous answer" }] }] } : []);
    const query = { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }) };
    mocks.from.mockReturnValue(query);
    run = async (flow) => { await flow.prepareStep(); await mocks.capturedFetch!("https://provider.test/v1/chat/completions", { method: "POST" }); return "Your file does not cover this position."; };
    mocks.stream.mockImplementation((flow: Flow) => ({ stream: new ReadableStream({ async start(controller) { try {
                const text = await run(flow);
                controller.enqueue({ type: "text-delta", id: "answer", delta: text });
                controller.close();
            }
            catch {
                controller.error(new Error("private provider details"));
            } } }) }));
});
describe("canonical chat boundaries", () => {
    it.each([true, false])("acknowledges a missing report identifier only when published identity exists: %s", async known => {
        const slug = known ? "caffeine-metabolism-cyp1a2-rs762551" : "invented37.5percent";
        const query = { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), maybeSingle: vi.fn().mockResolvedValue({ data: known ? { slug } : null, error: null }) };
        mocks.from.mockReturnValue(query);
        let result: unknown;
        run = async flow => { result = await flow.tools.get_report.execute({ slug }); return "No completed report is available under your selected purposes."; };
        const r = request();
        expect((await ownChatResponse(r, await r.json(), options)).status).toBe(200);
        expect(result).toEqual({ ...(known ? { slug } : {}), error: "report_not_generated", note: "No completed report for this topic is currently available under your selected purposes.", unavailable_sources: [] });
        expect(mocks.from).toHaveBeenCalledExactlyOnceWith("report_templates");
        expect(query.select).toHaveBeenCalledExactlyOnceWith("slug");
        expect(query.eq.mock.calls).toEqual([["slug", slug], ["status", "published"]]);
    });
    it("does not acknowledge an excluded fixture even if its catalog identity exists", async () => {
        let result: unknown;
        run = async flow => { result = await flow.tools.get_report.execute({ slug: "auto-e2e-hidden" }); return "No completed report is available."; };
        const r = request();
        expect((await ownChatResponse(r, await r.json(), options)).status).toBe(200);
        expect(result).not.toHaveProperty("slug");
        expect(mocks.from).not.toHaveBeenCalled();
    });
    it.each(["query-error", "withdrawal"])("fails closed during missing-report identity lookup: %s", async failure => {
        const query = { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), maybeSingle: vi.fn().mockImplementation(async () => {
            if (failure === "withdrawal") mocks.check.mockRejectedValue(new Error("withdrawn"));
            return { data: { slug: "caffeine" }, error: failure === "query-error" ? new Error("private database details") : null };
        }) };
        mocks.from.mockReturnValue(query);
        run = async flow => { await flow.tools.get_report.execute({ slug: "caffeine" }); return "hidden"; };
        const r = request();
        const response = await ownChatResponse(r, await r.json(), options);
        expect(response.status).toBe(403);
        expect(await response.json()).toEqual({ error: "copilot_unavailable" });
        expect(mocks.rpc.mock.calls.some(call => call[0] === "commit")).toBe(false);
    });
    it("returns closed JSON only after a guarded atomic pair commit", async () => {
        const r = request();
        const response = await ownChatResponse(r, await r.json(), options);
        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({ chatId, message: { role: "assistant", content: "Your file does not cover this position.", citations: [], embryoFindings: [] } });
        expect(response.headers.get("x-inherit-chat-id")).toBe(chatId);
        expect(mocks.providerFetch).toHaveBeenCalledOnce();
        expect(mocks.rpc).toHaveBeenCalledWith("commit", authority, projection, null, expect.objectContaining({ lastOrdinal: 0, nonceHash: JSON.stringify("nonce") }));
    });
    it.each([{ contextToken: "valid-context-token", message: "Hi", messages: [] }, { chatId, message: "Hi", scope: "me" }, { message: "Hi" }])("refuses client history/selectors before provider", async (body) => {
        const r = request(body);
        expect((await ownChatResponse(r, body, options)).status).toBe(400);
        expect(mocks.prepare).not.toHaveBeenCalled();
    });
    it("requires exact current actor/session and a single-use context", async () => {
        mocks.token.mockReturnValue({ authority: { ...authority, sessionId: accountId } });
        const r = request();
        expect((await ownChatResponse(r, await r.json(), options)).status).toBe(404);
        expect(mocks.stream).not.toHaveBeenCalled();
    });
    it("does not contact a provider or persist a prohibited user prompt", async () => {
        const body = { contextToken: "valid-context-token", message: "What dosage of vitamin D should I take?" };
        const response = await ownChatResponse(request(body), body, options);
        expect(response.headers.get("x-copilot-refusal")).toBe("treatment");
        expect(mocks.prepare).not.toHaveBeenCalled();
        expect(mocks.rpc).not.toHaveBeenCalled();
    });
    it("loads history only from the server for an existing chat", async () => {
        const body = { chatId, message: "Explain that observation." };
        await ownChatResponse(request(body), body, options);
        expect(mocks.token).not.toHaveBeenCalled();
        expect(mocks.stream.mock.calls[0][0].messages).toEqual([{ role: "user", content: "Previous question" }, { role: "assistant", content: "Previous answer" }, { role: "user", content: body.message }]);
    });
    it("rechecks sources at the last dispatch boundary, after prepareStep", async () => {
        run = async (flow) => { await flow.prepareStep(); mocks.check.mockRejectedValue(new Error("withdrawn")); await mocks.capturedFetch!("https://provider.test/v1/chat/completions"); return "hidden"; };
        const r = request();
        const response = await ownChatResponse(r, await r.json(), options);
        expect(response.status).toBe(403);
        expect(mocks.providerFetch).not.toHaveBeenCalled();
        expect(mocks.rpc.mock.calls.some(c => c[0] === "commit")).toBe(false);
    });
    it("refuses a tool call after withdrawal and never reads variants", async () => {
        run = async (flow) => { mocks.check.mockRejectedValue(new Error("withdrawn")); await flow.tools.get_genotype.execute({ rsid: "rs762551" }); return "hidden"; };
        const r = request();
        expect((await ownChatResponse(r, await r.json(), options)).status).toBe(403);
        expect(mocks.from).not.toHaveBeenCalled();
    });
    it("discards final text and private errors if permission changes after the provider response", async () => {
        run = async () => { mocks.check.mockRejectedValue(new Error("secret recipient")); return "private raw genetics"; };
        const r = request();
        const response = await ownChatResponse(r, await r.json(), options);
        expect(await response.json()).toEqual({ error: "copilot_unavailable" });
        expect(mocks.rpc.mock.calls.some(c => c[0] === "commit")).toBe(false);
    });
    it("persists the fixed output replacement, never the rejected model content", async () => {
        run = async () => "You have a 99.999% risk.";
        const r = request();
        const response = await ownChatResponse(r, await r.json(), options);
        const body = await response.json();
        expect(response.headers.get("x-copilot-refusal")).toBeTruthy();
        expect(body.message.content).not.toContain("99.999");
        expect(mocks.rpc.mock.calls.find(c => c[0] === "commit")?.[4].answer).toBe(body.message.content);
    });
    it("rejects a stale projection and a replayed nonce before dispatch", async () => {
        mocks.rpc.mockImplementation(async (op: string) => op === "prepare" ? projection : false);
        const r = request();
        expect((await ownChatResponse(r, await r.json(), options)).status).toBe(403);
        expect(mocks.stream).not.toHaveBeenCalled();
    });
});

it("keeps the exact data check inside a paused transport authorization boundary", async () => {
    let resume!: () => void;
    let reached!: () => void;
    const pause = new Promise<void>(resolve => { resume = resolve; });
    const transportReached = new Promise<void>(resolve => { reached = resolve; });
    const provider = await mocks.prepare();
    mocks.prepare.mockResolvedValue({ ...provider, createFetch: (authorize: () => Promise<boolean>) => async () => {
        reached();
        await pause;
        if (!await authorize()) throw new Error("unavailable");
        return mocks.providerFetch();
    } });
    const r = request();
    const response = ownChatResponse(r, await r.json(), options);
    await transportReached;
    mocks.check.mockRejectedValue(new Error("source withdrawn during DNS"));
    resume();
    expect((await response).status).toBe(403);
    expect(mocks.providerFetch).not.toHaveBeenCalled();
    expect(mocks.rpc.mock.calls.some(call => call[0] === "commit")).toBe(false);
});
