import { NextResponse } from "next/server";
import { z } from "zod";
import { adultInvitationTokenHash } from "@/lib/adult-invitations";
import { hmacSecret } from "@/lib/crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

const formSchema = z.object({
  token: z.string().max(128),
  action: z.enum(["confirm", "refuse", "delete"]),
}).strict();

export async function POST(request: Request) {
  const url = new URL(request.url);
  const origin = request.headers.get("origin");
  if (origin && origin !== url.origin) {
    return NextResponse.json({ error: "invalid_origin" }, { status: 403 });
  }

  const entries = Object.fromEntries(await request.formData());
  const parsed = formSchema.safeParse(entries);
  const tokenHash = parsed.success ? adultInvitationTokenHash(parsed.data.token) : null;
  if (!parsed.success || !tokenHash) {
    return NextResponse.redirect(new URL("/legal/gdpr", url.origin), 303);
  }

  let accountId: string | null = null;
  let accountEmailHmac: string | null = null;
  if (parsed.data.action === "confirm") {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user?.email) {
      const next = `/withdraw/${encodeURIComponent(parsed.data.token)}`;
      return NextResponse.redirect(
        new URL(`/auth/sign-in?next=${encodeURIComponent(next)}`, url.origin),
        303,
      );
    }
    accountId = user.id;
    accountEmailHmac = hmacSecret(user.email.trim().toLowerCase(), "contact-email-v1");
  }

  const responseArgs = {
    p_token_hash: tokenHash,
    p_action: parsed.data.action,
    ...(accountId && accountEmailHmac
      ? {
          p_account_id: accountId,
          p_account_email_hmac: accountEmailHmac,
        }
      : {}),
  };
  const { data, error } = await createAdminClient().rpc(
    "respond_adult_subject_invitation_v1",
    responseArgs,
  );
  const result = !error && ["accepted", "refused", "deleted"].includes(data)
    ? data
    : "unavailable";
  return NextResponse.redirect(
    new URL(`/withdraw/${encodeURIComponent(parsed.data.token)}?result=${result}`, url.origin),
    303,
  );
}
