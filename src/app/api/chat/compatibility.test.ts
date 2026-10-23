import crypto from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `POST /api/chat`, the compatibility branch (G8.5, owner decision of 23
 * October 2026: the compatibility chat body moves to the register). The
 * panel on /copilot/[scope] for a scope with no canonical Copilot authority
 * sends the registered `{ contextToken, message }` under a token the page
 * minted, and the AI SDK transport body it sent before is refused. Every
 * check the branch made before still runs, in the same order. Only the
 * database, the provider SDKs and the model stream are mocked; every value
 * is synthetic.
 */
const mocks = vi.hoisted(() => ({
  user: vi.fn(), account: vi.fn(), subject: vi.fn(), canonical: vi.fn(), settings: vi.fn(), grant: vi.fn(), key: vi.fn(),
  stream: vi.fn(), own: vi.fn(), files: vi.fn(),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: mocks.user },
    from: (table: string) => {
      const chain = { select: () => chain, eq: () => chain, is: () => chain,
        maybeSingle: async () => table === "llm_settings" ? mocks.settings() : mocks.grant() };
      return chain;
    },
  }),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ from: () => { const chain = { select: () => chain, eq: () => chain, maybeSingle: async () => mocks.key() }; return chain; } }),
}));
vi.mock("@/lib/account-deletion", async (load) => ({
  ...await load<typeof import("@/lib/account-deletion")>(), getSensitiveAccountContext: mocks.account,
}));
vi.mock("@/lib/subjects", () => ({ resolveSubjectForAccount: mocks.subject }));
// The one-time X-Inherit-CSRF gate passes through here; it is tested on this
// route, through the same handler, in src/lib/security/session-csrf-routes.test.ts.
vi.mock("@/lib/security/session-csrf", async (importOriginal) =>
  (await import("@/lib/security/session-csrf.test-support")).admitEverySessionCsrf(await importOriginal()));
vi.mock("@/lib/copilot/own-chat", () => ({ hasCanonicalCopilotScope: mocks.canonical }));
vi.mock("@/lib/copilot/own-chat-route", () => ({ ownChatResponse: mocks.own }));
vi.mock("@/lib/copilot/family-chat-route", () => ({ isFamilyChatRequest: async () => false, familyChatResponse: vi.fn() }));
vi.mock("@/lib/copilot/cohort-chat-route", () => ({ isCohortChatRequest: async () => false, cohortChatResponse: vi.fn() }));
vi.mock("@/lib/genome/load", async (load) => ({ ...await load<typeof import("@/lib/genome/load")>(), getSubjectProcessedFiles: mocks.files }));
vi.mock("@ai-sdk/anthropic", () => ({ createAnthropic: () => () => ({ provider: "anthropic" }) }));
vi.mock("@ai-sdk/openai-compatible", () => ({ createOpenAICompatible: () => () => ({ provider: "openai-compatible" }) }));
vi.mock("ai", async (load) => ({ ...await load<typeof import("ai")>(), streamText: mocks.stream,
  toUIMessageStream: ({ stream }: { stream: ReadableStream }) => stream }));

vi.stubEnv("BYOK_ENCRYPTION_KEY", crypto.randomBytes(32).toString("base64"));
const { POST } = await import("./route");
const { mintCompatChatToken } = await import("@/lib/copilot/compat-chat-token");
const { encryptSecret } = await import("@/lib/crypto");
const { ANTHROPIC_MODELS } = await import("@/lib/llm");

const ACCOUNT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SESSION = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const SUBJECT = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const OTHER = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const QUESTION = "What does my file say about caffeine?";
const ANSWER = "Your file does not cover that variant, so nothing can be said about it.";
const token = (overrides: Partial<{ accountId: string; sessionId: string; subjectId: string }> = {}) =>
  mintCompatChatToken({ accountId: ACCOUNT, sessionId: SESSION, subjectId: SUBJECT, ...overrides });
const call = (body: unknown, path = "/api/chat", origin = "https://inherit.test") => POST(new Request(`https://inherit.test${path}`, {
  method: "POST", headers: { "content-type": "application/json", origin }, body: JSON.stringify(body),
}));
const chunks = (text: string) => new ReadableStream({ start(controller) {
  for (const chunk of [{ type: "start" }, { type: "text-start", id: "t" }, { type: "text-delta", id: "t", delta: text },
    { type: "text-end", id: "t" }, { type: "finish" }]) controller.enqueue(chunk);
  controller.close();
} });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.user.mockResolvedValue({ data: { user: { id: ACCOUNT } } });
  mocks.account.mockResolvedValue({ user: { id: ACCOUNT }, sessionId: SESSION });
  mocks.subject.mockResolvedValue({ id: SUBJECT, subjectClass: "self", displayLabel: "You", routeSegment: "me" });
  mocks.canonical.mockResolvedValue(false);
  mocks.settings.mockResolvedValue({ data: { provider: "openai_compatible", base_url: "https://model.synthetic.invalid/v1", model: "synthetic-model", key_last4: "wxyz" } });
  mocks.grant.mockResolvedValue({ data: { id: OTHER } });
  mocks.key.mockResolvedValue({ data: { encrypted_key: `\\x${encryptSecret("synthetic-key-only").toString("hex")}` } });
  mocks.files.mockResolvedValue([]);
  mocks.stream.mockImplementation(() => ({ stream: chunks(ANSWER) }));
  mocks.own.mockResolvedValue(new Response("own", { status: 299 }));
});

describe("POST /api/chat, the compatibility branch", () => {
  it("answers the registered body with chat-completion-v1, from the one question it was sent", async () => {
    const response = await call({ contextToken: token(), message: QUESTION });
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    const answer = await response.json() as { chatId: string; message: unknown };
    expect(Object.keys(answer).sort()).toEqual(["chatId", "message"]);
    expect(answer.chatId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(answer.message).toEqual({ role: "assistant", content: ANSWER, citations: [], embryoFindings: [] });
    expect(mocks.subject).toHaveBeenCalledWith(ACCOUNT, `s-${SUBJECT}`);
    expect(mocks.stream).toHaveBeenCalledTimes(1);
    expect(mocks.stream.mock.calls[0][0].messages).toEqual([{ role: "user", content: QUESTION }]);
    expect(mocks.own).not.toHaveBeenCalled();
  });

  it("refuses the AI SDK transport body it used to take, with or without the scope query, before any check", async () => {
    for (const path of ["/api/chat?scope=me", "/api/chat"]) {
      const response = await call({ id: "chat-1", messages: [{ id: "m", role: "user", parts: [{ type: "text", text: QUESTION }] }],
        trigger: "submit-message", messageId: "m" }, path);
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: "invalid_request" });
    }
    expect(mocks.subject).not.toHaveBeenCalled();
    expect(mocks.stream).not.toHaveBeenCalled();
  });

  it("answers a token for another account, another session, or no session with the same opaque 404", async () => {
    for (const contextToken of [token({ accountId: OTHER }), token({ sessionId: OTHER })]) {
      const response = await call({ contextToken, message: QUESTION });
      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ error: "not_found" });
    }
    mocks.account.mockResolvedValue(null);
    expect((await call({ contextToken: token(), message: QUESTION })).status).toBe(404);
    expect(mocks.subject).not.toHaveBeenCalled();
  });

  it("refuses a cross-site request, a query and an extra field before reading the token", async () => {
    expect((await call({ contextToken: token(), message: QUESTION }, "/api/chat", "https://elsewhere.test")).status).toBe(403);
    expect((await call({ contextToken: token(), message: QUESTION }, "/api/chat?scope=me")).status).toBe(403);
    expect((await call({ contextToken: token(), message: QUESTION, scope: "me" })).status).toBe(400);
    expect((await call({ contextToken: token(), message: "   " })).status).toBe(400);
    expect(mocks.account).not.toHaveBeenCalled();
  });

  it("leaves a token that is not this one to the own branch", async () => {
    expect((await call({ contextToken: "x".repeat(64), message: QUESTION })).status).toBe(299);
    expect(mocks.own).toHaveBeenCalledTimes(1);
  });

  it("keeps the branch's refusals in their order: canonical scope, provider, local-only, consent, key", async () => {
    mocks.canonical.mockResolvedValueOnce(true);
    expect(await (await call({ contextToken: token(), message: QUESTION })).json()).toEqual({ error: "copilot_unavailable" });

    mocks.settings.mockResolvedValueOnce({ data: null });
    const noProvider = await call({ contextToken: token(), message: QUESTION });
    expect(noProvider.status).toBe(409);
    expect((await noProvider.json()).error).toBe("no_provider");

    mocks.subject.mockResolvedValueOnce({ id: SUBJECT, subjectClass: "other_adult", displayLabel: "Sam", routeSegment: `s-${SUBJECT}` });
    const localOnly = await call({ contextToken: token(), message: QUESTION });
    expect(localOnly.status).toBe(403);
    expect((await localOnly.json()).error).toBe("local_model_required");

    mocks.grant.mockResolvedValueOnce({ data: null });
    const consent = await call({ contextToken: token(), message: QUESTION });
    expect(consent.status).toBe(403);
    expect(await consent.json()).toEqual({ error: "consent_required", provider_key: "model.synthetic.invalid" });

    mocks.settings.mockResolvedValueOnce({ data: { provider: "anthropic", base_url: null, model: ANTHROPIC_MODELS[0], key_last4: null } });
    mocks.key.mockResolvedValueOnce({ data: null });
    const noKey = await call({ contextToken: token(), message: QUESTION });
    expect(noKey.status).toBe(409);
    expect((await noKey.json()).error).toBe("no_key");
    expect(mocks.stream).not.toHaveBeenCalled();
  });

  it("answers a gated question with the registered refusal stream and no model call", async () => {
    const response = await call({ contextToken: token(), message: "Do I have cancer?" });
    expect(response.status).toBe(200);
    expect(response.headers.get("x-copilot-refusal")).toBeTruthy();
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    await response.body?.cancel();
    expect(mocks.stream).not.toHaveBeenCalled();
  });
});
