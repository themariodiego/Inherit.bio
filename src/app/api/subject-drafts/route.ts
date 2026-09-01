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
  const { error } = await createAdminClient().rpc(
    "create_adult_subject_invitation_v1",
    {
      p_account_id: user.id,
      p_contact_ciphertext: `\\x${encryptSecret(email).toString("hex")}`,
      p_contact_hmac: contactHmac,
      p_idempotency_key: idempotencyKey,
      p_test_jurisdiction: true,
    },
  );
  if (error) {
    return NextResponse.json({ error: "invitation_unavailable" }, { status: 503 });
  }

  return NextResponse.json({ accepted: true }, { status: 202 });
}
