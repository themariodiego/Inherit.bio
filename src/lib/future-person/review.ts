import "server-only";

import crypto from "node:crypto";
import { z } from "zod";
import { decryptSecret, hmacSecret } from "@/lib/crypto";
import { mintPublicFormToken, readPublicFormToken } from "@/lib/embryos/operation-token";
import { sha256Hex } from "./claim-session";
import { keyringRootKeys, type DigestSet } from "@/lib/hmac-keyring";
import { claimDataKey, sealDocumentBytes } from "./document-envelope";

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
const decisionFields = {
  reviewRevision: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
  reason: z.string().transform((value) => value.normalize("NFC").trim())
    .refine((value) => [...value].length >= 20 && [...value].length <= 2000 && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value)),
  nonce: z.string().min(1).max(2048),
};
export const verifiedDocumentIdentity = z.object({
  fullName: z.string().max(480).transform(value=>value.normalize("NFC").trim().replace(/\s+/gu," "))
    .refine(value=>[...value].length>=2&&[...value].length<=120&&!/[\u0000-\u001f\u007f-\u009f]/u.test(value)),
  dateOfBirth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u).refine(value=>{
    const date=new Date(`${value}T00:00:00.000Z`);
    if(Number.isNaN(date.getTime())||date.toISOString().slice(0,10)!==value||date.getUTCFullYear()<1900)return false;
    const year=date.getUTCFullYear()+18;
    const month=date.getUTCMonth();
    const day=Math.min(date.getUTCDate(),new Date(Date.UTC(year,month+1,0)).getUTCDate());
    return new Date(Date.UTC(year,month,day)).toISOString().slice(0,10)<=new Date().toISOString().slice(0,10);
  }),
  photoIdentityReviewed: z.literal(true),
  birthRecordReviewed: z.literal(true),
  adultAgeConfirmed: z.literal(true),
}).strict();
const linkedIdentity=verifiedDocumentIdentity.extend({recordedParentLinkConfirmed:z.literal(true)}).strict();
/** Approval requires the named human's explicit document and verified-tuple attestation. */
export const reviewDecisionBody=z.discriminatedUnion("decision",[
  z.object({...decisionFields,decision:z.enum(["reject","needs-more-information"])}).strict(),
  z.object({...decisionFields,decision:z.literal("approve-record-key"),documentaryAttestation:linkedIdentity}).strict(),
  z.object({...decisionFields,decision:z.enum(["approve-recovery-key","approve-claimed-unbound-no-key-recovery"]),documentaryAttestation:verifiedDocumentIdentity}).strict(),
  z.object({...decisionFields,decision:z.literal("keyless-document-match"),documentaryAttestation:linkedIdentity}).strict(),
]);
/** Purpose-separated verified identity under every held external revision.
 * The database chooses its current contact-root revision and forbids retiring
 * a revision still used by a durable claimant identity. No identity is public.
 */
export function verifiedIdentityDigestSet(attestation:z.infer<typeof verifiedDocumentIdentity>):DigestSet {
  const parsed=verifiedDocumentIdentity.parse({fullName:attestation.fullName,dateOfBirth:attestation.dateOfBirth,photoIdentityReviewed:attestation.photoIdentityReviewed,birthRecordReviewed:attestation.birthRecordReviewed,adultAgeConfirmed:attestation.adultAgeConfirmed});
  const value=JSON.stringify([parsed.fullName.toLowerCase(),parsed.dateOfBirth]);
  const set:DigestSet={"1":hmacSecret(value,"future-person-claimant-identity-v1")};
  for(const {revision,key} of keyringRootKeys(process.env.INHERIT_HMAC_KEYRING)) {
    let subKey:Buffer|undefined;
    try {
      subKey=crypto.createHmac("sha256",key).update(`future-person-claimant-identity-v${revision}`).digest();
      set[String(revision)]=crypto.createHmac("sha256",subKey).update(value).digest("hex");
    } finally { subKey?.fill(0);key.fill(0); }
  }
  return set;
}
function sealReviewField(value:string,wrappedHex:string,reviewId:string,nonceHash:string,field:string):string {
  const key=claimDataKey(wrappedHex);
  const bytes=Buffer.from(value,"utf8");
  try { return `\\x${sealDocumentBytes(key,`claim-review-v1|${reviewId}|${nonceHash}|${field}`,bytes).toString("hex")}`; }
  finally { key.fill(0);bytes.fill(0); }
}
export function sealDocumentaryAttestation(attestation:z.infer<typeof verifiedDocumentIdentity>,wrappedHex:string,reviewId:string,nonceHash:string) {
  return sealReviewField(JSON.stringify(attestation),wrappedHex,reviewId,nonceHash,"attestation");
}
/** The professional basis uses the claim's own key, destroyed at closure. */
export function sealReason(reason:string,wrappedHex:string,reviewId:string,nonceHash:string):string {
  return sealReviewField(reason,wrappedHex,reviewId,nonceHash,"reason");
}

// ---------------------------------------------------------------------------
// The case the GET returns (future-person-claim-review-case-v1).

const caseRow = z.object({
  claimId: z.uuid(),
  mode: z.enum(["record-key", "claimant-recovery-key", "keyless"]),
  state: z.enum(["document_review_pending", "more_information_required", "approved_pending_owner_notice"]),
  reviewRevision: z.number().int().min(1),
  deadline: z.iso.datetime({ offset: true }),
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
  recordedParentSigningEvidence: z.array(z.object({nameCiphertext:z.string().regex(/^[0-9a-f]{58,4096}$/u),
    role:z.literal("genetic-parent")}).strict()).min(1).max(4).optional(),
}).strict().superRefine((row,context)=>{
  if(row.recordedParentSigningEvidence&&(row.caseKind!=="record_key"||row.parentIdentityCiphertext!==null))
    context.addIssue({code:"custom",message:"Signed parent evidence belongs only to the Card case",path:["recordedParentSigningEvidence"]});
});

const claimantIdentity = z.object({
  version: z.literal(1),
  contactEmail:z.email().max(254),
  claimantName: z.string().min(2).max(480),
  claimantDateOfBirth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u).optional(),
  childDateOfBirth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u).optional(),
}).passthrough();

/**
 * The parent-supplied identity a record carries (public.future_person_identity
 * .parent_supplied_ciphertext), for legacy deployment-key sealed rows. New
 * optional matching profiles have an independently erasable key and are not
 * the source of the Card's genuine earlier signed parent names.
 */
const parentIdentity = z.object({
  version: z.literal(1),
  parentNames: z.array(z.string().min(1).max(120)).min(1).max(4),
  parentRoles: z.array(z.enum(["genetic-parent", "legal-parent", "gestational-parent", "intended-parent"])).min(1).max(4),
}).passthrough();

export function openClaimReviewIdentity(identityHex: string, wrappedHex: string): z.infer<typeof claimantIdentity> | null {
  let key: Buffer | undefined;
  try {
    key = claimDataKey(wrappedHex);
    const blob = Buffer.from(identityHex, "hex");
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, blob.subarray(0, 12));
    decipher.setAuthTag(blob.subarray(12, 28));
    const text = Buffer.concat([decipher.update(blob.subarray(28)), decipher.final()]).toString("utf8");
    const parsed = claimantIdentity.safeParse(JSON.parse(text));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  } finally {
    key?.fill(0);
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

function openSignedParents(evidence:z.infer<typeof caseRow>["recordedParentSigningEvidence"]):z.infer<typeof parentIdentity>|null {
  if(!evidence)return null;
  try {
    const names=evidence.map(item=>decryptSecret(Buffer.from(item.nameCiphertext,"hex")));
    if(names.some(name=>[...name].length<2||[...name].length>120||/[\u0000-\u001f\u007f-\u009f]/u.test(name)))return null;
    return parentIdentity.parse({version:1,parentNames:names,parentRoles:[...new Set(evidence.map(item=>item.role))]});
  }catch{return null;}
}

/** The closed case body, or null when the row or a sealed field does not open. */
export function reviewCaseBody(row: unknown): Record<string, unknown> | null {
  const parsed = caseRow.safeParse(row);
  if (!parsed.success) return null;
  const value = parsed.data;
  const identity = openClaimReviewIdentity(value.identityCiphertext, value.wrappedDataKey);
  if (!identity) return null;
  const dateOfBirth = value.mode === "keyless" ? identity.childDateOfBirth : identity.claimantDateOfBirth;
  if (!dateOfBirth) return null;

  let caseBody: Record<string, unknown>;
  switch (value.caseKind) {
    case "record_key": {
      // The fallback consists only of genuine earlier signature ciphertext
      // authorized by the current assigned-review RPC. No current-name guess.
      if(value.recordedParentSigningEvidence&&value.parentIdentityCiphertext!==null)return null;
      const parents = value.recordedParentSigningEvidence ? openSignedParents(value.recordedParentSigningEvidence)
        : value.parentIdentityCiphertext ? openParentIdentity(value.parentIdentityCiphertext) : null;
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
