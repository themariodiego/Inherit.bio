import "server-only";

import crypto from "node:crypto";
import { hashOperationNonce } from "@/lib/account-deletion";
import { hmacSecret } from "@/lib/crypto";

/**
 * The one-time operation nonce of the destructive `/api/subjects/[id]/*`
 * routes (register mutationSecurityBindings.destructiveBindings), under brief
 * X1.5: the page that offers the operation renders it, nothing stores it,
 * and only the state-changing request consumes it.
 *
 * The nonce is `<expiresAt>.<random>.<mac>`, the shape of the account
 * operation nonce (`src/lib/account-operation-nonce.ts`) under its own MAC
 * context. The MAC binds the account, its originating auth session, the
 * operation, the registered route that operation belongs to and the exact
 * route subject. None of them travels in the nonce: the verifier recomputes
 * the MAC from the live request, so a nonce minted for another account,
 * session, subject or route does not verify. Verification cannot say the
 * nonce is unused; the consuming database function records its hash once,
 * in the same transaction as the operation, which is what makes it one-time.
 */

export type SubjectOperation = "subject_sharing_stop";

/** Each operation belongs to exactly one registered route. */
export const SUBJECT_OPERATION_ROUTES: Readonly<Record<SubjectOperation, string>> = Object.freeze({
  subject_sharing_stop: "api.subject-sharing",
});

export const SUBJECT_OPERATION_NONCE_LIFETIME_MS = 10 * 60 * 1000;
export const SUBJECT_OPERATION_NONCE_MAX_LENGTH = 128;

const MAC_CONTEXT = "subject-operation-nonce-v1";
const SHAPE = /^(\d{13})\.([A-Za-z0-9_-]{43})\.([0-9a-f]{64})$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export type SubjectOperationContext = Readonly<{
  accountId: string;
  sessionId: string;
  operation: SubjectOperation;
  subjectId: string;
}>;

export type VerifiedSubjectOperationNonce = Readonly<{
  /** SHA-256 of the whole nonce, the form the database records. */
  nonceHash: string;
  expiresAt: number;
}>;

function validContext(context: SubjectOperationContext): boolean {
  return UUID.test(context.accountId) && UUID.test(context.sessionId) && UUID.test(context.subjectId)
    && Object.hasOwn(SUBJECT_OPERATION_ROUTES, context.operation);
}

function mac(context: SubjectOperationContext, expiresAt: number, random: string): string {
  return hmacSecret([context.accountId, context.sessionId, context.operation,
    SUBJECT_OPERATION_ROUTES[context.operation], context.subjectId, String(expiresAt), random].join("|"), MAC_CONTEXT);
}

/** Pure: mints and returns a nonce. It writes nothing anywhere. */
export function mintSubjectOperationNonce(context: SubjectOperationContext, now = Date.now()): string {
  if (!validContext(context) || !Number.isSafeInteger(now) || now < 0) throw new Error("subject_operation_context_invalid");
  const expiresAt = now + SUBJECT_OPERATION_NONCE_LIFETIME_MS;
  const random = crypto.randomBytes(32).toString("base64url");
  return `${expiresAt}.${random}.${mac(context, expiresAt, random)}`;
}

/**
 * `expected` must come from the live request (its authenticated account and
 * session, the route's own operation and its route subject), never from the
 * request body.
 */
export function verifySubjectOperationNonce(
  nonce: unknown,
  expected: SubjectOperationContext,
  now = Date.now(),
): VerifiedSubjectOperationNonce | null {
  if (!validContext(expected) || typeof nonce !== "string" || nonce.length > SUBJECT_OPERATION_NONCE_MAX_LENGTH) return null;
  const match = SHAPE.exec(nonce);
  if (!match) return null;
  const expiresAt = Number(match[1]);
  if (!Number.isSafeInteger(expiresAt) || expiresAt <= now || expiresAt > now + SUBJECT_OPERATION_NONCE_LIFETIME_MS) return null;
  const bytes = Buffer.from(match[2], "base64url");
  if (bytes.length !== 32 || bytes.toString("base64url") !== match[2]) return null;
  const expectedMac = Buffer.from(mac(expected, expiresAt, match[2]), "hex");
  if (!crypto.timingSafeEqual(expectedMac, Buffer.from(match[3], "hex"))) return null;
  return Object.freeze({ nonceHash: hashOperationNonce(nonce), expiresAt });
}
