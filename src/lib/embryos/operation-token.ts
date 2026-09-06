import "server-only";

import crypto from "node:crypto";
import { hmacSecret } from "@/lib/crypto";

/**
 * The one-time operation token of the embryo routes (contract §5.1, §6.0;
 * decision §11.1). A page mints one token per state-changing control,
 * bound to the acting account, its auth session, the exact operation and
 * the exact target; the route verifies every one of those against what it
 * knows for itself and passes only the nonce to the RPC, which records
 * sha256(nonce) in `embryo_operation_nonces` before any write. A token
 * minted for one operation or one target cannot be replayed on another,
 * and a second use of the same nonce fails inside the database.
 *
 * The envelope is the same sealed envelope as `src/lib/family/grant-token.ts`
 * (base64url JSON, a dot, a keyed digest over the payload) under its own
 * digest contexts, so a family token never reads as an embryo one.
 *
 * The public-form token is the same envelope with no account in it: the
 * rights-activation form is filled in before any sign-in, so the token only
 * proves the form was served recently by this deployment. It is not
 * one-time; activation is made one-time by consuming the invitation token
 * hash in the database.
 */

export type EmbryoOperation =
  | "cohort_draft_create"
  | "artifact_sign"
  | "invitation_create"
  | "invitation_accept"
  | "cohort_finalize"
  | "record_key_print"
  | "cohort_restrict"
  | "embryo_disposition"
  | "cohort_purpose_grant";

export type EmbryoOperationTargetKind = "account" | "cohort_draft" | "cohort" | "embryo" | "rights_session";

export interface EmbryoOperationClaims {
  accountId: string;
  sessionId: string;
  operation: EmbryoOperation;
  targetKind: EmbryoOperationTargetKind;
  targetId: string;
  nonce: string;
  /** Epoch milliseconds. */
  expiresAt: number;
}

/** The header carrying the token on an authenticated mutation (authenticated-mutation-v1). */
export const CSRF_HEADER = "x-inherit-csrf";

/** The header carrying the destructive operation nonce (restrict and withdraw). */
export const OPERATION_HEADER = "x-inherit-operation-nonce";

const EMBRYO_OPERATIONS: ReadonlySet<string> = new Set<EmbryoOperation>([
  "cohort_draft_create",
  "artifact_sign",
  "invitation_create",
  "invitation_accept",
  "cohort_finalize",
  "record_key_print",
  "cohort_restrict",
  "embryo_disposition",
  "cohort_purpose_grant",
]);

const TARGET_KINDS: ReadonlySet<string> = new Set<EmbryoOperationTargetKind>([
  "account",
  "cohort_draft",
  "cohort",
  "embryo",
  "rights_session",
]);

/** Ten minutes: long enough to read the page, short enough to be recent. */
const OPERATION_LIFETIME_MS = 10 * 60 * 1000;

const OPERATION_DIGEST_CONTEXT = "embryo-operation-v1";
const PUBLIC_FORM_DIGEST_CONTEXT = "public-form-v1";

/**
 * The exact shape of the digest `hmacSecret` emits: 64 lowercase hex
 * characters. A signature of any other shape is refused before the constant-
 * time compare, which would otherwise throw on a segment whose character
 * count matches but whose UTF-8 byte count does not.
 */
const HEX_DIGEST = /^[0-9a-f]{64}$/;

type PublicForm = "rights-activate";

interface PublicFormClaims {
  form: PublicForm;
  nonce: string;
  expiresAt: number;
  /** Optional browser binding; required by rights-activation callers. */
  candidateHash?: string;
}

/** A nonce the RPCs accept: 16-256 characters of base64url, no whitespace. */
function newNonce(): string {
  return crypto.randomBytes(24).toString("base64url");
}

function seal(claims: unknown, context: string): string {
  const payload = Buffer.from(JSON.stringify(claims), "utf8").toString("base64url");
  return `${payload}.${hmacSecret(payload, context)}`;
}

function unseal<T>(value: string, context: string): T | null {
  const separator = value.lastIndexOf(".");
  if (separator <= 0) return null;
  const payload = value.slice(0, separator);
  const signature = value.slice(separator + 1);
  if (!HEX_DIGEST.test(signature)) return null;
  const expected = hmacSecret(payload, context);
  if (
    signature.length !== expected.length ||
    !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
  ) {
    return null;
  }
  try {
    return JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as T;
  } catch {
    return null;
  }
}

export function mintEmbryoOperation(
  claims: Omit<EmbryoOperationClaims, "nonce" | "expiresAt">,
  now = Date.now(),
): string {
  const operation: EmbryoOperationClaims = {
    accountId: claims.accountId,
    sessionId: claims.sessionId,
    operation: claims.operation,
    targetKind: claims.targetKind,
    targetId: claims.targetId,
    nonce: newNonce(),
    expiresAt: now + OPERATION_LIFETIME_MS,
  };
  return seal(operation, OPERATION_DIGEST_CONTEXT);
}

/** The claims of a token that is well-formed, unexpired and ours; null otherwise. */
export function readEmbryoOperation(token: string, now = Date.now()): EmbryoOperationClaims | null {
  const claims = unseal<EmbryoOperationClaims>(token, OPERATION_DIGEST_CONTEXT);
  if (!claims || typeof claims !== "object") return null;
  if (
    typeof claims.accountId !== "string" ||
    typeof claims.sessionId !== "string" ||
    typeof claims.operation !== "string" ||
    !EMBRYO_OPERATIONS.has(claims.operation) ||
    typeof claims.targetKind !== "string" ||
    !TARGET_KINDS.has(claims.targetKind) ||
    typeof claims.targetId !== "string" ||
    typeof claims.nonce !== "string" ||
    typeof claims.expiresAt !== "number" ||
    !Number.isFinite(claims.expiresAt)
  ) {
    return null;
  }
  if (claims.expiresAt <= now) return null;
  return {
    accountId: claims.accountId,
    sessionId: claims.sessionId,
    operation: claims.operation,
    targetKind: claims.targetKind,
    targetId: claims.targetId,
    nonce: claims.nonce,
    expiresAt: claims.expiresAt,
  };
}

/**
 * The claims of a token minted for exactly this account, session,
 * operation and target; null on any mismatch, on a missing token, on a
 * stale one and on one that is not ours. The route passes what it knows
 * for itself and never trusts the token's own view of who is acting.
 */
export function verifyEmbryoOperation(
  token: string | null | undefined,
  expected: Omit<EmbryoOperationClaims, "nonce" | "expiresAt">,
  now = Date.now(),
): EmbryoOperationClaims | null {
  if (typeof token !== "string" || token.length === 0) return null;
  const claims = readEmbryoOperation(token, now);
  if (!claims) return null;
  if (
    claims.accountId !== expected.accountId ||
    claims.sessionId !== expected.sessionId ||
    claims.operation !== expected.operation ||
    claims.targetKind !== expected.targetKind ||
    claims.targetId !== expected.targetId
  ) {
    return null;
  }
  return claims;
}

export function mintPublicFormToken(form: PublicForm, now = Date.now(), candidateHash?: string): string {
  const claims: PublicFormClaims = { form, nonce: newNonce(), expiresAt: now + OPERATION_LIFETIME_MS, candidateHash };
  return seal(claims, PUBLIC_FORM_DIGEST_CONTEXT);
}

/** The nonce of a public-form token served for this form and still fresh; null otherwise. */
export function readPublicFormToken(token: string, form: PublicForm, now = Date.now(), candidateHash?: string): { nonce: string } | null {
  const claims = unseal<PublicFormClaims>(token, PUBLIC_FORM_DIGEST_CONTEXT);
  if (!claims || typeof claims !== "object") return null;
  if (
    claims.form !== form ||
    typeof claims.nonce !== "string" ||
    typeof claims.expiresAt !== "number" ||
    !Number.isFinite(claims.expiresAt)
  ) {
    return null;
  }
  if (claims.expiresAt <= now) return null;
  if (candidateHash !== undefined && claims.candidateHash !== candidateHash) return null;
  return { nonce: claims.nonce };
}
