"use client";
import {useState} from "react";
import Link from "next/link";
import {z} from "zod";
export function ClaimantAccountBinding({nonce,csrf}:{nonce:string|null;csrf:string}) {
 const [confirmed,setConfirmed]=useState(false);const [busy,setBusy]=useState(false);const [done,setDone]=useState(false);const [message,setMessage]=useState("");
 async function bind(){
  if(!nonce||!confirmed||busy||done)return;setBusy(true);setMessage("");
  try {
   const response=await fetch("/api/future-person/claim/session/account",{method:"POST",credentials:"same-origin",cache:"no-store",
    headers:{"Content-Type":"application/json","X-Inherit-CSRF":csrf},body:JSON.stringify({nonce})});
   const receipt=z.object({status:z.literal("account_bound")}).strict().safeParse(await response.json());
   if(response.status!==200||!receipt.success)throw new Error("unavailable");
   setDone(true);setMessage("Your record is now part of your account. This claim link has closed.");
  }catch{setMessage("This record could not be linked. Sign in again and reopen your claim session.");}finally{setBusy(false);}
 }
 if(done)return <section className="mt-8"><p role="status">{message}</p><Link href="/files" className="mt-4 inline-block underline">Go to your files</Link></section>;
 return <section className="mt-8">
  <h2 className="font-semibold">Keep the record in your account</h2>
  <p className="mt-4 max-w-prose text-ink-muted">You can keep using your claim without an account. Linking it closes this claim link and your Recovery Key. It does not turn on new reports or sharing.</p>
  {nonce?<fieldset disabled={busy} className="mt-4"><legend className="sr-only">Link your record</legend>
   <label className="flex items-start gap-3"><input type="checkbox" checked={confirmed} onChange={event=>setConfirmed(event.target.checked)}/>
    <span>I want to keep this record in my account.</span></label>
   <button disabled={!confirmed} onClick={bind} className="mt-4 rounded-full border px-6 py-3 disabled:opacity-50">Link to my account</button>
   <p role="status" className="mt-4">{message}</p></fieldset>:
   <p className="mt-4">Account linking is not open in this session. <Link href="/auth/sign-in?next=%2Fwithdraw%2Fsession" className="underline">Sign in again</Link> to check your account.</p>}
 </section>;
}
