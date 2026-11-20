import "server-only";

import { mintPersonOperationNonce } from "@/lib/person-operation-nonce-core";
import { createAdminClient } from "@/lib/supabase/admin";
import type { EmbryoCohortView } from "./cohorts";
import type { EmbryoUploaderWithdrawalReadiness, EmbryoUploaderWithdrawalView } from "./uploader-withdrawal-client";

export type { EmbryoUploaderWithdrawalReadiness, EmbryoUploaderWithdrawalView } from "./uploader-withdrawal-client";

/**
 * A non-parent uploader's withdrawal of its permission for an embryo upload
 * (owner decision of 19 November 2026, "A non-parent uploader's withdrawal
 * for an embryo upload stops analysis and deletes, as they signed"). The
 * withdrawal is api.consent-revoke for the uploader's own consent.upload-embryo
 * signature; `withdraw_embryo_uploader_consent_v1` restricts a finalised
 * cohort under the register's actor case nonparent-required-uploader-basis-loss,
 * or deletes an open draft (20261119170000_embryo_uploader_consent_withdrawal.sql).
 *
 * These are what /embryos and /embryos/upload render for the control. Brief
 * X1.5: they run while the page renders, so they write nothing; the code is
 * minted, never stored. The signature is offered only to the account that
 * signed it as the uploader, and only where the database's read
 * (`embryo_uploader_withdrawal_readiness_v1`) finds the phase; when that read
 * fails for another reason, as before the migration is hosted, the control
 * says it is not available and offers no request.
 */

type Admin = ReturnType<typeof createAdminClient>;
type Actor = Readonly<{ accountId: string; sessionId: string }>;
const PHASES = new Set<EmbryoUploaderWithdrawalReadiness>(["cohort", "draft"]);

/** The uploader's own uploader-form signature on one draft, or null. */
async function uploaderSignature(admin: Admin, accountId: string, draftId: string): Promise<string | null> {
  const { data, error } = await admin.from("consent_signatures").select("id")
    .eq("target_kind", "cohort_draft").eq("target_id", draftId).eq("artifact_key", "consent.upload-embryo")
    .eq("purpose", "embryo-upload-uploader-class").eq("signer_account_id", accountId)
    .order("signed_at", { ascending: false }).limit(1).maybeSingle();
  return error || !data ? null : data.id;
}

async function viewFor(admin: Admin, actor: Actor, signatureId: string, now: number):
  Promise<EmbryoUploaderWithdrawalView | null> {
  const { data, error } = await admin.rpc("embryo_uploader_withdrawal_readiness_v1", {
    p_account_id: actor.accountId, p_signature_id: signatureId,
  });
  if (error?.code === "42501") return null;
  const readiness: EmbryoUploaderWithdrawalReadiness = !error && typeof data === "string"
    && PHASES.has(data as EmbryoUploaderWithdrawalReadiness) ? data as EmbryoUploaderWithdrawalReadiness : "unavailable";
  return { signatureId, readiness, nonce: readiness === "unavailable" ? null : mintPersonOperationNonce({
    accountId: actor.accountId, sessionId: actor.sessionId, operation: "consent_revoke", targetId: signatureId }, now) };
}

/**
 * For each listed cohort this account uploaded as its non-parent uploader,
 * the control on its card; nothing for a cohort the account is a parent of.
 */
export async function prepareCohortUploaderWithdrawals(actor: Actor, cohorts: readonly EmbryoCohortView[],
  now = Date.now()): Promise<Map<string, EmbryoUploaderWithdrawalView>> {
  const views = new Map<string, EmbryoUploaderWithdrawalView>();
  const owned = cohorts.filter((cohort) => cohort.viewerRole === "nonparent_uploader_owner");
  if (owned.length === 0) return views;
  const admin = createAdminClient();
  const { data: rows, error } = await admin.from("embryo_cohorts").select("id, draft_id")
    .in("id", owned.map((cohort) => cohort.id)).eq("owner_account_id", actor.accountId).eq("upload_class", "embryo_third_party");
  if (error || !rows) return views;
  for (const row of rows as { id: string; draft_id: string }[]) {
    const signatureId = await uploaderSignature(admin, actor.accountId, row.draft_id);
    if (!signatureId) continue;
    const view = await viewFor(admin, actor, signatureId, now);
    if (view) views.set(row.id, view);
  }
  return views;
}

/**
 * The control for the open draft /embryos/upload shows the account as its
 * own (the newest, as `loadUploadStage` reads it), when that draft is a
 * third-party upload the account signed as its non-parent uploader; or null.
 */
export async function prepareDraftUploaderWithdrawal(actor: Actor, now = Date.now()):
  Promise<EmbryoUploaderWithdrawalView | null> {
  const admin = createAdminClient();
  const { data: draft, error } = await admin.from("embryo_cohort_drafts").select("id, upload_class")
    .eq("owner_account_id", actor.accountId)
    .in("state", ["draft", "evidence_pending", "ready"]).gt("fixed_expires_at", new Date(now).toISOString())
    .order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (error || !draft || draft.upload_class !== "embryo_third_party") return null;
  const signatureId = await uploaderSignature(admin, actor.accountId, draft.id);
  return signatureId ? viewFor(admin, actor, signatureId, now) : null;
}
