import "server-only";

import { getSensitiveAccountContext } from "@/lib/account-deletion";
import {
  PERSON_OPERATION_NONCE_HEADER,
  mintPersonOperationNonce,
  verifyPersonOperationNonce,
  type PersonOperation,
  type PersonOperationContext,
  type VerifiedPersonOperationNonce,
} from "@/lib/person-operation-nonce-core";

/**
 * The server side of the person operation nonce (`person-operation-nonce-core.ts`
 * holds the format, the MAC and the operations): what a route reads from a
 * request and passes to its database door, and what a page renders.
 */
export * from "@/lib/person-operation-nonce-core";

/** The nonce a request carries in its header, verified for `expected`, or null. */
export function personOperationNonceFrom(
  request: Request,
  expected: PersonOperationContext,
  now = Date.now(),
): VerifiedPersonOperationNonce | null {
  return verifyPersonOperationNonce(request.headers.get(PERSON_OPERATION_NONCE_HEADER), expected, now);
}

/** The database door's two nonce arguments. */
export function personOperationNonceArgs(nonce: VerifiedPersonOperationNonce) {
  return { p_nonce_hash: nonce.nonceHash, p_nonce_expires_at: new Date(nonce.expiresAt).toISOString() };
}

/** True for the door's refusal of a nonce: replayed, expired or malformed. */
export function isOperationNonceRefusal(error: { code?: string; message?: string } | null | undefined): boolean {
  return error?.code === "22023" && error.message === "invalid_operation_nonce";
}

/**
 * What a page renders for one operation on one target: the nonce for the
 * live account and auth session, or null when there is none. It reads the
 * current session and stores nothing.
 */
export async function pageOperationNonce(operation: PersonOperation, targetId: string | ((accountId: string) => string),
  now = Date.now()): Promise<string | null> {
  const context = await getSensitiveAccountContext();
  if (!context) return null;
  const target = typeof targetId === "function" ? targetId(context.user.id) : targetId;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(target)) return null;
  return mintPersonOperationNonce({ accountId: context.user.id, sessionId: context.sessionId, operation, targetId: target }, now);
}
