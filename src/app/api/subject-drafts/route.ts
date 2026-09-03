import { NextResponse } from "next/server";
import { z } from "zod";
import { encryptSecret, hmacSecret } from "@/lib/crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

const requestSchema = z.object({
  kind: z.literal("other_adult"),
  adultFlow: z.literal("path-a-own-account"),
  email: z.email().max(320),
  adultAttestation: z.literal(true),
  requestId: z.uuid(),
  // The optional note the invited person reads in the invitation mail
  // (brief §5 §5.2). Plain text only: no control characters, so the mail
  // template can render it as words and never as a link.
  note: z
    .string()
    .trim()
    .min(1)
    .max(500)
    .regex(/^[^\u0000-\u0008\u000b-\u001f\u007f]+$/)
    .optional(),
}).strict();

function normalizedEmail(value: string): string {
  return value.trim().toLowerCase();
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user?.email) return new Response("Unauthorized", { status: 401 });

  if (process.env.INHERIT_TEST_JURISDICTION !== "1") {
    return NextResponse.json({ error: "jurisdiction_unavailable" }, { status: 409 });
  }

  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  const email = normalizedEmail(parsed.data.email);
  if (email === normalizedEmail(user.email)) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  const contactHmac = hmacSecret(email, "contact-email-v1");
  const idempotencyKey = hmacSecret(
    JSON.stringify([
      "adult-subject-invitation-v1",
      user.id,
      contactHmac,
      parsed.data.requestId,
    ]),
    "mail-idempotency-v1",
  );
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("create_adult_subject_invitation_v1", {
    p_account_id: user.id,
    p_contact_ciphertext: `\\x${encryptSecret(email).toString("hex")}`,
    p_contact_hmac: contactHmac,
    p_idempotency_key: idempotencyKey,
    p_test_jurisdiction: true,
  });
  if (error) {
    return NextResponse.json({ error: "invitation_unavailable" }, { status: 503 });
  }

  // The note travels in the queued mail's payload, never in the opaque
  // invitation token and never in a link. The invitation itself is already
  // recorded, so a payload that cannot be updated leaves the invitation
  // standing without the note rather than failing the request.
  const invitationId = data?.[0]?.invitation_id;
  if (parsed.data.note && invitationId) {
    await admin
      .from("mail_outbox")
      .update({ template_payload: { note: parsed.data.note } })
      .eq("target_id", invitationId)
      .eq("template_id", "adult-subject-invitation")
      .eq("state", "queued");
  }

  return NextResponse.json({ accepted: true }, { status: 202 });
}
