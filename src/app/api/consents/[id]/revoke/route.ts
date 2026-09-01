import { NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  if (!z.string().uuid().safeParse(id).success) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });
  const { data: revoked, error } = await createAdminClient().rpc(
    "revoke_cloud_model_consent",
    { p_account_id: user.id, p_grant_id: id },
  );
  if (error) return NextResponse.json({ error: "consent_unavailable" }, { status: 503 });
  if (!revoked) return new Response("Not found", { status: 404 });
  return NextResponse.json({ revoked: true });
}
