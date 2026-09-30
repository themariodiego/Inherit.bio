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
import { refusalFor, type RefusalId } from '@/copy/copilot/refusals';
import { FAMILY_SCOPE_LABEL } from '@/copy/copilot/group-scopes';
import { classifyIntent, checkResponse, foldStreamChunks, type AllowedNumerals } from './guard';
import { copilotGroupScopes } from './group-scopes';
import { modelRuntime } from './model-endpoint';
import { prepareOwnCopilotProvider } from './own-provider-authority';
import { ownChatBodySchema } from './own-chat-route';
import { snapshotHash } from './own-chat-token';
import { readFamilyChatToken } from './family-chat-token';
import { familyChatCitations, familyReportDetail, familyReportList, FamilyUseLedger } from './family-chat-content';
import { captureFamilyReports, checkFamilyTurn, familyChatHistorySchema, familyChatRpc, familyJurisdictionPermits,
  familyMembersHash, isFamilyGroupChat, resolveFamilyMembers } from './family-chat';

/**
 * `POST /api/chat` for the Family group scope (register api.chat,
 * chat-scope-v1, scope-derived-v1 `family:individual-risks`).
 *
 * The request carries only `{contextToken, message}` or `{chatId, message}`.
 * The intent gate runs before anything is read. The group is resolved again
 * for this turn from the database; the context token only proves the page
 * showed this same group to this same session. Every tool result, the pinned
 * model connection and the final commit recheck the whole turn: session,
 * both Family capabilities for everyone, every member's exact grants, the
 * asker's own local model permission, and every captured read. A member who
 * pauses or withdraws mid-conversation is gone from the next turn, and the
 * turn in flight fails closed without writing anything.
 *
 * There is no genotype tool in this scope. The model reads each person's
 * saved reports for the layers they shared, attributed to that person.
 */
export const FAMILY_SYSTEM_PROMPT = `You are the Inherit copilot. You answer the account holder's questions about results that other adults have chosen to share with them on Inherit.

Hard rules:
- You are informational, never diagnostic. Never tell anyone they have, will get, or are protected from any disease. Never give treatment, medicine, diet or supplement advice.
- You can read only the saved reports each person shared for Copilot, through list_reports and get_report. Every result belongs to one named person. Always say whose result a fact is, using the person's name exactly as the tools give it.
- Never merge two people's results into one statement, never compare people as better or worse, and never rank them.
- Never guess or state how people are related, how much DNA they share, or anything about a child they might have.
- You cannot read anyone's whole file or any single position outside a shared report. A report type a person did not share is not a result about them.
- State no number that the tools did not return this turn, and cite nothing beyond the citations the tools returned.`;

const headers = { 'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff' };
const denied = () => Response.json({ error: 'copilot_unavailable' }, { status: 403, headers });
/** responseContracts.copilot-transport-unavailable-v1, exactly: no echo, no read, no model call, no write. */
export const transportUnavailable = () => Response.json({ error: 'local_transport_unavailable', state: 'not-covered',
  reason: 'local-transport-unavailable', messageCopyId: 'copilot.transport.local-unavailable' }, { status: 403, headers });
const notFound = () => Response.json({ error: 'not_found' }, { status: 404, headers });

/** True when this request is for the Family group scope: a Family context token, or a family group chat id. */
export async function isFamilyChatRequest(body: unknown): Promise<boolean> {
  const parsed = ownChatBodySchema.safeParse(body);
  if (!parsed.success) return false;
  if ('contextToken' in parsed.data) return readFamilyChatToken(parsed.data.contextToken) !== null;
  const actor = await currentOwnUploadAccount();
  return Boolean(actor && await isFamilyGroupChat(actor, parsed.data.chatId));
}

export async function familyChatResponse(request: Request, body: unknown, options: {
  refusal: (id: RefusalId, text: string) => Response;
}) {
  if (!isSameOrigin(request) || new URL(request.url).search) return denied();
  const parsed = ownChatBodySchema.safeParse(body);
  if (!parsed.success) return Response.json({ error: 'invalid_request' }, { status: 400, headers });
  const input = parsed.data;
  const actor = await currentOwnUploadAccount();
  if (!actor || !copilotGroupScopes().family) return notFound();
  const token = 'contextToken' in input ? readFamilyChatToken(input.contextToken) : null;
  if ('contextToken' in input && (!token || token.accountId !== actor.accountId || token.sessionId !== actor.sessionId)) return notFound();
  const chatId = 'chatId' in input ? input.chatId : null;
  if (chatId && !await isFamilyGroupChat(actor, chatId)) return notFound();
  try {
    // api.chat's registered order: live jurisdiction, then the transport (a
    // true non-self scope runs on a server-attested same-host model or not at
    // all), then the model endpoint and the live scope grants, then the
    // intent gate, all before any result is read.
    if (!await familyJurisdictionPermits(actor)) return denied();
    if (!modelRuntime().localAllowed) return transportUnavailable();
    const self = await resolveSubjectForAccount(actor.accountId, 'me');
    const provider = self ? await prepareOwnCopilotProvider(self.id) : null;
    if (!self || !provider) return denied();
    if (provider.authority.providerClass !== 'local') return transportUnavailable();
    if (token && snapshotHash(provider.authority) !== token.providerHash) return denied();
    const resolved = await resolveFamilyMembers(actor);
    // The people this thread may name are read as persons by both gates.
    const people = resolved.map(member => member.displayLabel);
    const verdict = classifyIntent(input.message, { kind: 'family', displayLabel: FAMILY_SCOPE_LABEL, people });
    if (verdict.intent !== 'allowed') return options.refusal(verdict.intent, refusalFor(verdict.intent, FAMILY_SCOPE_LABEL));
    // The page's group is the one this first turn may read; a change since then needs a fresh page.
    if (token && familyMembersHash(resolved) !== token.membersHash) return denied();
    let lastOrdinal = 0;
    let history: Array<{ role: 'user' | 'assistant'; content: string }> = [];
    if (chatId) {
      const raw = await familyChatRpc('history', actor, chatId, { provider: provider.authority });
      if (raw === null) return notFound();
      const h = familyChatHistorySchema.parse(raw);
      lastOrdinal = h.lastOrdinal;
      history = h.messages.map(message => ({ role: message.role, content: message.content[0].text }));
    }
    const capture = await captureFamilyReports(resolved);
    const members = capture.members;
    const check = () => checkFamilyTurn(actor, self.id, provider.authority, members, capture.confirm, request.signal);
    await check();
    const ledger = new FamilyUseLedger();
    const tools = {
      list_reports: tool({ description: 'List the saved reports each person in this family view shared with you for Copilot, by person. Never generates results.',
        inputSchema: z.object({ category: z.string().max(100).nullish() }).strict(), execute: async ({ category }) => {
          await check();
          const result = familyReportList(members, capture.rows, ledger, category);
          await check();
          return result;
        } }),
      get_report: tool({ description: 'Read one saved report for each person who shared it, or for one person_ref from list_reports. Each source names its person.',
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
    const readableNow = members.length ? members.map(member => `${member.displayLabel} (${member.ref})`).join(', ') : 'nobody';
    const result = streamText({ model, system: `${FAMILY_SYSTEM_PROMPT}\nPeople whose shared reports you may read now: ${readableNow}. Tools read only what each person currently shares.`,
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
    const output = checkResponse(folded.text, folded.toolJson, allowedNumerals as AllowedNumerals, { scope: 'family', people });
    const answer = output.ok ? chunks.filter((chunk): chunk is Extract<UIMessageChunk, { type: 'text-delta' }> => chunk.type === 'text-delta')
      .map(chunk => chunk.delta).join('') : refusalFor(output.violation, FAMILY_SCOPE_LABEL);
    if (!answer.length || answer.length > 64000) return denied();
    // A replaced answer carries no sources, but the turn still records whose data its tools read.
    const citations = output.ok ? familyChatCitations(members, capture.rows, ledger, folded.toolJson) : [];
    await check();
    const committed = await familyChatRpc('commit', actor, chatId, { message: input.message, answer, citations, lastOrdinal,
      nonceHash: token ? snapshotHash(token.nonce) : null, expiresAt: token ? new Date(token.expiresAt).toISOString() : null,
      provider: provider.authority, used: ledger.commitPayload(members) });
    if (committed === null) return notFound();
    const { chatId: savedChatId } = z.object({ chatId: z.uuid() }).strict().parse(committed);
    await check();
    return Response.json({ chatId: savedChatId, message: { role: 'assistant', content: answer, citations, embryoFindings: [] } },
      { headers: { ...headers, 'x-inherit-chat-id': savedChatId, ...(!output.ok ? { 'x-copilot-refusal': output.violation } : {}) } });
  } catch {
    return denied();
  }
}
