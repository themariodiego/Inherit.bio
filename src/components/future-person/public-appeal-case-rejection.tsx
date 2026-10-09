"use client";
import { useEffect, useRef, useState } from "react";
import { z } from "zod";

const receipt = z.object({ caseId: z.uuid(), state: z.literal("resolved"), outcome: z.literal("rejected"),
 reviewRevision: z.number().int().positive().safe() }).strict();
export function PublicAppealCaseRejection({ caseId, reviewRevision, csrf, nonce, disabled, onResolved }: {
 caseId: string; reviewRevision: number; csrf: string; nonce: string; disabled: boolean; onResolved: () => void;
}) {
 const [reason, setReason] = useState(""); const [checked, setChecked] = useState(false);
 const [busy, setBusy] = useState(false); const [message, setMessage] = useState("");
 const [unconfirmed, setUnconfirmed] = useState(false); const inFlight = useRef(false);
 const operation = useRef<AbortController | null>(null); const mounted = useRef(true);
 useEffect(() => { mounted.current = true; return () => { mounted.current = false; operation.current?.abort(); }; }, []);
 async function close() {
  if (disabled || busy || unconfirmed || inFlight.current || !checked || [...reason.trim()].length < 20 || [...reason].length > 2000) return;
  inFlight.current = true;
  const abort = new AbortController(); operation.current = abort; setBusy(true);
  const timeout = setTimeout(() => abort.abort(), 20_000);
  try {
   const response = await fetch(`/api/reviews/appeals/${caseId}`, { method: "POST", credentials: "same-origin", signal: abort.signal,
    headers: { "content-type": "application/json", "x-inherit-csrf": csrf },
    body: JSON.stringify({ decision: "reject", reviewRevision, reason, nonce }) });
   const value = receipt.safeParse(await response.json());
   if (abort.signal.aborted || response.status !== 200 || !value.success || value.data.caseId !== caseId || value.data.reviewRevision !== reviewRevision + 1) throw new Error("unavailable");
   if (!abort.signal.aborted) { setReason(""); setChecked(false); onResolved(); }
  } catch { if (mounted.current) { setUnconfirmed(true); setMessage("We could not confirm whether this request was closed. Reload this page and check the current case before trying again."); } }
  finally { clearTimeout(timeout); inFlight.current = false; if (mounted.current) setBusy(false); }
 }
 return <section className="space-y-3 rounded-xl border p-4" aria-busy={busy}>
  <h2>Refuse this request</h2>
  <p>This closes only this request. It does not give access or change anyone&apos;s data.</p>
  <label className="block">Reason<textarea value={reason} maxLength={2000} disabled={disabled || busy || unconfirmed}
   onChange={event => setReason(event.target.value)} /></label>
  <p>Record what you checked. Do not copy file content into the reason.</p>
  <label className="block"><input type="checkbox" checked={checked} disabled={disabled || busy || unconfirmed}
   onChange={event => setChecked(event.target.checked)} /> I have read this request and the files that are here.</label>
  <button type="button" disabled={disabled || busy || unconfirmed || !checked || [...reason.trim()].length < 20}
   onClick={() => void close()}>Refuse request</button>
  {message && <p role="status">{message}</p>}
 </section>;
}
