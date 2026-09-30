import 'server-only';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { hmacSecret } from '@/lib/crypto';

/**
 * The Family group scope's context token (register chat-scope-v1): minted by
 * the authorized `/copilot/family` page, carried only in the first request
 * body, single use (its nonce is consumed by the same database transaction
 * that writes the first turn) and valid for nine minutes. It binds the
 * account, the session, the provider authority and the exact group the page
 * showed; it never freezes access, because the chat route resolves the group
 * again before every read. A separate HMAC domain from the own-scope token,
 * so neither can be presented as the other.
 */
const DOMAIN = 'family-copilot-context-v1';
const LIFETIME_MS = 540_000;
const hash = z.string().regex(/^[0-9a-f]{64}$/);
export const familyChatTokenSchema = z.object({
  accountId: z.uuid(), sessionId: z.uuid(), scope: z.literal('family'), issuingRoute: z.literal('copilot.scope'),
  providerHash: hash, membersHash: hash, nonce: z.string().regex(/^[A-Za-z0-9_-]{32}$/),
  issuedAt: z.number().int().positive(), expiresAt: z.number().int().positive(),
}).strict();
export type FamilyChatToken = z.infer<typeof familyChatTokenSchema>;

export function mintFamilyChatToken(input: Pick<FamilyChatToken, 'accountId' | 'sessionId' | 'providerHash' | 'membersHash'>, now = Date.now()) {
  const claims = familyChatTokenSchema.parse({ ...input, scope: 'family', issuingRoute: 'copilot.scope',
    nonce: randomBytes(24).toString('base64url'), issuedAt: now, expiresAt: now + LIFETIME_MS });
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
  return `${payload}.${hmacSecret(payload, DOMAIN)}`;
}

export function readFamilyChatToken(token: string, now = Date.now()): FamilyChatToken | null {
  if (token.length > 12000) return null;
  const [payload, sig, extra] = token.split('.');
  if (extra !== undefined || !payload || !/^[A-Za-z0-9_-]+$/.test(payload) || !/^[0-9a-f]{64}$/.test(sig ?? '')) return null;
  if (!timingSafeEqual(Buffer.from(sig, 'hex'), Buffer.from(hmacSecret(payload, DOMAIN), 'hex'))) return null;
  try {
    const bytes = Buffer.from(payload, 'base64url');
    if (bytes.toString('base64url') !== payload) return null;
    const parsed = familyChatTokenSchema.safeParse(JSON.parse(bytes.toString('utf8')));
    if (!parsed.success) return null;
    const claims = parsed.data;
    return claims.issuedAt <= now && claims.expiresAt > now && claims.expiresAt - claims.issuedAt === LIFETIME_MS ? claims : null;
  } catch {
    return null;
  }
}
