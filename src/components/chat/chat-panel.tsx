"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { REFUSAL_IDS, refusalFor, type RefusalId } from "@/copy/copilot/refusals";
import { providerDisplayName } from "@/lib/llm";
import { NOT_DIAGNOSTIC } from "@/copy/reports/strings";
import { ConsentDialog } from "./consent-dialog";
import { route } from "@/lib/primary-routes";

export interface ChatProviderInfo {
  configured: boolean;
  provider?: "anthropic" | "openai_compatible";
  providerKey?: string;
  model?: string;
  local?: boolean;
  hasConsent?: boolean;
}

/** chat-completion-v1, as the compatibility branch answers it: no citations and no embryo findings. */
const completion = z.object({ chatId: z.uuid(), message: z.object({ role: z.literal("assistant"),
  content: z.string().max(100_000), citations: z.array(z.never()).max(0), embryoFindings: z.array(z.never()).max(0) }).strict() }).strict();
const refusalBody = z.object({ error: z.string().max(200), provider_key: z.string().max(400).optional() }).passthrough();
type Turn = { id: string; role: "user" | "assistant"; content: string };
type Blocked = { code: string; providerKey?: string };

/**
 * The compatibility panel on `/copilot/[scope]`, for a scope with no canonical
 * Copilot authority. Since 23 October 2026 (owner decision, G8.5) it sends the
 * register's `{ contextToken, message }` to `api.chat`, as `OwnChatPanel`
 * does, in place of the AI SDK transport's `{ id, messages, trigger,
 * messageId }` with a `?scope=` query. The page mints the token for this
 * account, session and subject. This branch keeps no conversation on the
 * server, so each question is sent and answered on its own, and the page is
 * refreshed after each one for a fresh token.
 */
export function ChatPanel({
  info,
  contextToken,
  displayLabel,
}: {
  info: ChatProviderInfo;
  /** The compatibility context token the page minted (src/lib/copilot/compat-chat-token.ts). */
  contextToken: string;
  displayLabel: string;
}) {
  const router = useRouter();
  const [input, setInput] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [pendingQuestion, setPendingQuestion] = useState<string | null>(null);
  const [blocked, setBlocked] = useState<Blocked | null>(null);
  const [consentFor, setConsentFor] = useState<string | null>(null);
  const pending = useRef<AbortController | null>(null);
  useEffect(() => () => { pending.current?.abort(); }, []);
  const busy = pendingQuestion !== null;

  async function submit() {
    const message = input.trim();
    if (!message || busy || pending.current) return;
    const controller = new AbortController();
    pending.current = controller;
    setInput("");
    setBlocked(null);
    setPendingQuestion(message);
    let answer: Turn | null = null;
    try {
      const response = await fetch("/api/chat", {
        method: "POST", credentials: "same-origin", cache: "no-store", redirect: "error",
        headers: { "content-type": "application/json" }, signal: controller.signal,
        body: JSON.stringify({ contextToken, message }),
      });
      if (response.headers.get("content-type")?.includes("application/json") && response.ok) {
        const result = completion.parse(await response.json());
        answer = { id: crypto.randomUUID(), role: "assistant", content: result.message.content };
      } else if (response.ok) {
        // The registered intent-refusal transport (copilot-refusal-v1).
        const refusal = response.headers.get("x-copilot-refusal");
        await response.body?.cancel();
        if (!refusal || !REFUSAL_IDS.includes(refusal as RefusalId)) throw new Error("unexpected_response");
        answer = { id: crypto.randomUUID(), role: "assistant", content: refusalFor(refusal as RefusalId, displayLabel) };
      } else {
        const parsed = refusalBody.safeParse(await response.json().catch(() => null));
        setBlocked({ code: parsed.success ? parsed.data.error : "unknown", providerKey: parsed.success ? parsed.data.provider_key : undefined });
      }
    } catch {
      if (!controller.signal.aborted) setBlocked({ code: "unknown" });
    } finally {
      if (pending.current === controller) pending.current = null;
      if (!controller.signal.aborted) {
        const asked: Turn = { id: crypto.randomUUID(), role: "user", content: message };
        if (answer) setTurns(previous => [...previous, asked, answer!]);
        setPendingQuestion(null);
        // A fresh token for the next question; this panel's state is kept.
        router.refresh();
      }
    }
  }

  const shown: Turn[] = pendingQuestion === null ? turns
    : [...turns, { id: "pending-question", role: "user", content: pendingQuestion }];

  return (
    <div className="rec-stack">
      {/* Data-flow indicator: always visible, names where data goes. */}
      <div
        data-testid="data-flow-indicator"
        className="surface flex flex-wrap items-center gap-2 px-4 py-3 text-sm"
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
            <Link href={route("settings.copilot")} className="prose-link">
              revoke in Settings
            </Link>
            .
          </span>
        ) : (
          <span>No provider configured yet.</span>
        )}
      </div>

      <div className="rec-thread">
        {shown.length === 0 ? (
          <div className="surface-inset surface-pad-sm rec-stack-sm max-w-measure text-sm text-ink">
            <p>
              Ask about your own genome. Try: &ldquo;What does my file say about
              caffeine?&rdquo; &ldquo;Do I carry the alcohol-flush
              variant?&rdquo; &ldquo;Summarize my heart reports.&rdquo;
            </p>
            <p>
              Answers are grounded in your reports and variants via tools, and
              cite their sources. The copilot is informational — never a
              diagnosis.
            </p>
          </div>
        ) : null}
        {shown.map((turn) => (
          <div
            key={turn.id}
            data-role={turn.role === "user" ? "user" : "assistant"}
            className="rec-message"
          >
            <p className="whitespace-pre-wrap">{turn.content}</p>
            {turn.role !== "user" ? <p data-slot="chat-not-diagnostic" className="caption mt-3">{NOT_DIAGNOSTIC}</p> : null}
          </div>
        ))}
        {busy ? (
          <p className="caption">Thinking…</p>
        ) : null}
      </div>

      {blocked?.code === "consent_required" ? (
        <div className="plate">
          <div className="plate-head">
            <p className="text-sm text-ink">
              Before sending data from your genome to a cloud service, Copilot
              needs your clear consent.
            </p>
          </div>
          <div className="plate-body">
            <Button
              size="sm"
              onClick={() => setConsentFor(blocked.providerKey ?? "")}
            >
              Review what would be shared
            </Button>
          </div>
        </div>
      ) : blocked?.code === "no_provider" || blocked?.code === "no_key" ? (
        <div className="plate">
          <div className="plate-head">
            <p className="text-sm text-ink">
              Configure a provider in{" "}
              <Link href={route("settings.copilot")} className="prose-link">
                Settings
              </Link>
              {". "}Add your own Anthropic key, or connect a model that runs on
              your computer for more privacy.
            </p>
          </div>
        </div>
      ) : blocked ? (
        <p role="alert" className="text-sm text-danger">
          The copilot request failed. Check your provider settings and try
          again.
        </p>
      ) : null}

      <form
        className="rec-composer"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <Textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void submit();
            }
          }}
          maxLength={8000}
          placeholder="Ask about your genome…"
          aria-label="Message the copilot"
          rows={1}
        />
        <Button
          type="submit"
          disabled={busy}
        >
          Send
        </Button>
      </form>

      <ConsentDialog
        providerKey={consentFor ?? ""}
        open={consentFor !== null}
        onGranted={() => {
          setConsentFor(null);
          setBlocked(null);
        }}
        onCancel={() => setConsentFor(null)}
      />
    </div>
  );
}
