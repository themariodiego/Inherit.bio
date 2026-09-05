import { decryptSecret, hmacSecret } from "@/lib/crypto";
import { submitMail } from "@/lib/email";
import type { createAdminClient } from "@/lib/supabase/admin";

/** The independent queue becomes sendable only in the final graph-purge transaction. */
export async function drainEmbryoTerminalMail(
  admin: ReturnType<typeof createAdminClient>,
): Promise<{ processed: number; failed: number }> {
  let processed = 0;
  let failed = 0;
  for (let index = 0; index < 10; index++) {
    const { data, error } = await admin.rpc("claim_embryo_terminal_mail_v1");
    if (error) throw new Error("terminal_mail_unavailable");
    const row = data?.[0];
    if (!row) break;
    let recipient = "";
    let accepted = false;
    let receipt = "";
    try {
      recipient = decryptSecret(Buffer.from(row.contact_ciphertext, "hex"));
      const providerId = await submitMail(
        recipient,
        { id: "embryo-ingest-abandoned", payload: {} },
        row.idempotency_key,
      );
      accepted = true;
      receipt = hmacSecret(providerId, "resend-message-id-v1");
    } catch {
      // No provider error, address, ciphertext or message content is logged.
    } finally {
      recipient = "";
    }
    const { data: completed, error: completionError } = await admin.rpc(
      "complete_embryo_terminal_mail_v1",
      {
        p_notice_id: row.notice_id,
        p_claim_token: row.claim_token,
        p_accepted: accepted,
        p_provider_message_hmac: receipt,
      },
    );
    // An uncertain accepted receipt is retried with the SAME provider key.
    // Never turn acceptance into a failure ACK that retains contact data.
    if (completionError || !completed) throw new Error("terminal_mail_completion_failed");
    if (accepted) processed++;
    else failed++;
  }
  return { processed, failed };
}
