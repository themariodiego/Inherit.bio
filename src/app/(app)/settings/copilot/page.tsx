import type { Metadata } from "next";
import Link from "next/link";
import { LlmSettingsForm } from "@/components/settings/llm-settings-form";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Copilot settings" };

export default async function CopilotSettingsPage() {
  const supabase = await createClient();
  const { data: llm } = await supabase.from("llm_settings").select("provider, base_url, model, key_last4").maybeSingle();
  return (
    <div className="mx-auto max-w-2xl space-y-8">
      <header className="space-y-2"><p className="eyebrow">Settings</p><h1 className="display text-3xl">Copilot model</h1></header>
      <LlmSettingsForm current={llm ? { provider: llm.provider as "anthropic" | "openai_compatible", base_url: llm.base_url, model: llm.model, key_last4: llm.key_last4 } : null} />
      <Link href="/settings" className="text-sm underline underline-offset-2">← Settings</Link>
    </div>
  );
}
