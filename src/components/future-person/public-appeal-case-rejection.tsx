"use client";
import { useEffect, useRef, useState } from "react";
import { z } from "zod";

const receipt = z.union([z.object({ caseId: z.uuid(), state: z.literal("resolved"), outcome: z.enum(["rejected", "upheld", "prior_decision_reversed"]),
 reviewRevision: z.number().int().positive().safe() }).strict(), z.object({ caseId: z.uuid(), state: z.literal("more_information_required"),
 outcome: z.literal("more_information_required"), reviewRevision: z.number().int().positive().safe() }).strict()]);
export function PublicAppealCaseRejection({ caseId, reviewRevision, csrf, nonce, disabled, allowUphold = false, allowMoreInformation = false, reversal, onMoreInformation, onResolved }: {
 caseId: string; reviewRevision: number; csrf: string; nonce: string; disabled: boolean; allowUphold?: boolean; allowMoreInformation?: boolean; reversal?: { priorDecisionRevision: number; evidenceRevision: number }; onMoreInformation?: () => void; onResolved: (outcome?: string) => void;
}) {
 const [reason, setReason] = useState(""); const [checked, setChecked] = useState(false);
 const [busy, setBusy] = useState(false); const [message, setMessage] = useState("");
 const [unconfirmed, setUnconfirmed] = useState(false); const inFlight = useRef(false);
 const operation = useRef<AbortController | null>(null); const mounted = useRef(true);
 useEffect(() => { mounted.current = true; return () => { mounted.current = false; operation.current?.abort(); }; }, []);
 async function close(decision: "reject" | "uphold" | "needs-more-information" | "reverse-prior-decision") {
  if (disabled || busy || unconfirmed || inFlight.current || decision === "uphold" && !allowUphold
   || decision === "reverse-prior-decision" && !reversal
   || decision === "needs-more-information" && (!allowMoreInformation || !onMoreInformation)
   || !checked || [...reason.trim()].length < 20 || [...reason].length > 2000) return;
  inFlight.current = true;
  const abort = new AbortController(); operation.current = abort; setBusy(true);
  const timeout = setTimeout(() => abort.abort(), 20_000);
  try {
   const response = await fetch(`/api/reviews/appeals/${caseId}`, { method: "POST", credentials: "same-origin", signal: abort.signal,
    headers: { "content-type": "application/json", "x-inherit-csrf": csrf },
    body: JSON.stringify({ decision, reviewRevision, reason, nonce, ...(decision === "reverse-prior-decision" ? reversal : {}) }) });
   const value = receipt.safeParse(await response.json());
   if (abort.signal.aborted || response.status !== 200 || !value.success || value.data.caseId !== caseId
    || value.data.state !== (decision === "needs-more-information" ? "more_information_required" : "resolved")
    || value.data.outcome !== (decision === "needs-more-information" ? "more_information_required" : decision === "uphold" ? "upheld" : decision === "reverse-prior-decision" ? "prior_decision_reversed" : "rejected") || value.data.reviewRevision !== reviewRevision + 1) throw new Error("unavailable");
   if (!abort.signal.aborted) { setReason(""); setChecked(false); if (decision === "needs-more-information") onMoreInformation?.(); else onResolved(value.data.outcome); }
  } catch { if (mounted.current) { setUnconfirmed(true); setMessage("We could not confirm whether this request changed. Reload this page and check the current case before trying again."); } }
  finally { clearTimeout(timeout); inFlight.current = false; if (mounted.current) setBusy(false); }
 }
 return <section className="space-y-3 rounded-xl border p-4" aria-busy={busy}>
  <h2>Refuse this request</h2>
  {busy && <p role="status">Saving this choice.</p>}
  <p>This closes only this request. It does not give access or change anyone&apos;s data.</p>
  <label className="block">Reason<textarea value={reason} maxLength={2000} disabled={disabled || busy || unconfirmed}
   onChange={event => setReason(event.target.value)} /></label>
  <p>Record what you checked. Do not copy file content into the reason.</p>
  <label className="block"><input type="checkbox" checked={checked} disabled={disabled || busy || unconfirmed}
   onChange={event => setChecked(event.target.checked)} /> I have read this request and the files that are here.</label>
  <button type="button" disabled={disabled || busy || unconfirmed || !checked || [...reason.trim()].length < 20}
   onClick={() => void close("reject")}>Refuse request</button>
  {allowUphold && <><p>The full files were checked. You can keep the same choice. This does not give access.</p>
   <button type="button" disabled={disabled || busy || unconfirmed || !checked || [...reason.trim()].length < 20}
    onClick={() => void close("uphold")}>Keep the same choice</button></>}
  {reversal && <><p>You can change only the earlier file choice. This gives no access. The old files cannot be opened. A new request with new files is needed.</p>
   <button type="button" disabled={disabled || busy || unconfirmed || !checked || [...reason.trim()].length < 20}
    onClick={() => void close("reverse-prior-decision")}>Change this choice</button></>}
  {allowMoreInformation && <><p>You can ask for more files. This keeps the same deadline and gives no access.</p>
   <button type="button" disabled={disabled || busy || unconfirmed || !checked || [...reason.trim()].length < 20 || !onMoreInformation}
    onClick={() => void close("needs-more-information")}>Ask for more files</button></>}
  {message && <p role="status">{message}</p>}
 </section>;
}
