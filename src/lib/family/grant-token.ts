import "server-only";

import crypto from "node:crypto";
import { hmacSecret } from "@/lib/crypto";
import { isPurpose, type Purpose } from "./graph";

/**
 * The single-use presentation token of `directional-purpose-grant-v1`
 * (docs/route-register.json policyContracts). The permissions server
 * component mints one token per rendered column and row, bound to the exact
 * signer, data subject, recipient principal, purpose, artifact, revisions
 * and a random nonce; `POST /api/consents` verifies the signature and the
 * expiry, recomputes every endpoint from the token rather than the request
 * body, and passes only the nonce to `grant_directional_purpose_v1`, which
 * records its digest before any grant write. A token for the opposite
 * column, another recipient or a stale revision cannot be retargeted.
 *
 * The same envelope carries the one-time operation nonce the register
 * requires for a `stop`: minted by the page that renders the confirmation
 * dialog, bound to that session's account and counterpart, and short-lived.
 */

/** The one artifact a directional subject grant signs. */
export const SHARE_WITH_ADULT_ARTIFACT = "consent.share-with-adult";

/**
 * The statement keys that artifact publishes, in the order
 * grant_directional_purpose_v1 records them. The permissions column sends
 * exactly these; the route accepts nothing else.
 */
export const SHARE_WITH_ADULT_STATEMENT_KEYS = [
  "one-purpose",
  "one-named-adult",
  "own-account",
  "pause-or-stop-any-time",
] as const;

/** The closed `grant-purpose` body of api.consents (docs/route-register.json). */
export interface GrantPurposeRequest {
  action: "grant-purpose";
  subjectId: string;
  purposeKey: Purpose;
  artifactVersion: number;
  artifactPresentationToken: string;
  affirmed: true;
  statementKeys: readonly string[];
}

/** Ten minutes: long enough to read the column, short enough to be recent. */
const PRESENTATION_LIFETIME_MS = 10 * 60 * 1000;

const GRANT_DIGEST_CONTEXT = "family-grant-presentation-v1";
const OPERATION_DIGEST_CONTEXT = "family-sharing-operation-v1";

export interface GrantPresentation {
  /** The account that signs: the data subject's own account, never the recipient's. */
  accountId: string;
  dataSubjectId: string;
  subjectBindingRevision: number;
  recipientPrincipalId: string;
  recipientAccountId: string;
  purpose: Purpose;
  artifactKey: string;
  artifactVersion: number;
  artifactBodySha256: string;
  jurisdictionRevision: number;
  direction: "subject_to_recipient";
  nonce: string;
  /** Epoch milliseconds. */
  expiresAt: number;
}

export interface SharingOperation {
  accountId: string;
  counterpartAccountId: string;
  operation: "stop";
  nonce: string;
  expiresAt: number;
}

/** A nonce the grant RPC accepts: 16-256 characters, no whitespace. */
export function newNonce(): string {
  return crypto.randomBytes(24).toString("base64url");
}

function sign(payload: string, context: string): string {
  return hmacSecret(payload, context);
}

function seal(claims: unknown, context: string): string {
  const payload = Buffer.from(JSON.stringify(claims), "utf8").toString("base64url");
  return `${payload}.${sign(payload, context)}`;
}

function unseal<T>(value: string, context: string): T | null {
  const separator = value.lastIndexOf(".");
  if (separator <= 0) return null;
  const payload = value.slice(0, separator);
  const signature = value.slice(separator + 1);
  const expected = sign(payload, context);
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

export function mintGrantPresentation(
  claims: Omit<GrantPresentation, "nonce" | "expiresAt" | "direction">,
  now = Date.now(),
): string {
  const presentation: GrantPresentation = {
    ...claims,
    direction: "subject_to_recipient",
    nonce: newNonce(),
    expiresAt: now + PRESENTATION_LIFETIME_MS,
  };
  return seal(presentation, GRANT_DIGEST_CONTEXT);
}

/** The claims of a token that is well-formed, unexpired and ours; null otherwise. */
export function readGrantPresentation(
  token: string,
  now = Date.now(),
): GrantPresentation | null {
  const claims = unseal<GrantPresentation>(token, GRANT_DIGEST_CONTEXT);
  if (!claims) return null;
  if (
    typeof claims.accountId !== "string" ||
    typeof claims.dataSubjectId !== "string" ||
    typeof claims.recipientPrincipalId !== "string" ||
    typeof claims.recipientAccountId !== "string" ||
    typeof claims.artifactKey !== "string" ||
    typeof claims.artifactBodySha256 !== "string" ||
    typeof claims.artifactVersion !== "number" ||
    typeof claims.nonce !== "string" ||
    typeof claims.expiresAt !== "number" ||
    claims.direction !== "subject_to_recipient" ||
    !isPurpose(claims.purpose)
  ) {
    return null;
  }
  if (claims.expiresAt <= now) return null;
  return claims;
}

export function mintSharingOperation(
  claims: Omit<SharingOperation, "nonce" | "expiresAt">,
  now = Date.now(),
): string {
  const operation: SharingOperation = {
    ...claims,
    nonce: newNonce(),
    expiresAt: now + PRESENTATION_LIFETIME_MS,
  };
  return seal(operation, OPERATION_DIGEST_CONTEXT);
}

export function readSharingOperation(
  value: string,
  now = Date.now(),
): SharingOperation | null {
  const claims = unseal<SharingOperation>(value, OPERATION_DIGEST_CONTEXT);
  if (!claims) return null;
  if (
    typeof claims.accountId !== "string" ||
    typeof claims.counterpartAccountId !== "string" ||
    claims.operation !== "stop" ||
    typeof claims.nonce !== "string" ||
    typeof claims.expiresAt !== "number"
  ) {
    return null;
  }
  if (claims.expiresAt <= now) return null;
  return claims;
}
