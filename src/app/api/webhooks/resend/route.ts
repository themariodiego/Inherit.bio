import { Resend } from "resend";
import { hmacSecret } from "@/lib/crypto";
import { createAdminClient } from "@/lib/supabase/admin";

export const maxDuration = 30;

const STATUS_BY_EVENT = {
  "email.delivered": "delivered",
  "email.delivery_delayed": "accepted",
  "email.complained": "complained",
  "email.bounced": "bounced",
  "email.failed": "reviewed_undeliverable",
  "email.suppressed": "reviewed_undeliverable",
} as const;

export async function POST(request: Request) {
  const webhookSecret = process.env.RESEND_WEBHOOK_SECRET;
  if (!webhookSecret) {
    return new Response("Webhook unavailable", { status: 503 });
  }

  const payload = await request.text();
  let event;
  try {
    event = new Resend(process.env.RESEND_API_KEY).webhooks.verify({
      payload,
      headers: {
        id: request.headers.get("svix-id") ?? "",
        timestamp: request.headers.get("svix-timestamp") ?? "",
        signature: request.headers.get("svix-signature") ?? "",
      },
      webhookSecret,
    });
  } catch {
    return new Response("Invalid signature", { status: 401 });
  }

  const status =
    event.type in STATUS_BY_EVENT
      ? STATUS_BY_EVENT[event.type as keyof typeof STATUS_BY_EVENT]
      : null;
  if (!status || !event.type.startsWith("email.") || !("email_id" in event.data)) {
    return new Response(null, { status: 204 });
  }

  const { data: matched, error } = await createAdminClient().rpc(
    "record_resend_mail_event",
    {
      p_provider_message_id_hmac: hmacSecret(
        event.data.email_id,
        "resend-message-id-v1",
      ),
      p_provider_event_hmac: hmacSecret(payload, "resend-webhook-event-v1"),
      p_status: status,
      p_occurred_at: event.created_at,
    },
  );
  if (error) return new Response("Webhook unavailable", { status: 503 });

  // Unknown provider IDs are acknowledged without disclosing whether a
  // message exists in this deployment.
  return new Response(null, { status: matched ? 204 : 202 });
}
