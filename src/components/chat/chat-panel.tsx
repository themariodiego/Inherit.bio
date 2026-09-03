"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { providerDisplayName } from "@/lib/llm";
import { ConsentDialog } from "./consent-dialog";

export interface ChatProviderInfo {
  configured: boolean;
  provider?: "anthropic" | "openai_compatible";
  providerKey?: string;
  model?: string;
  local?: boolean;
  hasConsent?: boolean;
}

function extractErrorCode(err: Error): { code: string; providerKey?: string } {
  try {
    const parsed = JSON.parse(err.message) as {
      error?: string;
      provider_key?: string;
    };
    return { code: parsed.error ?? "unknown", providerKey: parsed.provider_key };
  } catch {
    return { code: "unknown" };
  }
}

export function ChatPanel({
  info,
  scope,
}: {
  info: ChatProviderInfo;
  scope: string;
}) {
  const [input, setInput] = useState("");
  const [consentFor, setConsentFor] = useState<string | null>(null);
  const { messages, sendMessage, status, error, clearError } = useChat({
    transport: new DefaultChatTransport({
      api: `/api/chat?scope=${encodeURIComponent(scope)}`,
    }),
  });

  const errorCode = error ? extractErrorCode(error) : null;

  const submit = () => {
    const text = input.trim();
    if (!text || status === "streaming" || status === "submitted") return;
    setInput("");
    void sendMessage({ text });
  };

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      {/* Data-flow indicator: always visible, names where data goes. */}
      <div
        data-testid="data-flow-indicator"
        className="flex flex-wrap items-center gap-2 rounded-xl border border-line bg-card px-4 py-2.5 text-xs"
      >
        <span
          aria-hidden
          className={`size-2 rounded-full ${info.local ? "bg-ok" : "bg-forest"}`}
        />
        {info.local ? (
          <span>
            <strong>Local mode:</strong> conversations and genome data go only
            to your own endpoint ({info.providerKey}) — nothing leaves your
            infrastructure.
          </span>
        ) : info.configured ? (
          <span>
            <strong>Cloud mode:</strong> genome-derived answers are sent to{" "}
            {providerDisplayName(info.providerKey ?? "")} ({info.model}) under
            your consent grant —{" "}
            <Link href="/settings/copilot" className="underline underline-offset-2">
              revoke in Settings
            </Link>
            .
          </span>
        ) : (
          <span>No provider configured yet.</span>
        )}
      </div>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
        {messages.length === 0 ? (
          <div className="rounded-2xl border border-line bg-card p-5 text-sm text-ink-muted">
            <p>
              Ask about your own genome. Try: &ldquo;What does my file say about
              caffeine?&rdquo; &ldquo;Do I carry the alcohol-flush
              variant?&rdquo; &ldquo;Summarize my heart reports.&rdquo;
            </p>
            <p className="mt-2">
              Answers are grounded in your reports and variants via tools, and
              cite their sources. The copilot is informational — never a
              diagnosis.
            </p>
          </div>
        ) : null}
        {messages.map((m) => (
          <div
            key={m.id}
            className={
              m.role === "user"
                ? "ml-auto max-w-[85%] rounded-2xl bg-forest px-4 py-2.5 text-sm text-on-forest"
                : "max-w-[85%] rounded-2xl border border-line bg-card px-4 py-2.5 text-sm"
            }
          >
            {m.parts.map((part, i) => {
              if (part.type === "text") {
                return (
                  <p key={i} className="whitespace-pre-wrap leading-relaxed">
                    {part.text}
                  </p>
                );
              }
              if (part.type.startsWith("tool-")) {
                const label = part.type.replace("tool-", "");
                return (
                  <p
                    key={i}
                    className="my-1 font-mono text-[11px] text-ink-muted"
                  >
                    ⚙ {label}
                    {"state" in part && part.state === "output-available"
                      ? " ✓"
                      : "…"}
                  </p>
                );
              }
              return null;
            })}
          </div>
        ))}
        {status === "submitted" ? (
          <p className="text-xs text-ink-muted">Thinking…</p>
        ) : null}
      </div>

      {errorCode?.code === "consent_required" ? (
        <div className="rounded-xl border border-line bg-tint p-4 text-sm">
          <p>
            Before sending data from your genome to a cloud service, Copilot
            needs your clear consent.
          </p>
          <Button
            size="sm"
            className="mt-2"
            onClick={() => setConsentFor(errorCode.providerKey ?? "")}
          >
            Review what would be shared
          </Button>
        </div>
      ) : errorCode?.code === "no_provider" || errorCode?.code === "no_key" ? (
        <div className="rounded-xl border border-line bg-tint p-4 text-sm">
          <p>
            Configure a provider in{" "}
            <Link href="/settings/copilot" className="underline underline-offset-2">
              Settings
            </Link>
            {". "}Add your own Anthropic key, or connect a model that runs on
            your computer for more privacy.
          </p>
        </div>
      ) : error ? (
        <p role="alert" className="text-sm text-danger">
          The copilot request failed. Check your provider settings and try
          again.
        </p>
      ) : null}

      <form
        className="flex items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <Textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          placeholder="Ask about your genome…"
          aria-label="Message the copilot"
          rows={2}
          className="min-h-0 resize-none"
        />
        <Button
          type="submit"
          disabled={status === "streaming" || status === "submitted"}
        >
          Send
        </Button>
      </form>

      <ConsentDialog
        providerKey={consentFor ?? ""}
        open={consentFor !== null}
        onGranted={() => {
          setConsentFor(null);
          clearError();
        }}
        onCancel={() => setConsentFor(null)}
      />
    </div>
  );
}
