import { z } from "zod";

/**
 * Another adult's genome under the register's Path B, "I have their file"
 * (brief §5.2 Path B, G2.6 adult half, G5.3; owner decision of 2026-09-28).
 * TEST-LOCAL only: the database refuses every step unless the server passes
 * the test-jurisdiction flag, and the routes also require
 * `third_party_adult_analysis` to resolve to permitted.
 *
 * Two artifacts are signed on the way:
 *   - `consent.upload-other-adult` v2, the uploader's Tier-2 consent for
 *     Path B (v1, approved earlier the same day, is kept and superseded);
 *   - `consent.subject-adult-esignature` v1, the person's own signature.
 * The owner approved both (docs/protocol/decisions.md, 2026-09-28) and the
 * migration seeds both. Approving a text opens no jurisdiction.
 *
 * The statement keys are each artifact's numbered statements, in order. The
 * migration hard-codes the same arrays; the content tests hold them equal.
 */
export const OTHER_ADULT_UPLOAD_ARTIFACT_KEY = "consent.upload-other-adult";

export const OTHER_ADULT_UPLOAD_STATEMENT_KEYS = [
  "subject-alive-and-adult",
  "subject-permission-held",
  "lawfully-held-with-knowledge",
  "contact-belongs-to-subject",
  "no-excluded-relationship",
  "held-until-accepted",
  "no-uploader-access",
] as const;

export const SUBJECT_ESIGNATURE_ARTIFACT_KEY = "consent.subject-adult-esignature";

export const SUBJECT_ESIGNATURE_STATEMENT_KEYS = [
  "knows-uploader-has-file",
  "agrees-to-upload",
  "shown-what-uploader-sees",
  "may-withdraw-any-time",
] as const;

const uuid = z.uuid().regex(/^[0-9a-f-]+$/);
const sha256 = z.string().regex(/^[0-9a-f]{64}$/);
/** The register's contact: normalized, a valid address, at most 254 bytes. */
const contactEmail = z.string().trim().toLowerCase().pipe(z.email().max(254))
  .refine((value) => new TextEncoder().encode(value).length <= 254, "contact");
/** A person's name as the uploader types it: plain words, no control characters. */
const displayName = z.string().trim().min(2).max(80).regex(/^[^\u0000-\u001f\u007f]+$/);

/** 18 or older on this UTC day. The server checks again with its own clock. */
export function isAdultOn(dateOfBirth: string, today: Date = new Date()): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateOfBirth)) return false;
  const [year, month, day] = dateOfBirth.split("-").map(Number) as [number, number, number];
  const born = Date.UTC(year, month - 1, day);
  if (Number.isNaN(born) || new Date(born).toISOString().slice(0, 10) !== dateOfBirth) return false;
  const adult = Date.UTC(today.getUTCFullYear() - 18, today.getUTCMonth(), today.getUTCDate());
  return born <= adult && year >= 1900;
}

/**
 * `POST /api/subject-drafts`, the register's path-b-subject-esignature body
 * (closed-subject-draft-create-v1), with the request id this route has
 * always used so a retried click reserves one draft.
 */
export const pathBDraftBody = z.object({
  kind: z.literal("adult"),
  adultFlow: z.literal("path-b-subject-esignature"),
  displayName,
  dateOfBirth: z.iso.date(),
  contactEmail,
  requestId: uuid,
}).strict();
export type PathBDraftRequest = z.infer<typeof pathBDraftBody>;

export function isPathBDraftPayload(value: unknown): boolean {
  return typeof value === "object" && value !== null
    && "adultFlow" in value && value.adultFlow === "path-b-subject-esignature";
}

/** subject-draft-created-v1. */
export const pathBDraftReceipt = z.object({
  subjectDraftId: uuid,
  state: z.literal("awaiting_uploader_artifact"),
  next: z.literal("sign_uploader_artifact"),
  expiresAt: z.string(),
}).strict();

/** `POST /api/invitations`, the adult body: the draft and the address it already holds. */
export const pathBInvitationBody = z.object({
  targetSubjectDraftId: uuid,
  contactEmail,
}).strict();

export function isPathBInvitationPayload(value: unknown): boolean {
  return typeof value === "object" && value !== null && "targetSubjectDraftId" in value;
}

/**
 * The Tier-2 signing body the register lists for `api.consents` with a
 * `subjectDraftId`. Every statement is its own checkbox, so the body carries
 * the exact published key list; the typed name is validated separately.
 */
export const otherAdultConsentBody = z.object({
  action: z.literal("sign-artifact"),
  signatureClass: z.literal("tier2"),
  subjectDraftId: uuid,
  artifactVersion: z.number().int().positive().safe(),
  artifactPresentationToken: z.string().min(16).max(4096),
  affirmed: z.literal(true),
  statementKeys: z.array(z.string().min(1).max(64)).min(1).max(16),
  typedName: z.string().min(1).max(200),
}).strict();

export type OtherAdultConsentRequest = z.infer<typeof otherAdultConsentBody>;

export function isOtherAdultConsentPayload(value: unknown): boolean {
  return typeof value === "object" && value !== null
    && "signatureClass" in value && value.signatureClass === "tier2"
    && "subjectDraftId" in value;
}

/** Exactly the published keys, in the published order. */
export function isOtherAdultStatementSet(keys: readonly string[]): boolean {
  return isExactKeys(keys, OTHER_ADULT_UPLOAD_STATEMENT_KEYS);
}

export function isExactKeys(keys: readonly string[], expected: readonly string[]): boolean {
  return keys.length === expected.length && keys.every((key, index) => key === expected[index]);
}

/** Brief §3: at least two whitespace-separated tokens of at least two characters. */
export function otherAdultTypedNameIsValid(name: string): boolean {
  return name.trim().split(/\s+/).filter((token) => Array.from(token).length >= 2).length >= 2;
}

/**
 * The numbered statements of an artifact body, in order. The page renders
 * these, so the words beside each checkbox are the signed text itself and
 * never a second copy that could drift from it.
 */
export function artifactStatements(body: string): string[] {
  return [...body.matchAll(/^(\d+)\. (.+)$/gm)].map((match) => match[2]!.trim());
}

/** The artifact's false-statement warning, read from its own body. */
export function artifactWarning(body: string): string | null {
  const start = body.indexOf("Signing this when it is not true");
  if (start < 0) return null;
  const end = body.indexOf("\n", start);
  return body.slice(start, end < 0 ? undefined : end).trim();
}

/** One file revision as both sides see it: a state and dates, nothing else. */
export const pathBRevisionState = z.object({
  state: z.enum(["pending", "confirmed", "refused", "deleted", "expired", "withdrawn"]),
  addedOn: z.string(),
  deleteBy: z.string().nullable(),
  confirmedOn: z.string().nullable(),
}).strict();
export type PathBRevisionState = z.infer<typeof pathBRevisionState>;

/**
 * One Path B person as the uploader sees them: the name the uploader typed,
 * dates and one state. No address, file name, hash or object identity.
 */
export const otherAdultTargetState = z.object({
  subjectId: uuid,
  label: z.string().min(1).max(200),
  requestedAt: z.string(),
  answerBy: z.string().nullable(),
  state: z.enum(["awaiting-request", "awaiting-signature", "ready", "pending"]),
  signed: z.boolean(),
  latest: pathBRevisionState.nullable(),
}).strict();
export type OtherAdultTargetState = z.infer<typeof otherAdultTargetState>;

export interface OtherAdultConsentView {
  token: string;
  version: number;
  effectiveOn: string;
  summary: string;
  body: string;
  statements: { key: string; text: string }[];
  /** The artifact's own false-statement warning, shown above the signing control. */
  warning: string;
}

export type OtherAdultTarget = OtherAdultTargetState & {
  /** Present while the uploader still has to sign for this person. */
  consent?: OtherAdultConsentView;
  /** Sealed for this account and person: sends the request, or adds a file. */
  operationToken?: string;
  /** Set when nothing can be done for this person yet, and why. */
  blockedBy?: "account-completion" | "unavailable";
};

/**
 * The register's `file-finalize-v1` other-adult outcome: stored, quarantined,
 * the upload-time notice queued. The fileId is the held revision's own
 * opaque id; no file row exists behind it.
 */
export const heldFinalizationReceipt = z.object({
  fileId: uuid,
  status: z.literal("stored_quarantined"),
  analysisState: z.literal("quarantined"),
  noticeState: z.literal("queued"),
}).strict();
export type HeldFinalizationReceipt = z.infer<typeof heldFinalizationReceipt>;

/**
 * `POST /api/withdraw/session`, the person's own confirmation of a Path B
 * request (register api.withdraw, the full confirm body): their artifact,
 * their country and the attestation they affirm.
 */
const subjectArtifactSignature = z.object({
  artifactVersion: z.number().int().positive().safe(),
  artifactPresentationToken: z.string().min(16).max(4096),
  affirmed: z.literal(true),
  statementKeys: z.array(z.string().min(1).max(64)).min(1).max(8),
  typedName: z.string().min(1).max(200),
}).strict();

export const pathBSubjectConfirmBody = z.object({
  operation: z.literal("confirm"),
  nonce: z.string().min(1).max(2_048),
  subjectArtifact: subjectArtifactSignature,
  jurisdictionCode: z.string().regex(/^[A-Z]{2}$/),
  jurisdictionAttestationVersion: z.number().int().positive().safe(),
  jurisdictionAttestationHash: sha256,
  jurisdictionAffirmed: z.literal(true),
}).strict();
export type PathBSubjectConfirmRequest = z.infer<typeof pathBSubjectConfirmBody>;

/**
 * The same confirmation made with the signed-in account (Path B's account
 * branch, adult-subject-confirmation-v1): the same artifact and typed name,
 * and no country field, because the account's own current declaration is the
 * one that counts. The body cannot name the account; the session decides it.
 */
export const pathBAccountConfirmBody = z.object({
  operation: z.literal("confirm"),
  nonce: z.string().min(1).max(2_048),
  withAccount: z.literal(true),
  subjectArtifact: subjectArtifactSignature,
}).strict();
export type PathBAccountConfirmRequest = z.infer<typeof pathBAccountConfirmBody>;

/** The same route, for one file revision: confirm it, refuse it, or delete everything. */
export const adultUploadRevisionBody = z.union([
  z.object({ operation: z.literal("confirm"), uploadRevisionAffirmed: z.literal(true), nonce: z.string().min(1).max(2_048) }).strict(),
  z.object({ operation: z.enum(["refuse", "delete"]), nonce: z.string().min(1).max(2_048) }).strict(),
]);
export type AdultUploadRevisionRequest = z.infer<typeof adultUploadRevisionBody>;

/** What the person's read-only view shows: exactly what the uploader can see. */
export const adultUploadRevisionView = z.object({
  state: z.enum(["pending", "confirmed"]),
  uploaderName: z.string().regex(/^\p{L}[\p{L} .'-]{0,59}$/u).nullable(),
  label: z.string().min(1).max(200),
  fileKind: z.enum(["array", "vcf"]),
  addedOn: z.string(),
  deleteBy: z.string(),
  confirmedOn: z.string().nullable(),
}).strict();
export type AdultUploadRevisionView = z.infer<typeof adultUploadRevisionView>;

/**
 * What the person's own account shows (Path B's account branch): for each
 * person they were added as, the name the uploader typed and each current
 * file's kind, dates and state. No identifier, uploader, address or hash.
 */
export const subjectHeldFile = z.object({
  state: z.enum(["pending", "confirmed"]),
  fileKind: z.enum(["array", "vcf"]),
  addedOn: z.string(),
  deleteBy: z.string().nullable(),
  confirmedOn: z.string().nullable(),
}).strict();
export type SubjectHeldFile = z.infer<typeof subjectHeldFile>;
export const subjectHeldFiles = z.array(z.object({
  label: z.string().min(1).max(200),
  files: z.array(subjectHeldFile).max(200),
}).strict()).max(100);
export type SubjectHeldFiles = z.infer<typeof subjectHeldFiles>;
