import 'server-only';
import { z } from 'zod';
import { familyCapability } from '@/lib/family/access';
import { listFamilyPeople } from '@/lib/family/graph';
import { loadSharedReportSnapshot, type SharedReportResult } from '@/lib/family/shared-report-results';
import { providerKeyFor } from '@/lib/llm';
import { resolveSubjectForAccount } from '@/lib/subjects';
import { createAdminClient } from '@/lib/supabase/admin';
import { currentOwnUploadAccount } from '@/lib/uploads/own-upload-context';
import { FAMILY_SCOPE_LABEL } from '@/copy/copilot/group-scopes';
import { copilotGroupScopes } from './group-scopes';
import { modelRuntime } from './model-endpoint';
import { assertOwnCopilotAuthority, prepareOwnCopilotProvider, type OwnCopilotAuthority } from './own-provider-authority';
import { familyCitationSchema, familyScopeSchema, LAYER_FOR_PURPOSE, type FamilyScopeMember } from './family-chat-content';
import { mintFamilyChatToken } from './family-chat-token';
import { snapshotHash } from './own-chat-token';

/**
 * The Family group Copilot scope, server side (register copilot-route-scope-v1
 * `family`, scope-derived-v1 `family:individual-risks`,
 * copilot-transport-availability-v1 `family:any`).
 *
 * The order of checks is the register's: the transport (a true non-self scope
 * runs only on a server-attested same-host model) before anything is read;
 * then the asker's jurisdiction; then the asker's own local Copilot
 * configuration and permission, which names the one model recipient; then
 * the group, which the database resolves member by member from current
 * directional grants. Each member is also held to both jurisdictions.
 */
type Actor = { accountId: string; sessionId: string };
type Rpc = (name: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }>;
const FAMILY_CAPABILITIES = ['third_party_adult_analysis', 'family_heritability'] as const;

function rpc(): Rpc {
  const admin = createAdminClient();
  return admin.rpc.bind(admin) as unknown as Rpc;
}

export type FamilyChatOperation = 'check' | 'list' | 'history' | 'commit';
export async function familyChatRpc(operation: FamilyChatOperation, actor: Actor, chatId: string | null, payload: Record<string, unknown>) {
  const { data, error } = await rpc()('family_copilot_chat_v1', { p_operation: operation, p_account_id: actor.accountId,
    p_session_id: actor.sessionId, p_chat_id: chatId, p_payload: payload });
  if (error) throw new Error('copilot_unavailable');
  return data;
}

/** Both Family capabilities for the asker and, when given, every contributor (G5.1b). */
export async function familyJurisdictionPermits(actor: Actor, contributorAccountIds: readonly string[] = []): Promise<boolean> {
  for (const capability of FAMILY_CAPABILITIES) {
    if ((await familyCapability(actor.accountId, contributorAccountIds, capability)).status !== 'permitted') return false;
  }
  return true;
}

/** The register copy for the asker's own refusal, or null when both capabilities are permitted. */
export async function familyJurisdictionRefusal(actor: Actor): Promise<string | null> {
  for (const capability of FAMILY_CAPABILITIES) {
    const decision = await familyCapability(actor.accountId, [], capability);
    if (decision.status !== 'permitted') return decision.userFacingCopy;
  }
  return null;
}

/**
 * The group as the database resolves it now, joined to the Family graph for
 * each person's display name and route handle, and filtered to members whose
 * own jurisdiction permits both capabilities. A member the graph cannot name
 * is not shown and not read.
 */
export async function resolveFamilyMembers(actor: Actor): Promise<FamilyScopeMember[]> {
  const response = await rpc()('family_copilot_scope_v1', { p_account_id: actor.accountId, p_session_id: actor.sessionId });
  const scope = familyScopeSchema.safeParse(response.data);
  if (response.error || !scope.success) throw new Error('copilot_unavailable');
  if (!scope.data.length) return [];
  const people = await listFamilyPeople(actor.accountId);
  const named: Omit<FamilyScopeMember, 'ref'>[] = [];
  for (const authority of scope.data) {
    const person = people.find(candidate => candidate.dataSubjectId === authority.subjectId
      && candidate.counterpartAccountId === authority.accountId && candidate.sharing === 'active');
    if (!person || !await familyJurisdictionPermits(actor, [authority.accountId])) continue;
    named.push({ authority, displayLabel: person.displayLabel, handleSegment: person.handle.routeSegment,
      layers: authority.layers.map(layer => LAYER_FOR_PURPOSE[layer.purpose]) });
  }
  return named
    .sort((left, right) => left.displayLabel.localeCompare(right.displayLabel, 'en') || left.authority.subjectId.localeCompare(right.authority.subjectId))
    .map((member, index) => ({ ...member, ref: `person-${index + 1}` }));
}

export function familyMembersHash(members: readonly FamilyScopeMember[]): string {
  return snapshotHash(members.map(member => member.authority));
}

/**
 * Each member's shared reports, read through the existing Family recipient
 * reader under that member's granted layers only. A member whose read is
 * refused is left out of this turn entirely. `confirm` re-runs every
 * captured read's locked terminal check and fails closed.
 */
export async function captureFamilyReports(members: readonly FamilyScopeMember[]) {
  const db = createAdminClient();
  const rows = new Map<string, SharedReportResult[]>();
  const confirms: Array<() => Promise<boolean>> = [];
  const readable: FamilyScopeMember[] = [];
  for (const member of members) {
    const snapshot = await loadSharedReportSnapshot(db, { subjectId: member.authority.subjectId,
      counterpartAccountId: member.authority.accountId, purposes: member.authority.layers.map(layer => layer.purpose) });
    if (!snapshot.authorized || snapshot.access.some(access => access.kind !== 'canonical')) continue;
    readable.push(member);
    rows.set(member.authority.subjectId, snapshot.reports);
    confirms.push(async () => (await snapshot.confirm()).authorized);
  }
  return { members: readable, rows, confirm: async () => {
    for (const confirm of confirms) if (!await confirm()) return false;
    return true;
  } };
}

/** One recheck of everything a group turn depends on; throws when any part changed. */
export async function checkFamilyTurn(actor: Actor, selfSubjectId: string, provider: OwnCopilotAuthority,
  members: readonly FamilyScopeMember[], confirm: () => Promise<boolean>, signal?: AbortSignal) {
  if (signal?.aborted || !modelRuntime().localAllowed || provider.providerClass !== 'local') throw new Error('copilot_unavailable');
  const now = await currentOwnUploadAccount();
  if (!now || now.accountId !== actor.accountId || now.sessionId !== actor.sessionId) throw new Error('copilot_unavailable');
  if (!await familyJurisdictionPermits(actor, members.map(member => member.authority.accountId))) throw new Error('copilot_unavailable');
  if (await familyChatRpc('check', actor, null, { members: members.map(member => member.authority) }) !== true) throw new Error('copilot_unavailable');
  if (!await assertOwnCopilotAuthority(actor, selfSubjectId, provider)) throw new Error('copilot_unavailable');
  if (!await confirm()) throw new Error('copilot_unavailable');
}

export type FamilyCopilotView =
  | { kind: 'transport_unavailable' }
  | { kind: 'jurisdiction_unavailable'; copy: string }
  | { kind: 'provider_required' }
  | { kind: 'ready'; contextToken: string | null; contextHash: string;
    providerInfo: { configured: true; provider: 'anthropic' | 'openai_compatible'; providerKey: string; model: string; local: true; hasConsent: true };
    chats: Array<{ id: string; createdAt: string }>;
    members: Array<{ displayLabel: string; layers: FamilyScopeMember['layers'] }> };

/** The page's state, in the register's order; no group data is read before the transport and jurisdiction pass. Null is 404. */
export async function prepareFamilyCopilotChat(): Promise<FamilyCopilotView | null> {
  const actor = await currentOwnUploadAccount();
  if (!actor) return null;
  // Hosted, preview or unattested: the registered unavailable page, whatever
  // else is true, before anything about the group is read.
  if (!modelRuntime().localAllowed) return { kind: 'transport_unavailable' };
  // A local deployment outside TEST-LOCAL does not serve the scope at all.
  if (!copilotGroupScopes().family) return null;
  const refusal = await familyJurisdictionRefusal(actor);
  if (refusal) return { kind: 'jurisdiction_unavailable', copy: refusal };
  try {
    const self = await resolveSubjectForAccount(actor.accountId, 'me');
    const provider = self ? await prepareOwnCopilotProvider(self.id) : null;
    if (!provider || provider.authority.providerClass !== 'local') return { kind: 'provider_required' };
    const members = await resolveFamilyMembers(actor);
    const chats = z.array(z.object({ id: z.uuid(), created_at: z.string() }).strict()).max(50)
      .parse(await familyChatRpc('list', actor, null, {}));
    const membersHash = familyMembersHash(members);
    return { kind: 'ready', contextHash: snapshotHash({ provider: provider.authority, membersHash }),
      contextToken: members.length ? mintFamilyChatToken({ accountId: actor.accountId, sessionId: actor.sessionId,
        providerHash: snapshotHash(provider.authority), membersHash }) : null,
      providerInfo: { configured: true, provider: provider.settings.provider,
        providerKey: providerKeyFor(provider.settings.provider, provider.settings.base_url), model: provider.settings.model, local: true, hasConsent: true },
      chats: chats.map(chat => ({ id: chat.id, createdAt: new Date(chat.created_at).toISOString() })),
      members: members.map(member => ({ displayLabel: member.displayLabel, layers: member.layers })) };
  } catch {
    return { kind: 'provider_required' };
  }
}

/** Whether a chat id names one of this account's family group chats. No content is read. */
type ChatScopeRow = { scope_kind: string; family_pair_id: string | null; legacy_unverified: boolean; canonical_authority: unknown };
type ChatScopeQuery = { eq(column: string, value: string): ChatScopeQuery; maybeSingle(): PromiseLike<{ data: ChatScopeRow | null; error: unknown }> };
export async function isFamilyGroupChat(actor: Actor, chatId: string): Promise<boolean> {
  // `canonical_authority` is not in the generated types; the row shape is named here instead.
  const chats = createAdminClient().from('chats') as unknown as { select(columns: string): ChatScopeQuery };
  const { data, error } = await chats.select('scope_kind,family_pair_id,legacy_unverified,canonical_authority')
    .eq('id', chatId).eq('user_id', actor.accountId).maybeSingle();
  const authority = data?.canonical_authority as { scope?: unknown } | null | undefined;
  return !error && data?.scope_kind === 'family' && data.family_pair_id === null && data.legacy_unverified === false
    && authority?.scope === 'family-group';
}

export const familyChatHistorySchema = z.object({ chatId: z.uuid(), messages: z.array(z.object({ id: z.uuid(), role: z.enum(['user', 'assistant']),
  content: z.array(z.object({ type: z.literal('text'), text: z.string().max(64000) }).strict()).length(1),
  citations: z.array(familyCitationSchema).max(100), turn_ordinal: z.number().int().positive(), created_at: z.string() }).strict()).min(2).max(100),
  lastOrdinal: z.number().int().positive() }).strict()
  .refine(h => h.messages.length % 2 === 0 && h.messages.every((m, i) => i % 2 === 0
    ? m.role === 'user' && h.messages[i + 1]?.role === 'assistant' && h.messages[i + 1].turn_ordinal === m.turn_ordinal
      && (i === 0 || h.messages[i - 1].turn_ordinal < m.turn_ordinal) : true), { message: 'chat history is unavailable' });

/** A group conversation's history, only while every turn's dependencies are current and the provider is unchanged. */
export async function readFamilyChatHistory(chatId: string) {
  const actor = await currentOwnUploadAccount();
  if (!actor || !copilotGroupScopes().family || !modelRuntime().localAllowed || !await isFamilyGroupChat(actor, chatId)) return null;
  if (!await familyJurisdictionPermits(actor)) return null;
  const self = await resolveSubjectForAccount(actor.accountId, 'me');
  const provider = self ? await prepareOwnCopilotProvider(self.id) : null;
  if (!provider || provider.authority.providerClass !== 'local') return null;
  const raw = await familyChatRpc('history', actor, chatId, { provider: provider.authority });
  if (raw === null) return null;
  const history = familyChatHistorySchema.parse(raw);
  return { chatId, scope: { kind: 'family' as const, displayLabel: FAMILY_SCOPE_LABEL },
    messages: history.messages.map(message => ({ id: message.id, role: message.role, content: message.content[0].text,
      citations: message.citations, embryoFindings: [], createdAt: new Date(message.created_at).toISOString() })) };
}
