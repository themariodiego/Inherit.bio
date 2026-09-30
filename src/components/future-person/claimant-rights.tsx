"use client";
import {useState} from "react";
import {z} from "zod";
const recoveryReceipt=z.object({recoveryKey:z.string().regex(/^[0-9A-HJKMNP-TV-Z]{20}$/u),contactMaterialExpiresOn:z.string().regex(/^\d{4}-\d{2}-\d{2}$/u),
  reverificationBinding:z.literal("retained-until-account-binding-key-rotation-or-claimant-deletion"),
  recordRetention:z.literal("claimed-record-is-not-deleted-by-temporary-contact-expiry")}).strict();
export function ClaimantRights({csrf,recoveryNonce,analysisNonce}:{csrf:string;recoveryNonce:string;analysisNonce:string}) {
  const [acknowledged,setAcknowledged]=useState(false);const [recoveryKey,setRecoveryKey]=useState<string|null>(null);
  const [busy,setBusy]=useState(false);const [message,setMessage]=useState("");
  async function recover(){
    if(busy||!acknowledged||recoveryKey)return;setBusy(true);setMessage("");
    try {
      const response=await fetch("/api/future-person/claim/session/recovery-key",{method:"POST",credentials:"same-origin",cache:"no-store",
        headers:{"Content-Type":"application/json","X-Inherit-CSRF":csrf},body:JSON.stringify({nonce:recoveryNonce,acknowledgedWillSaveOffline:true})});
      const parsed=recoveryReceipt.safeParse(await response.json());
      if(response.status!==201||!parsed.success)throw new Error("unavailable");setRecoveryKey(parsed.data.recoveryKey);
      setMessage("Your Recovery Key is shown once. Save it on paper or print this page before leaving.");
    }catch{setMessage("This session could not issue a key. Start a new claim if your session has ended.");}finally{setBusy(false);}
  }
  async function stop(){
    if(busy)return;setBusy(true);setMessage("");
    try{
      const response=await fetch("/api/future-person/claim/session/analysis",{method:"DELETE",credentials:"same-origin",cache:"no-store",
        headers:{"X-Inherit-CSRF":csrf,"X-Inherit-Operation-Nonce":analysisNonce}});
      const parsed=z.object({status:z.literal("analysis_stopped"),effectiveAt:z.iso.datetime()}).strict().safeParse(await response.json());
      if(response.status!==200||!parsed.success)throw new Error("unavailable");setMessage("Future analysis has stopped. Your record is still retained.");
    }catch{setMessage("This session could not stop analysis. Start a new claim if your session has ended.");}finally{setBusy(false);}
  }
  return <section className="mx-auto max-w-3xl px-6 py-16">
    <h1 className="display text-4xl">Your claimed record</h1>
    <p className="mt-5 max-w-prose text-ink-muted">You control this record. Its genetic information is not shown on this page. You do not need an account.</p>
    <p className="mt-4 max-w-prose text-ink-muted">Your record stays until you ask to delete it. The temporary contact address expires separately. Keep a Recovery Key so you can start a new claim later with fresh identity documents.</p>
    <fieldset className="mt-8" disabled={busy||recoveryKey!==null}>
      <legend className="font-semibold">Keep access without an account</legend>
      <label className="mt-4 flex items-start gap-3"><input type="checkbox" checked={acknowledged} onChange={event=>setAcknowledged(event.target.checked)}/>
        <span>I will save my Recovery Key offline before leaving this page.</span></label>
      <button className="mt-4 rounded-full bg-forest px-6 py-3 text-on-forest disabled:opacity-50" disabled={!acknowledged} onClick={recover}>Show my Recovery Key once</button>
    </fieldset>
    {recoveryKey&&<div className="mt-6"><p className="font-mono text-xl tracking-wider">{recoveryKey}</p>
      <button className="mt-4 rounded-full border px-6 py-3" onClick={()=>window.print()}>Print this page</button></div>}
    <button className="mt-8 rounded-full border px-6 py-3 disabled:opacity-50" disabled={busy} onClick={stop}>Stop future analysis</button>
    <p className="mt-4" role="status" aria-live="polite">{message}</p>
  </section>;
}
