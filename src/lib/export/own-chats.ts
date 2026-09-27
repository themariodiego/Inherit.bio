import "server-only";
import { isDeepStrictEqual } from "node:util";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The saved Copilot conversations the free synchronous export carries (F5,
 * 26 Sep 2026).
 *
 * The archive used to read every chat and message the account had ever
 * stored, including legacy unverified chats, chats whose Copilot permission
 * had ended and turns answered from data that has since changed, and it said
 * "not stored server-side" when there were none. Both were wrong. The owner
 * decided on 26 Sep 2026 (docs/protocol/decisions.md) that exportability
 * follows a chat's own grants, never the provider settings, and that legacy
 * unverified chats are not exported, matching the chat history the person
 * sees (`chat-history-projection-v1`).
 *
 * The rules are those of `private.export_archive_chat_messages_v1`
 * (supabase/migrations/20260925220000_export_archive_chat_reader.sql), mirrored
 * here because that helper runs only under an export job. The chat history's
 * own reader cannot be reused: it is capped at 50 chats and 100 messages, and
 * it needs the provider transport and credential to be usable. A chat is
 * exported only when all of these hold:
 *
 *   - it belongs to this account and is about a subject this account IS;
 *   - its scope is `self`;
 *   - it is canonical: it carries its authority and is not legacy unverified;
 *   - the Copilot grant it was created under is still that same revision,
 *     unrevoked, unexpired, current and about that subject;
 *   - for a cloud model, the provider consent it was created under is too.
 *
 * Within a chat, the first turn answered under a data projection that no
 * longer holds is omitted whole, with every turn after it. A chat with nothing
 * left is not listed. Only the history fields leave: no grant revisions,
 * projections or provider payloads.
 *
 * The current projection itself can only come from the database, through the
 * Copilot `prepare` operation, which needs the account's current Copilot
 * authority. Where that authority cannot be resolved although the chat's own
 * grant is current, no turn can be shown to match and the chat is omitted. That
 * errs towards carrying less, never more, than the job reader; the chat history
 * cannot show such a chat either.
 */

type Actor = { accountId: string; sessionId: string };
type Row = Record<string, unknown>;
type Rpc = (name: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }>;

export type ExportedChatMessage = {
  id: string; role: string; content: unknown; citations: unknown; embryoFindings: []; createdAt: string;
};
export type ExportedChat = {
  id: string; subject_id: string; scope_kind: "self"; created_at: string; messages: ExportedChatMessage[];
};

// The API caps every response at 1,000 rows whatever range is asked for, so
// reads advance by the rows actually returned and stop only on an empty page.
const PAGE = 1000;
const unavailable = () => new Error("export unavailable");

async function readAll(page: (from: number, to: number) => PromiseLike<{ data: unknown[] | null; error: unknown }>) {
  const rows: Row[] = [];
  for (let from = 0; ; ) {
    const { data, error } = await page(from, from + PAGE - 1);
    if (error) throw unavailable();
    if (!data || data.length === 0) return rows;
    rows.push(...(data as Row[]));
    from += data.length;
  }
}

const isObject = (value: unknown): value is Row =>
  typeof value === "object" && value !== null && !Array.isArray(value);
/** `x::text = authority->>'key'`: the same comparison the SQL helper makes. */
const sameText = (column: unknown, value: unknown) =>
  value !== undefined && value !== null && column !== undefined && column !== null && String(column) === String(value);
const live = (row: Row) =>
  row.revoked_at === null && (row.expires_at === null || Date.parse(String(row.expires_at)) > Date.now());

type Selection = { chats: Row[]; projections: Map<string, unknown> };

/** The chats whose own grants are current, and each subject's projection. */
async function selectChats(admin: SupabaseClient, actor: Actor, ownSubjects: ReadonlySet<string>): Promise<Selection> {
  const all = await readAll((from, to) => admin.from("chats")
    .select("id,subject_id,scope_kind,legacy_unverified,canonical_authority,created_at")
    .eq("user_id", actor.accountId).order("created_at").order("id").range(from, to));
  const candidates = all.filter(chat => typeof chat.subject_id === "string" && ownSubjects.has(chat.subject_id)
    && chat.scope_kind === "self" && chat.legacy_unverified === false && isObject(chat.canonical_authority));
  if (candidates.length === 0) return { chats: [], projections: new Map() };

  const authorityOf = (chat: Row) => chat.canonical_authority as Row;
  const grantIds = [...new Set(candidates.map(chat => authorityOf(chat).copilotGrantId).filter(id => typeof id === "string"))];
  const consentIds = [...new Set(candidates.filter(chat => authorityOf(chat).providerClass === "cloud")
    .map(chat => authorityOf(chat).providerGrantId).filter(id => typeof id === "string"))];
  const [grants, directions, consents] = await Promise.all([
    grantIds.length ? readAll((from, to) => admin.from("purpose_grants")
      .select("grant_id,grant_revision,target_kind,target_id,revoked_at,expires_at")
      .in("grant_id", grantIds).order("grant_id").range(from, to)) : [],
    grantIds.length ? readAll((from, to) => admin.from("directional_grants")
      .select("grant_id,grant_revision,status")
      .in("grant_id", grantIds).order("grant_id").order("grant_revision").range(from, to)) : [],
    consentIds.length ? readAll((from, to) => admin.from("subject_consents")
      .select("id,grant_revision,account_id,subject_id,revoked_at,expires_at")
      .in("id", consentIds).order("id").range(from, to)) : [],
  ]);

  const chats = candidates.filter(chat => {
    const authority = authorityOf(chat);
    const copilot = grants.some(grant => sameText(grant.grant_id, authority.copilotGrantId)
      && sameText(grant.grant_revision, authority.copilotGrantRevision) && live(grant)
      && grant.target_kind === "subject" && grant.target_id === chat.subject_id
      && directions.some(direction => direction.grant_id === grant.grant_id
        && direction.grant_revision === grant.grant_revision && direction.status === "current"));
    const provider = authority.providerClass !== "cloud" || consents.some(consent =>
      sameText(consent.id, authority.providerGrantId) && sameText(consent.grant_revision, authority.providerGrantRevision)
      && consent.account_id === actor.accountId && consent.subject_id === chat.subject_id && live(consent));
    return copilot && provider;
  });

  const rpc = admin.rpc.bind(admin) as unknown as Rpc;
  const projections = new Map<string, unknown>();
  for (const subjectId of new Set(chats.map(chat => chat.subject_id as string))) {
    const subject = { p_account_id: actor.accountId, p_session_id: actor.sessionId, p_subject_id: subjectId };
    const authority = await rpc("own_copilot_authority_v1", { ...subject, p_expected: null });
    if (authority.error) throw unavailable();
    if (!isObject(authority.data)) { projections.set(subjectId, null); continue; }
    const prepared = await rpc("own_copilot_chat_v1", { ...subject, p_operation: "prepare", p_authority: authority.data,
      p_projection: null, p_chat_id: null, p_payload: {} });
    if (prepared.error || !isObject(prepared.data)) throw unavailable();
    projections.set(subjectId, prepared.data);
  }
  return { chats, projections };
}

/** One chat's messages before its first turn under a projection that no longer holds. */
async function exportableMessages(admin: SupabaseClient, chat: Row, projection: unknown): Promise<ExportedChatMessage[]> {
  if (projection === null || projection === undefined) return [];
  const rows = await readAll((from, to) => admin.from("chat_messages")
    .select("id,role,content,canonical_citations,created_at,turn_ordinal,canonical_projection,legacy_unverified")
    .eq("chat_id", chat.id as string).order("turn_ordinal").order("role", { ascending: false }).order("id").range(from, to));
  let cutoff = Infinity;
  for (const message of rows) {
    if (message.legacy_unverified !== false || !isDeepStrictEqual(message.canonical_projection, projection)) {
      cutoff = Math.min(cutoff, Number(message.turn_ordinal));
    }
  }
  return rows.filter(message => Number(message.turn_ordinal) < cutoff).map(message => ({
    id: message.id as string, role: message.role as string, content: message.content,
    citations: message.canonical_citations ?? [], embryoFindings: [], createdAt: message.created_at as string,
  }));
}

/**
 * Throws rather than returning a partial list: a failed read, or a grant or
 * projection that changed while the chats were read. The second selection is
 * the same before-and-after question the report and ancestry halves of the
 * archive ask (D-097, D-099): a withdrawal landing mid-export must not leave
 * already-buffered turns in it.
 */
export async function ownChatsForExport(admin: SupabaseClient, actor: Actor, ownSubjectIds: readonly string[],
  assertActive: () => void = () => {}): Promise<ExportedChat[]> {
  const ownSubjects = new Set(ownSubjectIds);
  const before = await selectChats(admin, actor, ownSubjects);
  assertActive();
  const chats: ExportedChat[] = [];
  for (const chat of before.chats) {
    const messages = await exportableMessages(admin, chat, before.projections.get(chat.subject_id as string));
    assertActive();
    if (messages.length) chats.push({ id: chat.id as string, subject_id: chat.subject_id as string, scope_kind: "self",
      created_at: chat.created_at as string, messages });
  }
  const after = await selectChats(admin, actor, ownSubjects);
  assertActive();
  if (!isDeepStrictEqual(after.chats.map(chat => chat.id), before.chats.map(chat => chat.id))
    || !isDeepStrictEqual(after.projections, before.projections)) throw unavailable();
  return chats;
}
