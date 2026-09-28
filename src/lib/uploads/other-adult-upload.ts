import { z } from "zod";

/**
 * Another adult's genome, held apart until that adult answers (brief §2.6,
 * G2.6 adult half, G5.3). TEST-LOCAL only: the artifact below is a draft the
 * owner has not approved, no migration seeds it, and the database refuses
 * both its signature and the upload branch unless the server passes the
 * test-jurisdiction flag.
 *
 * The statement keys are the numbered statements of
 * `content/legal/consent.upload-other-adult/v1.md`, in order. The database
 * function `private.sign_other_adult_upload_artifact_v1` hard-codes the same
 * array; `content/legal/consent-upload-other-adult.test.ts` holds all three
 * equal.
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

/** The artifact file's front-matter status while the owner has not approved it. */
export const OTHER_ADULT_UPLOAD_DRAFT_STATUS = "draft-awaiting-owner-approval";

const uuid = z.uuid().regex(/^[0-9a-f-]+$/);

/**
 * The Tier-2 signing body the register lists for `api.consents` with a
 * `subjectDraftId`: the reserved subject of the uploader's own pending
 * invitation. Every statement is its own checkbox, so the body carries the
 * exact published key list; the typed name is validated separately.
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
  return keys.length === OTHER_ADULT_UPLOAD_STATEMENT_KEYS.length
    && keys.every((key, index) => key === OTHER_ADULT_UPLOAD_STATEMENT_KEYS[index]);
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

/** The held-upload finalization receipt: stored, unreadable, nothing analysed. */
export const heldFinalizationReceipt = z.object({
  uploadId: uuid,
  status: z.literal("stored_quarantined"),
  analysisState: z.literal("quarantined"),
}).strict();
export type HeldFinalizationReceipt = z.infer<typeof heldFinalizationReceipt>;
