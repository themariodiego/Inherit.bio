import type { Metadata } from "next";
import Link from "next/link";
import { ChatPanel, type ChatProviderInfo } from "@/components/chat/chat-panel";
import { isLocalBaseUrl, providerKeyFor } from "@/lib/llm";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Copilot" };

export default async function ChatPage() {
  const supabase = await createClient();
  const { data: settings } = await supabase
    .from("llm_settings")
    .select("provider, base_url, model")
    .maybeSingle();

  let info: ChatProviderInfo = { configured: false };
  if (settings) {
    const providerKey = providerKeyFor(
      settings.provider as "anthropic" | "openai_compatible",
      settings.base_url,
    );
    const local =
      settings.provider === "openai_compatible" &&
      settings.base_url != null &&
      isLocalBaseUrl(settings.base_url);
    const { data: grant } = await supabase
      .from("consent_grants")
      .select("id")
      .eq("provider_key", providerKey)
      .is("revoked_at", null)
      .maybeSingle();
    info = {
      configured: true,
      provider: settings.provider as "anthropic" | "openai_compatible",
      providerKey,
      model: settings.model,
      local,
      hasConsent: Boolean(grant),
    };
  }

  return (
    <div className="mx-auto flex h-[calc(100vh-8rem)] max-w-3xl flex-col">
      <div className="mb-4">
        <p className="eyebrow mb-2">Copilot</p>
        <h1 className="display text-3xl">Ask your genome</h1>
      </div>
      {!info.configured ? (
        <div
          data-testid="local-mode-instructions"
          className="space-y-4 rounded-2xl border border-line bg-card p-6 text-sm"
        >
          <p>
            The copilot is bring-your-own-model. Two ways to start, the
            private one first:
          </p>
          <ol className="list-decimal space-y-3 pl-5">
            <li>
              <strong>Local model (privacy-preferred).</strong> Run{" "}
              <a
                href="https://ollama.com"
                target="_blank"
                rel="noopener noreferrer"
                className="underline underline-offset-2"
              >
                Ollama
              </a>{" "}
              or LM Studio on your machine, then in Settings choose
              &ldquo;OpenAI-compatible&rdquo; with base URL{" "}
              <code className="rounded bg-tint px-1.5 py-0.5 font-mono text-xs">
                http://localhost:11434/v1
              </code>{" "}
              and a model such as{" "}
              <code className="rounded bg-tint px-1.5 py-0.5 font-mono text-xs">
                llama3.1
              </code>
              . Nothing about your genome ever leaves your infrastructure.
              (Local endpoints require running Inherit itself locally or
              self-hosted on the same network — the hosted demo cannot reach
              your localhost.)
            </li>
            <li>
              <strong>Cloud model with your own key.</strong> Add your
              Anthropic API key in Settings (Claude Sonnet 5 by default,
              Opus 5 selectable). Before any genome-derived data is sent, a
              consent dialog will name the provider and the exact data
              classes; the grant is revocable any time.
            </li>
          </ol>
          <p>
            <Link href="/settings" className="underline underline-offset-2">
              Open Settings →
            </Link>
          </p>
        </div>
      ) : (
        <ChatPanel info={info} />
      )}
    </div>
  );
}
