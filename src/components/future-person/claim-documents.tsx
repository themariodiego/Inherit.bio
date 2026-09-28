"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  DOCUMENTS_HEADING,
  DOCUMENTS_INTRO,
  DOCUMENT_FILE_HINT,
  DOCUMENT_LABELS,
  DOCUMENT_STATUS,
  SEND_FILE_BUTTON,
} from "@/copy/rights/future-person-claim";
import { sniffDocumentType } from "@/lib/future-person/document-sniff";

type Kind = keyof typeof DOCUMENT_LABELS;
type Status = keyof typeof DOCUMENT_STATUS;
const KINDS = Object.keys(DOCUMENT_LABELS) as Kind[];
const MAXIMUM_BYTES = 20_000_000;
const CHUNK_BYTES = 4_000_000;
const POLLS = 60;

function hex(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * The documents step (api.future-person-claim-document-session, then
 * api.evidence-chunk and api.evidence-complete). One file at a time: open a
 * session with the page's one-time nonce, send the file in chunks of at most
 * 4,000,000 bytes, then ask for the outcome until the malware scan answers.
 * The browser never learns a bucket, a key or whether any record exists;
 * the answers are the closed statuses in DOCUMENT_STATUS.
 *
 * Each session spends the page's nonce, so the page is refreshed after one
 * opens and the next file uses the new nonce.
 */
export function ClaimDocuments({ nonce }: { nonce: string }) {
  const router = useRouter();
  const [status, setStatus] = useState<Partial<Record<Kind, Status>>>({});
  const [busy, setBusy] = useState(false);
  const inputs = useRef<Partial<Record<Kind, HTMLInputElement | null>>>({});

  const say = (kind: Kind, value: Status) => setStatus((current) => ({ ...current, [kind]: value }));

  async function send(kind: Kind) {
    const file = inputs.current[kind]?.files?.[0];
    if (!file) return;
    setBusy(true);
    say(kind, "working");
    try {
      if (file.size < 1 || file.size > MAXIMUM_BYTES) return say(kind, "oversize");
      const bytes = new Uint8Array(await file.arrayBuffer());
      const mediaType = sniffDocumentType(bytes);
      if (!mediaType) return say(kind, "type");
      const sha256 = hex(await crypto.subtle.digest("SHA-256", bytes));
      const opened = await fetch("/api/future-person/claim/session/documents", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ documentKind: kind, mediaType, sizeBytes: bytes.length, sha256, nonce }),
      });
      router.refresh();
      if (opened.status === 429) return say(kind, "limited");
      if (opened.status === 404) return say(kind, "expired");
      if (opened.status !== 201) return say(kind, "failed");
      const session = ((await opened.json()) as { session: string }).session;
      const csrf = opened.headers.get("x-inherit-csrf") ?? "";
      const completeNonce = opened.headers.get("x-inherit-complete-nonce") ?? "";
      const chunkCount = Math.ceil(bytes.length / CHUNK_BYTES);
      for (let sequence = 0; sequence < chunkCount; sequence++) {
        const sent = await fetch(`/api/evidence/${session}/chunks/${sequence}`, {
          method: "PUT",
          credentials: "same-origin",
          headers: { "content-type": "application/octet-stream", "x-inherit-csrf": csrf },
          body: bytes.slice(sequence * CHUNK_BYTES, (sequence + 1) * CHUNK_BYTES),
        });
        if (sent.status !== 204) return say(kind, sent.status === 404 ? "expired" : "integrity");
      }
      for (let poll = 0; poll < POLLS; poll++) {
        const done = await fetch(`/api/evidence/${session}/complete`, {
          method: "POST",
          credentials: "same-origin",
          headers: { "content-type": "application/json", "x-inherit-csrf": csrf },
          body: JSON.stringify({ chunkCount, nonce: completeNonce }),
        });
        if (done.status === 201) return say(kind, "received");
        if (done.status === 422) {
          const reason = ((await done.json().catch(() => null)) as { reason?: string } | null)?.reason;
          return say(kind, reason && reason in DOCUMENT_STATUS ? (reason as Status) : "failed");
        }
        if (done.status !== 202) return say(kind, done.status === 404 ? "expired" : "failed");
        say(kind, "scanning");
        await wait(3000);
      }
    } catch {
      say(kind, "failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby="claim-documents" className="space-y-5 rounded-2xl border border-line bg-card p-6">
      <h2 id="claim-documents" className="font-medium">{DOCUMENTS_HEADING}</h2>
      <p className="text-sm leading-relaxed text-ink-muted">{DOCUMENTS_INTRO}</p>
      {KINDS.map((kind) => (
        <div key={kind} className="space-y-2">
          <label htmlFor={`claim-document-${kind}`} className="block text-sm font-medium">
            {DOCUMENT_LABELS[kind]}
          </label>
          <input
            id={`claim-document-${kind}`}
            ref={(element) => { inputs.current[kind] = element; }}
            type="file"
            accept="application/pdf,image/jpeg,image/png"
            aria-describedby={`claim-document-${kind}-hint`}
            className="block min-h-11 w-full text-sm"
          />
          <p id={`claim-document-${kind}-hint`} className="text-sm text-ink-muted">{DOCUMENT_FILE_HINT}</p>
          <Button type="button" disabled={busy} onClick={() => void send(kind)}>
            {status[kind] === "working" ? DOCUMENT_STATUS.working : SEND_FILE_BUTTON}
          </Button>
          {status[kind] && status[kind] !== "working" ? (
            <p role="status" className="text-sm">{DOCUMENT_STATUS[status[kind]!]}</p>
          ) : null}
        </div>
      ))}
    </section>
  );
}
