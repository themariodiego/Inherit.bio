import 'server-only';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { hmacSecret } from '@/lib/crypto';

/**
 * The context token of the compatibility Copilot panel (owner decision of 23
 * October 2026, G8.5: the compatibility chat body moves to the register).
 *
 * `/copilot/[scope]` renders this panel only for a scope with no canonical
 * Copilot authority (`hasCanonicalCopilotScope` false). Its request is now the
 * register's `{ contextToken, message }` instead of the AI SDK transport's
 * `{ id, messages, trigger, messageId }` with `?scope=`: the page mints this
 * token for the signed-in account, its auth session and the subject the route
 * resolved, and the route re-reads all three before anything else. The token
 * names no provider and grants nothing: every check the compatibility branch
 * made before (canonical scope, intent gate, provider, local-only for another
 * person, provider-key consent, key, endpoint) runs again on every request.
 *
 * Its own MAC domain, so it never reads as an own, family or cohort token, and
 * the same 9-minute lifetime as the own token. It is not recorded anywhere,
 * so it is not single-use: the compatibility branch keeps no conversation,
 * and each question is answered on its own.
 */
const DOMAIN = 'copilot-compat-context-v1';
const LIFETIME_MS = 540000;
const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
export const compatChatTokenSchema = z.object({ accountId: uuid, sessionId: uuid, subjectId: uuid,
  issuingRoute: z.literal('copilot.scope'), nonce: z.string().regex(/^[A-Za-z0-9_-]{32}$/),
  issuedAt: z.number().int().positive(), expiresAt: z.number().int().positive() }).strict();
export type CompatChatToken = z.infer<typeof compatChatTokenSchema>;

export function mintCompatChatToken(input: Pick<CompatChatToken, 'accountId' | 'sessionId' | 'subjectId'>, now = Date.now()): string {
  const claims = compatChatTokenSchema.parse({ ...input, issuingRoute: 'copilot.scope', nonce: randomBytes(24).toString('base64url'),
    issuedAt: now, expiresAt: now + LIFETIME_MS });
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
  return `${payload}.${hmacSecret(payload, DOMAIN)}`;
}

export function readCompatChatToken(token: unknown, now = Date.now()): CompatChatToken | null {
  if (typeof token !== 'string' || token.length > 12000) return null;
  const [payload, sig, extra] = token.split('.');
  if (extra !== undefined || !payload || !/^[A-Za-z0-9_-]+$/.test(payload) || !/^[0-9a-f]{64}$/.test(sig ?? '')) return null;
  if (!timingSafeEqual(Buffer.from(sig, 'hex'), Buffer.from(hmacSecret(payload, DOMAIN), 'hex'))) return null;
  try {
    const bytes = Buffer.from(payload, 'base64url');
    if (bytes.toString('base64url') !== payload) return null;
    const parsed = compatChatTokenSchema.safeParse(JSON.parse(bytes.toString('utf8')));
    if (!parsed.success) return null;
    return parsed.data.issuedAt <= now && parsed.data.expiresAt > now && parsed.data.expiresAt - parsed.data.issuedAt === LIFETIME_MS
      ? parsed.data : null;
  } catch {
    return null;
  }
}

/** Whether a body is the compatibility panel's `{ contextToken, message }`, by its token's own MAC. */
export function isCompatChatRequest(body: unknown): boolean {
  return typeof body === 'object' && body !== null && 'contextToken' in body
    && readCompatChatToken((body as { contextToken: unknown }).contextToken) !== null;
}
