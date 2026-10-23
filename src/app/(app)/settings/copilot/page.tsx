import { OwnCopilotPermission } from "@/components/settings/own-copilot-permission";
import { prepareOwnCopilotPermission } from "@/lib/copilot/own-consent";
import { modelRuntime } from "@/lib/copilot/model-endpoint";
import type { Metadata } from "next";
import Link from "next/link";
import { LlmSettingsForm } from "@/components/settings/llm-settings-form";
import { createClient } from "@/lib/supabase/server";
import { pageOperationNonce } from "@/lib/person-operation-nonce";
import { route } from "@/lib/primary-routes";

export const metadata: Metadata = { title: "Copilot settings" };

export default async function CopilotSettingsPage() {
  const supabase = await createClient();
  const { data: llm } = await supabase.from("llm_settings").select("provider, base_url, model, key_last4").maybeSingle();
  const permission = await prepareOwnCopilotPermission();
  const runtime = modelRuntime();
  // The one-time nonce the removal consumes (api.llm-settings DELETE, G8.5):
  // rendered here for this account and session, stored nowhere.
  const removeNonce = llm ? await pageOperationNonce("provider_setting_delete", accountId => accountId) : null;
  return (
    <div className="page-stack rec-column stack-sections">
      <header className="rec-head">
        <p className="eyebrow">Settings</p>
        <h1 className="display">Copilot model</h1>
      </header>
      <LlmSettingsForm localAvailable={runtime.localAllowed} localOrigins={runtime.localAllowed ? runtime.origins : []}
        removeNonce={removeNonce}
        current={llm ? { provider: llm.provider as "anthropic" | "openai_compatible", base_url: llm.base_url, model: llm.model, key_last4: llm.key_last4 } : null} />
      <OwnCopilotPermission view={permission} />
      <p className="text-sm"><Link href={route("settings.index")} className="link-target quiet-link">← Settings</Link></p>
    </div>
  );
}
