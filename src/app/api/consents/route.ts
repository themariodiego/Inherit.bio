import { NextResponse } from "next/server";
import { z } from "zod";
import { LLM_DATA_CLASSES, providerKeyFor } from "@/lib/llm";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

const schema = z.object({ providerKey: z.string().trim().min(1).max(255) });

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  const { data: settings } = await supabase
    .from("llm_settings")
    .select("provider, base_url")
    .maybeSingle();
  if (!settings) return NextResponse.json({ error: "provider_unavailable" }, { status: 409 });
  const currentKey = providerKeyFor(
    settings.provider as "anthropic" | "openai_compatible",
    settings.base_url,
  );
  if (parsed.data.providerKey !== currentKey) {
    return NextResponse.json({ error: "provider_changed" }, { status: 409 });
  }

  const { data: grantId, error } = await createAdminClient().rpc(
    "grant_cloud_model_consent",
    {
      p_account_id: user.id,
      p_provider_key: currentKey,
      p_data_classes: [...LLM_DATA_CLASSES],
    },
  );
  if (error || !grantId) {
    return NextResponse.json({ error: "consent_unavailable" }, { status: 503 });
  }
  return NextResponse.json({ grantId });
}
