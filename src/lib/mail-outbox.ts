import crypto from "node:crypto";
import { encryptSecret, hmacSecret } from "@/lib/crypto";
import type { MailTemplate } from "@/lib/email";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Json } from "@/lib/supabase/types";

interface EnqueueAccountMail {
  accountId: string;
  email: string;
  mail: MailTemplate;
  purpose: string;
  targetKind: string;
  targetId: string;
  semanticKey: string;
  expiresAt?: Date;
}

function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

export async function enqueueAccountMail({
  accountId,
  email,
  mail,
  purpose,
  targetKind,
  targetId,
  semanticKey,
  expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
}: EnqueueAccountMail): Promise<string> {
  const normalizedEmail = normalizeEmail(email);
  const idempotencyKey = crypto
    .createHash("sha256")
    .update(
      JSON.stringify([
        "mail-outbox-v1",
        accountId,
        mail.id,
        purpose,
        targetKind,
        targetId,
        semanticKey,
      ]),
      "utf8",
    )
    .digest("hex");

  const { data, error } = await createAdminClient().rpc(
    "enqueue_account_mail",
    {
      p_account_id: accountId,
      p_contact_ciphertext: `\\x${encryptSecret(normalizedEmail).toString("hex")}`,
      p_contact_hmac: hmacSecret(normalizedEmail, "contact-email-v1"),
      p_template_id: mail.id,
      p_purpose: purpose,
      p_target_kind: targetKind,
      p_target_id: targetId,
      p_template_payload: mail.payload as unknown as Json,
      p_idempotency_key: idempotencyKey,
      p_expires_at: expiresAt.toISOString(),
    },
  );
  if (error || !data) throw new Error("mail_enqueue_failed");
  return data;
}
