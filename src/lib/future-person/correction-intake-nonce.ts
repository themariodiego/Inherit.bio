import "server-only";
import crypto from "node:crypto";
import { z } from "zod";
import { newCaseHmac } from "./new-case-envelope-crypto";

const claimsSchema = z.object({ operation: z.literal("future-person-correction-request"),
  rightsSessionHash: z.string().regex(/^[0-9a-f]{64}$/u),
  nonce: z.string().regex(/^[A-Za-z0-9_-]{16,256}$/u),
  expiresAt: z.number().int().nonnegative().safe() }).strict();
const context = "new-future-person-correction-intake-nonce-v1";
const lifetimeMs = 600_000;

/** Only after the actual read-only rights view permits correct. No row is
 * written by this stateless operation/session token. Native POST rechecks. */
export function mintCorrectionIntakeNonce(rightsSessionHash: string, now = Date.now()): string {
  if (!Number.isSafeInteger(now) || now < 0 || !Number.isSafeInteger(now + lifetimeMs)) throw new Error("correction_unavailable");
  let random: Buffer | undefined, payloadBytes: Buffer | undefined;
  try {
    random = crypto.randomBytes(24);
    const claims = claimsSchema.parse({ operation: "future-person-correction-request", rightsSessionHash,
      nonce: random.toString("base64url"), expiresAt: now + lifetimeMs });
    payloadBytes = Buffer.from(JSON.stringify(claims), "utf8");
    const payload = payloadBytes.toString("base64url");
    return `${payload}.${newCaseHmac(payload, context)}`;
  } finally { random?.fill(0); payloadBytes?.fill(0); }
}

export function readCorrectionIntakeNonce(token: string, sessionHash: string, now = Date.now()): string | null {
  if (!Number.isSafeInteger(now) || now < 0 || token.length > 2048) return null;
  let actual: Buffer | undefined, expected: Buffer | undefined, payload: Buffer | undefined;
  try {
    const parts = token.split(".");
    if (parts.length !== 2 || !/^[A-Za-z0-9_-]+$/u.test(parts[0]!) || !/^[0-9a-f]{64}$/u.test(parts[1]!)) return null;
    actual = Buffer.from(parts[1]!, "utf8"); expected = Buffer.from(newCaseHmac(parts[0]!, context), "utf8");
    if (!crypto.timingSafeEqual(actual, expected)) return null;
    payload = Buffer.from(parts[0]!, "base64url");
    if (payload.toString("base64url") !== parts[0]) return null;
    const claims = claimsSchema.safeParse(JSON.parse(new TextDecoder("utf8", { fatal: true, ignoreBOM: false }).decode(payload)));
    return claims.success && claims.data.rightsSessionHash === sessionHash
      && claims.data.expiresAt > now && claims.data.expiresAt <= now + lifetimeMs ? claims.data.nonce : null;
  } catch { return null; } finally { actual?.fill(0); expected?.fill(0); payload?.fill(0); }
}
