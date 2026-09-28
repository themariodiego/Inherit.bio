import 'server-only';
import { z } from 'zod';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { streamText, toUIMessageStream, type UIMessageChunk } from 'ai';
import allowedNumerals from '../../../config/allowed-numerals.json';
import { isSameOrigin } from '@/lib/account-deletion';
import { cohortLabel } from '@/copy/embryos/index';
import { formatDate } from '@/components/embryo/format';
import { refusalFor, type RefusalId } from '@/copy/copilot/refusals';
import { EMBRYO_ANALYSIS, cohortCapability, permits } from '@/lib/embryos/access';
import { acknowledged } from '@/lib/embryos/tier2';
import { providerKeyFor } from '@/lib/llm';
import { resolveSubjectForAccount } from '@/lib/subjects';
import { currentOwnUploadAccount } from '@/lib/uploads/own-upload-context';
import { classifyIntent, checkResponse, type AllowedNumerals } from './guard';
import { copilotGroupScopes } from './group-scopes';
import { modelRuntime } from './model-endpoint';
import { prepareOwnCopilotProvider } from './own-provider-authority';
import { ownChatBodySchema } from './own-chat-route';
import { snapshotHash } from './own-chat-token';
import { readCohortChatToken } from './cohort-chat-token';
import { cohortCitations, cohortSystemMessage } from './cohort-chat-content';
import { authorityHash, checkCohortTurn, cohortAuthority, cohortChatHistorySchema, cohortChatRpc, cohortChatTarget,
  loadCohortContext, readableCohort } from './cohort-chat';

/**
 * `POST /api/chat` for the Embryo (cohort) scope (register api.chat,
 * chat-scope-v1, scope-derived-v1 `cohort:*`, response `copilotCohortTurnResponse`).
 *
 * The request carries only `{contextToken, message}` or `{chatId, message}`.
 * The cohort comes from the token or the chat row, never from the request.
 * The intent gate runs before anything about the cohort is read. The
 * authority is resolved again for this turn and must equal the one the page
 * read under; it is rechecked inside the pinned model connection, after the
 * model replies and around the commit. The model has no tools: its whole
 * context is `copilotCohortContext`, closed and donor-neutral, and every
 * number it states must be in it. Nothing is ranked, selected or sexed
 * (ADR 0034), and both gates refuse those questions and answers.
 */
const headers = { 'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff' };
const denied = () => Response.json({ error: 'copilot_unavailable' }, { status: 403, headers });
const notFound = () => Response.json({ error: 'not_found' }, { status: 404, headers });
/** responseContracts.copilot-transport-unavailable-v1, exactly: no echo, no read, no model call, no write. */
const transportUnavailable = () => Response.json({ error: 'local_transport_unavailable', state: 'not-covered',
  reason: 'local-transport-unavailable', messageCopyId: 'copilot.transport.local-unavailable' }, { status: 403, headers });

/** True when this request is for the cohort scope: a cohort context token, or one of this account's cohort chats. */
export async function isCohortChatRequest(body: unknown): Promise<boolean> {
  const parsed = ownChatBodySchema.safeParse(body);
  if (!parsed.success) return false;
  if ('contextToken' in parsed.data) return readCohortChatToken(parsed.data.contextToken) !== null;
  const actor = await currentOwnUploadAccount();
  return Boolean(actor && await cohortChatTarget(actor, parsed.data.chatId));
}

export async function cohortChatResponse(request: Request, body: unknown, options: {
  refusal: (id: RefusalId, text: string) => Response;
}) {
  if (!isSameOrigin(request) || new URL(request.url).search) return denied();
  const parsed = ownChatBodySchema.safeParse(body);
  if (!parsed.success) return Response.json({ error: 'invalid_request' }, { status: 400, headers });
  const input = parsed.data;
  const actor = await currentOwnUploadAccount();
  if (!actor) return notFound();
  const token = 'contextToken' in input ? readCohortChatToken(input.contextToken) : null;
  if ('contextToken' in input && (!token || token.accountId !== actor.accountId || token.sessionId !== actor.sessionId)) return notFound();
  const chatId = 'chatId' in input ? input.chatId : null;
  const cohortId = token ? token.cohortId : chatId ? await cohortChatTarget(actor, chatId) : null;
  if (!cohortId) return notFound();
  try {
    const cohort = await readableCohort(actor.accountId, cohortId);
    if (!cohort) return notFound();
    // The transport first: a true non-self scope runs on a server-attested
    // same-host model or not at all, and it is not built outside TEST-LOCAL.
    if (!modelRuntime().localAllowed || !copilotGroupScopes().cohort) return transportUnavailable();
    if (!permits(await cohortCapability(actor.accountId, cohort, EMBRYO_ANALYSIS))) return denied();
    if (!cohort.analysisGranted || !await acknowledged({ id: actor.accountId })) return denied();
    const self = await resolveSubjectForAccount(actor.accountId, 'me');
    const provider = self ? await prepareOwnCopilotProvider(self.id) : null;
    if (!self || !provider) return denied();
    if (provider.authority.providerClass !== 'local') return transportUnavailable();
    if (token && snapshotHash(provider.authority) !== token.providerHash) return denied();
    const label = cohortLabel(formatDate(cohort.createdAt));
    const verdict = classifyIntent(input.message, { kind: 'cohort', displayLabel: label, cohortSize: cohort.embryoCount });
    if (verdict.intent !== 'allowed') return options.refusal(verdict.intent, refusalFor(verdict.intent, label));
    const authority = await cohortAuthority(actor, cohortId);
    if (!authority) return notFound();
    // The page's authority is the one this first turn may read under; any change needs a fresh page.
    if (token && authorityHash(authority) !== token.authorityHash) return denied();
    let lastOrdinal = 0;
    let history: Array<{ role: 'user' | 'assistant'; content: string }> = [];
    if (chatId) {
      const raw = await cohortChatRpc('history', actor, cohortId, chatId, { provider: provider.authority });
      if (raw === null) return notFound();
      const h = cohortChatHistorySchema.parse(raw);
      lastOrdinal = h.lastOrdinal;
      history = h.messages.map(message => ({ role: message.role, content: message.content[0].text }));
    }
    const check = () => checkCohortTurn(actor, cohortId, self.id, provider.authority, authority, request.signal);
    const context = await loadCohortContext(cohort, authority);
    await check();
    const providerKey = providerKeyFor(provider.settings.provider, provider.settings.base_url);
    // The pinned transport runs the whole recheck after DNS, immediately before connecting.
    const providerFetch = provider.createFetch(async () => { await check(); return true; });
    const model = provider.settings.provider === 'anthropic'
      ? createAnthropic({ apiKey: provider.apiKey!, fetch: providerFetch })(provider.settings.model)
      : createOpenAICompatible({ name: providerKey, baseURL: provider.settings.base_url!, apiKey: provider.apiKey, fetch: providerFetch })(provider.settings.model);
    const result = streamText({ model, system: cohortSystemMessage(context),
      messages: [...history, { role: 'user', content: input.message }], abortSignal: request.signal });
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
    if (chunks.some(chunk => chunk.type === 'error' || chunk.type === 'tool-input-available')) return denied();
    const text = chunks.filter((chunk): chunk is Extract<UIMessageChunk, { type: 'text-delta' }> => chunk.type === 'text-delta')
      .map(chunk => chunk.delta).join('');
    // Every number must be in the closed context; the context is the only "tool" this scope has.
    const output = checkResponse(text, [context], allowedNumerals as AllowedNumerals,
      { scope: 'cohort', cohortSize: context.embryos.length });
    const answer = output.ok ? text : refusalFor(output.violation, label);
    if (!answer.length || answer.length > 64000) return denied();
    const citations = output.ok ? cohortCitations(context, answer) : [];
    await check();
    const committed = await cohortChatRpc('commit', actor, cohortId, chatId, { message: input.message, answer, citations, lastOrdinal,
      nonceHash: token ? snapshotHash(token.nonce) : null, expiresAt: token ? new Date(token.expiresAt).toISOString() : null,
      provider: provider.authority, authority });
    if (committed === null) return notFound();
    const { chatId: savedChatId } = z.object({ chatId: z.uuid() }).strict().parse(committed);
    await check();
    return Response.json({ chatId: savedChatId, message: { role: 'assistant', content: answer, citations, embryoFindings: [] } },
      { headers: { ...headers, 'x-inherit-chat-id': savedChatId, ...(!output.ok ? { 'x-copilot-refusal': output.violation } : {}) } });
  } catch {
    return denied();
  }
}
