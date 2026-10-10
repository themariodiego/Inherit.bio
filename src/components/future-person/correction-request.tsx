"use client";
import { useState, type FormEvent } from "react";
import { z } from "zod";
const fields = [
  ["display-label", "Record label"], ["disposition-record", "Disposition record"],
  ["identity-match-profile", "Identity match"], ["report-provenance", "Report source"],
  ["variant-call-source", "Variant source"],
] as const;
const receipt = z.object({ status: z.literal("review_pending"), correctionId: z.uuid() }).strict();
export function CorrectionRequestForm({ csrf, nonce, ownStatementDownloadsEnabled=false }: { csrf: string; nonce: string; ownStatementDownloadsEnabled?:boolean }) {
  const [field, setField] = useState<string>(fields[0][0]);
  const [statement, setStatement] = useState("");
  const [busy, setBusy] = useState(false), [done, setDone] = useState(false);
  const [message, setMessage] = useState("");
  const [correctionId, setCorrectionId] = useState<string | null>(null);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (busy || done) return;
    setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/future-person/claim/session/corrections", {
        method: "POST", credentials: "same-origin", cache: "no-store",
        headers: { "Content-Type": "application/json", "X-Inherit-CSRF": csrf },
        body: JSON.stringify({ field, statement, nonce }),
      });
      const parsed = receipt.safeParse(await response.json());
      if (response.status !== 202 || !parsed.success) throw new Error("unavailable");
      setStatement(""); setDone(true); setCorrectionId(parsed.data.correctionId);
      setMessage("Your request is ready for review. The request does not change your record. You will receive a receipt email.");
    } catch { setMessage("The request could not be confirmed. Open a new session before you try again."); }
    finally { setBusy(false); }
  }
  return <section className="mx-auto max-w-3xl px-6 pb-16">
    <h2 className="display text-2xl">Ask for a change</h2>
    <p className="mt-4 max-w-prose text-ink-muted">A named reviewer will check your request. You do not need permission from a parent. The reviewer can read your statement. The review must finish within 30 days.</p>
    {!done && <form className="mt-6" onSubmit={submit}>
      <fieldset disabled={busy}>
        <label className="block">What do you want to change?
          <select className="mt-2 block w-full rounded border p-3" value={field} onChange={event => setField(event.target.value)}>
            {fields.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
        <label className="mt-4 block">What change do you want? Use 20 to 4,000 characters.
          <textarea className="mt-2 block w-full rounded border p-3" rows={6} required value={statement}
            onChange={event => setStatement(event.target.value)} autoComplete="off" spellCheck={false}/>
        </label>
        <button className="mt-4 rounded-full bg-forest px-6 py-3 text-on-forest disabled:opacity-50"
          disabled={busy || [...statement.trim()].length < 20 || [...statement.trim()].length > 4000}>Send the request</button>
      </fieldset>
    </form>}
    {ownStatementDownloadsEnabled && done && correctionId && <a className="mt-4 inline-block underline" href={`/api/future-person/claim/session/corrections/${correctionId}/statement`} download>Download my statement</a>}
    <p className="mt-4" role="status" aria-live="polite">{message}</p>
  </section>;
}
