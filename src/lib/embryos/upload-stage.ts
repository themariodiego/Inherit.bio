import "server-only";

import { mintArtifactPresentation } from "@/lib/family/grant-token";
import type { ArtifactDocument } from "@/components/legal/artifact-document";
import { isTestJurisdictionEnabled } from "@/lib/legal/jurisdictions";
import { createAdminClient } from "@/lib/supabase/admin";
import { EMBRYO_ARTIFACT_KEYS, EMBRYO_ARTIFACT_STATEMENT_KEYS, EMBRYO_UPLOAD_UPLOADER_STATEMENT_KEYS } from "./basis";
import { currentStageSignature, type StageAttestation, type StageSignature } from "./upload-signature";
import { mintEmbryoOperation } from "./operation-token";
import {
  resolveUploadStage,
  type Acknowledgement,
  type ArtifactToSign,
  type CohortFacts,
  type DraftFacts,
  type UploadNotice,
} from "./upload-stage-core";

/**
 * The server half of `/embryos/upload` past step 2: read the rows the stage
 * decider needs, decide the stage (`upload-stage-core.ts`), and mint exactly
 * the tokens that stage's controls spend. Every token is bound to this
 * account, this auth session, one operation and one target, and lives ten
 * minutes (`operation-token.ts`); every presentation is bound to one
 * artifact version and its published statement set. Nothing a stage does
 * not use is minted.
 *
 * Built only under TEST-LOCAL (`embryoIngestBuilt`). `EMBRYO_INGEST_AVAILABLE`
 * stays false: it is the production statement, and production still says it.
 */

/** Whether this deployment offers the steps past the draft: TEST-LOCAL only. */
export function embryoIngestBuilt(): boolean {
  return isTestJurisdictionEnabled();
}

export interface SignableArtifact {
  key: ArtifactToSign["key"];
  version: number;
  effectiveOn: string;
  summary: string;
  body: string;
  sha256: string;
  statementKeys: string[];
  presentationToken: string;
  csrfToken: string;
}

export type UploadStageView =
  | { kind: "reauthenticate" }
  | { kind: "start"; notice: UploadNotice; draftCsrfToken: string }
  | { kind: "owner-sign" | "co-parent-sign"; draftId: string; artifacts: SignableArtifact[] }
  | { kind: "invite"; draftId: string; expiresAt: string; csrfTokens: string[] }
  | { kind: "waiting"; draftId: string; expiresAt: string }
  | { kind: "evidence-review-unavailable"; draftId: string }
  | {
      kind: "acknowledge";
      draftId: string;
      artifacts: SignableArtifact[];
      signed: Partial<Record<Acknowledgement, string>>;
      finalizeNonce: string;
    }
  | { kind: "processing"; cohortId: string }
  | { kind: "complete"; cohortId: string; draftCsrfToken: string };

type Admin = ReturnType<typeof createAdminClient>;
const OPEN_DRAFT_STATES = ["draft", "evidence_pending", "ready"];
const DRAFT_COLUMNS = "id, owner_account_id, uploader_principal_id, upload_situation, basis_case, fixed_expires_at, created_at";

class StageReadError extends Error {}
function rows<T>(result: { data: T[] | null; error: unknown }): T[] {
  if (result.error || !result.data) throw new StageReadError("stage read failed");
  return result.data;
}

interface DraftRow {
  id: string; owner_account_id: string; uploader_principal_id: string; upload_situation: DraftFacts["uploadSituation"];
  basis_case: DraftFacts["basisCase"]; fixed_expires_at: string; created_at: string;
}

async function draftFacts(admin: Admin, draft: DraftRow, documents: ArtifactDocument[]): Promise<DraftFacts> {
  const [slots, signatures, invitations, attestations] = await Promise.all([
    admin.from("draft_participant_slots").select("slot_kind, principal_id, state").eq("embryo_draft_id", draft.id),
    admin.from("consent_signatures").select("id, artifact_key, artifact_version, artifact_body_sha256, signer_principal_id, signer_account_id, purpose, signed_at, statement_keys, jurisdiction_code, jurisdiction_revision")
      .eq("target_kind", "cohort_draft").eq("target_id", draft.id),
    admin.from("subject_invitations").select("invitee_principal_id, status")
      .eq("target_kind", "cohort_draft").eq("target_id", draft.id),
    admin.from("attestations").select("signature_id, principal_id, kind, statement_keys, affirmed")
      .eq("target_kind", "cohort_draft").eq("target_id", draft.id),
  ]);
  const slotRows = rows(slots) as { slot_kind: string; principal_id: string | null; state: string }[];
  const principalIds = [...new Set([draft.uploader_principal_id, ...slotRows.map((slot) => slot.principal_id).filter((id): id is string => id !== null)])];
  const principals = principalIds.length === 0 ? [] : rows(await admin.from("subject_principals")
    .select("id, account_id, status, principal_kind").in("id", principalIds)) as
    { id: string; account_id: string | null; status: string; principal_kind: string }[];
  const principal = new Map(principals.map((row) => [row.id, row]));
  const accountIds = [...new Set(principals.flatMap(row => row.account_id ? [row.account_id] : []))];
  const profiles = accountIds.length ? rows(await admin.from("profiles").select("id, jurisdiction_code, jurisdiction_revision").in("id", accountIds)) as
    { id: string; jurisdiction_code: string | null; jurisdiction_revision: number }[] : [];
  const profile = new Map(profiles.map(row => [row.id, row]));
  const currentSignatures = (rows(signatures) as StageSignature[]).filter(signature => {
    const signer = principal.get(signature.signer_principal_id);
    return currentStageSignature({ signature, principal: signer,
      profile: signer?.account_id ? profile.get(signer.account_id) : undefined,
      artifact: documents.find(document => document.artifact_key === signature.artifact_key),
      attestations: rows(attestations) as StageAttestation[] });
  });
  return {
    id: draft.id,
    ownerAccountId: draft.owner_account_id,
    uploaderPrincipalId: draft.uploader_principal_id,
    uploadSituation: draft.upload_situation,
    basisCase: draft.basis_case,
    fixedExpiresAt: new Date(draft.fixed_expires_at).toISOString(),
    createdAt: new Date(draft.created_at).toISOString(),
    slots: slotRows.map((slot) => {
      const row = slot.principal_id ? principal.get(slot.principal_id) : undefined;
      return {
        kind: slot.slot_kind, principalId: slot.principal_id, state: slot.state,
        principalAccountId: row?.account_id ?? null, principalActive: row?.status === "active",
        principalKind: row?.principal_kind ?? null,
      };
    }),
    signatures: currentSignatures
      .map((row) => ({ id: row.id, artifactKey: row.artifact_key, signerPrincipalId: row.signer_principal_id,
        purpose: row.purpose, signedAt: new Date(row.signed_at).toISOString() })),
    invitations: (rows(invitations) as { invitee_principal_id: string | null; status: string }[])
      .map((row) => ({ inviteePrincipalId: row.invitee_principal_id, status: row.status })),
  };
}

/** The rows the decider reads, for this account only. */
async function stageFacts(admin: Admin, accountId: string, sessionId: string, now: Date, documents: ArtifactDocument[]) {
  const live = now.toISOString();
  const [owned, principals, cohorts] = await Promise.all([
    admin.from("embryo_cohort_drafts").select(DRAFT_COLUMNS).eq("owner_account_id", accountId)
      .in("state", OPEN_DRAFT_STATES).gt("fixed_expires_at", live).order("created_at", { ascending: false }).limit(1),
    admin.from("subject_principals").select("id").eq("account_id", accountId)
      .eq("principal_kind", "genetic_parent").eq("status", "active"),
    admin.from("embryo_cohorts").select("id, status, created_at, publication_revision").eq("owner_account_id", accountId)
      .order("created_at", { ascending: false }).limit(1),
  ]);
  const ownedRow = (rows(owned) as DraftRow[])[0] ?? null;
  const parentIds = (rows(principals) as { id: string }[]).map((row) => row.id);
  let coParentRows: DraftRow[] = [];
  if (parentIds.length > 0) {
    const slots = rows(await admin.from("draft_participant_slots").select("embryo_draft_id")
      .in("principal_id", parentIds).in("slot_kind", ["parent_a", "parent_b"]).eq("state", "current")
      .not("embryo_draft_id", "is", null)) as { embryo_draft_id: string }[];
    const draftIds = [...new Set(slots.map((slot) => slot.embryo_draft_id))];
    if (draftIds.length > 0) {
      coParentRows = rows(await admin.from("embryo_cohort_drafts").select(DRAFT_COLUMNS).in("id", draftIds)
        .neq("owner_account_id", accountId).in("state", OPEN_DRAFT_STATES).gt("fixed_expires_at", live)) as DraftRow[];
    }
  }
  const cohortRow = (rows(cohorts) as { id: string; status: string; created_at: string; publication_revision: number }[])[0] ?? null;
  let latestCohort: CohortFacts | null = null;
  if (cohortRow) {
    const sessions = rows(await admin.from("embryo_ingest_sessions").select("status").eq("cohort_id", cohortRow.id).eq("account_id", accountId).eq("originating_session_id", sessionId)
      .order("created_at", { ascending: false }).limit(1)) as { status: string }[];
    latestCohort = { id: cohortRow.id, createdAt: new Date(cohortRow.created_at).toISOString(), status: cohortRow.status, publicationRevision: cohortRow.publication_revision,
      sessionStatus: sessions[0]?.status ?? null };
  }
  return {
    ownedDraft: ownedRow ? await draftFacts(admin, ownedRow, documents) : null,
    coParentDrafts: await Promise.all(coParentRows.map((row) => draftFacts(admin, row, documents))),
    latestCohort,
  };
}

function statementKeysFor(artifact: ArtifactToSign): string[] {
  return artifact.key === "consent.upload-embryo" && artifact.role === "uploader"
    ? [...EMBRYO_UPLOAD_UPLOADER_STATEMENT_KEYS]
    : [...EMBRYO_ARTIFACT_STATEMENT_KEYS[artifact.key]];
}

async function signable(
  claims: { accountId: string; sessionId: string; draftId: string },
  artifacts: ArtifactToSign[],
  now: number,
  documents: ArtifactDocument[],
): Promise<SignableArtifact[] | null> {
  const out: SignableArtifact[] = [];
  for (const artifact of artifacts) {
    const document = documents.find(document => document.artifact_key === artifact.key);
    if (!document) return null;
    const statementKeys = statementKeysFor(artifact);
    out.push({
      key: artifact.key,
      version: document.version,
      effectiveOn: document.effective_on,
      summary: document.summary_markdown,
      body: document.body_markdown,
      sha256: document.body_sha256,
      statementKeys,
      presentationToken: mintArtifactPresentation({
        accountId: claims.accountId, targetKind: "cohort_draft", targetId: claims.draftId,
        artifactKey: artifact.key, artifactVersion: document.version,
        artifactBodySha256: document.body_sha256, statementKeys,
      }, now),
      csrfToken: mintEmbryoOperation({
        accountId: claims.accountId, sessionId: claims.sessionId, operation: "artifact_sign",
        targetKind: "cohort_draft", targetId: claims.draftId,
      }, now),
    });
  }
  return out;
}

/**
 * The stage and its tokens, or null when a row or an artifact could not be
 * read: the page then shows its read-failed state rather than a guess.
 */
export async function loadUploadStage(
  account: { accountId: string; sessionId: string },
  now = Date.now(),
): Promise<UploadStageView | null> {
  const admin = createAdminClient();
  let facts: Awaited<ReturnType<typeof stageFacts>>;
  let documents: ArtifactDocument[];
  try {
    const live = await admin.rpc("embryo_upload_account_live_v1", { p_account_id: account.accountId, p_auth_session_id: account.sessionId });
    if (live.error) return null;
    if (live.data !== true) return { kind: "reauthenticate" };
    documents = rows(await admin.from("consent_artifacts")
      .select("artifact_key, version, body_sha256, body_markdown, summary_markdown, effective_on, summary_of_changes")
      .in("artifact_key", [...EMBRYO_ARTIFACT_KEYS]).is("superseded_at", null).lte("published_at", new Date(now).toISOString())) as ArtifactDocument[];
    facts = await stageFacts(admin, account.accountId, account.sessionId, new Date(now), documents);
  } catch (error) {
    if (error instanceof StageReadError) return null;
    throw error;
  }
  const { stage, notice } = resolveUploadStage({ accountId: account.accountId, ...facts });
  const mint = (operation: "invitation_create" | "cohort_finalize", draftId: string) => mintEmbryoOperation({
    accountId: account.accountId, sessionId: account.sessionId, operation, targetKind: "cohort_draft", targetId: draftId,
  }, now);
  switch (stage.kind) {
    case "start":
      return {
        kind: "start", notice,
        draftCsrfToken: mintEmbryoOperation({
          accountId: account.accountId, sessionId: account.sessionId, operation: "cohort_draft_create",
          targetKind: "account", targetId: account.accountId,
        }, now),
      };
    case "owner-sign":
    case "co-parent-sign": {
      const artifacts = await signable({ ...account, draftId: stage.draftId }, stage.artifacts, now, documents);
      return artifacts ? { kind: stage.kind, draftId: stage.draftId, artifacts } : null;
    }
    case "invite":
      return { kind: "invite", draftId: stage.draftId, expiresAt: stage.expiresAt,
        csrfTokens: Array.from({ length: stage.count }, () => mint("invitation_create", stage.draftId)) };
    case "waiting":
      return { kind: "waiting", draftId: stage.draftId, expiresAt: stage.expiresAt };
    case "evidence-review-unavailable":
      return { kind: "evidence-review-unavailable", draftId: stage.draftId };
    case "acknowledge": {
      const artifacts = await signable({ ...account, draftId: stage.draftId }, stage.artifacts, now, documents);
      return artifacts ? { kind: "acknowledge", draftId: stage.draftId, artifacts, signed: stage.signed,
        finalizeNonce: mint("cohort_finalize", stage.draftId) } : null;
    }
    case "processing":
      return { kind: "processing", cohortId: stage.cohortId };
    case "complete":
      return { kind: "complete", cohortId: stage.cohortId, draftCsrfToken: mintEmbryoOperation({
        accountId: account.accountId, sessionId: account.sessionId, operation: "cohort_draft_create",
        targetKind: "account", targetId: account.accountId,
      }, now) };
  }
}
