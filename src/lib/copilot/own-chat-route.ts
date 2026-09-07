import 'server-only';
import { z } from 'zod';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { streamText, tool, stepCountIs, toUIMessageStream, type UIMessageChunk } from 'ai';
import allowedNumerals from '../../../config/allowed-numerals.json';
import { isSameOrigin } from '@/lib/account-deletion';
import { createAdminClient } from '@/lib/supabase/admin';
import { currentOwnUploadAccount } from '@/lib/uploads/own-upload-context';
import { resolveSubjectForAccount } from '@/lib/subjects';
import { parseRsid } from '@/lib/genome/types';
import { providerKeyFor } from '@/lib/llm';
import { isFixtureSlug } from '@/components/reports/library';
import { refusalFor, type RefusalId } from '@/copy/copilot/refusals';
import { classifyIntent, checkResponse, foldStreamChunks, type AllowedNumerals } from './guard';
import { prepareOwnCopilotProvider } from './own-provider-authority';
import { checkOwnChat, ownChatRpc, ownChatSubject, ownChatHistorySchema, type OwnChatOperation } from './own-chat';
import { readOwnChatToken, snapshotHash } from './own-chat-token';
import { ownChatProjectionSchema, ownChatCallSchema, ownChatReportSchema, ownChatPrsSchema, ownGenotypeResult, capturedReportResult, capturedPrsResult, capturedChatCitations, LEGACY_SOURCE_LIMIT, LEGACY_RAW_NOTE, type OwnChatProjection } from './own-chat-content';
export const ownChatBodySchema = z.union([
    z.object({ contextToken: z.string().min(16).max(12000), message: z.string().trim().min(1).max(8000) }).strict(),
    z.object({ chatId: z.uuid(), message: z.string().trim().min(1).max(8000) }).strict(),
]);
const headers = { 'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff' };
const denied = () => Response.json({ error: 'copilot_unavailable' }, { status: 403, headers });
const notFound = () => Response.json({ error: 'not_found' }, { status: 404, headers });
export async function ownChatResponse(request: Request, body: unknown, options: {
    systemPrompt: string;
    refusal: (id: RefusalId, text: string) => Response;
}) {
    if (!isSameOrigin(request) || new URL(request.url).search)
        return denied();
    const parsed = ownChatBodySchema.safeParse(body);
    if (!parsed.success)
        return Response.json({ error: 'invalid_request' }, { status: 400, headers });
    const input = parsed.data;
    const actor = await currentOwnUploadAccount();
    if (!actor)
        return denied();
    const token = 'contextToken' in input ? readOwnChatToken(input.contextToken) : null;
    if ('contextToken' in input && (!token || token.authority.accountId !== actor.accountId || token.authority.sessionId !== actor.sessionId))
        return notFound();
    const subject = token ? await resolveSubjectForAccount(actor.accountId, `s-${token.authority.subjectId}`)
        : 'chatId' in input ? await ownChatSubject(actor, input.chatId) : null;
    if (!subject || subject.subjectClass !== 'self')
        return notFound();
    const verdict = classifyIntent(input.message, { kind: 'self', displayLabel: subject.displayLabel });
    if (verdict.intent !== 'allowed')
        return options.refusal(verdict.intent, refusalFor(verdict.intent, subject.displayLabel));
    try {
        const provider = await prepareOwnCopilotProvider(subject.id);
        if (!provider)
            return denied();
        if (token && snapshotHash(provider.authority) !== snapshotHash(token.authority))
            return denied();
        let projection: OwnChatProjection;
        let lastOrdinal = 0;
        let history: Array<{
            role: 'user' | 'assistant';
            content: string;
        }> = [];
        const chatId = 'chatId' in input ? input.chatId : null;
        if (chatId) {
            const h = ownChatHistorySchema.parse(await ownChatRpc('history', provider.authority, null, chatId));
            projection = h.projection;
            lastOrdinal = h.lastOrdinal;
            history = h.messages.map(m => ({ role: m.role, content: m.content[0].text }));
        }
        else {
            projection = ownChatProjectionSchema.parse(await ownChatRpc('prepare', provider.authority));
            if (!token || snapshotHash(projection) !== token.projectionHash)
                return denied();
            if (await ownChatRpc('begin', provider.authority, projection, null, { nonceHash: snapshotHash(token.nonce), expiresAt: new Date(token.expiresAt).toISOString() }) !== true)
                return denied();
        }
        const check = async () => { if (request.signal.aborted)
            throw new Error('copilot_unavailable'); await checkOwnChat(provider.authority, projection); };
        const db = createAdminClient();
        async function pages<T>(operation: OwnChatOperation, schema: z.ZodType<T>, selector: Record<string, unknown> = {}) {
            const rows: T[] = [];
            for (let offset = 0;;) {
                await check();
                const page = z.array(schema).max(1000).parse(await ownChatRpc(operation, provider!.authority, projection, chatId, { ...selector, offset }));
                if (!page.length)
                    break;
                rows.push(...page);
                offset += page.length;
                if (rows.length > 10000 || JSON.stringify(rows).length > 2000000)
                    throw new Error('copilot_unavailable');
            }
            await check();
            return rows;
        }
        const sourceIds = new Set([...projection.sources, ...projection.legacySources].map(s => s.id));
        async function calls(rsids: number[]) {
            const rows = await pages('calls', ownChatCallSchema, { rsids });
            if (rows.some(r => !sourceIds.has(r.file_id) || !rsids.includes(r.rsid)))
                throw new Error('copilot_unavailable');
            return rows;
        }
        async function reports() {
            const rows = await pages('reports', ownChatReportSchema);
            if (rows.some(r => !projection.sources.some(s => s.id === r.file_id && s.completed.some(c => c.purpose === r.purpose))))
                throw new Error('copilot_unavailable');
            return rows.filter(r => !isFixtureSlug(r.report.slug));
        }
        const legacyAnalysis = () => [...projection.legacySources.map(s => ({ file_id: s.id, status: 'historical_analysis_unavailable', note: LEGACY_SOURCE_LIMIT })),
            ...projection.unavailableSources.map(s => ({ file_id: s.id, status: s.reason, note: 'This source is not currently readable; no result is inferred.' }))];
        const rawProvenance = () => projection.legacySources.length ? { legacy_sources: projection.legacySources.map(s => ({ file_id: s.id, provenance: 'historical_normalization_unrecorded' })), provenance_note: LEGACY_RAW_NOTE } : {};
        const tools = {
            get_genotype: tool({ description: 'Read an observed genotype at one rsID. Missing and conflicting observations are not negative findings.',
                inputSchema: z.object({ rsid: z.string().max(32) }).strict(), execute: async ({ rsid }) => {
                    await check();
                    const n = parseRsid(rsid);
                    if (!n)
                        return { error: 'not a valid rsID' };
                    if (projection.unavailableSources.length)
                        return { error: 'source_unavailable', note: 'Some files are not currently readable, so the complete source union cannot be checked.' };
                    const { data: reference, error } = await db.from('ref_variants').select('rsid,chrom,pos38,ref,alt,gene_symbol').eq('rsid', n).maybeSingle();
                    if (error)
                        throw new Error('copilot_unavailable');
                    const result = ownGenotypeResult(n, await calls([n]), reference);
                    await check();
                    return { ...result, ...rawProvenance() };
                } }),
            search_variants: tool({ description: 'Find observed genotypes for known reference positions in a named gene.',
                inputSchema: z.object({ gene: z.string().regex(/^[A-Za-z0-9-]{1,32}$/) }).strict(), execute: async ({ gene }) => {
                    await check();
                    if (projection.unavailableSources.length)
                        return { error: 'source_unavailable', note: 'Some files are not currently readable, so the complete source union cannot be checked.' };
                    const { data: refs, error } = await db.from('ref_variants').select('rsid,chrom,pos38,ref,alt,gene_symbol').eq('gene_symbol', gene.toUpperCase()).order('rsid').limit(50);
                    if (error)
                        throw new Error('copilot_unavailable');
                    const rows = refs?.length ? await calls(refs.map(r => r.rsid)) : [];
                    const result = { gene, variants: (refs ?? []).map(r => ({ ...ownGenotypeResult(r.rsid, rows, r), gene: r.gene_symbol })),
                        note: 'Only known reference positions are searched; this is not a complete gene screen.', ...rawProvenance() };
                    await check();
                    return result;
                } }),
            list_reports: tool({ description: 'List only existing completed reports authorized for this subject; never generates reports.',
                inputSchema: z.object({ category: z.string().max(100).nullish() }).strict(), execute: async ({ category }) => {
                    await check();
                    const rows = await reports();
                    const result = { reports: rows.filter(r => !category || r.report.catalogSnapshot?.template.category === category).map(r => ({ slug: r.report.slug, title: r.report.catalogSnapshot?.template.title ?? r.report.slug,
                            category: r.report.catalogSnapshot?.template.category ?? null,
                            file_id: r.file_id, purpose: r.purpose, covered: r.report.covered, completed_at: r.completed_at })),
                        unavailable_sources: legacyAnalysis(), ...(category && rows.some(r => !r.report.catalogSnapshot) ? { limitation: 'Older reports without captured catalog categories cannot be matched to this category filter.' } : {}) };
                    await check();
                    return result;
                } }),
            get_report: tool({ description: 'Read captured report outcomes and source conflicts. Uncaptured current scientific metadata is not supplied.',
                inputSchema: z.object({ slug: z.string().max(200) }).strict(), execute: async ({ slug }) => {
                    await check();
                    const rows = await reports();
                    let result = capturedReportResult(rows, slug);
                    if ('error' in result && !isFixtureSlug(slug)) {
                        // Acknowledge only a real published lookup identifier. This
                        // supplies no current scientific metadata or personal finding.
                        const { data: identity, error } = await db.from('report_templates').select('slug').eq('slug', slug).eq('status', 'published').maybeSingle();
                        if (error)
                            throw new Error('copilot_unavailable');
                        result = capturedReportResult(rows, slug, identity?.slug);
                    }
                    await check();
                    return { ...result, unavailable_sources: legacyAnalysis() };
                } }),
            get_prs: tool({ description: 'Read completed score-panel coverage only. No personal score, rank, percentile or risk is available.',
                inputSchema: z.object({ score_id: z.string().regex(/^PGS\d{6}$/) }).strict(), execute: async ({ score_id }) => {
                    await check();
                    const rows = await pages('prs', ownChatPrsSchema);
                    if (rows.some(r => !projection.sources.some(s => s.id === r.file_id && s.completed.some(c => c.purpose === 'reports.polygenic'))))
                        throw new Error('copilot_unavailable');
                    const result = capturedPrsResult(rows, score_id);
                    await check();
                    return { ...result, unavailable_sources: legacyAnalysis() };
                } }),
        };
        const providerKey = providerKeyFor(provider.settings.provider, provider.settings.base_url);
        // The pinned transport runs both recipient and source checks after DNS and
        // immediately before connection, not merely before transport preparation.
        const providerFetch = provider.createFetch(async () => { await check(); return true; });
        const model = provider.settings.provider === 'anthropic'
            ? createAnthropic({ apiKey: provider.apiKey!, fetch: providerFetch })(provider.settings.model)
            : createOpenAICompatible({ name: providerKey, baseURL: provider.settings.base_url!, apiKey: provider.apiKey, fetch: providerFetch })(provider.settings.model);
        await check();
        const result = streamText({ model, system: `${options.systemPrompt}\nThe authorized subject is ${subject.displayLabel}. Tools read only existing allowed sources. Never treat missing, ungenerated or unavailable sources as a negative result.`,
            messages: [...history, { role: 'user', content: input.message }], tools, stopWhen: stepCountIs(8), abortSignal: request.signal,
            prepareStep: async () => { await check(); return {}; },
        });
        const chunks: UIMessageChunk[] = [];
        let bytes = 0;
        const reader = toUIMessageStream({ stream: result.stream, sendReasoning: false }).getReader();
        try {
            for (;;) {
                const { done, value } = await reader.read();
                if (done)
                    break;
                bytes += JSON.stringify(value).length;
                if (bytes > 2000000)
                    throw new Error('copilot_unavailable');
                chunks.push(value);
            }
        }
        finally {
            await reader.cancel().catch(() => { });
            reader.releaseLock();
        }
        await check();
        if (chunks.some(c => c.type === 'error'))
            return denied();
        const folded = foldStreamChunks(chunks);
        const output = checkResponse(folded.text, folded.toolJson, allowedNumerals as AllowedNumerals, { scope: 'self' });
        const answer = output.ok ? chunks.filter((c): c is Extract<UIMessageChunk, {
            type: 'text-delta';
        }> => c.type === 'text-delta').map(c => c.delta).join('')
            : refusalFor(output.violation, subject.displayLabel);
        if (!answer.length || answer.length > 64000)
            return denied();
        const citations = output.ok ? capturedChatCitations(folded.toolJson) : [];
        await check();
        const committed = z.object({ chatId: z.uuid() }).strict().parse(await ownChatRpc('commit', provider.authority, projection, chatId, { message: input.message, answer, citations, lastOrdinal, nonceHash: token ? snapshotHash(token.nonce) : null }));
        await check();
        return Response.json({ chatId: committed.chatId, message: { role: 'assistant', content: answer, citations, embryoFindings: [] } }, { headers: { ...headers, 'x-inherit-chat-id': committed.chatId, ...(!output.ok ? { 'x-copilot-refusal': output.violation } : {}) } });
    }
    catch {
        return denied();
    }
}
