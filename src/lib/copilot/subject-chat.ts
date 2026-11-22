import 'server-only';
import { z } from 'zod';
import { familyCapability } from '@/lib/family/access';
import { listFamilyPeople } from '@/lib/family/graph';
import { loadSharedReportSnapshot, type SharedReportResult } from '@/lib/family/shared-report-results';
import { acknowledged } from '@/lib/family/tier2';
import { providerKeyFor } from '@/lib/llm';
import { resolveSubjectForAccount } from '@/lib/subjects';
import { createAdminClient } from '@/lib/supabase/admin';
import { loadPathBReportSnapshot } from '@/lib/uploads/path-b-report-reader';
import { currentOwnUploadAccount } from '@/lib/uploads/own-upload-context';
import { modelRuntime } from './model-endpoint';
import { assertOwnCopilotAuthority, prepareOwnCopilotProvider, type OwnCopilotAuthority } from './own-provider-authority';
import { familyChatHistorySchema } from './family-chat';
import { LAYER_FOR_PURPOSE, type ReportScopeMember } from './family-chat-content';
import { mintSubjectChatToken } from './subject-chat-token';
import { snapshotHash } from './own-chat-token';

/**
 * Copilot for one other adult's record, server side (register
 * copilot-route-scope-v1 `subject`, scope-derived-v1 `subject:adult` /
 * `uploader-or-grantee`, copilot-transport-availability-v1
 * `subject:adult-uploader-or-grantee`; owner decision of 19 November 2026,
 * "G8.5: Copilot for another adult's record opens").
 *
 * `/copilot/s-{subject}` names the record whose data is read, never a scope
 * the request chooses. Two relationships open it, and nothing else does:
 *   - grantee: the subject is another account's own `self` record, and the
 *     asker sees that person on their Family pages (the Family graph's
 *     `dataSubjectId`); the person shares through the Family relationship;
 *   - uploader: the subject is a confirmed Path B `other_adult` record the
 *     asker added, bound to the person's own account.
 *
 * The order of checks is the register's: the local transport and the
 * asker's jurisdiction before anything about the subject is read (the
 * relationship is classified first, from the asker's own rows); then the
 * asker's own local model and its permission; then the database's scope
 * function, which asks other-adult-mitigation-state-v1 first, then the
 * person's `copilot.local` grant to this asker, then each report layer's
 * own purpose. The Tier-2 acknowledgement follows, as on every page that
 * shows another adult's results. Only saved reports of a shared layer are
 * read, through the existing recipient readers; ancestry and raw variants
 * are not read in this version, and no cloud provider is ever used.
 */
type Actor = { accountId: string; sessionId: string };
type Rpc = (name: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }>;
const CAPABILITY = 'third_party_adult_analysis' as const;
const uuid = z.uuid();
const revision = z.number().int().positive().safe();
const layerPurpose = z.enum(['reports.monogenic', 'reports.polygenic']);
const grant = z.object({ purpose: z.string(), grantId: uuid, grantRevision: revision }).strict();

/** Exactly what `subject_copilot_scope_v1` returns when the scope is ready, compared whole on every recheck. */
export const subjectAuthoritySchema = z.object({
  case: z.enum(['grantee', 'uploader']), subjectId: uuid, accountId: uuid, lifecycleRevision: revision,
  subjectBindingRevision: revision, relationship: z.object({ id: uuid, revision }).strict(),
  copilot: grant.refine(g => g.purpose === 'copilot.local'),
  layers: z.array(z.object({ purpose: layerPurpose, grantId: uuid, grantRevision: revision }).strict()).min(1).max(2)
    .refine(layers => new Set(layers.map(layer => layer.purpose)).size === layers.length),
}).strict();
export type SubjectAuthority = z.infer<typeof subjectAuthoritySchema>;
export const subjectScopeSchema = z.discriminatedUnion('state', [
  z.object({ state: z.literal('ready'), authority: subjectAuthoritySchema }).strict(),
  z.object({ state: z.literal('held') }).strict(),
  z.object({ state: z.literal('permission-missing') }).strict(),
]);
export type SubjectScope = z.infer<typeof subjectScopeSchema>;

/** The one person a thread is about, as the asker names them. */
export interface SubjectTarget {
  case: 'grantee' | 'uploader';
  subjectId: string;
  displayLabel: string;
  /** The segment the report pages and the Family pages name this person's record by (`s-{uuid}`). */
  handleSegment: string;
}

/** The one member the report tools read, in the shape the shared content functions take. */
export interface SubjectScopeMember extends ReportScopeMember {
  authority: SubjectAuthority;
}

function rpc(): Rpc {
  const admin = createAdminClient();
  return admin.rpc.bind(admin) as unknown as Rpc;
}

export type SubjectChatOperation = 'check' | 'list' | 'history' | 'commit';
export async function subjectChatRpc(operation: SubjectChatOperation, actor: Actor, subjectId: string | null,
  chatId: string | null, payload: Record<string, unknown>) {
  const { data, error } = await rpc()('subject_copilot_chat_v1', { p_operation: operation, p_account_id: actor.accountId,
    p_session_id: actor.sessionId, p_subject_id: subjectId, p_chat_id: chatId, p_payload: payload });
  if (error) throw new Error('copilot_unavailable');
  return data;
}

/** The database's scope for this one subject: ready, held or permission-missing. Throws for no relationship at all. */
export async function subjectScope(actor: Actor, subjectId: string): Promise<SubjectScope> {
  const response = await rpc()('subject_copilot_scope_v1', { p_account_id: actor.accountId, p_session_id: actor.sessionId,
    p_subject_id: subjectId });
  const scope = subjectScopeSchema.safeParse(response.data);
  if (response.error || !scope.success || (scope.data.state === 'ready' && scope.data.authority.subjectId !== subjectId)) {
    throw new Error('copilot_unavailable');
  }
  return scope.data;
}

/** `third_party_adult_analysis` for the asker and, when given, the person whose record is read (G5.1b). */
export async function subjectJurisdictionPermits(actor: Actor, contributorAccountIds: readonly string[] = []): Promise<boolean> {
  return (await familyCapability(actor.accountId, contributorAccountIds, CAPABILITY)).status === 'permitted';
}

/** The register copy for the asker's own refusal, or null when the capability is permitted. */
export async function subjectJurisdictionRefusal(actor: Actor): Promise<string | null> {
  const decision = await familyCapability(actor.accountId, [], CAPABILITY);
  return decision.status === 'permitted' ? null : decision.userFacingCopy;
}

/**
 * Which uploader-or-grantee relationship the address names, from the
 * asker's own rows alone: a Path B record they added and its person holds
 * with their own account, or a person on their Family pages whose own record
 * this is. Null for everything else, which every caller answers with the
 * same 404.
 */
export async function resolveSubjectTarget(accountId: string, subjectId: string): Promise<SubjectTarget | null> {
  if (!uuid.safeParse(subjectId).success) return null;
  const held = await resolveSubjectForAccount(accountId, `s-${subjectId}`);
  if (held) {
    return held.subjectClass === 'other_adult' && held.ownerAccountId === accountId && held.subjectAccountId !== null
      && held.subjectAccountId !== accountId
      ? { case: 'uploader', subjectId: held.id, displayLabel: held.displayLabel, handleSegment: `s-${held.id}` }
      : null;
  }
  const person = (await listFamilyPeople(accountId)).find(candidate => candidate.dataSubjectId === subjectId);
  return person ? { case: 'grantee', subjectId, displayLabel: person.displayLabel, handleSegment: person.handle.routeSegment } : null;
}

/** The thread's one member, for the report tools and their citations. */
export function subjectMember(target: SubjectTarget, authority: SubjectAuthority): SubjectScopeMember {
  return { authority, ref: 'person-1', displayLabel: target.displayLabel, handleSegment: target.handleSegment,
    layers: authority.layers.map(layer => LAYER_FOR_PURPOSE[layer.purpose]),
    // A grantee has the person's Family page; an uploader cites the reports alone.
    personHref: authority.case === 'grantee' ? `/family/${target.handleSegment}` : null };
}

/**
 * The person's saved reports for the layers they share for Copilot, through
 * the existing recipient reader of the relationship: the Family recipient
 * reader for a grantee, Path B's uploader reader for an uploader. Each
 * re-runs its own locked terminal check in `confirm`. A refused read, or a
 * layer the reader returns that the authority does not name, is unavailable.
 */
export async function captureSubjectReports(member: SubjectScopeMember) {
  const { authority } = member;
  const purposes = authority.layers.map(layer => layer.purpose);
  const snapshot = authority.case === 'grantee'
    ? await loadSharedReportSnapshot(createAdminClient(), { subjectId: authority.subjectId,
      counterpartAccountId: authority.accountId, purposes })
    : await loadPathBReportSnapshot(authority.subjectId);
  if (!snapshot.authorized || snapshot.access.some(access => access.kind !== 'canonical' || !purposes.includes(access.purpose))) {
    throw new Error('copilot_unavailable');
  }
  const rows = new Map<string, SharedReportResult[]>([[authority.subjectId,
    snapshot.reports.filter(row => row.subjectId === authority.subjectId && purposes.includes(row.purpose))]]);
  return { rows, confirm: async () => (await snapshot.confirm()).authorized };
}

/** One recheck of everything a turn depends on; throws when any part changed. */
export async function checkSubjectTurn(actor: Actor, selfSubjectId: string, provider: OwnCopilotAuthority,
  member: SubjectScopeMember, confirm: () => Promise<boolean>, signal?: AbortSignal) {
  if (signal?.aborted || !modelRuntime().localAllowed || provider.providerClass !== 'local') throw new Error('copilot_unavailable');
  const now = await currentOwnUploadAccount();
  if (!now || now.accountId !== actor.accountId || now.sessionId !== actor.sessionId) throw new Error('copilot_unavailable');
  if (!await subjectJurisdictionPermits(actor, [member.authority.accountId])) throw new Error('copilot_unavailable');
  if (!await acknowledged({ id: actor.accountId })) throw new Error('copilot_unavailable');
  if (await subjectChatRpc('check', actor, member.authority.subjectId, null, { authority: member.authority }) !== true) {
    throw new Error('copilot_unavailable');
  }
  if (!await assertOwnCopilotAuthority(actor, selfSubjectId, provider)) throw new Error('copilot_unavailable');
  if (!await confirm()) throw new Error('copilot_unavailable');
}

export type SubjectCopilotView =
  | { kind: 'transport_unavailable' }
  | { kind: 'jurisdiction_unavailable'; copy: string; displayLabel: string }
  | { kind: 'provider_required'; displayLabel: string }
  | { kind: 'permission_missing'; displayLabel: string }
  | { kind: 'held'; displayLabel: string }
  | { kind: 'gated'; displayLabel: string }
  | { kind: 'ready'; contextToken: string; contextHash: string; displayLabel: string;
    providerInfo: { configured: true; provider: 'anthropic' | 'openai_compatible'; providerKey: string; model: string; local: true; hasConsent: true };
    chats: Array<{ id: string; createdAt: string }>;
    layers: SubjectScopeMember['layers'] };

type ProviderPreparation = NonNullable<Awaited<ReturnType<typeof prepareOwnCopilotProvider>>>;
type OpenState = { kind: 'open'; actor: Actor; target: SubjectTarget; provider: ProviderPreparation; authority: SubjectAuthority };

/**
 * The register's order for `/copilot/s-{subject}`, stopping at the first
 * check that fails. Null is the page's 404: no uploader-or-grantee
 * relationship, or one the database does not confirm.
 */
async function subjectCopilotState(subjectId: string): Promise<Exclude<SubjectCopilotView, { kind: 'ready' }> | OpenState | null> {
  const actor = await currentOwnUploadAccount();
  if (!actor) return null;
  const target = await resolveSubjectTarget(actor.accountId, subjectId);
  if (!target) return null;
  // Hosted, preview or unattested: the registered unavailable page, before
  // anything about the record, its person or its results is read.
  if (!modelRuntime().localAllowed) return { kind: 'transport_unavailable' };
  const displayLabel = target.displayLabel;
  const refusal = await subjectJurisdictionRefusal(actor);
  if (refusal) return { kind: 'jurisdiction_unavailable', copy: refusal, displayLabel };
  let provider: Awaited<ReturnType<typeof prepareOwnCopilotProvider>>;
  try {
    const self = await resolveSubjectForAccount(actor.accountId, 'me');
    provider = self ? await prepareOwnCopilotProvider(self.id) : null;
  } catch {
    provider = null;
  }
  if (!provider || provider.authority.providerClass !== 'local') return { kind: 'provider_required', displayLabel };
  let scope: SubjectScope;
  try {
    scope = await subjectScope(actor, target.subjectId);
  } catch {
    return null;
  }
  if (scope.state === 'held') return { kind: 'held', displayLabel };
  if (scope.state === 'permission-missing' || scope.authority.case !== target.case) return { kind: 'permission_missing', displayLabel };
  if (!await acknowledged({ id: actor.accountId })) return { kind: 'gated', displayLabel };
  return { kind: 'open', actor, target, provider, authority: scope.authority };
}

/** The page's view: every state above, or the thread with one context token for exactly this record and authority. */
export async function prepareSubjectCopilotChat(subjectId: string): Promise<SubjectCopilotView | null> {
  const state = await subjectCopilotState(subjectId);
  if (!state || state.kind !== 'open') return state;
  const { actor, target, provider, authority } = state;
  try {
    const chats = z.array(z.object({ id: z.uuid(), created_at: z.string() }).strict()).max(50)
      .parse(await subjectChatRpc('list', actor, target.subjectId, null, {}));
    const authorityHash = snapshotHash(authority);
    const member = subjectMember(target, authority);
    return { kind: 'ready', displayLabel: target.displayLabel, contextHash: snapshotHash({ provider: provider.authority, authorityHash }),
      contextToken: mintSubjectChatToken({ accountId: actor.accountId, sessionId: actor.sessionId, subjectId: target.subjectId,
        providerHash: snapshotHash(provider.authority), authorityHash }),
      providerInfo: { configured: true, provider: provider.settings.provider,
        providerKey: providerKeyFor(provider.settings.provider, provider.settings.base_url), model: provider.settings.model,
        local: true, hasConsent: true },
      chats: chats.map(chat => ({ id: chat.id, createdAt: new Date(chat.created_at).toISOString() })),
      layers: member.layers };
  } catch {
    return { kind: 'provider_required', displayLabel: target.displayLabel };
  }
}

/**
 * Whether the scope would open for this subject now: the entry links render
 * only then. On a deployment with no attested same-host model it is false
 * before anything is read; it lists no conversation and mints no token.
 */
export async function subjectCopilotOpens(subjectId: string): Promise<boolean> {
  if (!modelRuntime().localAllowed) return false;
  try {
    return (await subjectCopilotState(subjectId))?.kind === 'open';
  } catch {
    return false;
  }
}

/** The subject of one of this account's subject-scope conversations, or null. No content is read. */
type ChatScopeRow = { scope_kind: string; subject_id: string | null; legacy_unverified: boolean; canonical_authority: unknown };
type ChatScopeQuery = { eq(column: string, value: string): ChatScopeQuery; maybeSingle(): PromiseLike<{ data: ChatScopeRow | null; error: unknown }> };
export async function subjectChatSubject(actor: Actor, chatId: string): Promise<string | null> {
  if (!uuid.safeParse(chatId).success) return null;
  // `canonical_authority` is not in the generated types; the row shape is named here instead.
  const chats = createAdminClient().from('chats') as unknown as { select(columns: string): ChatScopeQuery };
  const { data, error } = await chats.select('scope_kind,subject_id,legacy_unverified,canonical_authority')
    .eq('id', chatId).eq('user_id', actor.accountId).maybeSingle();
  const authority = data?.canonical_authority as { scope?: unknown } | null | undefined;
  return !error && data?.scope_kind === 'subject' && data.subject_id && data.legacy_unverified === false
    && authority?.scope === 'subject-adult' ? data.subject_id : null;
}

/** A conversation's history, only while every turn is current, the record readable and the provider unchanged. */
export async function readSubjectChatHistory(chatId: string) {
  const actor = await currentOwnUploadAccount();
  if (!actor || !modelRuntime().localAllowed) return null;
  const subjectId = await subjectChatSubject(actor, chatId);
  if (!subjectId) return null;
  const target = await resolveSubjectTarget(actor.accountId, subjectId);
  if (!target || !await subjectJurisdictionPermits(actor) || !await acknowledged({ id: actor.accountId })) return null;
  const self = await resolveSubjectForAccount(actor.accountId, 'me');
  const provider = self ? await prepareOwnCopilotProvider(self.id) : null;
  if (!provider || provider.authority.providerClass !== 'local') return null;
  const raw = await subjectChatRpc('history', actor, subjectId, chatId, { provider: provider.authority });
  if (raw === null) return null;
  const history = familyChatHistorySchema.parse(raw);
  return { chatId, scope: { kind: 'subject' as const, displayLabel: target.displayLabel },
    messages: history.messages.map(message => ({ id: message.id, role: message.role, content: message.content[0].text,
      citations: message.citations, embryoFindings: [], createdAt: new Date(message.created_at).toISOString() })) };
}
