/**
 * Where an account stands in the embryo upload, decided from rows already
 * read (design §2.2 steps 2–5; E0 contract §2; `finalize_embryo_cohort_v1`).
 * Pure: the server loader (`upload-stage.ts`) reads the rows and mints the
 * tokens a stage needs; this module only decides which stage it is, so every
 * branch is provable in the unit suite.
 *
 * The rules are the database's, restated so the page never offers a control
 * the transaction would refuse:
 *
 *  - a required parent is a current `parent_a`/`parent_b` slot whose
 *    principal is an active genetic parent (`resolve_embryo_basis_authority_v1`);
 *  - each required parent signs the parent-class upload consent, the
 *    parentage attestation and the disposition-rights attestation, and on a
 *    single-parent basis the single-parent-basis attestation too;
 *  - only the draft's owner signs the upload consent through the signing
 *    route; a co-parent's upload consent and parentage are signed when they
 *    accept the invitation, so what is left to them later is the rest;
 *  - a third-party uploader signs the uploader-class upload consent;
 *  - a deceased-parent or sole-authority basis also needs reviewed evidence,
 *    and no review exists on this site yet, so that draft cannot finish;
 *  - the owner acknowledges the insurance disclosure and the Future Person
 *    Charter last, and finalizing opens the upload session.
 *
 * A finalized record's upload is one browser lifecycle: the sample handles
 * and the first operation nonce exist only in the finalize response. A record
 * found open again on a later load was left before its file was sent.
 */
import type { BasisCase } from "./basis";

export const PARENT_ARTIFACTS = [
  "consent.upload-embryo",
  "attestation.embryo-parentage",
  "attestation.embryo-disposition-rights",
  "attestation.embryo-single-parent-basis",
] as const;
export type ParentArtifact = (typeof PARENT_ARTIFACTS)[number];

export const ACKNOWLEDGEMENTS = ["disclosure.insurance-and-discrimination", "charter.future-person"] as const;
export type Acknowledgement = (typeof ACKNOWLEDGEMENTS)[number];

/** What a signing screen offers: one artifact, in the role the database will record. */
export interface ArtifactToSign {
  key: ParentArtifact | Acknowledgement;
  /** `consent.upload-embryo` has two published statement sets. */
  role: "parent" | "uploader" | "owner";
}

export interface DraftFacts {
  id: string;
  ownerAccountId: string;
  uploaderPrincipalId: string;
  uploadSituation: "own_embryos" | "with_genetic_parents_permission";
  basisCase: BasisCase | "identified_donor_consented";
  fixedExpiresAt: string;
  createdAt: string;
  slots: { kind: string; principalId: string | null; state: string; principalAccountId: string | null; principalActive: boolean; principalKind: string | null }[];
  signatures: { id: string; artifactKey: string; signerPrincipalId: string; purpose: string | null; signedAt: string }[];
  invitations: { inviteePrincipalId: string | null; status: string }[];
}

export interface CohortFacts {
  id: string;
  createdAt: string;
  status: string;
  sessionStatus: string | null;
}

export type UploadStage =
  | { kind: "start" }
  | { kind: "owner-sign"; draftId: string; artifacts: ArtifactToSign[] }
  | { kind: "invite"; draftId: string; count: number; expiresAt: string }
  | { kind: "waiting"; draftId: string; expiresAt: string }
  | { kind: "co-parent-sign"; draftId: string; artifacts: ArtifactToSign[] }
  | { kind: "evidence-review-unavailable"; draftId: string }
  | {
      kind: "acknowledge";
      draftId: string;
      artifacts: ArtifactToSign[];
      /** Acknowledgements this owner already signed on this draft, by artifact. */
      signed: Partial<Record<Acknowledgement, string>>;
    }
  | { kind: "processing"; cohortId: string };

/** A notice shown above the start of a new upload. */
export type UploadNotice = "co-parent-done" | "upload-failed" | "upload-left" | null;

export interface UploadStageDecision {
  stage: UploadStage;
  notice: UploadNotice;
}

const PARENT_SLOTS = new Set(["parent_a", "parent_b"]);
const EVIDENCE_BASES = new Set(["parent_deceased", "sole_legal_authority"]);
const PROCESSING_SESSIONS = new Set(["complete", "processing", "sanitization_pending"]);
const FAILED_SESSIONS = new Set(["failed", "abandoned", "cancelled", "failure_pending"]);
const OPEN_SESSIONS = new Set(["open", "mapping_required"]);

function requiredParents(draft: DraftFacts): string[] {
  return draft.slots
    .filter((slot) => PARENT_SLOTS.has(slot.kind) && slot.state === "current" && slot.principalId !== null
      && slot.principalActive && slot.principalKind === "genetic_parent")
    .map((slot) => slot.principalId as string);
}

function viewerParent(draft: DraftFacts, accountId: string): string | null {
  const slot = draft.slots.find((candidate) => PARENT_SLOTS.has(candidate.kind) && candidate.state === "current"
    && candidate.principalAccountId === accountId && candidate.principalActive && candidate.principalId !== null
    && candidate.principalKind === "genetic_parent");
  return slot?.principalId ?? null;
}

const UPLOAD_PURPOSE = { parent: "embryo-upload-parent-class", uploader: "embryo-upload-uploader-class" } as const;

function signed(draft: DraftFacts, principal: string, artifact: ArtifactToSign): boolean {
  return draft.signatures.some((signature) => signature.signerPrincipalId === principal
    && signature.artifactKey === artifact.key
    && (artifact.key !== "consent.upload-embryo" || signature.purpose === UPLOAD_PURPOSE[artifact.role as "parent" | "uploader"]));
}

/** Everything a required parent signs, in the order a signing screen shows them. */
export function parentArtifacts(basisCase: DraftFacts["basisCase"]): ArtifactToSign[] {
  return PARENT_ARTIFACTS
    .filter((key) => key !== "attestation.embryo-single-parent-basis" || basisCase !== "true_two_parent")
    .map((key) => ({ key, role: "parent" as const }));
}

/** What the owner still signs before anyone is invited. */
export function ownerArtifactsLeft(draft: DraftFacts): ArtifactToSign[] {
  if (draft.uploadSituation === "with_genetic_parents_permission") {
    const upload: ArtifactToSign = { key: "consent.upload-embryo", role: "uploader" };
    return signed(draft, draft.uploaderPrincipalId, upload) ? [] : [upload];
  }
  const self = viewerParent(draft, draft.ownerAccountId);
  if (!self) return [];
  return parentArtifacts(draft.basisCase).filter((artifact) => !signed(draft, self, artifact));
}

/**
 * What a parent who is not the owner still signs in their own account. The
 * upload consent is theirs only through the invitation, so it is never
 * offered here; a missing one keeps the record waiting instead.
 */
export function coParentArtifactsLeft(draft: DraftFacts, accountId: string): ArtifactToSign[] {
  const self = viewerParent(draft, accountId);
  if (!self || draft.ownerAccountId === accountId) return [];
  return parentArtifacts(draft.basisCase)
    .filter((artifact) => artifact.key !== "consent.upload-embryo")
    .filter((artifact) => !signed(draft, self, artifact));
}

function parentsComplete(draft: DraftFacts): boolean {
  const parents = requiredParents(draft);
  const expected = draft.basisCase === "true_two_parent" ? 2 : 1;
  if (parents.length !== expected || new Set(parents).size !== expected) return false;
  return parents.every((principal) => parentArtifacts(draft.basisCase).every((artifact) => signed(draft, principal, artifact)));
}

/** Parent slots still waiting for someone to accept, and whether each has a live invitation. */
function pendingSlots(draft: DraftFacts): { principalId: string; invited: boolean }[] {
  return draft.slots
    .filter((slot) => PARENT_SLOTS.has(slot.kind) && slot.state === "pending" && slot.principalId !== null)
    .map((slot) => ({
      principalId: slot.principalId as string,
      invited: draft.invitations.some((invitation) => invitation.inviteePrincipalId === slot.principalId
        && (invitation.status === "pending" || invitation.status === "accepted")),
    }));
}

/** The latest acknowledgement of each kind this draft's uploader signed. */
function acknowledgementsSigned(draft: DraftFacts): Partial<Record<Acknowledgement, string>> {
  const out: Partial<Record<Acknowledgement, string>> = {};
  for (const key of ACKNOWLEDGEMENTS) {
    const latest = draft.signatures
      .filter((signature) => signature.artifactKey === key && signature.signerPrincipalId === draft.uploaderPrincipalId)
      .sort((a, b) => b.signedAt.localeCompare(a.signedAt))[0];
    if (latest) out[key] = latest.id;
  }
  return out;
}

/** The owner's stage on their own open draft. */
export function ownerStage(draft: DraftFacts): UploadStage {
  const own = ownerArtifactsLeft(draft);
  if (own.length > 0) return { kind: "owner-sign", draftId: draft.id, artifacts: own };
  const uninvited = pendingSlots(draft).filter((slot) => !slot.invited);
  if (uninvited.length > 0) {
    return { kind: "invite", draftId: draft.id, count: uninvited.length, expiresAt: draft.fixedExpiresAt };
  }
  if (!parentsComplete(draft)) return { kind: "waiting", draftId: draft.id, expiresAt: draft.fixedExpiresAt };
  if (EVIDENCE_BASES.has(draft.basisCase)) return { kind: "evidence-review-unavailable", draftId: draft.id };
  const signedAcks = acknowledgementsSigned(draft);
  return {
    kind: "acknowledge",
    draftId: draft.id,
    artifacts: ACKNOWLEDGEMENTS.filter((key) => !signedAcks[key]).map((key) => ({ key, role: "owner" as const })),
    signed: signedAcks,
  };
}

/** The upload's latest record, once finalized: still checking, failed, left, or done. */
export function cohortOutcome(cohort: CohortFacts | null): "processing" | "upload-failed" | "upload-left" | null {
  if (!cohort) return null;
  if (cohort.status === "ingesting" || (cohort.status === "upload_pending" && cohort.sessionStatus !== null && PROCESSING_SESSIONS.has(cohort.sessionStatus))) {
    return "processing";
  }
  if (cohort.sessionStatus !== null && FAILED_SESSIONS.has(cohort.sessionStatus)) return "upload-failed";
  if (cohort.status === "upload_pending" && (cohort.sessionStatus === null || OPEN_SESSIONS.has(cohort.sessionStatus))) {
    return "upload-left";
  }
  return null;
}

/**
 * The one stage this account sees. A co-parent with a statement left signs
 * first, since nothing on the owner's side can move until they do; then the
 * account's own open draft; then its latest finalized record, when that is
 * still being checked. Everything else starts a new upload, with a notice
 * for what the account last left behind.
 */
export function resolveUploadStage(input: {
  accountId: string;
  ownedDraft: DraftFacts | null;
  coParentDrafts: DraftFacts[];
  latestCohort: CohortFacts | null;
}): UploadStageDecision {
  const coParent = input.coParentDrafts
    .filter((draft) => draft.ownerAccountId !== input.accountId)
    .map((draft) => ({ draft, left: coParentArtifactsLeft(draft, input.accountId) }))
    .sort((a, b) => b.draft.createdAt.localeCompare(a.draft.createdAt));
  const toSign = coParent.find((entry) => entry.left.length > 0);
  if (toSign) {
    return { stage: { kind: "co-parent-sign", draftId: toSign.draft.id, artifacts: toSign.left }, notice: null };
  }
  const outcome = cohortOutcome(input.latestCohort);
  const draftIsNewer = input.ownedDraft !== null
    && (input.latestCohort === null || input.ownedDraft.createdAt > input.latestCohort.createdAt);
  if (input.ownedDraft && (draftIsNewer || outcome !== "processing")) {
    return { stage: ownerStage(input.ownedDraft), notice: null };
  }
  if (outcome === "processing") return { stage: { kind: "processing", cohortId: input.latestCohort!.id }, notice: null };
  if (outcome === "upload-failed" || outcome === "upload-left") return { stage: { kind: "start" }, notice: outcome };
  return { stage: { kind: "start" }, notice: coParent.length > 0 ? "co-parent-done" : null };
}
