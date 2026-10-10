"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { RECORD_KEY_CARDS_HEADING, RECORD_KEY_CARDS_NOTE, cardDateNote } from "@/copy/embryos/upload";
import type { RecordKeyCardControl } from "@/lib/embryos/record-key-card-controls";
import { readRecordKeyCardReceipt, type RecordKeyCardReceipt } from "@/lib/embryos/record-key-card-receipt";

export function RecordKeyCards({ control }: { control: RecordKeyCardControl }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false), [refreshing, startRefresh] = useTransition();
  const [attempted, setAttempted] = useState(false), [receipt, setReceipt] = useState<RecordKeyCardReceipt | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const submitting = useRef(false);
  function refresh() { setReceipt(null); startRefresh(() => router.refresh()); }
  async function collect() {
    if (busy || refreshing || attempted || submitting.current) return;
    submitting.current = true;
    setAttempted(true); setBusy(true); setMessage(null);
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 20_000);
    try {
      const response = await fetch(`/api/embryo-cohorts/${control.cohortId}/record-key-cards`, {
        method: "POST", credentials: "same-origin", cache: "no-store", referrerPolicy: "no-referrer",
        signal: controller.signal, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ nonce: control.nonce }),
      });
      const next = readRecordKeyCardReceipt(response.status, await response.json(), control);
      if (next) setReceipt(next);
      else setMessage("We could not confirm the cards. Refresh this page to check.");
    } catch { setMessage("We could not confirm the cards. Refresh this page to check."); }
    finally { clearTimeout(timer); setBusy(false); }
  }
  return <article data-slot="record-key-card-control" data-cohort-id={control.cohortId}
    className="space-y-3 rounded-xl border border-line p-4">
    {receipt ? <section data-slot="own-record-key-cards" aria-label={RECORD_KEY_CARDS_HEADING} className="space-y-3">
      <p className="text-sm">{RECORD_KEY_CARDS_NOTE}</p>
      <ul className="space-y-3">{receipt.record_key_cards.map(card => <li key={card.embryo_id}
        data-slot="record-key-card" data-embryo-id={card.embryo_id} className="space-y-1 rounded-xl border border-line p-4">
        <h3 className="font-medium">{card.display_label}</h3>
        <p data-slot="record-key-value" className="break-all font-mono text-sm">{card.record_key}</p>
        <p className="break-all text-sm">{card.claim_url}</p>
        <p className="text-sm">{cardDateNote(card.closing_date_words, card.closing_date_state === "provisional_until_terminal_ordinal_resolution")}</p>
      </li>)}</ul>
      <Button type="button" variant="outline" onClick={() => window.print()}>Print</Button>
      <Button type="button" disabled={refreshing} onClick={refresh}>Continue</Button>
    </section> : <>
      <p className="text-sm">You have {control.cardCount} {control.cardCount === 1 ? "card" : "cards"} to collect for this group.</p>
      <p className="text-sm text-ink-muted">The cards show once. Be ready to print or copy them. Analysis does not need to start first.</p>
      <Button type="button" disabled={busy || refreshing || attempted} onClick={collect}>{busy ? "Working…" : "Show my cards"}</Button>
      {attempted && !busy ? <Button type="button" variant="outline" disabled={refreshing} onClick={refresh}>Refresh</Button> : null}
    </>}
    {message ? <p role="status" className="text-sm">{message}</p> : null}
  </article>;
}
