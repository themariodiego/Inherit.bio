import 'server-only';
import { z } from 'zod';
import { EMBRYO_STATUS, cohortLabel } from '@/copy/embryos/index';
import { formatDate } from '@/components/embryo/format';
import { EMBRYO_ANALYSIS, cohortCapability, embryoCapability, permits, resolveResultSurfaceState, type ResultSurfaceState } from '@/lib/embryos/access';
import { allowedConditions } from '@/lib/embryos/allowed-conditions';
import { listCohortsForAccount, rowsOrThrow, type EmbryoCohortView } from '@/lib/embryos/cohorts';
import { loadEmbryoInputFacts } from '@/lib/embryos/input-facts-load';
import { projectComparison, type EmbryoQcRow, type EmbryoScoreRow } from '@/lib/embryos/projection';
import { acknowledged } from '@/lib/embryos/tier2';
import { providerKeyFor } from '@/lib/llm';
import { resolveSubjectForAccount } from '@/lib/subjects';
import { createAdminClient } from '@/lib/supabase/admin';
import { currentOwnUploadAccount } from '@/lib/uploads/own-upload-context';
import { copilotGroupScopes } from './group-scopes';
import { modelRuntime } from './model-endpoint';
import { assertOwnCopilotAuthority, prepareOwnCopilotProvider, type OwnCopilotAuthority } from './own-provider-authority';
import { buildCohortContext, cohortAuthoritySchema, cohortCitationSchema, type CohortAuthority, type CopilotCohortContext } from './cohort-chat-content';
import { mintCohortChatToken } from './cohort-chat-token';
import { snapshotHash } from './own-chat-token';

/**
 * The Embryo (cohort) group Copilot scope, server side (register
 * copilot-route-scope-v1 `c-{cohort}`, scope-derived-v1 `cohort:*`,
 * copilot-transport-availability-v1 `cohort:any`). TEST-LOCAL only.
 *
 * The order of checks: the cohort must be one this account can read (else the
 * same 404 as an unknown id); then the transport, before anything else about
 * it is read; then the cohort's jurisdiction for the viewer and every
 * required upload principal; then the result surface's own states (files
 * still being checked, a missing analysis grant, the Tier-2 gate); then the
 * asker's own local Copilot; then the database authority over the published
 * cohort, which is what every turn is bound to.
 */
type Actor = { accountId: string; sessionId: string };
type Rpc = (name: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }>;

function rpc(): Rpc {
  const admin = createAdminClient();
  return admin.rpc.bind(admin) as unknown as Rpc;
}

export type CohortChatOperation = 'authority' | 'list' | 'history' | 'commit';
/** The service-only dispatcher. Null is the database saying "not readable now" (the route's 404). */
export async function cohortChatRpc(operation: CohortChatOperation, actor: Actor, cohortId: string, chatId: string | null,
  payload: Record<string, unknown>) {
  const { data, error } = await rpc()('cohort_copilot_chat_v1', { p_operation: operation, p_account_id: actor.accountId,
    p_session_id: actor.sessionId, p_cohort_id: cohortId, p_chat_id: chatId, p_payload: payload });
  if (error) throw new Error('copilot_unavailable');
  return data ?? null;
}

/** The current authority over the cohort, or null. */
export async function cohortAuthority(actor: Actor, cohortId: string): Promise<CohortAuthority | null> {
  const raw = await cohortChatRpc('authority', actor, cohortId, null, {});
  return raw === null ? null : cohortAuthoritySchema.parse(raw);
}

export function authorityHash(authority: CohortAuthority): string {
  return snapshotHash(authority);
}

/** The cohort this account can read by this id, or null. */
export async function readableCohort(accountId: string, cohortId: string): Promise<EmbryoCohortView | null> {
  if (!permits(await embryoCapability(accountId, [], EMBRYO_ANALYSIS))) return null;
  return (await listCohortsForAccount(accountId)).find(cohort => cohort.id === cohortId) ?? null;
}

/**
 * The published comparison the embryos pages project, read with the service
 * role exactly as `/embryos/compare` reads it, then reduced to the closed
 * `copilotCohortContext` for the embryos the authority names.
 */
export async function loadCohortContext(cohort: EmbryoCohortView, authority: CohortAuthority): Promise<CopilotCohortContext> {
  const admin = createAdminClient();
  const embryoIds = authority.embryos.map(embryo => embryo.embryoId);
  const registered = new Set(allowedConditions().map(entry => entry.condition_id));
  const [qcResult, scoreResult] = await Promise.all([
    admin.from('embryo_qc').select('*').in('embryo_id', embryoIds),
    registered.size > 0
      ? admin.from('embryo_scores')
        .select('embryo_id, condition_id, condition_name, finding, evidence_label, coverage_state, citation_ids, not_covered_reason')
        .in('embryo_id', embryoIds).in('condition_id', [...registered])
      : { data: [] as never[], error: null },
  ]);
  const qcRows = rowsOrThrow('embryo_qc', qcResult);
  const scoreRows = rowsOrThrow('embryo_scores', scoreResult);
  const named = cohort.embryos.filter(embryo => embryoIds.includes(embryo.id));
  const sourceFacts = new Map(await Promise.all(named.map(async embryo =>
    [embryo.id, await loadEmbryoInputFacts(admin, cohort.id, embryo.subjectId)] as const)));
  const comparison = projectComparison({
    cohortId: cohort.id,
    embryos: named.map(embryo => ({ id: embryo.id, cohort_id: cohort.id, sample_ordinal: embryo.sampleOrdinal,
      display_label: embryo.displayLabel, status: embryo.status })),
    qcRows: qcRows.map(qc => ({ ...qc, source_facts: sourceFacts.get(qc.embryo_id) })) as unknown as EmbryoQcRow[],
    scores: scoreRows as unknown as EmbryoScoreRow[],
    registeredConditionIds: registered,
  });
  return buildCohortContext(comparison, authority);
}

/** One recheck of everything a cohort turn depends on; throws when any part changed. */
export async function checkCohortTurn(actor: Actor, cohortId: string, selfSubjectId: string, provider: OwnCopilotAuthority,
  expected: CohortAuthority, signal?: AbortSignal) {
  if (signal?.aborted || !modelRuntime().localAllowed || provider.providerClass !== 'local' || !copilotGroupScopes().cohort) {
    throw new Error('copilot_unavailable');
  }
  const now = await currentOwnUploadAccount();
  if (!now || now.accountId !== actor.accountId || now.sessionId !== actor.sessionId) throw new Error('copilot_unavailable');
  const cohort = await readableCohort(actor.accountId, cohortId);
  if (!cohort || !permits(await cohortCapability(actor.accountId, cohort, EMBRYO_ANALYSIS))) throw new Error('copilot_unavailable');
  const current = await cohortAuthority(actor, cohortId);
  if (!current || authorityHash(current) !== authorityHash(expected)) throw new Error('copilot_unavailable');
  if (!await assertOwnCopilotAuthority(actor, selfSubjectId, provider)) throw new Error('copilot_unavailable');
}

export type CohortCopilotView =
  | { kind: 'transport_unavailable' }
  | { kind: 'jurisdiction_unavailable'; copy: string }
  | { kind: 'blocked'; state: Exclude<ResultSurfaceState, 'jurisdiction-unavailable' | 'complete'>; cohortId: string;
    grantsMissing: number; viewerGranted: boolean | null }
  | { kind: 'provider_required'; cohortLabel: string }
  | { kind: 'ready'; cohortId: string; cohortLabel: string; contextToken: string; contextHash: string;
    providerInfo: { configured: true; provider: 'anthropic' | 'openai_compatible'; providerKey: string; model: string; local: true; hasConsent: true };
    chats: Array<{ id: string; createdAt: string }>;
    embryos: Array<{ label: string; status: string }>;
    standingStatement: string };

/** The page's state for `/copilot/c-{cohort}`, in the order above. Null is 404. */
export async function prepareCohortCopilotChat(cohortId: string): Promise<CohortCopilotView | null> {
  const actor = await currentOwnUploadAccount();
  if (!actor) return null;
  const cohort = await readableCohort(actor.accountId, cohortId);
  if (!cohort) return null;
  // Hosted, preview, unattested, or not built here: the registered
  // unavailable page, before anything else about the cohort is read.
  if (!modelRuntime().localAllowed || !copilotGroupScopes().cohort) return { kind: 'transport_unavailable' };
  const decision = await cohortCapability(actor.accountId, cohort, EMBRYO_ANALYSIS);
  const state = resolveResultSurfaceState({ decision, cohort, acknowledged: await acknowledged({ id: actor.accountId }) });
  if (state === 'jurisdiction-unavailable') return { kind: 'jurisdiction_unavailable', copy: decision.userFacingCopy };
  const blocked = (next: Exclude<ResultSurfaceState, 'jurisdiction-unavailable' | 'complete'>) => ({
    kind: 'blocked' as const, state: next, cohortId, grantsMissing: cohort.analysisGrantsMissing,
    viewerGranted: cohort.viewerAnalysisGranted });
  if (state !== 'complete') return blocked(state);
  const label = cohortLabel(formatDate(cohort.createdAt));
  try {
    const self = await resolveSubjectForAccount(actor.accountId, 'me');
    const provider = self ? await prepareOwnCopilotProvider(self.id) : null;
    if (!provider || provider.authority.providerClass !== 'local') return { kind: 'provider_required', cohortLabel: label };
    const authority = await cohortAuthority(actor, cohortId);
    // Every grant is in and the gate is passed, but the database does not
    // yet hold a published cohort for this account: still being checked.
    if (!authority) return blocked('processing');
    const context = await loadCohortContext(cohort, authority);
    const chats = z.array(z.object({ id: z.uuid(), created_at: z.string() }).strict()).max(50)
      .parse(await cohortChatRpc('list', actor, cohortId, null, {}) ?? []);
    const hash = authorityHash(authority);
    return { kind: 'ready', cohortId, cohortLabel: label, contextHash: snapshotHash({ provider: provider.authority, hash }),
      contextToken: mintCohortChatToken({ accountId: actor.accountId, sessionId: actor.sessionId, cohortId,
        providerHash: snapshotHash(provider.authority), authorityHash: hash }),
      providerInfo: { configured: true, provider: provider.settings.provider,
        providerKey: providerKeyFor(provider.settings.provider, provider.settings.base_url), model: provider.settings.model, local: true, hasConsent: true },
      chats: chats.map(chat => ({ id: chat.id, createdAt: new Date(chat.created_at).toISOString() })),
      embryos: context.embryos.map(embryo => ({ label: embryo.display_label, status: EMBRYO_STATUS[embryo.status] })),
      standingStatement: context.standing_statement };
  } catch {
    return { kind: 'provider_required', cohortLabel: label };
  }
}

/** The cohort a chat id names, when it is one of this account's cohort conversations. No content is read. */
export async function cohortChatTarget(actor: Actor, chatId: string): Promise<string | null> {
  const { data, error } = await createAdminClient().from('chats').select('scope_kind,cohort_id,legacy_unverified')
    .eq('id', chatId).eq('user_id', actor.accountId).maybeSingle();
  const row = data as { scope_kind: string; cohort_id: string | null; legacy_unverified: boolean } | null;
  return !error && row?.scope_kind === 'cohort' && row.cohort_id && row.legacy_unverified === false ? row.cohort_id : null;
}

export const cohortChatHistorySchema = z.object({ chatId: z.uuid(), messages: z.array(z.object({ id: z.uuid(), role: z.enum(['user', 'assistant']),
  content: z.array(z.object({ type: z.literal('text'), text: z.string().max(64000) }).strict()).length(1),
  citations: z.array(cohortCitationSchema).max(50), embryo_findings: z.array(z.unknown()).max(0),
  turn_ordinal: z.number().int().positive(), created_at: z.string() }).strict()).min(2).max(100),
  lastOrdinal: z.number().int().positive() }).strict()
  .refine(h => h.messages.length % 2 === 0 && h.messages.every((m, i) => i % 2 === 0
    ? m.role === 'user' && h.messages[i + 1]?.role === 'assistant' && h.messages[i + 1].turn_ordinal === m.turn_ordinal
      && (i === 0 || h.messages[i - 1].turn_ordinal < m.turn_ordinal) : true), { message: 'chat history is unavailable' });

/** A cohort conversation's history (copilotCohortHistoryResponse), only while its authority and provider are current. */
export async function readCohortChatHistory(chatId: string) {
  const actor = await currentOwnUploadAccount();
  if (!actor || !copilotGroupScopes().cohort || !modelRuntime().localAllowed) return null;
  const cohortId = await cohortChatTarget(actor, chatId);
  if (!cohortId) return null;
  const cohort = await readableCohort(actor.accountId, cohortId);
  if (!cohort || !permits(await cohortCapability(actor.accountId, cohort, EMBRYO_ANALYSIS))
    || !await acknowledged({ id: actor.accountId })) return null;
  const self = await resolveSubjectForAccount(actor.accountId, 'me');
  const provider = self ? await prepareOwnCopilotProvider(self.id) : null;
  if (!provider || provider.authority.providerClass !== 'local') return null;
  const raw = await cohortChatRpc('history', actor, cohortId, chatId, { provider: provider.authority });
  if (raw === null) return null;
  const history = cohortChatHistorySchema.parse(raw);
  return { chatId, scope: { kind: 'cohort' as const, displayLabel: cohortLabel(formatDate(cohort.createdAt)) },
    messages: history.messages.map(message => ({ id: message.id, role: message.role, content: message.content[0].text,
      citations: message.citations, embryoFindings: [], createdAt: new Date(message.created_at).toISOString() })) };
}
