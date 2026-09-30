import "server-only";

import crypto from "node:crypto";
import { hashOperationNonce } from "@/lib/account-deletion";
import { hmacSecret } from "@/lib/crypto";

/**
 * The one-time operation nonce for account deletion and its cancellation,
 * under brief X1.5: the page that offers the operation renders it, nothing
 * stores it, and only the explicit POST consumes it.
 *
 * The nonce is `<expiresAt>.<random>.<mac>`. The MAC binds it to the account,
 * the originating auth session, the operation and the expiry, none of which
 * the nonce carries: the verifier recomputes the MAC from the live context of
 * the request that presents it, so a nonce minted for another account, another
 * session or the other operation simply fails to verify. Verification says the
 * server minted it for this context and it has not expired; it cannot say the
 * nonce is unused. The consuming database function records its hash once, in
 * the same transaction as the operation, which is what makes it one-time.
 */

export type AccountOperation = "account_delete" | "account_delete_cancel";
export const ACCOUNT_OPERATION_NONCE_LIFETIME_MS = 10 * 60 * 1000;
export const ACCOUNT_OPERATION_NONCE_MAX_LENGTH = 128;

const MAC_CONTEXT = "account-operation-nonce-v1";
const SHAPE = /^(\d{13})\.([A-Za-z0-9_-]{43})\.([0-9a-f]{64})$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export type AccountOperationContext = Readonly<{
  accountId: string;
  sessionId: string;
  operation: AccountOperation;
}>;

export type VerifiedAccountOperationNonce = Readonly<{
  /** SHA-256 of the whole nonce, the form the database records. */
  nonceHash: string;
  expiresAt: number;
}>;

function validContext(context: AccountOperationContext): boolean {
  return UUID.test(context.accountId) && UUID.test(context.sessionId)
    && (context.operation === "account_delete" || context.operation === "account_delete_cancel");
}

function mac(context: AccountOperationContext, expiresAt: number, random: string): string {
  return hmacSecret([context.accountId, context.sessionId, context.operation, String(expiresAt), random].join("|"), MAC_CONTEXT);
}

/** Pure: mints and returns a nonce. It writes nothing anywhere. */
export function mintAccountOperationNonce(context: AccountOperationContext, now = Date.now()): string {
  if (!validContext(context) || !Number.isSafeInteger(now) || now < 0) throw new Error("account_operation_context_invalid");
  const expiresAt = now + ACCOUNT_OPERATION_NONCE_LIFETIME_MS;
  const random = crypto.randomBytes(32).toString("base64url");
  return `${expiresAt}.${random}.${mac(context, expiresAt, random)}`;
}

/**
 * `expected` must come from the live request (its authenticated account and
 * session and the route's own operation), never from the request body.
 */
export function verifyAccountOperationNonce(
  nonce: unknown,
  expected: AccountOperationContext,
  now = Date.now(),
): VerifiedAccountOperationNonce | null {
  if (!validContext(expected) || typeof nonce !== "string" || nonce.length > ACCOUNT_OPERATION_NONCE_MAX_LENGTH) return null;
  const match = SHAPE.exec(nonce);
  if (!match) return null;
  const expiresAt = Number(match[1]);
  if (!Number.isSafeInteger(expiresAt) || expiresAt <= now || expiresAt > now + ACCOUNT_OPERATION_NONCE_LIFETIME_MS) return null;
  const bytes = Buffer.from(match[2], "base64url");
  if (bytes.length !== 32 || bytes.toString("base64url") !== match[2]) return null;
  const expectedMac = Buffer.from(mac(expected, expiresAt, match[2]), "hex");
  if (!crypto.timingSafeEqual(expectedMac, Buffer.from(match[3], "hex"))) return null;
  return Object.freeze({ nonceHash: hashOperationNonce(nonce), expiresAt });
}
