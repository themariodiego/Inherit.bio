import { NextResponse } from "next/server";
import { z } from "zod";
import { encryptSecret } from "@/lib/crypto";
import { ANTHROPIC_MODELS } from "@/lib/llm";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

const bodySchema = z
  .object({
    provider: z.enum(["anthropic", "openai_compatible"]),
    base_url: z.url().nullish(),
    model: z.string().min(1).max(200),
    api_key: z.string().min(1).max(500).nullish(),
  })
  .refine(
    (b) => b.provider !== "openai_compatible" || Boolean(b.base_url),
    { message: "base_url is required for OpenAI-compatible providers" },
  )
  .refine(
    (b) =>
      b.provider !== "anthropic" ||
      (ANTHROPIC_MODELS as readonly string[]).includes(b.model),
    { message: "unknown Anthropic model" },
  );

// Stores copilot provider settings. The API key is encrypted server-side and
// written to llm_keys (no client grants); it is never logged and never
// returned by any endpoint.
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return new Response(parsed.error.issues[0]?.message ?? "Bad request", {
      status: 400,
    });
  }
  const body = parsed.data;

  const { error: settingsError } = await supabase.from("llm_settings").upsert({
    user_id: user.id,
    provider: body.provider,
    base_url: body.base_url ?? null,
    model: body.model,
    key_last4: body.api_key ? body.api_key.slice(-4) : undefined,
    updated_at: new Date().toISOString(),
  });
  if (settingsError) {
    return new Response(settingsError.message, { status: 500 });
  }

  if (body.api_key) {
    const admin = createAdminClient();
    const { error } = await admin.from("llm_keys").upsert({
      user_id: user.id,
      encrypted_key: `\\x${encryptSecret(body.api_key).toString("hex")}`,
      updated_at: new Date().toISOString(),
    });
    if (error) return new Response(error.message, { status: 500 });
  }

  return NextResponse.json({ saved: true });
}

// Removes stored provider settings and the encrypted key.
export async function DELETE() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  await supabase.from("llm_settings").delete().eq("user_id", user.id);
  const admin = createAdminClient();
  await admin.from("llm_keys").delete().eq("user_id", user.id);
  return NextResponse.json({ deleted: true });
}
