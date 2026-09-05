import { z } from "zod";
import {
  BASES,
  EMBRYO_ANALYSIS_GRANT_STATEMENT_KEYS,
  EMBRYO_ARTIFACT_KEYS,
  EMBRYO_ARTIFACT_STATEMENT_KEYS,
  EMBRYO_COUNT_MAXIMUM,
  EMBRYO_UPLOAD_UPLOADER_STATEMENT_KEYS,
  requiredContactCount,
  type EmbryoArtifactKey,
} from "./basis";
import { RECORD_KEY_PATTERN, transferCard, type TransferCard } from "./record-key-cards";

/**
 * The closed request bodies of the embryo routes (E0 contract §6) and the
 * pure mappings between a body, the RPC it calls and the response it
 * returns. Nothing here reads a header, a cookie, the environment or the
 * database, so every branch is provable in the unit suite; the route files
 * add the account, the session, the token checks and the crypto.
 *
 * Every body is `.strict()`: a key the register does not list is refused
 * before any other check, and a body that fits two shapes cannot exist
 * because each shape carries a literal that the others lack.
 */

/** A contact as the request normalises it: trimmed and lower-cased. */
export function normalizeContact(value: string): string {
  return value.trim().toLowerCase();
}

/** The register's limit on a contact address, in bytes of UTF-8. */
const CONTACT_BYTE_LIMIT = 254;

function utf8Length(value: string): number {
  return new TextEncoder().encode(value).length;
}

/** A normalised, well-formed address of at most 254 bytes. */
const contactEmail = z
  .string()
  .max(1024)
  .transform(normalizeContact)
  .pipe(
    z
      .email()
      .max(CONTACT_BYTE_LIMIT)
      .refine((value) => utf8Length(value) <= CONTACT_BYTE_LIMIT, "contact"),
  );

/** The sealed tokens the routes accept: never empty, never unbounded. */
const sealedToken = z.string().min(16).max(8192);
const artifactVersion = z.number().int().positive();
const statementKeys = z.array(z.string().min(1).max(64)).min(1).max(16);
const typedName = z.string().min(1).max(200);

// ---------------------------------------------------------------------------
// api.embryo-cohort-drafts (§6.1)
// ---------------------------------------------------------------------------

const draftCommon = {
  basis: z.enum(BASES),
  donorAttributionIntent: z.enum(["none", "identified-donor-subject"]),
  embryoCount: z.number().int().min(1).max(EMBRYO_COUNT_MAXIMUM),
};

/** `closed-embryo-cohort-draft-v1`: one of the two situation bodies, each closed. */
export const cohortDraftBody = z.discriminatedUnion("uploadSituation", [
  z
    .object({
      uploadSituation: z.literal("own-embryos"),
      ...draftCommon,
      otherRequiredPrincipalContacts: z.array(contactEmail).max(2),
    })
    .strict(),
  z
    .object({
      uploadSituation: z.literal("with-genetic-parents-permission"),
      ...draftCommon,
      requiredGeneticPrincipalContacts: z.array(contactEmail).max(2),
    })
    .strict(),
]);

export type CohortDraftRequest = z.infer<typeof cohortDraftBody>;

/** The contact addresses the body carries, normalised, in the order given. */
export function draftContacts(body: CohortDraftRequest): string[] {
  return body.uploadSituation === "own-embryos"
    ? body.otherRequiredPrincipalContacts
    : body.requiredGeneticPrincipalContacts;
}

/**
 * The issues a well-formed draft body still fails on (§6.1, decision
 * §11.3): an identified-donor intent has no artifact to consume it; the
 * contact count must be exactly the one the basis derives; and no contact
 * may repeat or be the uploader's own address. Empty when the body may go
 * to the database.
 */
export function draftRequestIssues(body: CohortDraftRequest, ownerEmail: string): string[] {
  if (body.donorAttributionIntent === "identified-donor-subject") {
    return ["identified_donor_attribution_unavailable"];
  }
  const contacts = draftContacts(body);
  const owner = normalizeContact(ownerEmail);
  const expected = requiredContactCount(body.uploadSituation, body.basis);
  if (
    contacts.length !== expected ||
    contacts.includes(owner) ||
    new Set(contacts).size !== contacts.length
  ) {
    return ["contacts"];
  }
  return [];
}

/** `cohort-draft-created-v1`; a type alias so it satisfies the closed-shape serializer's record constraint. */
export type CohortDraftCreated = {
  cohortDraftId: string;
  state: "awaiting_uploader_artifacts";
  next: "sign_uploader_artifacts";
  requiredPrincipalSlots: string[];
  optionalAttributionSlots: string[];
  expiresAt: string;
};

export const COHORT_DRAFT_CREATED_KEYS = [
  "cohortDraftId",
  "state",
  "next",
  "requiredPrincipalSlots",
  "optionalAttributionSlots",
  "expiresAt",
] as const satisfies readonly (keyof CohortDraftCreated)[];

/** The 201 body from the draft RPC's row; the attribution slots are always empty in E0. */
export function cohortDraftCreated(row: {
  draft_id: string;
  expires_at: string;
  required_principal_slots: string[];
}): CohortDraftCreated {
  return {
    cohortDraftId: row.draft_id,
    state: "awaiting_uploader_artifacts",
    next: "sign_uploader_artifacts",
    requiredPrincipalSlots: [...row.required_principal_slots],
    optionalAttributionSlots: [],
    expiresAt: row.expires_at,
  };
}

// ---------------------------------------------------------------------------
// api.consents embryo bodies (§6.2)
// ---------------------------------------------------------------------------

/** The Tier-2 `sign-artifact` body against a cohort draft. */
export const signDraftArtifactBody = z
  .object({
    action: z.literal("sign-artifact"),
    signatureClass: z.literal("tier2"),
    cohortDraftId: z.uuid(),
    artifactVersion,
    artifactPresentationToken: sealedToken,
    affirmed: z.literal(true),
    statementKeys,
    typedName,
  })
  .strict();

/** The `grant-purpose` body for one cohort's `embryo.analysis` grant. */
export const grantCohortPurposeBody = z
  .object({
    action: z.literal("grant-purpose"),
    cohortId: z.uuid(),
    purposeKey: z.literal("embryo.analysis"),
    artifactVersion,
    artifactPresentationToken: sealedToken,
    affirmed: z.literal(true),
    statementKeys,
    typedName,
  })
  .strict();

/**
 * Whether a consents payload names an embryo target. The adult bodies never
 * carry `cohortDraftId` or `cohortId`, so the route can take the embryo
 * branch on that key alone and leave every adult body exactly as it was.
 */
export function isEmbryoConsentPayload(payload: unknown): boolean {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return false;
  const record = payload as Record<string, unknown>;
  return (
    (record.action === "sign-artifact" && "cohortDraftId" in record) ||
    (record.action === "grant-purpose" && "cohortId" in record)
  );
}

export function sameStatementKeys(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((key, index) => key === right[index]);
}

export function isEmbryoArtifactKey(key: string): key is EmbryoArtifactKey {
  return (EMBRYO_ARTIFACT_KEYS as readonly string[]).includes(key);
}

/**
 * Whether the keys are a published set for the artifact (§2): the parent
 * form for every key, and for `consent.upload-embryo` also the uploader
 * form. Which of the two the draft takes is the signing RPC's decision.
 */
export function isPublishedStatementSet(key: EmbryoArtifactKey, keys: readonly string[]): boolean {
  if (sameStatementKeys(keys, EMBRYO_ARTIFACT_STATEMENT_KEYS[key])) return true;
  return key === "consent.upload-embryo" && sameStatementKeys(keys, EMBRYO_UPLOAD_UPLOADER_STATEMENT_KEYS);
}

export function isAnalysisGrantStatementSet(keys: readonly string[]): boolean {
  return sameStatementKeys(keys, EMBRYO_ANALYSIS_GRANT_STATEMENT_KEYS);
}

const COUNTRY_CODE = /^[A-Z]{2}$/;
const SUBDIVISION_CODE = /^[A-Z]{2}-[A-Z0-9]{1,3}$/;

/**
 * The two-letter code a signature row records (§6.2): the profile's
 * country, the country of a committed subdivision, or `ZZ` when the account
 * has declared nothing the RPC's `^[A-Z]{2}$` check would take.
 */
export function signingJurisdictionCode(raw: string | null | undefined): string {
  const code = (raw ?? "").trim().toUpperCase();
  if (COUNTRY_CODE.test(code)) return code;
  if (SUBDIVISION_CODE.test(code)) return code.slice(0, 2);
  return "ZZ";
}

// ---------------------------------------------------------------------------
// api.invitations (§6.3), api.rights-activate (§6.4), api.invitation-accept (§6.5)
// ---------------------------------------------------------------------------

/** The one embryo body of api.invitations; the adult bodies live on api.subject-drafts. */
export const coParentInvitationBody = z
  .object({
    targetCohortDraftId: z.uuid(),
    contactEmail,
  })
  .strict();

/** A mailed invitation token: 32 random bytes as base64url, exactly 43 characters. */
export const rightsActivateBody = z
  .object({
    token: z.string().length(43),
    nonce: sealedToken,
  })
  .strict();

function acceptedArtifact<K extends string>(artifactKey: K) {
  return z
    .object({
      artifactVersion,
      artifactPresentationToken: sealedToken,
      affirmed: z.literal(true),
      statementKeys,
      typedName,
      artifactKey: z.literal(artifactKey),
    })
    .strict();
}

/** The co-parent body of api.invitation-accept (decision §11.5: `jurisdictionCode` only). */
export const coParentAcceptBody = z
  .object({
    nonce: sealedToken,
    coParentArtifacts: z
      .object({
        uploadEmbryo: acceptedArtifact("consent.upload-embryo"),
        parentageAttestation: acceptedArtifact("attestation.embryo-parentage"),
      })
      .strict(),
    jurisdictionCode: z.string().regex(COUNTRY_CODE),
  })
  .strict();

export type CoParentAcceptRequest = z.infer<typeof coParentAcceptBody>;

// ---------------------------------------------------------------------------
// api.embryo-record-key-cards (§6.6)
// ---------------------------------------------------------------------------

export const recordKeyCardsBody = z.object({ nonce: sealedToken }).strict();

// ---------------------------------------------------------------------------
// api.embryo-disposition (§6.8)
// ---------------------------------------------------------------------------

export const DISPOSITIONS = ["stored", "transferred", "donated", "discarded"] as const;
export type Disposition = (typeof DISPOSITIONS)[number];

const disposition = z.enum(DISPOSITIONS);

/** The three action bodies; the RPC decides which one the cohort's basis takes. */
export const dispositionBody = z.discriminatedUnion("action", [
  z.object({ action: z.literal("propose"), disposition, nonce: sealedToken }).strict(),
  z.object({ action: z.literal("confirm"), proposalId: z.uuid(), disposition, nonce: sealedToken }).strict(),
  z.object({ action: z.literal("commit-single-authority"), disposition, nonce: sealedToken }).strict(),
]);

export type DispositionRequest = z.infer<typeof dispositionBody>;

export interface DispositionRpcArgs {
  p_action: DispositionRequest["action"];
  p_disposition: Disposition;
  /** Null for every action but `confirm`; the RPC refuses any other pairing. */
  p_proposal_id: string | null;
}

export function dispositionRpcArgs(body: DispositionRequest): DispositionRpcArgs {
  return {
    p_action: body.action,
    p_disposition: body.disposition,
    p_proposal_id: body.action === "confirm" ? body.proposalId : null,
  };
}

const isoTimestamp = z.iso.datetime({ offset: true });

const dispositionAwaiting = z
  .object({
    status: z.literal("awaiting_other_parent"),
    proposalId: z.uuid(),
    expiresAt: isoTimestamp,
  })
  .strict();

const dispositionRecorded = z
  .object({
    embryoId: z.uuid(),
    disposition: z.enum(["stored", "donated", "discarded"]),
    effectiveAt: isoTimestamp,
    retentionExpiresAt: isoTimestamp,
  })
  .strict();

const transferRpcCard = z
  .object({
    record_key: z.string().regex(RECORD_KEY_PATTERN),
    closing_date_iso: z.iso.date(),
    closing_date_state: z.literal("definitive_transferred_claim_window"),
  })
  .strict();

const dispositionTransferred = z
  .object({
    embryoId: z.uuid(),
    disposition: z.literal("transferred"),
    effectiveAt: isoTimestamp,
    retentionExpiresAt: isoTimestamp,
    recipientSetRevision: z.number().int().positive(),
    callerState: z.enum(["delivered_inline", "not_a_card_recipient"]),
    card: transferRpcCard.nullable(),
  })
  .strict()
  // A card is present exactly when the caller is a recipient; anything else
  // is a database defect and must not reach a body.
  .refine((value) => (value.callerState === "delivered_inline") === (value.card !== null), "card");

/** The RPC's jsonb, one of exactly three closed shapes; anything else throws. */
const dispositionResult = z.union([dispositionAwaiting, dispositionRecorded, dispositionTransferred]);

export interface DispositionAwaitingBody {
  status: "awaiting_other_parent";
  proposalId: string;
  expiresAt: string;
}

export interface DispositionRecordedBody {
  embryoId: string;
  disposition: "stored" | "donated" | "discarded";
  effectiveAt: string;
  retentionExpiresAt: string;
}

export interface DispositionTransferredBody {
  embryoId: string;
  disposition: "transferred";
  effectiveAt: string;
  retentionExpiresAt: string;
  recordKeyDelivery: {
    recipientSetRevision: number;
    callerState: "delivered_inline" | "not_a_card_recipient";
  };
  recordKeyCard: TransferCard | null;
}

export type DispositionResponse =
  | { status: 202; body: DispositionAwaitingBody }
  | { status: 200; body: DispositionRecordedBody }
  | { status: 200; body: DispositionTransferredBody };

/**
 * `embryo-disposition-v1` from the RPC's jsonb: the awaiting receipt (202),
 * a recorded non-transfer disposition (200), or a transfer with its
 * replacement card composed in TypeScript (200). Throws on any shape the
 * register does not publish, so the route answers with the blocked
 * response rather than serializing an unregistered key.
 */
export function dispositionResponse(result: unknown, origin?: string): DispositionResponse {
  const parsed = dispositionResult.parse(result);
  if ("status" in parsed) {
    return {
      status: 202,
      body: { status: parsed.status, proposalId: parsed.proposalId, expiresAt: parsed.expiresAt },
    };
  }
  if (parsed.disposition === "transferred") {
    return {
      status: 200,
      body: {
        embryoId: parsed.embryoId,
        disposition: "transferred",
        effectiveAt: parsed.effectiveAt,
        retentionExpiresAt: parsed.retentionExpiresAt,
        recordKeyDelivery: {
          recipientSetRevision: parsed.recipientSetRevision,
          callerState: parsed.callerState,
        },
        recordKeyCard: parsed.card ? transferCard(parsed.card, origin) : null,
      },
    };
  }
  return {
    status: 200,
    body: {
      embryoId: parsed.embryoId,
      disposition: parsed.disposition,
      effectiveAt: parsed.effectiveAt,
      retentionExpiresAt: parsed.retentionExpiresAt,
    },
  };
}
