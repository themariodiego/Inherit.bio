"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import { REFUSAL_IDS, refusalFor, type RefusalId } from "@/copy/copilot/refusals";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { providerDisplayName } from "@/lib/llm";
import type { ChatProviderInfo } from "./chat-panel";

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
const history = z.object({ chatId: z.uuid(), scope: z.object({ kind: z.literal("self"),
  displayLabel: z.string().max(200) }).strict(), messages: z.array(z.object({
  id: z.uuid(), role: z.enum(["user", "assistant"]), content: z.string().max(100_000),
  citations: z.array(citation).max(100), embryoFindings: z.array(z.never()).max(0),
  createdAt: z.iso.datetime(),
}).strict()).max(200) }).strict();
type DisplayMessage = { id: string; role: "user" | "assistant"; content: string;
  citations: z.infer<typeof citation>[] };

/** Only the newest plain-text question crosses this boundary. The server owns history. */
export function OwnChatPanel({ contextToken, info, chats, displayLabel }: {
  contextToken: string; info: ChatProviderInfo; displayLabel: string;
  chats: { id: string; createdAt: string }[];
}) {
  const router = useRouter();
  const [input, setInput] = useState("");
  const [chatId, setChatId] = useState<string | null>(null);
  const [usedToken, setUsedToken] = useState<string | null>(null);
  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pending = useRef<AbortController | null>(null);
  useEffect(() => () => { pending.current?.abort(); }, []);
  const awaitingContext = chatId === null && usedToken === contextToken;

  async function submit() {
    const message = input.trim();
    if (!message || busy || awaitingContext || pending.current) return;
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
      if (result.chatId !== id || result.scope.displayLabel !== displayLabel) throw new Error("unexpected_chat");
      if (controller.signal.aborted) return;
      setChatId(id); setMessages(result.messages); setInput("");
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
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <div data-testid="data-flow-indicator" className="rounded-xl border border-line bg-card px-4 py-3 text-sm">
        <p>{info.local ? <><strong>Local mode:</strong> questions and permitted data go to your own endpoint ({info.providerKey}).</>
          : <><strong>Cloud mode:</strong> questions and permitted data go to {providerDisplayName(info.providerKey ?? "")} ({info.model}).</>}</p>
        <Link href="/settings/copilot" className="underline underline-offset-2">Review or withdraw permission</Link>
      </div>
      <div className="flex flex-wrap items-start gap-3 text-sm">
        <Button type="button" variant="outline" disabled={busy} onClick={() => {
          setChatId(null); setMessages([]); setInput(""); setError(null); router.refresh();
        }}>New conversation</Button>
        {chats.length > 0 ? <details>
          <summary className="cursor-pointer py-2">Past conversations</summary>
          <ul className="space-y-2 py-2">{chats.map(chat => <li key={chat.id}>
            <Button type="button" variant="outline" disabled={busy} onClick={() => { void openConversation(chat.id); }}>
              Conversation from <time dateTime={chat.createdAt}>{new Date(chat.createdAt).toISOString().slice(0, 16).replace("T", " ")} UTC</time>
            </Button>
          </li>)}</ul>
        </details> : null}
      </div>
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1" aria-live="polite" aria-busy={busy}>
        {messages.length === 0 ? <p className="rounded-xl border border-line bg-card p-5 text-sm text-ink-muted">
          Ask about your own file or a report you chose. Answers explain what was found, its sources, and what remains unknown.
        </p> : null}
        {messages.map(message => <div key={message.id} className={message.role === "user"
          ? "ml-auto max-w-[85%] rounded-2xl bg-forest px-4 py-3 text-sm text-on-forest"
          : "max-w-[85%] rounded-2xl border border-line bg-card px-4 py-3 text-sm"}>
          <p className="whitespace-pre-wrap break-words leading-relaxed">{message.content}</p>
          {message.citations.length > 0 ? <ul aria-label="Sources" className="mt-3 space-y-2">{message.citations.map(source =>
            <li key={source.id}><a href={source.href} rel="noreferrer" className="break-words underline underline-offset-2">{source.label}</a></li>)}</ul> : null}
        </div>)}
        {busy ? <p className="text-sm text-ink-muted">Checking your question…</p> : null}
      </div>
      {error ? <p role="alert" className="text-sm text-danger">{error}</p> : null}
      {awaitingContext && !busy ? <p role="status" className="text-sm text-ink-muted">Refreshing your permission check…</p> : null}
      <form className="flex items-end gap-2" onSubmit={event => { event.preventDefault(); void submit(); }}>
        <Textarea value={input} onChange={event => setInput(event.target.value)} maxLength={8000} disabled={busy || awaitingContext}
          onKeyDown={event => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
            event.preventDefault(); void submit();
          } }} placeholder="Ask about your genome…" aria-label="Message the copilot" rows={2} className="min-h-0 resize-none" />
        <Button type="submit" disabled={busy || awaitingContext || !input.trim()}>Send</Button>
      </form>
    </div>
  );
}
