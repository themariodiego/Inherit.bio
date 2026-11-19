import "server-only";

import { getSensitiveAccountContext } from "@/lib/account-deletion";
import { encryptSecret, hmacSecret } from "@/lib/crypto";
import { mintSubjectOperationNonce } from "@/lib/subject-endpoints/operation-nonce";
import { resolveSubjectForAccount } from "@/lib/subjects";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import type { OwnUploadWithdrawalReadiness, OwnUploadWithdrawalView } from "./own-upload-withdrawal-client";

export type { OwnUploadWithdrawalReadiness, OwnUploadWithdrawalView } from "./own-upload-withdrawal-client";

/**
 * Withdrawing a person's consent to store their own DNA file (owner decision
 * of 19 November 2026, "Withdrawing consent for a person's own DNA file
 * deletes the files and all made from them"). The withdrawal is the self case
 * of `api.subject-delete` (`DELETE /api/subjects/[id]`), the whole-record
 * emptying, run through `empty_self_subject_with_notice_v1`, which also
 * queues the confirmation email in the same transaction
 * (20261119150000_own_upload_consent_withdrawal.sql).
 *
 * This module holds the two server halves: what a page renders for the
 * control, and the sealed address the route hands the database for the email.
 */

const READINESS = new Set(["ready", "processing", "unsupported"]);

/**
 * What `/settings/consents` and `/files` render for the control. It is shown
 * only while the account holds a live upload consent on its own record: the
 * `upload_class` row `prepare-own-upload.ts` reads, with its
 * `consent.upload-self` signature. Brief X1.5: this runs while the page
 * renders, so it writes nothing; the nonce is minted, never stored.
 *
 * The readiness comes from `self_subject_withdrawal_readiness_v1`, which
 * predicts the emptying's own refusals. When that read fails (for example
 * before the migration that adds it is hosted) the control says it is not
 * available and offers no request: it never shows a withdrawal it cannot run.
 */
export async function prepareOwnUploadWithdrawal(now = Date.now()): Promise<OwnUploadWithdrawalView> {
  const account = await getSensitiveAccountContext();
  if (!account) return { kind: "none" };
  const self = await resolveSubjectForAccount(account.user.id, "me");
  if (!self || self.subjectClass !== "self" || self.lifecycle !== "active") return { kind: "none" };
  const admin = createAdminClient();
  const at = new Date(now).toISOString();
  const grant = await admin.from("subject_consents").select("signature_id")
    .eq("subject_id", self.id).eq("account_id", account.user.id).eq("consent_type", "upload_class")
    .is("revoked_at", null).contains("scope", ["store"]).or(`expires_at.is.null,expires_at.gt.${at}`)
    .order("granted_at", { ascending: false }).limit(1).maybeSingle();
  if (grant.error || !grant.data?.signature_id) return { kind: "none" };
  const signature = await admin.from("consent_signatures").select("artifact_version, signed_at")
    .eq("id", grant.data.signature_id).eq("artifact_key", "consent.upload-self")
    .eq("signer_account_id", account.user.id).eq("target_kind", "subject").eq("target_id", self.id).maybeSingle();
  if (signature.error || !signature.data) return { kind: "none" };
  const read = await admin.rpc("self_subject_withdrawal_readiness_v1", {
    p_account_id: account.user.id, p_subject_id: self.id,
  });
  const readiness: OwnUploadWithdrawalReadiness = !read.error && typeof read.data === "string" && READINESS.has(read.data)
    ? read.data as OwnUploadWithdrawalReadiness : "unavailable";
  return {
    kind: "live",
    subjectId: self.id,
    signedAt: signature.data.signed_at,
    version: signature.data.artifact_version,
    readiness,
    nonce: readiness === "ready" ? mintSubjectOperationNonce({ accountId: account.user.id, sessionId: account.sessionId,
      operation: "subject_delete", subjectId: self.id }, now) : null,
  };
}

/** The envelope `empty_self_subject_with_notice_v1` addresses the confirmation email with. */
export type SelfWithdrawalNotice = Readonly<{ contactRevision: number; contactCiphertext: string; contactHmac: string }>;

/**
 * The signed-in account's own address, sealed under the server key, with its
 * keyed hash, for the confirmation email. Only the authenticated server
 * response chooses the recipient; nothing in the request does.
 *
 * As `ownReportReadyEnvelope` does, the database-owned counter is read first
 * and the address second: an Auth email change before or between the two
 * reads, or before the withdrawal commits, makes the envelope stale and the
 * database refuses the whole withdrawal, so the email is never sent to an
 * address the account no longer has. Null when the account has no confirmed
 * address; a failed read throws.
 */
export async function selfWithdrawalNotice(accountId: string): Promise<SelfWithdrawalNotice | null> {
  const { data: profile, error } = await createAdminClient().from("profiles")
    .select("mail_contact_revision").eq("id", accountId).single();
  if (error || !Number.isSafeInteger(profile?.mail_contact_revision) || profile!.mail_contact_revision < 1) {
    throw new Error("unavailable");
  }
  const { data: { user } } = await (await createClient()).auth.getUser();
  if (user?.id !== accountId || !user.email || !user.email_confirmed_at) return null;
  const email = user.email.trim().toLowerCase();
  return { contactRevision: profile!.mail_contact_revision,
    contactCiphertext: encryptSecret(email).toString("hex"), contactHmac: hmacSecret(email, "contact-email-v1") };
}
