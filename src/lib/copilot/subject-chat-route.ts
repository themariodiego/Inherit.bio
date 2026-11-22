import 'server-only';
import { z } from 'zod';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { streamText, tool, stepCountIs, toUIMessageStream, type UIMessageChunk } from 'ai';
import allowedNumerals from '../../../config/allowed-numerals.json';
import { isSameOrigin } from '@/lib/account-deletion';
import { providerKeyFor } from '@/lib/llm';
import { resolveSubjectForAccount } from '@/lib/subjects';
import { currentOwnUploadAccount } from '@/lib/uploads/own-upload-context';
import { acknowledged } from '@/lib/family/tier2';
import { refusalFor, type RefusalId } from '@/copy/copilot/refusals';
import { familySystemMessage } from '@/copy/copilot/system-prompts';
import { classifyIntent, checkResponse, foldStreamChunks, type AllowedNumerals } from './guard';
import { modelRuntime } from './model-endpoint';
import { prepareOwnCopilotProvider } from './own-provider-authority';
import { ownChatBodySchema } from './own-chat-route';
import { snapshotHash } from './own-chat-token';
import { familyChatHistorySchema } from './family-chat';
import { familyChatCitations, familyReportDetail, familyReportList, FamilyUseLedger } from './family-chat-content';
import { transportUnavailable } from './family-chat-route';
import { readSubjectChatToken } from './subject-chat-token';
import { captureSubjectReports, checkSubjectTurn, resolveSubjectTarget, subjectChatRpc, subjectChatSubject,
  subjectJurisdictionPermits, subjectMember, subjectScope } from './subject-chat';

/**
 * `POST /api/chat` for Copilot about one other adult's record (register
 * api.chat, chat-scope-v1, scope-derived-v1 `subject:adult` /
 * `uploader-or-grantee`; owner decision of 19 November 2026).
 *
 * The request carries only `{contextToken, message}` or `{chatId, message}`:
 * the subject comes from the token the page minted or from the database chat
 * row, never from the body. In api.chat's registered order: the asker's
 * jurisdiction; the transport (a server-attested same-host model or not at
 * all, so a cloud provider never runs here, consent or not); the asker's own
 * local model; the database's scope for this one record (the mitigation
 * decision at the model-retrieval checkpoint, then the person's own
 * `copilot.local` grant for this relationship, then each report layer's own
 * purpose); the Tier-2 acknowledgement; then the intent gate, all before any
 * result is read. Every tool result, the pinned model connection and the
 * commit recheck the whole turn, and the commit binds both rows of the turn
 * to the record, its Copilot grant and every layer and source it read.
 *
 * The person's saved reports for the layers they share are all it reads:
 * no ancestry, no genotype tool and no raw variant, although the register
 * would permit those with further grants.
 */
const headers = { 'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff' };
const denied = () => Response.json({ error: 'copilot_unavailable' }, { status: 403, headers });
const notFound = () => Response.json({ error: 'not_found' }, { status: 404, headers });

/** True when this request is for this scope: a subject context token, or one of this account's subject chats. */
export async function isSubjectChatRequest(body: unknown): Promise<boolean> {
  const parsed = ownChatBodySchema.safeParse(body);
  if (!parsed.success) return false;
  if ('contextToken' in parsed.data) return readSubjectChatToken(parsed.data.contextToken) !== null;
  const actor = await currentOwnUploadAccount();
  return Boolean(actor && await subjectChatSubject(actor, parsed.data.chatId));
}

export async function subjectChatResponse(request: Request, body: unknown, options: {
  refusal: (id: RefusalId, text: string) => Response;
}) {
  if (!isSameOrigin(request) || new URL(request.url).search) return denied();
  const parsed = ownChatBodySchema.safeParse(body);
  if (!parsed.success) return Response.json({ error: 'invalid_request' }, { status: 400, headers });
  const input = parsed.data;
  const actor = await currentOwnUploadAccount();
  if (!actor) return notFound();
  const token = 'contextToken' in input ? readSubjectChatToken(input.contextToken) : null;
  if ('contextToken' in input && (!token || token.accountId !== actor.accountId || token.sessionId !== actor.sessionId)) return notFound();
  const chatId = 'chatId' in input ? input.chatId : null;
  // The one record this turn may read: the token's, or the chat row's.
  const subjectId = token ? token.subjectId : await subjectChatSubject(actor, chatId!);
  if (!subjectId) return notFound();
  try {
    if (!await subjectJurisdictionPermits(actor)) return denied();
    if (!modelRuntime().localAllowed) return transportUnavailable();
    const self = await resolveSubjectForAccount(actor.accountId, 'me');
    const provider = self ? await prepareOwnCopilotProvider(self.id) : null;
    if (!self || !provider) return denied();
    if (provider.authority.providerClass !== 'local') return transportUnavailable();
    if (token && snapshotHash(provider.authority) !== token.providerHash) return denied();
    const target = await resolveSubjectTarget(actor.accountId, subjectId);
    if (!target) return notFound();
    const scope = await subjectScope(actor, target.subjectId);
    // A conversation whose record is no longer readable is gone; a page whose permission is gone is stale.
    if (scope.state !== 'ready' || scope.authority.case !== target.case) return chatId ? notFound() : denied();
    // The page's authority is the one this first turn may read; a change since then needs a fresh page.
    if (token && snapshotHash(scope.authority) !== token.authorityHash) return denied();
    if (!await acknowledged({ id: actor.accountId })) return denied();
    const member = subjectMember(target, scope.authority);
    // The person this thread names is read as a person by both gates.
    const people = [member.displayLabel];
    const verdict = classifyIntent(input.message, { kind: 'subject', displayLabel: member.displayLabel, people });
    if (verdict.intent !== 'allowed') return options.refusal(verdict.intent, refusalFor(verdict.intent, member.displayLabel));
    let lastOrdinal = 0;
    let history: Array<{ role: 'user' | 'assistant'; content: string }> = [];
    if (chatId) {
      const raw = await subjectChatRpc('history', actor, target.subjectId, chatId, { provider: provider.authority });
      if (raw === null) return notFound();
      const h = familyChatHistorySchema.parse(raw);
      lastOrdinal = h.lastOrdinal;
      history = h.messages.map(message => ({ role: message.role, content: message.content[0].text }));
    }
    const capture = await captureSubjectReports(member);
    const members = [member];
    const check = () => checkSubjectTurn(actor, self.id, provider.authority, member, capture.confirm, request.signal);
    await check();
    const ledger = new FamilyUseLedger();
    const tools = {
      list_reports: tool({ description: `List the saved reports ${member.displayLabel} shared with you for Copilot. Never generates results.`,
        inputSchema: z.object({ category: z.string().max(100).nullish() }).strict(), execute: async ({ category }) => {
          await check();
          const result = familyReportList(members, capture.rows, ledger, category);
          await check();
          return result;
        } }),
      get_report: tool({ description: `Read one saved report ${member.displayLabel} shared with you. The source names its person.`,
        inputSchema: z.object({ slug: z.string().max(200), person_ref: z.string().regex(/^person-\d{1,3}$/).nullish() }).strict(),
        execute: async ({ slug, person_ref }) => {
          await check();
          const result = familyReportDetail(members, capture.rows, ledger, slug, person_ref);
          await check();
          return result;
        } }),
    };
    const providerKey = providerKeyFor(provider.settings.provider, provider.settings.base_url);
    // The pinned transport runs the whole recheck after DNS, immediately before connecting.
    const providerFetch = provider.createFetch(async () => { await check(); return true; });
    const model = provider.settings.provider === 'anthropic'
      ? createAnthropic({ apiKey: provider.apiKey!, fetch: providerFetch })(provider.settings.model)
      : createOpenAICompatible({ name: providerKey, baseURL: provider.settings.base_url!, apiKey: provider.apiKey, fetch: providerFetch })(provider.settings.model);
    const result = streamText({ model, system: familySystemMessage(members),
      messages: [...history, { role: 'user', content: input.message }], tools, stopWhen: stepCountIs(8), abortSignal: request.signal,
      prepareStep: async () => { await check(); return {}; },
    });
    const chunks: UIMessageChunk[] = [];
    let bytes = 0;
    const reader = toUIMessageStream({ stream: result.stream, sendReasoning: false }).getReader();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += JSON.stringify(value).length;
        if (bytes > 2_000_000) throw new Error('copilot_unavailable');
        chunks.push(value);
      }
    } finally {
      await reader.cancel().catch(() => { });
      reader.releaseLock();
    }
    await check();
    if (chunks.some(chunk => chunk.type === 'error')) return denied();
    const folded = foldStreamChunks(chunks);
    const output = checkResponse(folded.text, folded.toolJson, allowedNumerals as AllowedNumerals, { scope: 'subject', people });
    const answer = output.ok ? chunks.filter((chunk): chunk is Extract<UIMessageChunk, { type: 'text-delta' }> => chunk.type === 'text-delta')
      .map(chunk => chunk.delta).join('') : refusalFor(output.violation, member.displayLabel);
    if (!answer.length || answer.length > 64000) return denied();
    // A replaced answer carries no sources; the turn is still bound to the record and every layer its tools read.
    const citations = output.ok ? familyChatCitations(members, capture.rows, ledger, folded.toolJson) : [];
    await check();
    const committed = await subjectChatRpc('commit', actor, target.subjectId, chatId, { message: input.message, answer, citations,
      lastOrdinal, nonceHash: token ? snapshotHash(token.nonce) : null, expiresAt: token ? new Date(token.expiresAt).toISOString() : null,
      provider: provider.authority, authority: member.authority, used: ledger.commitPayload(members) });
    if (committed === null) return notFound();
    const { chatId: savedChatId } = z.object({ chatId: z.uuid() }).strict().parse(committed);
    await check();
    return Response.json({ chatId: savedChatId, message: { role: 'assistant', content: answer, citations, embryoFindings: [] } },
      { headers: { ...headers, 'x-inherit-chat-id': savedChatId, ...(!output.ok ? { 'x-copilot-refusal': output.violation } : {}) } });
  } catch {
    return denied();
  }
}
