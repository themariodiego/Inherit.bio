import 'server-only';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { hmacSecret } from '@/lib/crypto';

/**
 * The cohort scope's context token (register chat-scope-v1): minted by the
 * authorized `/copilot/c-{cohort}` page, carried only in the first request
 * body, single use (its nonce is consumed by the same database transaction
 * that writes the first turn) and valid for nine minutes. It binds the
 * account, the session, the cohort, the provider authority and the exact
 * cohort authority the page read under; it never freezes access, because the
 * chat route resolves the authority again before every read. Its own HMAC
 * domain, so no other scope's token can be presented as this one.
 */
const DOMAIN = 'cohort-copilot-context-v1';
const LIFETIME_MS = 540_000;
const hash = z.string().regex(/^[0-9a-f]{64}$/);
export const cohortChatTokenSchema = z.object({
  accountId: z.uuid(), sessionId: z.uuid(), scope: z.literal('cohort'), cohortId: z.uuid(),
  issuingRoute: z.literal('copilot.scope'), providerHash: hash, authorityHash: hash,
  nonce: z.string().regex(/^[A-Za-z0-9_-]{32}$/), issuedAt: z.number().int().positive(), expiresAt: z.number().int().positive(),
}).strict();
export type CohortChatToken = z.infer<typeof cohortChatTokenSchema>;

export function mintCohortChatToken(
  input: Pick<CohortChatToken, 'accountId' | 'sessionId' | 'cohortId' | 'providerHash' | 'authorityHash'>, now = Date.now()) {
  const claims = cohortChatTokenSchema.parse({ ...input, scope: 'cohort', issuingRoute: 'copilot.scope',
    nonce: randomBytes(24).toString('base64url'), issuedAt: now, expiresAt: now + LIFETIME_MS });
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
  return `${payload}.${hmacSecret(payload, DOMAIN)}`;
}

export function readCohortChatToken(token: string, now = Date.now()): CohortChatToken | null {
  if (token.length > 12000) return null;
  const [payload, sig, extra] = token.split('.');
  if (extra !== undefined || !payload || !/^[A-Za-z0-9_-]+$/.test(payload) || !/^[0-9a-f]{64}$/.test(sig ?? '')) return null;
  if (!timingSafeEqual(Buffer.from(sig, 'hex'), Buffer.from(hmacSecret(payload, DOMAIN), 'hex'))) return null;
  try {
    const bytes = Buffer.from(payload, 'base64url');
    if (bytes.toString('base64url') !== payload) return null;
    const parsed = cohortChatTokenSchema.safeParse(JSON.parse(bytes.toString('utf8')));
    if (!parsed.success) return null;
    const claims = parsed.data;
    return claims.issuedAt <= now && claims.expiresAt > now && claims.expiresAt - claims.issuedAt === LIFETIME_MS ? claims : null;
  } catch {
    return null;
  }
}
