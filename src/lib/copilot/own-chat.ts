import 'server-only';
import { z } from 'zod';
import { createAdminClient } from '@/lib/supabase/admin';
import { currentOwnUploadAccount } from '@/lib/uploads/own-upload-context';
import { providerKeyFor } from '@/lib/llm';
import { resolveSubjectForAccount } from '@/lib/subjects';
import { prepareOwnCopilotProvider, ownCopilotProviderStatus, assertOwnCopilotAuthority, type OwnCopilotAuthority } from './own-provider-authority';
import { ownChatProjectionSchema, ownChatCitationSchema, type OwnChatProjection } from './own-chat-content';
import { mintOwnChatToken, snapshotHash } from './own-chat-token';
type Actor = {
    accountId: string;
    sessionId: string;
};
export type OwnCopilotChatView = {
    kind: 'unavailable';
    reason: 'account_required' | 'provider_unavailable' | 'consent_required' | 'scope_unavailable' | 'transport_unavailable';
} | {
    kind: 'legacy';
} | {
    kind: 'ready';
    contextToken: string;
    providerInfo: {
        configured: true;
        provider: 'anthropic' | 'openai_compatible';
        providerKey: string;
        model: string;
        local: boolean;
        hasConsent: true;
    };
    chats: Array<{
        id: string;
        createdAt: string;
    }>;
};
/** Same fail-closed classification for the RSC and legacy route. A canonical
 * consent, source identity or saved chat prevents any legacy ABI fallback. */
export async function hasCanonicalCopilotScope(subjectId: string) {
    const db = createAdminClient();
    const [signatures, files, chats] = await Promise.all([
        db.from('consent_signatures').select('id').eq('target_id', subjectId).eq('artifact_key', 'consent.upload-self').limit(1),
        db.from('genome_files').select('id').eq('subject_id', subjectId).or('single_logical_sample_verified_at.not.is.null,structural_validator_version.not.is.null,storage_object_id.not.is.null,source_sha256.not.is.null').limit(1),
        db.from('chats').select('id').eq('subject_id', subjectId).not('canonical_authority', 'is', null).limit(1),
    ]);
    if (signatures.error || files.error || chats.error)
        throw new Error('copilot_unavailable');
    return Boolean(signatures.data?.length || files.data?.length || chats.data?.length);
}
export const ownChatMessageSchema = z.object({ id: z.uuid(), role: z.enum(['user', 'assistant']), content: z.array(z.object({ type: z.literal('text'), text: z.string().max(64000) }).strict()).length(1),
    citations: z.array(ownChatCitationSchema).max(100),
    turn_ordinal: z.number().int().positive(), created_at: z.string() }).strict();
export const ownChatHistorySchema = z.object({ chatId: z.uuid(), messages: z.array(ownChatMessageSchema).max(100), projection: ownChatProjectionSchema, lastOrdinal: z.number().int().nonnegative() }).strict().refine(h => h.messages.length % 2 === 0 && h.messages.every((m, i) => i % 2 === 0 ? m.role === 'user' && h.messages[i + 1]?.role === 'assistant' && h.messages[i + 1].turn_ordinal === m.turn_ordinal
    && (i === 0 || h.messages[i - 1].turn_ordinal < m.turn_ordinal) : true), { message: 'chat history is unavailable' });
export type OwnChatOperation = 'prepare' | 'begin' | 'check' | 'calls' | 'reports' | 'prs' | 'history' | 'list' | 'commit';
export async function ownChatRpc(operation: OwnChatOperation, authority: OwnCopilotAuthority, projection: OwnChatProjection | null = null, chatId: string | null = null, payload: Record<string, unknown> = {}) {
    const db = createAdminClient() as unknown as {
        rpc: (name: string, args: Record<string, unknown>) => PromiseLike<{
            data: unknown;
            error: unknown;
        }>;
    };
    const { data, error } = await db.rpc('own_copilot_chat_v1', { p_operation: operation, p_account_id: authority.accountId, p_session_id: authority.sessionId,
        p_subject_id: authority.subjectId, p_authority: authority, p_projection: projection, p_chat_id: chatId, p_payload: payload });
    if (error)
        throw new Error('copilot_unavailable');
    return data;
}
export async function checkOwnChat(authority: OwnCopilotAuthority, projection: OwnChatProjection) {
    if (!await assertOwnCopilotAuthority({ accountId: authority.accountId, sessionId: authority.sessionId }, authority.subjectId, authority)
        || await ownChatRpc('check', authority, projection) !== true)
        throw new Error('copilot_unavailable');
}
export async function prepareOwnCopilotChat(subjectId: string): Promise<OwnCopilotChatView> {
    try {
        const actor = await currentOwnUploadAccount();
        if (!actor)
            return { kind: 'unavailable', reason: 'account_required' };
        const subject = await resolveSubjectForAccount(actor.accountId, `s-${subjectId}`);
        if (!subject || subject.subjectClass !== 'self')
            return { kind: 'unavailable', reason: 'scope_unavailable' };
        if (!await hasCanonicalCopilotScope(subjectId))
            return { kind: 'legacy' };
        const status = await ownCopilotProviderStatus(subjectId);
        if (status !== 'ready')
            return { kind: 'unavailable', reason: status };
        const provider = await prepareOwnCopilotProvider(subjectId);
        if (!provider)
            return { kind: 'unavailable', reason: 'transport_unavailable' };
        const projection = ownChatProjectionSchema.parse(await ownChatRpc('prepare', provider.authority));
        const chats = z.array(z.object({ id: z.uuid(), created_at: z.string() }).strict()).max(50).parse(await ownChatRpc('list', provider.authority));
        await checkOwnChat(provider.authority, projection);
        return { kind: 'ready', contextToken: mintOwnChatToken({ authority: provider.authority, projectionHash: snapshotHash(projection) }),
            providerInfo: { configured: true, provider: provider.settings.provider, providerKey: providerKeyFor(provider.settings.provider, provider.settings.base_url),
                model: provider.settings.model, local: provider.authority.providerClass === 'local', hasConsent: true },
            chats: chats.map(c => ({ id: c.id, createdAt: new Date(c.created_at).toISOString() })) };
    }
    catch {
        return { kind: 'unavailable', reason: 'scope_unavailable' };
    }
}
/** Resolve only the opaque server chat target here. No content read precedes authority. */
export async function ownChatSubject(actor: Actor, chatId: string) {
    const { data, error } = await createAdminClient().from('chats').select('subject_id,scope_kind,legacy_unverified').eq('id', chatId).eq('user_id', actor.accountId).maybeSingle();
    if (error || !data || data.scope_kind !== 'self' || data.legacy_unverified || !data.subject_id)
        return null;
    return resolveSubjectForAccount(actor.accountId, `s-${data.subject_id}`);
}
export async function readOwnChatHistory(chatId: string) {
    const actor = await currentOwnUploadAccount();
    if (!actor)
        return null;
    const subject = await ownChatSubject(actor, chatId);
    if (!subject)
        return null;
    const provider = await prepareOwnCopilotProvider(subject.id);
    if (!provider)
        return null;
    const history = ownChatHistorySchema.parse(await ownChatRpc('history', provider.authority, null, chatId));
    await checkOwnChat(provider.authority, history.projection);
    return { chatId, scope: { kind: 'self' as const, displayLabel: subject.displayLabel }, messages: history.messages.map(m => ({ id: m.id, role: m.role,
            content: m.content[0].text, citations: m.citations, embryoFindings: [], createdAt: new Date(m.created_at).toISOString() })) };
}
