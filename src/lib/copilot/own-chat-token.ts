import 'server-only';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { hmacSecret } from '@/lib/crypto';
import { ownCopilotAuthoritySchema } from './own-provider-authority';
const DOMAIN = 'own-copilot-context-v1';
export const ownChatTokenSchema = z.object({ authority: ownCopilotAuthoritySchema, projectionHash: z.string().regex(/^[0-9a-f]{64}$/),
    issuingRoute: z.literal('copilot.self'), nonce: z.string().regex(/^[A-Za-z0-9_-]{32}$/), issuedAt: z.number().int().positive(), expiresAt: z.number().int().positive() }).strict();
export type OwnChatToken = z.infer<typeof ownChatTokenSchema>;
/** Canonical JSON ordering makes the snapshot digest independent of JSONB key order. */
export function snapshotHash(value: unknown): string {
    const canonical = (v: unknown): unknown => Array.isArray(v) ? v.map(canonical) : v && typeof v === 'object'
        ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)).map(([k, x]) => [k, canonical(x)])) : v;
    return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}
export function mintOwnChatToken(input: Pick<OwnChatToken, 'authority' | 'projectionHash'>, now = Date.now()) {
    const claims = ownChatTokenSchema.parse({ ...input, issuingRoute: 'copilot.self', nonce: randomBytes(24).toString('base64url'), issuedAt: now, expiresAt: now + 540000 });
    const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
    return `${payload}.${hmacSecret(payload, DOMAIN)}`;
}
export function readOwnChatToken(token: string, now = Date.now()): OwnChatToken | null {
    if (token.length > 12000)
        return null;
    const [payload, sig, extra] = token.split('.');
    if (extra !== undefined || !payload || !/^[A-Za-z0-9_-]+$/.test(payload) || !/^[0-9a-f]{64}$/.test(sig ?? ''))
        return null;
    if (!timingSafeEqual(Buffer.from(sig, 'hex'), Buffer.from(hmacSecret(payload, DOMAIN), 'hex')))
        return null;
    try {
        const bytes = Buffer.from(payload, 'base64url');
        if (bytes.toString('base64url') !== payload)
            return null;
        const p = ownChatTokenSchema.safeParse(JSON.parse(bytes.toString('utf8')));
        if (!p.success)
            return null;
        return p.data.issuedAt <= now && p.data.expiresAt > now && p.data.expiresAt - p.data.issuedAt === 540000 ? p.data : null;
    }
    catch {
        return null;
    }
}
