import { z } from "zod";
import { decryptSecret, hmacSecret } from "@/lib/crypto";
import { submitMail } from "@/lib/email";
import type { createAdminClient } from "@/lib/supabase/admin";

const noticeKind = z.enum(["invitation-refused", "draft-cancelled", "donor-attribution-ended"]);

/** Canonical outbox delivery; only the recipient envelope is draft-independent. */
export async function drainInvitationTerminalMail(
  admin: ReturnType<typeof createAdminClient>,
): Promise<{ processed: number; failed: number }> {
  let processed = 0;
  let failed = 0;
  for (let index = 0; index < 10; index++) {
    const { data, error } = await admin.rpc("claim_invitation_terminal_mail_v1");
    if (error) throw new Error("invitation_terminal_mail_unavailable");
    const row = data?.[0];
    if (!row) break;
    const { data: authorized, error: authorizationError } = await admin.rpc(
      "authorize_invitation_terminal_mail_v1",
      { p_outbox_id: row.outbox_id, p_attempt_ordinal: row.attempt_ordinal },
    );
    if (authorizationError || !authorized) { failed++; continue; }

    let recipient = "";
    let accepted = false;
    let receipt = "";
    try {
      const kind = noticeKind.parse(row.notice_kind);
      if (Boolean(row.contact_ciphertext) === Boolean(row.recipient_account_id)) {
        throw new Error("invitation_recipient_shape");
      }
      if (row.recipient_account_id) {
        // Resolve only this server-selected account's current verified address.
        const { data: account, error: accountError } = await admin.auth.admin.getUserById(row.recipient_account_id);
        if (accountError || !account.user?.email || !account.user.email_confirmed_at) {
          throw new Error("invitation_recipient_unavailable");
        }
        recipient = account.user.email;
      } else {
        recipient = decryptSecret(Buffer.from(row.contact_ciphertext!.replace(/^\\x/u, ""), "hex"));
      }
      // Recipient resolution may await Auth. Recheck after that boundary so a
      // deletion notice or authority change during lookup prevents submission.
      const checkpoint = await admin.rpc("authorize_invitation_terminal_mail_v1", {
        p_outbox_id: row.outbox_id, p_attempt_ordinal: row.attempt_ordinal,
      });
      if (checkpoint.error || checkpoint.data !== true) {
        failed++;
        continue;
      }
      const providerId = await submitMail(
        recipient, { id: "invitation-terminal-notice", payload: { kind } }, row.idempotency_key,
      );
      accepted = true;
      receipt = hmacSecret(providerId, "resend-message-id-v1");
    } catch {
      // No plaintext, provider response or recipient identifier is logged.
    } finally {
      recipient = "";
    }
    const { data: completed, error: completionError } = await admin.rpc(
      "complete_invitation_terminal_mail_v1",
      { p_outbox_id: row.outbox_id, p_attempt_ordinal: row.attempt_ordinal,
        p_success: accepted, p_provider_message_hmac: receipt },
    );
    // Never replace an uncertain success receipt with a failure acknowledgment.
    if (completionError || !completed) throw new Error("invitation_terminal_mail_completion_failed");
    if (accepted) processed++;
    else failed++;
  }
  return { processed, failed };
}
