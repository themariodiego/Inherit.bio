import { beforeEach, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ownChatsForExport } from "./own-chats";

/**
 * F5: the synchronous export's `chats.json` carries exactly what the chat
 * history shows, by the rules of `private.export_archive_chat_messages_v1`.
 * Each rule has a case here that fails if it is dropped.
 */

const ACCOUNT = "11111111-1111-4111-8111-111111111111";
const OTHER_ACCOUNT = "22222222-2222-4222-8222-222222222222";
const SESSION = "33333333-3333-4333-8333-333333333333";
const SUBJECT = "44444444-4444-4444-8444-444444444444";
const OTHER_SUBJECT = "55555555-5555-4555-8555-555555555555";
const GRANT = "66666666-6666-4666-8666-666666666666";
const CONSENT = "77777777-7777-4777-8777-777777777777";
const PROJECTION = { sources: [{ id: "file", completed: [{ purpose: "reports.polygenic", resultHash: "a".repeat(64) }] }],
  legacySources: [], unavailableSources: [] };
// Same content, keys in another order: jsonb equality ignores key order.
const SAME_PROJECTION = { unavailableSources: [], legacySources: [],
  sources: [{ completed: [{ resultHash: "a".repeat(64), purpose: "reports.polygenic" }], id: "file" }] };
const STALE_PROJECTION = { ...PROJECTION, sources: [] };

type Row = Record<string, unknown>;
type Db = { chats: Row[]; chat_messages: Row[]; purpose_grants: Row[]; directional_grants: Row[]; subject_consents: Row[] };
let db: Db;
let reads: string[];
let rpcs: { name: string; args: Record<string, unknown> }[];
let authority: { data: unknown; error: unknown };
let onRead: (table: string) => void;

const authorityOf = (overrides: Row = {}) => ({ accountId: ACCOUNT, sessionId: "old-session", subjectId: SUBJECT,
  context: { principalId: "principal" }, settingsRevision: 3, recipientRevision: 3, providerClass: "local",
  runtimeAttestationRevision: 1, runtimeAttestationFingerprint: "f".repeat(64),
  copilotGrantId: GRANT, copilotGrantRevision: 2, providerGrantId: null, providerGrantRevision: null, ...overrides });
const chat = (id: string, overrides: Row = {}): Row => ({ id, user_id: ACCOUNT, subject_id: SUBJECT, scope_kind: "self",
  legacy_unverified: false, canonical_authority: authorityOf(), created_at: `2026-09-2${id.length % 10}T00:00:00Z`,
  title: "Private title", ...overrides });
/** A user row and its answer, carrying the provider fields a turn stores. */
const turn = (chatId: string, ordinal: number, projection: unknown = PROJECTION, overrides: Row = {}): Row[] =>
  (["user", "assistant"] as const).map(role => ({ id: `${chatId}-${String(ordinal).padStart(5, "0")}-${role}`, chat_id: chatId,
    user_id: ACCOUNT, role, content: [{ type: "text", text: `${role} ${ordinal}` }], turn_ordinal: ordinal,
    canonical_citations: role === "assistant" ? [{ id: "report", label: "Report", href: "/genome/me/reports/x" }] : null,
    canonical_projection: projection, legacy_unverified: false, created_at: `2026-09-26T00:00:${String(ordinal % 60).padStart(2, "0")}Z`,
    grant_revisions: [2], provider_classification: "local", authorization_fingerprint: "secret", model_recipient_revision: 3,
    ...overrides }));

function client(): SupabaseClient {
  return {
    from(table: keyof Db) {
      reads.push(table);
      onRead(table);
      const filters: ((row: Row) => boolean)[] = [];
      let range: [number, number] = [0, Infinity];
      const builder = {
        select: () => builder,
        eq(column: string, value: unknown) { filters.push(row => row[column] === value); return builder; },
        in(column: string, values: unknown[]) { filters.push(row => values.includes(row[column])); return builder; },
        order: () => builder,
        range(from: number, to: number) { range = [from, to]; return builder; },
        then(resolve: (value: unknown) => unknown) {
          const rows = (db[table] ?? []).filter(row => filters.every(filter => filter(row)));
          // The API's cap: never more than 1,000 rows, whatever was asked for.
          return Promise.resolve({ data: rows.slice(range[0], Math.min(range[1] + 1, range[0] + 1000)), error: null }).then(resolve);
        },
      };
      return builder;
    },
    rpc(name: string, args: Record<string, unknown>) {
      rpcs.push({ name, args });
      if (name === "own_copilot_authority_v1") return Promise.resolve(authority);
      if (name === "own_copilot_chat_v1" && args.p_operation === "prepare") return Promise.resolve({ data: PROJECTION, error: null });
      return Promise.resolve({ data: null, error: { message: "unexpected" } });
    },
  } as unknown as SupabaseClient;
}

const exportChats = () => ownChatsForExport(client(), { accountId: ACCOUNT, sessionId: SESSION }, [SUBJECT]);
const ids = async () => (await exportChats()).map(exported => exported.id);

beforeEach(() => {
  db = { chats: [], chat_messages: [], purpose_grants: [
    { grant_id: GRANT, grant_revision: 2, target_kind: "subject", target_id: SUBJECT, revoked_at: null, expires_at: null },
  ], directional_grants: [{ grant_id: GRANT, grant_revision: 2, status: "current" }], subject_consents: [
    { id: CONSENT, grant_revision: 1, account_id: ACCOUNT, subject_id: SUBJECT, revoked_at: null, expires_at: null },
  ] };
  reads = []; rpcs = []; onRead = () => {};
  authority = { data: { ...authorityOf(), sessionId: SESSION }, error: null };
});

describe("the chats the free export carries", () => {
  it("carries nothing, and reads no message, when there is no chat", async () => {
    expect(await exportChats()).toEqual([]);
    expect(reads).not.toContain("chat_messages");
  });

  it("carries a visible chat with only the history fields, the user turn before its answer", async () => {
    db.chats = [chat("visible")];
    db.chat_messages = [...turn("visible", 2), ...turn("visible", 1)].reverse();
    // The fake does not sort, so hand it history order as the query asks.
    db.chat_messages.sort((a, b) => Number(a.turn_ordinal) - Number(b.turn_ordinal) || (a.role === "user" ? -1 : 1));
    const [exported, ...rest] = await exportChats();
    expect(rest).toEqual([]);
    expect(Object.keys(exported).sort()).toEqual(["created_at", "id", "messages", "scope_kind", "subject_id"]);
    expect(exported).toMatchObject({ id: "visible", subject_id: SUBJECT, scope_kind: "self" });
    expect(exported.messages.map(message => message.content)).toEqual([
      [{ type: "text", text: "user 1" }], [{ type: "text", text: "assistant 1" }],
      [{ type: "text", text: "user 2" }], [{ type: "text", text: "assistant 2" }],
    ]);
    for (const message of exported.messages) {
      expect(Object.keys(message).sort()).toEqual(["citations", "content", "createdAt", "embryoFindings", "id", "role"]);
      expect(message.embryoFindings).toEqual([]);
    }
    expect(exported.messages[0].citations).toEqual([]);
    expect(exported.messages[1].citations).toEqual([{ id: "report", label: "Report", href: "/genome/me/reports/x" }]);
    // No grant revision, projection, provider payload or private title leaves.
    const text = JSON.stringify(exported);
    for (const secret of ["grant_revisions", "canonical_projection", "authorization_fingerprint", "provider_classification",
      "copilotGrantRevision", "runtimeAttestationFingerprint", "Private title", "resultHash"]) {
      expect(text, secret).not.toContain(secret);
    }
  });

  it("follows the chat's own grants and never reads the provider settings or key", async () => {
    db.chats = [chat("visible")];
    db.chat_messages = turn("visible", 1);
    expect(await ids()).toEqual(["visible"]);
    expect(reads).not.toContain("llm_settings");
    expect(reads).not.toContain("llm_keys");
    // The projection comes from the database's own `prepare`, under the exact
    // authority it just resolved, for this account, session and subject.
    const prepare = rpcs.find(call => call.args.p_operation === "prepare")!;
    expect(prepare.args).toEqual({ p_account_id: ACCOUNT, p_session_id: SESSION, p_subject_id: SUBJECT, p_operation: "prepare",
      p_authority: authority.data, p_projection: null, p_chat_id: null, p_payload: {} });
  });

  it("does not carry a legacy, non-canonical, non-self, foreign-subject or another account's chat", async () => {
    db.chats = [
      chat("legacy", { legacy_unverified: true }),
      chat("unmarked", { legacy_unverified: null }),
      chat("no-authority", { canonical_authority: null }),
      chat("family", { scope_kind: "family" }),
      chat("someone-else", { subject_id: OTHER_SUBJECT }),
      chat("other-account", { user_id: OTHER_ACCOUNT }),
    ];
    db.chat_messages = db.chats.flatMap(row => turn(String(row.id), 1));
    expect(await exportChats()).toEqual([]);
    // Nothing about them was read beyond the chat row itself.
    expect(reads).not.toContain("chat_messages");
  });

  it.each([
    ["revoked", () => { db.purpose_grants[0].revoked_at = "2026-09-25T00:00:00Z"; }],
    ["expired", () => { db.purpose_grants[0].expires_at = "2026-09-01T00:00:00Z"; }],
    ["superseded by a new revision", () => { db.purpose_grants[0].grant_revision = 3; db.directional_grants[0].grant_revision = 3; }],
    ["no longer current as a direction", () => { db.directional_grants[0].status = "superseded"; }],
    ["about another subject", () => { db.purpose_grants[0].target_id = OTHER_SUBJECT; }],
  ])("omits a chat whose Copilot grant is %s", async (_, change) => {
    db.chats = [chat("stale-grant")];
    db.chat_messages = turn("stale-grant", 1);
    change();
    expect(await exportChats()).toEqual([]);
  });

  it("asks a cloud chat's provider consent too, by its own revision and account", async () => {
    const cloud = authorityOf({ providerClass: "cloud", providerGrantId: CONSENT, providerGrantRevision: 1 });
    db.chats = [chat("cloud", { canonical_authority: cloud })];
    db.chat_messages = turn("cloud", 1);
    expect(await ids()).toEqual(["cloud"]);
    db.subject_consents[0].revoked_at = "2026-09-25T00:00:00Z";
    expect(await ids()).toEqual([]);
    db.subject_consents[0] = { ...db.subject_consents[0], revoked_at: null, account_id: OTHER_ACCOUNT };
    expect(await ids()).toEqual([]);
    db.subject_consents[0] = { ...db.subject_consents[0], account_id: ACCOUNT, grant_revision: 2 };
    expect(await ids()).toEqual([]);
  });

  it("stops before the first turn answered from a projection that no longer holds, and drops everything after it", async () => {
    db.chats = [chat("cutoff")];
    db.chat_messages = [...turn("cutoff", 1), ...turn("cutoff", 2, SAME_PROJECTION), ...turn("cutoff", 3, STALE_PROJECTION),
      ...turn("cutoff", 4)];
    const [exported] = await exportChats();
    expect(exported.messages.map(message => message.id)).toEqual([
      "cutoff-00001-user", "cutoff-00001-assistant", "cutoff-00002-user", "cutoff-00002-assistant",
    ]);
  });

  it("treats a legacy turn inside a canonical chat as the same cutoff", async () => {
    db.chats = [chat("mixed")];
    db.chat_messages = [...turn("mixed", 1), ...turn("mixed", 2, PROJECTION, { legacy_unverified: true }), ...turn("mixed", 3)];
    expect((await exportChats())[0].messages).toHaveLength(2);
  });

  it("does not list a chat with nothing left", async () => {
    db.chats = [chat("all-stale"), chat("empty-shell")];
    db.chat_messages = turn("all-stale", 1, STALE_PROJECTION);
    expect(await exportChats()).toEqual([]);
  });

  it("omits the chats of a subject whose current Copilot authority cannot be resolved", async () => {
    db.chats = [chat("unresolved")];
    db.chat_messages = turn("unresolved", 1);
    authority = { data: null, error: null };
    expect(await exportChats()).toEqual([]);
    expect(rpcs.some(call => call.args.p_operation === "prepare")).toBe(false);
  });

  it("refuses rather than understating when a read fails", async () => {
    db.chats = [chat("visible")];
    db.chat_messages = turn("visible", 1);
    authority = { data: null, error: { message: "unavailable" } };
    await expect(exportChats()).rejects.toThrow("export unavailable");
  });

  it("refuses when the grant is withdrawn while the messages are read", async () => {
    db.chats = [chat("visible")];
    db.chat_messages = turn("visible", 1);
    onRead = table => { if (table === "chat_messages") db.purpose_grants[0].revoked_at = "2026-09-26T00:00:00Z"; };
    await expect(exportChats()).rejects.toThrow("export unavailable");
  });

  it("reads a chat longer than one API page completely", async () => {
    db.chats = [chat("long")];
    db.chat_messages = Array.from({ length: 1203 }, (_, i) => turn("long", i + 1)).flat();
    const [exported] = await exportChats();
    expect(exported.messages).toHaveLength(2406);
    expect(new Set(exported.messages.map(message => message.id)).size).toBe(2406);
  });
});
