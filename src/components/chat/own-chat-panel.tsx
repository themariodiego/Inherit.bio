"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import { REFUSAL_IDS, refusalFor, type RefusalId } from "@/copy/copilot/refusals";
import { NOT_DIAGNOSTIC } from "@/copy/reports/strings";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { providerDisplayName } from "@/lib/llm";
import type { ChatProviderInfo } from "./chat-panel";
import { route } from "@/lib/primary-routes";
import { OWN_CHAT_CORRECTION_NOTICE, ownChatCorrectionSchema } from "@/lib/copilot/own-chat-correction";

const citation = z.object({ id: z.string().min(1).max(2000), label: z.string().min(1).max(100_000),
  href: z.string().max(4000).refine(value => {
    if (value.startsWith("/") && !value.startsWith("//") && !value.includes("\\")) return true;
    try { const url = new URL(value); return url.protocol === "https:" && !url.username && !url.password; }
    catch { return false; }
  }),
}).strict();
const content = z.object({ role: z.literal("assistant"), content: z.string().max(100_000),
  citations: z.array(citation).max(100), embryoFindings: z.array(z.never()).max(0),
}).strict();
const completion = z.object({ chatId: z.uuid(), message: content }).strict();
const history = z.object({ chatId: z.uuid(), correction: ownChatCorrectionSchema.optional(), scope: z.object({ kind: z.enum(["self", "family"]),
  displayLabel: z.string().max(200) }).strict(), messages: z.array(z.object({
  id: z.uuid(), role: z.enum(["user", "assistant"]), content: z.string().max(100_000),
  citations: z.array(citation).max(100), embryoFindings: z.array(z.never()).max(0),
  createdAt: z.iso.datetime(),
}).strict()).max(200) }).strict();
type DisplayMessage = { id: string; role: "user" | "assistant"; content: string;
  citations: z.infer<typeof citation>[] };

const OWN_THREAD_HINT = "Ask about your own file or a report you chose. Answers explain what was found, its sources, and what remains unknown.";

/**
 * Only the newest plain-text question crosses this boundary. The server owns
 * history. The Family group scope reuses this panel with its own hint and
 * placeholder; its history must come back as a `family` scope.
 */
export function OwnChatPanel({ contextToken, info, chats, displayLabel, scopeKind = "self", threadHint = OWN_THREAD_HINT,
  placeholder = "Ask about your genome…" }: {
  contextToken: string; info: ChatProviderInfo; displayLabel: string;
  chats: { id: string; createdAt: string }[];
  scopeKind?: "self" | "family"; threadHint?: string; placeholder?: string;
}) {
  const router = useRouter();
  const [input, setInput] = useState("");
  const [chatId, setChatId] = useState<string | null>(null);
  const [usedToken, setUsedToken] = useState<string | null>(null);
  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [correction, setCorrection] = useState(false);
  const pending = useRef<AbortController | null>(null);
  useEffect(() => () => { pending.current?.abort(); }, []);
  const awaitingContext = !correction && chatId === null && usedToken === contextToken;

  async function submit() {
    const message = input.trim();
    if (!message || busy || correction || awaitingContext || pending.current) return;
    const controller = new AbortController();
    pending.current = controller;
    setBusy(true); setError(null);
    if (!chatId) setUsedToken(contextToken);
    try {
      const response = await fetch("/api/chat", {
        method: "POST", credentials: "same-origin", cache: "no-store", redirect: "error",
        headers: { "content-type": "application/json" }, signal: controller.signal,
        body: JSON.stringify(chatId ? { chatId, message } : { contextToken, message }),
      });
      if (!response.ok) {
        if (response.status === 409) {
          const blocked = ownChatCorrectionSchema.safeParse(await response.clone().json().catch(() => null));
          if (blocked.success) {
            await response.body?.cancel();
            if (!controller.signal.aborted) setCorrection(true);
            return;
          }
        }
        await response.body?.cancel();
        if ([401, 403, 404, 409].includes(response.status)) {
          setMessages([]); setChatId(null);
          setError("Your files or permissions changed. Review your Copilot settings before asking again.");
          router.refresh();
          return;
        }
        throw new Error("request_failed");
      }
      let answer: DisplayMessage;
      if (response.headers.get("content-type")?.includes("application/json")) {
        const result = completion.parse(await response.json());
        if (chatId && result.chatId !== chatId) throw new Error("unexpected_chat");
        setChatId(result.chatId);
        answer = { id: crypto.randomUUID(), ...result.message };
      } else {
        // The registered intent-refusal transport creates no conversation or stored user turn.
        const refusal = response.headers.get("x-copilot-refusal");
        await response.body?.cancel();
        if (!refusal || !REFUSAL_IDS.includes(refusal as RefusalId)) throw new Error("unexpected_response");
        answer = { id: crypto.randomUUID(), role: "assistant", citations: [],
          content: refusalFor(refusal as RefusalId, displayLabel) };
        if (!chatId) router.refresh();
      }
      if (controller.signal.aborted) return;
      setMessages(previous => [...previous,
        { id: crypto.randomUUID(), role: "user", content: message, citations: [] }, answer]);
      setInput("");
    } catch {
      if (!controller.signal.aborted) {
        setError("Copilot could not finish this question. Check your settings and try again.");
        if (!chatId) router.refresh();
      }
    } finally {
      if (!controller.signal.aborted) setBusy(false);
      if (pending.current === controller) pending.current = null;
    }
  }

  async function openConversation(id: string) {
    if (busy || pending.current) return;
    const controller = new AbortController();
    pending.current = controller;
    setBusy(true); setError(null); setMessages([]); setChatId(null);
    try {
      const response = await fetch(`/api/chats/${encodeURIComponent(id)}`, {
        credentials: "same-origin", cache: "no-store", redirect: "error", signal: controller.signal,
      });
      if (!response.ok) { await response.body?.cancel(); throw new Error("history_unavailable"); }
      const result = history.parse(await response.json());
      if (result.chatId !== id || result.scope.kind !== scopeKind || result.scope.displayLabel !== displayLabel) throw new Error("unexpected_chat");
      if (controller.signal.aborted) return;
      setChatId(id); setMessages(result.messages); setInput(""); setCorrection(Boolean(result.correction));
    } catch {
      if (!controller.signal.aborted) {
        setError("This conversation is no longer available with your current permissions.");
        router.refresh();
      }
    } finally {
      if (!controller.signal.aborted) setBusy(false);
      if (pending.current === controller) pending.current = null;
    }
  }

  return (
    <div className="rec-stack">
      <div data-testid="data-flow-indicator" className="surface rec-stack-sm px-4 py-3 text-sm">
        <p>{info.local ? <><strong>Local mode:</strong> questions and permitted data go to your own endpoint ({info.providerKey}).</>
          : <><strong>Cloud mode:</strong> questions and permitted data go to {providerDisplayName(info.providerKey ?? "")} ({info.model}).</>}</p>
        <Link href={route("settings.copilot")} className="link-target quiet-link">Review or withdraw permission</Link>
      </div>
      <div className="flex flex-wrap items-start gap-3 text-sm">
        <Button type="button" variant="outline" disabled={busy || correction} onClick={() => {
          setChatId(null); setMessages([]); setInput(""); setError(null); router.refresh();
        }}>New conversation</Button>
        {chats.length > 0 ? <details>
          <summary className="quiet-link py-2">Past conversations</summary>
          <ul className="rec-stack-sm py-2">{chats.map(chat => <li key={chat.id}>
            <Button type="button" variant="outline" disabled={busy} onClick={() => { void openConversation(chat.id); }}>
              Conversation from <time dateTime={chat.createdAt}>{new Date(chat.createdAt).toISOString().slice(0, 16).replace("T", " ")} UTC</time>
            </Button>
          </li>)}</ul>
        </details> : null}
      </div>
      {correction ? <p role="status" data-slot="chat-scientific-correction" className="surface-inset surface-pad-sm max-w-measure text-sm text-ink">
        {OWN_CHAT_CORRECTION_NOTICE}
      </p> : null}
      <div className="rec-thread" aria-live="polite" aria-busy={busy}>
        {messages.length === 0 ? <p className="surface-inset surface-pad-sm max-w-measure text-sm text-ink">
          {threadHint}
        </p> : null}
        {messages.map(message => <div key={message.id} data-role={message.role} className="rec-message">
          <p className="whitespace-pre-wrap break-words">{message.content}</p>
          {message.citations.length > 0 ? <ul aria-label="Sources" className="rec-stack-sm mt-3 text-sm">{message.citations.map(source =>
            <li key={source.id}><a href={source.href} rel="noreferrer" className="link-target prose-link break-words">{source.label}</a></li>)}</ul> : null}
          {message.role === "assistant" ? <p data-slot="chat-not-diagnostic" className="caption mt-3">{NOT_DIAGNOSTIC}</p> : null}
        </div>)}
        {busy ? <p className="caption">Checking your question…</p> : null}
      </div>
      {error ? <p role="alert" className="text-sm text-danger">{error}</p> : null}
      {awaitingContext && !busy ? <p role="status" className="caption">Checking your permission…</p> : null}
      <form className="rec-composer" onSubmit={event => { event.preventDefault(); void submit(); }}>
        <Textarea value={input} onChange={event => setInput(event.target.value)} maxLength={8000} disabled={busy || correction || awaitingContext}
          onKeyDown={event => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
            event.preventDefault(); void submit();
          } }} placeholder={placeholder} aria-label="Message the copilot" rows={1} />
        <Button type="submit" disabled={busy || correction || awaitingContext || !input.trim()}>Send</Button>
      </form>
    </div>
  );
}
