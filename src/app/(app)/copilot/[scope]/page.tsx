import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChatPanel, type ChatProviderInfo } from "@/components/chat/chat-panel";
import { isLocalBaseUrl, providerKeyFor } from "@/lib/llm";
import { resolveSubjectForAccount } from "@/lib/subjects";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Copilot" };

const EXAMPLE_QUESTIONS = [
  "What does my caffeine result mean?",
  "Do I carry the alcohol flush variant?",
  "Which of my reports have the strongest evidence?",
];

export default async function ChatPage(
  props: PageProps<"/copilot/[scope]">,
) {
  const { scope } = await props.params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) notFound();
  const subject = await resolveSubjectForAccount(user.id, scope);
  if (!subject) notFound();
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
        <h1 className="display text-3xl">Ask about {subject.displayLabel}</h1>
      </div>
      {!info.configured ? (
        <div
          data-testid="local-mode-instructions"
          className="space-y-5 rounded-2xl border border-line bg-card p-6 text-sm"
        >
          <div className="space-y-3">
            <p className="text-base leading-relaxed">
              Ask questions about your own reports in plain language —{" "}
              <em>&ldquo;What does my caffeine result mean?&rdquo;</em> — and
              get answers grounded in your data.
            </p>
            <ul aria-label="Example questions" className="space-y-1.5">
              {EXAMPLE_QUESTIONS.map((q) => (
                <li
                  key={q}
                  className="border-l-2 border-line pl-3 text-xs italic text-ink-muted"
                >
                  &ldquo;{q}&rdquo;
                </li>
              ))}
            </ul>
            <p className="text-xs text-ink-muted">
              Questions like these become askable as soon as an AI is
              connected.
            </p>
          </div>

          <div className="space-y-4 border-t border-line pt-5">
            <p>
              To answer, the copilot needs an AI — Inherit doesn&rsquo;t
              bundle one, so you decide which AI (if any) ever sees your
              questions. <strong>Connecting an AI is a one-time technical
              step.</strong>
            </p>

            <div className="space-y-2">
              <h2 className="font-medium">Easiest: use an AI service</h2>
              <ol className="list-decimal space-y-2 pl-5">
                <li>
                  Create an Anthropic API key at{" "}
                  <a
                    href="https://console.anthropic.com"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline underline-offset-2"
                  >
                    console.anthropic.com
                  </a>
                  .
                </li>
                <li>
                  Paste it in{" "}
                  <Link
                    href="/settings/copilot"
                    className="underline underline-offset-2"
                  >
                    Settings → Copilot provider
                  </Link>{" "}
                  and save. (Claude Sonnet 5 by default, Opus 5 selectable.)
                </li>
              </ol>
              <p className="text-ink-muted">
                An API key is like a password. It lets Inherit send{" "}
                <strong>your</strong> questions to the AI service you chose. We
                ask for your explicit consent each time. A question typically
                costs pennies. Before Inherit sends any genome-derived data, a
                consent dialog names the provider and exact data classes. You
                can revoke the grant at any time.
              </p>
            </div>

            <details className="rounded-xl border border-line p-4">
              <summary className="cursor-pointer font-medium">
                Advanced: run a private AI on your own computer (most private)
              </summary>
              <p className="mt-3 leading-relaxed text-ink-muted">
                For the privacy-preferred option, run{" "}
                <a
                  href="https://ollama.com"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline underline-offset-2"
                >
                  Ollama
                </a>{" "}
                or LM Studio on your machine. Then choose
                &ldquo;OpenAI-compatible&rdquo; in Settings. Use the base URL{" "}
                <code className="rounded bg-tint px-1.5 py-0.5 font-mono text-xs">
                  http://localhost:11434/v1
                </code>{" "}
                and a model such as{" "}
                <code className="rounded bg-tint px-1.5 py-0.5 font-mono text-xs">
                  llama3.1
                </code>
                . Nothing about your genome ever leaves your infrastructure.
                Local endpoints require Inherit to run locally or be
                self-hosted on the same network. The hosted demo cannot reach
                your localhost.
              </p>
            </details>
          </div>

          <p>
            <Link href="/settings/copilot" className="underline underline-offset-2">
              Open Settings →
            </Link>
          </p>
        </div>
      ) : (
        <ChatPanel info={info} scope={subject.routeSegment} />
      )}
    </div>
  );
}
