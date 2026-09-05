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
const ARTIFACT_DIGEST_CONTEXT = "artifact-presentation-v1";
const COHORT_GRANT_DIGEST_CONTEXT = "cohort-grant-presentation-v1";

/**
 * The exact shape of the digest `hmacSecret` emits: 64 lowercase hex
 * characters. A signature of any other shape is refused before the constant-
 * time compare, which would otherwise throw on a segment whose character
 * count matches but whose UTF-8 byte count does not.
 */
const HEX_DIGEST = /^[0-9a-f]{64}$/;

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
  if (!HEX_DIGEST.test(signature)) return null;
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

/**
 * The presentation token of an embryo artifact signature (E0 contract
 * §5.3, §6.2, §6.5). The page that renders an artifact for a cohort draft
 * or a cohort mints one token per rendered artifact, bound to the signer's
 * account, the target, the artifact's key, version and body hash, and the
 * statement keys it showed. `POST /api/consents` and the invitation-accept
 * route read the token, recompute the artifact row from the key and version
 * and refuse when the hash no longer matches: what was shown is what is
 * signed, never what the request body says.
 */
export interface ArtifactPresentation {
  accountId: string;
  targetKind: "cohort_draft" | "cohort";
  targetId: string;
  artifactKey: string;
  artifactVersion: number;
  artifactBodySha256: string;
  statementKeys: string[];
  nonce: string;
  /** Epoch milliseconds. */
  expiresAt: number;
}

/**
 * The presentation token of a cohort `embryo.analysis` grant (contract
 * §5.3, §6.2): the same idea as the directional grant above, bound to the
 * cohort and to the participant-set revision the page rendered, so a grant
 * cannot be signed against a cohort whose parents changed meanwhile.
 */
export interface CohortGrantPresentation {
  accountId: string;
  cohortId: string;
  purpose: "embryo.analysis";
  artifactKey: string;
  artifactVersion: number;
  artifactBodySha256: string;
  participantSetRevision: number;
  nonce: string;
  /** Epoch milliseconds. */
  expiresAt: number;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

export function mintArtifactPresentation(
  claims: Omit<ArtifactPresentation, "nonce" | "expiresAt">,
  now = Date.now(),
): string {
  const presentation: ArtifactPresentation = {
    accountId: claims.accountId,
    targetKind: claims.targetKind,
    targetId: claims.targetId,
    artifactKey: claims.artifactKey,
    artifactVersion: claims.artifactVersion,
    artifactBodySha256: claims.artifactBodySha256,
    statementKeys: [...claims.statementKeys],
    nonce: newNonce(),
    expiresAt: now + PRESENTATION_LIFETIME_MS,
  };
  return seal(presentation, ARTIFACT_DIGEST_CONTEXT);
}

/** The claims of an artifact token that is well-formed, unexpired and ours; null otherwise. */
export function readArtifactPresentation(
  token: string,
  now = Date.now(),
): ArtifactPresentation | null {
  const claims = unseal<ArtifactPresentation>(token, ARTIFACT_DIGEST_CONTEXT);
  if (!claims || typeof claims !== "object") return null;
  if (
    typeof claims.accountId !== "string" ||
    (claims.targetKind !== "cohort_draft" && claims.targetKind !== "cohort") ||
    typeof claims.targetId !== "string" ||
    typeof claims.artifactKey !== "string" ||
    typeof claims.artifactVersion !== "number" ||
    typeof claims.artifactBodySha256 !== "string" ||
    !isStringArray(claims.statementKeys) ||
    typeof claims.nonce !== "string" ||
    typeof claims.expiresAt !== "number"
  ) {
    return null;
  }
  if (claims.expiresAt <= now) return null;
  return {
    accountId: claims.accountId,
    targetKind: claims.targetKind,
    targetId: claims.targetId,
    artifactKey: claims.artifactKey,
    artifactVersion: claims.artifactVersion,
    artifactBodySha256: claims.artifactBodySha256,
    statementKeys: [...claims.statementKeys],
    nonce: claims.nonce,
    expiresAt: claims.expiresAt,
  };
}

export function mintCohortGrantPresentation(
  claims: Omit<CohortGrantPresentation, "nonce" | "expiresAt">,
  now = Date.now(),
): string {
  const presentation: CohortGrantPresentation = {
    accountId: claims.accountId,
    cohortId: claims.cohortId,
    purpose: claims.purpose,
    artifactKey: claims.artifactKey,
    artifactVersion: claims.artifactVersion,
    artifactBodySha256: claims.artifactBodySha256,
    participantSetRevision: claims.participantSetRevision,
    nonce: newNonce(),
    expiresAt: now + PRESENTATION_LIFETIME_MS,
  };
  return seal(presentation, COHORT_GRANT_DIGEST_CONTEXT);
}

/** The claims of a cohort grant token that is well-formed, unexpired and ours; null otherwise. */
export function readCohortGrantPresentation(
  token: string,
  now = Date.now(),
): CohortGrantPresentation | null {
  const claims = unseal<CohortGrantPresentation>(token, COHORT_GRANT_DIGEST_CONTEXT);
  if (!claims || typeof claims !== "object") return null;
  if (
    typeof claims.accountId !== "string" ||
    typeof claims.cohortId !== "string" ||
    claims.purpose !== "embryo.analysis" ||
    typeof claims.artifactKey !== "string" ||
    typeof claims.artifactVersion !== "number" ||
    typeof claims.artifactBodySha256 !== "string" ||
    typeof claims.participantSetRevision !== "number" ||
    typeof claims.nonce !== "string" ||
    typeof claims.expiresAt !== "number"
  ) {
    return null;
  }
  if (claims.expiresAt <= now) return null;
  return {
    accountId: claims.accountId,
    cohortId: claims.cohortId,
    purpose: claims.purpose,
    artifactKey: claims.artifactKey,
    artifactVersion: claims.artifactVersion,
    artifactBodySha256: claims.artifactBodySha256,
    participantSetRevision: claims.participantSetRevision,
    nonce: claims.nonce,
    expiresAt: claims.expiresAt,
  };
}
