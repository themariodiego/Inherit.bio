import "server-only";
import type { EmbryoCohortView } from "./cohorts";
import type { SignableArtifact } from "./upload-stage";
import { embryoIngestBuilt } from "./upload-stage";
import { EMBRYO_ANALYSIS_GRANT_STATEMENT_KEYS } from "./basis";
import { getSensitiveAccountContext } from "@/lib/account-deletion";
import { mintCohortGrantPresentation } from "@/lib/family/grant-token";
import { createAdminClient } from "@/lib/supabase/admin";
import { mintEmbryoOperation } from "./operation-token";

/** The graph has already admitted this account as a current required parent.
 * Every grant is separately rechecked by grant_cohort_purpose_v1. */
export async function loadCohortPermission(accountId: string, cohort: EmbryoCohortView): Promise<SignableArtifact | null> {
  if (!embryoIngestBuilt() || cohort.status !== "active" || cohort.viewerAnalysisGranted !== false) return null;
  const account = await getSensitiveAccountContext();
  if (!account || account.user.id !== accountId) return null;
  const admin = createAdminClient();
  const live = await admin.rpc("embryo_upload_account_live_v1", { p_account_id: accountId, p_auth_session_id: account.sessionId });
  if (live.error || live.data !== true) return null;
  const [published, record] = await Promise.all([
    admin.from("consent_artifacts").select("artifact_key, version, body_sha256, body_markdown, summary_markdown, effective_on")
      .eq("artifact_key", "consent.upload-embryo").is("superseded_at", null).lte("published_at", new Date().toISOString()).maybeSingle(),
    admin.from("embryo_cohorts").select("participant_set_revision").eq("id", cohort.id).eq("status", "active").maybeSingle(),
  ]);
  const document = published.data;
  if (published.error || record.error || !document || !record.data) return null;
  return { key: "consent.upload-embryo", version: document.version, effectiveOn: document.effective_on,
    summary: document.summary_markdown, body: document.body_markdown, sha256: document.body_sha256,
    statementKeys: [...EMBRYO_ANALYSIS_GRANT_STATEMENT_KEYS],
    presentationToken: mintCohortGrantPresentation({ accountId, cohortId: cohort.id, purpose: "embryo.analysis",
      artifactKey: document.artifact_key, artifactVersion: document.version, artifactBodySha256: document.body_sha256,
      participantSetRevision: record.data.participant_set_revision }),
    csrfToken: mintEmbryoOperation({ accountId, sessionId: account.sessionId, operation: "cohort_purpose_grant", targetKind: "cohort", targetId: cohort.id }),
  };
}
