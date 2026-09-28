import "server-only";

import crypto from "node:crypto";
import { z } from "zod";
import { decryptSecret, encryptSecret, hmacSecret } from "@/lib/crypto";
import { mintPublicFormToken, readPublicFormToken } from "@/lib/embryos/operation-token";
import { sha256Hex } from "./claim-session";
import { claimDataKey } from "./document-envelope";

/**
 * The named-human claim review (api.future-person-claim-review,
 * api.legal-evidence-review-download, api.download-chunk). The database
 * decides who may read and decide: an active claim reviewer, assigned the
 * case, in a live session stepped up with MFA in the last 15 minutes. This
 * module shapes what the routes send and accept around those decisions.
 */

export const REVIEW_CSRF_HEADER = "x-inherit-csrf";
export const REVIEW_NONCE_HEADER = "x-inherit-review-nonce";
const PRODUCTION = process.env.NODE_ENV === "production";
export const DOWNLOAD_COOKIE = PRODUCTION ? "__Host-inherit-download" : "inherit-download";
export const CHUNK_BYTES = 4_000_000;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
/** parameterContract.id: a canonical lowercase UUID. */
export function isCanonicalId(value: string): boolean {
  return UUID.test(value);
}

function binding(reviewId: string, accountId: string, sessionId: string): string {
  return `${reviewId}|${accountId}|${sessionId}`;
}

/** X-Inherit-CSRF for one reviewer, session and case. */
export function reviewCsrf(reviewId: string, accountId: string, sessionId: string): string {
  return hmacSecret(binding(reviewId, accountId, sessionId), "claim-review-csrf-v1");
}

export function reviewCsrfMatches(presented: string | null, reviewId: string, accountId: string, sessionId: string): boolean {
  if (!presented || !/^[0-9a-f]{64}$/u.test(presented)) return false;
  return crypto.timingSafeEqual(Buffer.from(presented), Buffer.from(reviewCsrf(reviewId, accountId, sessionId)));
}

/** A recent one-time decision nonce for this reviewer, session and case (ten minutes). */
export function mintReviewNonce(reviewId: string, accountId: string, sessionId: string, now = Date.now()): string {
  return mintPublicFormToken("future-person-claim-review", now, sha256Hex(binding(reviewId, accountId, sessionId)));
}

export function readReviewNonce(token: string, reviewId: string, accountId: string, sessionId: string, now = Date.now()): string | null {
  if (token.length > 2048) return null;
  return readPublicFormToken(token, "future-person-claim-review", now, sha256Hex(binding(reviewId, accountId, sessionId)))?.nonce ?? null;
}

const DECISIONS = [
  "approve-record-key", "approve-recovery-key", "approve-claimed-unbound-no-key-recovery",
  "keyless-document-match", "needs-more-information", "reject",
] as const;

/** methodRequestContracts.POST: one of six closed bodies, told apart by `decision`. */
export const reviewDecisionBody = z.object({
  decision: z.enum(DECISIONS),
  reviewRevision: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
  reason: z.string().transform((value) => value.normalize("NFC").trim())
    .refine((value) => [...value].length >= 20 && [...value].length <= 2000 && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value)),
  nonce: z.string().min(1).max(2048),
}).strict();

/** The reviewer's professional basis, sealed before it reaches the database (a bytea literal). */
export function sealReason(reason: string): string {
  return `\\x${encryptSecret(reason).toString("hex")}`;
}

// ---------------------------------------------------------------------------
// The case the GET returns (future-person-claim-review-case-v1).

const caseRow = z.object({
  claimId: z.uuid(),
  mode: z.enum(["record-key", "claimant-recovery-key", "keyless"]),
  state: z.enum(["document_review_pending", "more_information_required", "approved_pending_owner_notice"]),
  reviewRevision: z.number().int().min(1),
  deadline: z.string(),
  caseKind: z.enum([
    "record_key", "record_key_unmatched_or_ineligible", "claimant_recovery_key",
    "recovery_key_unmatched_or_ineligible", "claimed_unbound_no_key_recovery", "unclaimed_keyless",
    "keyless_none", "keyless_ambiguous",
  ]),
  allowedDecisions: z.array(z.enum(DECISIONS)).min(1),
  photoIdentityDocumentId: z.uuid(),
  birthRecordDocumentId: z.uuid(),
  identityCiphertext: z.string().regex(/^[0-9a-f]+$/u),
  wrappedDataKey: z.string().regex(/^[0-9a-f]+$/u),
  parentIdentityCiphertext: z.string().regex(/^[0-9a-f]+$/u).nullable(),
}).strict();

const claimantIdentity = z.object({
  version: z.literal(1),
  claimantName: z.string().min(2).max(480),
  claimantDateOfBirth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u).optional(),
  childDateOfBirth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u).optional(),
}).passthrough();

/**
 * The parent-supplied identity a record carries (public.future_person_identity
 * .parent_supplied_ciphertext), sealed with the deployment key. The profile
 * writer (api.future-person-identity-profile) is not built; this is the shape
 * it must write.
 */
const parentIdentity = z.object({
  version: z.literal(1),
  parentNames: z.array(z.string().min(1).max(120)).min(1).max(4),
  parentRoles: z.array(z.enum(["genetic-parent", "legal-parent", "gestational-parent", "intended-parent"])).min(1).max(4),
}).passthrough();

function openIdentity(identityHex: string, wrappedHex: string): z.infer<typeof claimantIdentity> | null {
  const key = claimDataKey(wrappedHex);
  try {
    const blob = Buffer.from(identityHex, "hex");
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, blob.subarray(0, 12));
    decipher.setAuthTag(blob.subarray(12, 28));
    const text = Buffer.concat([decipher.update(blob.subarray(28)), decipher.final()]).toString("utf8");
    const parsed = claimantIdentity.safeParse(JSON.parse(text));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  } finally {
    key.fill(0);
  }
}

function openParentIdentity(hex: string): z.infer<typeof parentIdentity> | null {
  try {
    const parsed = parentIdentity.safeParse(JSON.parse(decryptSecret(Buffer.from(hex, "hex"))));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** The closed case body, or null when the row or a sealed field does not open. */
export function reviewCaseBody(row: unknown): Record<string, unknown> | null {
  const parsed = caseRow.safeParse(row);
  if (!parsed.success) return null;
  const value = parsed.data;
  const identity = openIdentity(value.identityCiphertext, value.wrappedDataKey);
  if (!identity) return null;
  const dateOfBirth = value.mode === "keyless" ? identity.childDateOfBirth : identity.claimantDateOfBirth;
  if (!dateOfBirth) return null;

  let caseBody: Record<string, unknown>;
  switch (value.caseKind) {
    case "record_key": {
      const parents = value.parentIdentityCiphertext ? openParentIdentity(value.parentIdentityCiphertext) : null;
      if (!parents) return null;
      caseBody = {
        kind: "record_key",
        recordSelector: { matched: true },
        recordedParentLink: { evidencedParentRoles: parents.parentRoles, recordedParentNames: parents.parentNames },
      };
      break;
    }
    case "claimant_recovery_key":
      caseBody = {
        kind: "claimant_recovery_key",
        recoverySelector: { matched: true },
        claimantBinding: { lifecycle: "claimed_unbound", identityHmacComparison: "pending_human_verified_document_tuple" },
      };
      break;
    case "record_key_unmatched_or_ineligible":
    case "recovery_key_unmatched_or_ineligible":
      caseBody = { kind: value.caseKind, selectorOutcome: "non_enumerating_unmatched_or_ineligible", allowedDecisions: value.allowedDecisions };
      break;
    case "keyless_none":
    case "keyless_ambiguous":
      caseBody = { kind: value.caseKind, selectorOutcome: "no_unique_candidate", allowedDecisions: value.allowedDecisions };
      break;
    default:
      // No path resolves these yet (no claimed_unbound claimant, no profile HMAC).
      return null;
  }
  return {
    claimId: value.claimId,
    mode: value.mode,
    state: value.state,
    reviewRevision: value.reviewRevision,
    deadline: new Date(value.deadline).toISOString(),
    claimant: { fullName: identity.claimantName, dateOfBirth },
    evidence: { photoIdentityDocumentId: value.photoIdentityDocumentId, birthRecordDocumentId: value.birthRecordDocumentId },
    case: caseBody,
    notice: { state: "not_applicable", noticeRevision: null },
  };
}

/** The download cookie value's hash, when the browser holds exactly one well-formed one. */
export function downloadCookieHash(request: Request): string | null {
  const values = (request.headers.get("cookie") ?? "")
    .split(";")
    .map((part) => part.trim())
    .filter((part) => part.slice(0, part.indexOf("=")) === DOWNLOAD_COOKIE)
    .map((part) => part.slice(part.indexOf("=") + 1));
  return values.length === 1 && /^[A-Za-z0-9_-]{43}$/u.test(values[0]!) ? sha256Hex(values[0]!) : null;
}

export function downloadCookie(secret: string): string {
  const attributes = [`${DOWNLOAD_COOKIE}=${secret}`, "Path=/", "Max-Age=3600", "HttpOnly", "SameSite=Strict"];
  if (PRODUCTION) attributes.push("Secure");
  return attributes.join("; ");
}
