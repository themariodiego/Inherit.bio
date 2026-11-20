import crypto from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `POST /api/chat` after the compatibility branch's retirement (G8.5, 24
 * October 2026). The scopes the compatibility panel served are answered by
 * the register's canonical rules: a self subject by the own chat, with a
 * server-held conversation and a single-use context token, and every other
 * subject by refusal. This suite drives the real route handler, the real own
 * branch, the real context token and the real intent and output guards.
 * Only the database function `own_copilot_chat_v1` (a stateful fake that
 * keeps its nonces, chats and turns as the SQL does), the subject lookup,
 * the provider authority and the model stream are replaced. Every value is
 * synthetic, and no model is called.
 */
const ACCOUNT = vi.hoisted(() => "80000000-0000-4000-8000-0000000000a1");
const SESSION = vi.hoisted(() => "80000000-0000-4000-8000-0000000000a2");
const mocks = vi.hoisted(() => ({ subject: vi.fn(), provider: vi.fn(), stream: vi.fn(), rpc: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { getUser: async () => ({ data: { user: { id: ACCOUNT } } }) } }) }));
vi.mock("@/lib/uploads/own-upload-context", () => ({ currentOwnUploadAccount: async () => ({ accountId: ACCOUNT, sessionId: SESSION }) }));
// The session the retired compatibility branch read, so that restoring it would answer rather than fail early.
vi.mock("@/lib/account-deletion", async (load) => ({ ...await load<typeof import("@/lib/account-deletion")>(),
  getSensitiveAccountContext: async () => ({ user: { id: ACCOUNT }, sessionId: SESSION }) }));
vi.mock("@/lib/subjects", () => ({ resolveSubjectForAccount: mocks.subject }));
vi.mock("@/lib/copilot/own-provider-authority", async (load) => ({ ...await load<typeof import("@/lib/copilot/own-provider-authority")>(),
  prepareOwnCopilotProvider: mocks.provider, assertOwnCopilotAuthority: async () => true }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc: mocks.rpc, from: (table: string) => chatRows(table) }) }));
// The one-time X-Inherit-CSRF gate passes through here; it is tested on this
// route, through the same handler, in src/lib/security/session-csrf-routes.test.ts.
vi.mock("@/lib/security/session-csrf", async (importOriginal) =>
  (await import("@/lib/security/session-csrf.test-support")).admitEverySessionCsrf(await importOriginal()));
vi.mock("@/lib/copilot/family-chat-route", () => ({ isFamilyChatRequest: async () => false, familyChatResponse: vi.fn() }));
vi.mock("@/lib/copilot/cohort-chat-route", () => ({ isCohortChatRequest: async () => false, cohortChatResponse: vi.fn() }));
vi.mock("@ai-sdk/openai-compatible", () => ({ createOpenAICompatible: () => () => ({ provider: "openai-compatible" }) }));
vi.mock("ai", async (load) => ({ ...await load<typeof import("ai")>(), streamText: mocks.stream,
  toUIMessageStream: ({ stream }: { stream: ReadableStream }) => stream }));

vi.stubEnv("BYOK_ENCRYPTION_KEY", crypto.randomBytes(32).toString("base64"));
const { POST } = await import("./route");
const { mintOwnChatToken, snapshotHash } = await import("@/lib/copilot/own-chat-token");
const { hmacSecret } = await import("@/lib/crypto");

const SELF = "80000000-0000-4000-8000-0000000000b1";
const OTHER_ADULT = "80000000-0000-4000-8000-0000000000b2";
const OTHER_ACCOUNT = "80000000-0000-4000-8000-0000000000c1";
const FIRST = "What does my file say about caffeine?";
const SECOND = "Can you explain that answer more simply?";
const ANSWERS = ["Your file does not cover that position, so nothing can be said about it.",
  "Your file has no reading at that position, so it says nothing either way."];
/** A self subject whose one file predates the canonical upload: what the compatibility panel served. */
const PROJECTION = { sources: [], legacySources: [{ id: "80000000-0000-4000-8000-0000000000d1", sha256: "e".repeat(64), build: "GRCh38",
  createdAt: "2026-08-01T00:00:00Z" }], unavailableSources: [] };
const authorityFor = (subjectId: string) => ({ accountId: ACCOUNT, sessionId: SESSION, subjectId,
  context: { accountRevision: 1, authSessionRevision: 1, jurisdictionRevision: 1, subjectBindingRevision: 1, accountBindingRevision: 1,
    uploadConsentId: "80000000-0000-4000-8000-0000000000e1", subjectLifecycleRevision: 1, originatingSessionRevision: 1,
    principalId: "80000000-0000-4000-8000-0000000000e2", principalRevision: 1 },
  settingsRevision: 1, providerClass: "cloud" as const, runtimeAttestationRevision: 1 as const, runtimeAttestationFingerprint: "f".repeat(64),
  recipientRevision: 1, copilotGrantId: "80000000-0000-4000-8000-0000000000e3", copilotGrantRevision: 1,
  providerGrantId: "80000000-0000-4000-8000-0000000000e4", providerGrantRevision: 1 });
const AUTHORITY = authorityFor(SELF);
const ownToken = (subjectId = SELF) => mintOwnChatToken({ authority: authorityFor(subjectId), projectionHash: snapshotHash(PROJECTION) });

type Turn = { id: string; role: "user" | "assistant"; content: [{ type: "text"; text: string }]; citations: never[]; turn_ordinal: number; created_at: string };
type Chat = { userId: string; subjectId: string; scopeKind: string; turns: Turn[] };
const db = { nonces: new Map<string, { completed: boolean }>(), chats: new Map<string, Chat>() };
const ok = (data: unknown) => ({ data, error: null });
const refused = (code: string) => ({ data: null, error: { code, message: "not_found" } });
const lastOrdinal = (chat: Chat) => Math.max(0, ...chat.turns.map(turn => turn.turn_ordinal));

/** own_copilot_chat_v1 as the SQL behaves for these operations (supabase/migrations, canonical_own_copilot_chat.sql). */
function ownCopilotChat(args: { p_operation: string; p_account_id: string; p_subject_id: string; p_chat_id: string | null;
  p_payload: Record<string, unknown> }) {
  if (args.p_account_id !== ACCOUNT || args.p_subject_id !== SELF) return refused("42501");
  const payload = args.p_payload;
  const chat = args.p_chat_id ? db.chats.get(args.p_chat_id) : undefined;
  if (args.p_chat_id && (!chat || chat.userId !== ACCOUNT || chat.subjectId !== SELF || chat.scopeKind !== "self")) return refused("42501");
  switch (args.p_operation) {
    case "prepare": return ok(PROJECTION);
    case "check": return ok(true);
    case "list": case "reports": case "prs": case "calls": return ok([]);
    case "begin": {
      const hash = String(payload.nonceHash);
      if (db.nonces.has(hash)) return refused("23505");
      db.nonces.set(hash, { completed: false });
      return ok(true);
    }
    case "history": return ok({ chatId: args.p_chat_id, messages: chat!.turns, projection: PROJECTION, lastOrdinal: lastOrdinal(chat!) });
    case "commit": {
      let id = args.p_chat_id, target = chat;
      if (!target) {
        const nonce = db.nonces.get(String(payload.nonceHash));
        if (!nonce || nonce.completed || payload.lastOrdinal !== 0) return refused("42501");
        nonce.completed = true;
        id = crypto.randomUUID();
        target = { userId: ACCOUNT, subjectId: SELF, scopeKind: "self", turns: [] };
        db.chats.set(id, target);
      } else if (payload.nonceHash !== null) return refused("22023");
      const ordinal = lastOrdinal(target) + 1;
      if (ordinal !== Number(payload.lastOrdinal) + 1) return refused("40001");
      const at = new Date(Date.UTC(2026, 9, 24, 12, 0, ordinal)).toISOString();
      target.turns.push({ id: crypto.randomUUID(), role: "user", content: [{ type: "text", text: String(payload.message) }], citations: [], turn_ordinal: ordinal, created_at: at },
        { id: crypto.randomUUID(), role: "assistant", content: [{ type: "text", text: String(payload.answer) }], citations: [], turn_ordinal: ordinal, created_at: at });
      return ok({ chatId: id });
    }
  }
  return refused("22023");
}
/** The one table read before authority: the chat row's scope (ownChatSubject). */
function chatRows(table: string) {
  const filters: Record<string, string> = {};
  const chain = { select: () => chain, eq: (column: string, value: string) => { filters[column] = value; return chain; },
    maybeSingle: async () => {
      if (table !== "chats") return { data: null, error: { message: "unexpected table" } };
      const chat = db.chats.get(filters.id);
      return ok(chat && chat.userId === filters.user_id
        ? { subject_id: chat.subjectId, scope_kind: chat.scopeKind, legacy_unverified: false } : null);
    } };
  return chain;
}
const subjects: Record<string, { id: string; subjectClass: string; displayLabel: string; subjectAccountId: string | null }> = {
  [`s-${SELF}`]: { id: SELF, subjectClass: "self", displayLabel: "You", subjectAccountId: ACCOUNT },
  [`s-${OTHER_ADULT}`]: { id: OTHER_ADULT, subjectClass: "other_adult", displayLabel: "Sam Example", subjectAccountId: null },
};
const chunks = (text: string) => new ReadableStream({ start(controller) {
  for (const chunk of [{ type: "start" }, { type: "text-start", id: "t" }, { type: "text-delta", id: "t", delta: text },
    { type: "text-end", id: "t" }, { type: "finish" }]) controller.enqueue(chunk);
  controller.close();
} });
const call = (body: unknown, path = "/api/chat") => POST(new Request(`https://inherit.test${path}`, {
  method: "POST", headers: { "content-type": "application/json", origin: "https://inherit.test" }, body: JSON.stringify(body) }));
const modelSaw = () => mocks.stream.mock.calls.map(([options]) => (options as { messages: unknown[] }).messages);

beforeEach(() => {
  vi.clearAllMocks();
  db.nonces.clear(); db.chats.clear();
  mocks.rpc.mockImplementation(async (name: string, args: Parameters<typeof ownCopilotChat>[0]) =>
    name === "own_copilot_chat_v1" ? ownCopilotChat(args) : { data: null, error: { message: "unexpected rpc" } });
  mocks.subject.mockImplementation(async (accountId: string, segment: string) => accountId === ACCOUNT ? subjects[segment] ?? null : null);
  mocks.provider.mockImplementation(async (subjectId: string) => subjectId !== SELF ? null : { actor: { accountId: ACCOUNT, sessionId: SESSION },
    authority: AUTHORITY, apiKey: undefined,
    settings: { provider: "openai_compatible", base_url: "https://model.synthetic.invalid/v1", model: "synthetic-model" },
    createFetch: () => async () => new Response("{}") });
  mocks.stream.mockImplementation(() => ({ stream: chunks(ANSWERS[mocks.stream.mock.calls.length - 1] ?? ANSWERS[1]) }));
});

describe("POST /api/chat, the scopes the compatibility panel served", () => {
  it("keeps the conversation on the server, so a second turn sees the first", async () => {
    const first = await call({ contextToken: ownToken(), message: FIRST });
    expect(first.status).toBe(200);
    const opened = await first.json() as { chatId: string; message: { content: string } };
    expect(opened.message).toEqual({ role: "assistant", content: ANSWERS[0], citations: [], embryoFindings: [] });
    // The next turn names the server's conversation and carries no history of its own.
    const second = await call({ chatId: opened.chatId, message: SECOND });
    expect(second.status).toBe(200);
    expect(await second.json()).toEqual({ chatId: opened.chatId, message: { role: "assistant", content: ANSWERS[1], citations: [], embryoFindings: [] } });
    expect(modelSaw()).toEqual([
      [{ role: "user", content: FIRST }],
      [{ role: "user", content: FIRST }, { role: "assistant", content: ANSWERS[0] }, { role: "user", content: SECOND }],
    ]);
    expect(db.chats.get(opened.chatId)!.turns.map(turn => [turn.turn_ordinal, turn.role, turn.content[0].text])).toEqual([
      [1, "user", FIRST], [1, "assistant", ANSWERS[0]], [2, "user", SECOND], [2, "assistant", ANSWERS[1]]]);
  });

  it("spends the context token once: a replay is resource-not-found-v1 and reaches no model", async () => {
    const token = ownToken();
    expect((await call({ contextToken: token, message: FIRST })).status).toBe(200);
    const replay = await call({ contextToken: token, message: SECOND });
    expect(replay.status).toBe(404);
    expect(await replay.json()).toEqual({ error: "not_found" });
    expect(mocks.stream).toHaveBeenCalledTimes(1);
    expect(db.chats.size).toBe(1);
    expect([...db.chats.values()][0].turns).toHaveLength(2);
    // A fresh token from the page opens a new conversation.
    expect((await call({ contextToken: ownToken(), message: SECOND })).status).toBe(200);
    expect(db.chats.size).toBe(2);
  });

  it("refuses the retired compatibility body as an unreadable token, before anything is read", async () => {
    // Exactly what /copilot/[scope] minted for the compatibility panel until 24 October 2026.
    const now = Date.now();
    const claims = { accountId: ACCOUNT, sessionId: SESSION, subjectId: SELF, issuingRoute: "copilot.scope",
      nonce: crypto.randomBytes(24).toString("base64url"), issuedAt: now, expiresAt: now + 540000 };
    const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
    const retired = `${payload}.${hmacSecret(payload, "copilot-compat-context-v1")}`;
    for (const subjectId of [SELF, OTHER_ADULT]) {
      const body = subjectId === SELF ? retired : (() => {
        const other = Buffer.from(JSON.stringify({ ...claims, subjectId })).toString("base64url");
        return `${other}.${hmacSecret(other, "copilot-compat-context-v1")}`;
      })();
      const response = await call({ contextToken: body, message: FIRST });
      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ error: "not_found" });
    }
    // The AI SDK transport body it sent before that, with or without its scope query, and any scope field.
    for (const path of ["/api/chat?scope=me", "/api/chat"]) {
      const response = await call({ id: "chat-1", messages: [{ id: "m", role: "user", parts: [{ type: "text", text: FIRST }] }],
        trigger: "submit-message", messageId: "m" }, path);
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: "invalid_request" });
    }
    expect((await call({ contextToken: ownToken(), message: FIRST, scope: "me" })).status).toBe(400);
    expect(mocks.subject).not.toHaveBeenCalled();
    expect(mocks.provider).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.stream).not.toHaveBeenCalled();
  });

  it("refuses a subject the person may not ask about, whatever names it, with no provider or model step", async () => {
    // A context token for another adult the account uploaded (as if a page had minted one).
    const otherToken = await call({ contextToken: ownToken(OTHER_ADULT), message: FIRST });
    expect(otherToken.status).toBe(404);
    expect(await otherToken.json()).toEqual({ error: "not_found" });
    // A chat row about that adult, and another account's own conversation.
    const subjectChat = crypto.randomUUID(), foreignChat = crypto.randomUUID();
    db.chats.set(subjectChat, { userId: ACCOUNT, subjectId: OTHER_ADULT, scopeKind: "subject", turns: [] });
    db.chats.set(foreignChat, { userId: OTHER_ACCOUNT, subjectId: SELF, scopeKind: "self", turns: [] });
    for (const chatId of [subjectChat, foreignChat, crypto.randomUUID()]) {
      const response = await call({ chatId, message: FIRST });
      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ error: "not_found" });
    }
    expect(mocks.provider).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.stream).not.toHaveBeenCalled();
  });
});
