"use client";

import {useEffect,useRef,useState} from "react";
import {keylessVerificationResponse,type ReviewPageCase} from "@/lib/future-person/review-page-contract";

/** This control only verifies the documentary tuple and reads its candidate.
 * It offers no approval or release action and stores nothing outside memory. */
export function KeylessDocumentVerification({claimId,reviewRevision,csrf,nonce,documentsRead,onVerified}:{
  claimId:string;reviewRevision:number;csrf:string;nonce:string;documentsRead:boolean;
  onVerified:(reviewCase:ReviewPageCase,proof:string|null)=>void;
}) {
  const [fullName,setFullName]=useState("");const [dateOfBirth,setDateOfBirth]=useState("");
  const [adult,setAdult]=useState(false);const [busy,setBusy]=useState(false);const [message,setMessage]=useState("");
  const active=useRef<AbortController|null>(null);
  useEffect(()=>()=>{active.current?.abort();active.current=null;},[]);
  async function verify() {
    if(!documentsRead||busy||!adult||fullName.trim().length<2||dateOfBirth.length!==10)return;
    const controller=new AbortController();active.current=controller;setBusy(true);setMessage("");
    const timeout=setTimeout(()=>controller.abort(),20000);
    try{
      const response=await fetch(`/api/reviews/future-person/claims/${claimId}/verify-documents`,{
        method:"POST",credentials:"same-origin",cache:"no-store",signal:controller.signal,
        headers:{"content-type":"application/json","x-inherit-csrf":csrf},body:JSON.stringify({reviewRevision,nonce,
          documentaryAttestation:{fullName,dateOfBirth,photoIdentityReviewed:true,birthRecordReviewed:true,adultAgeConfirmed:true}}),
      });
      const parsed=keylessVerificationResponse.safeParse(await response.json());
      if(response.status!==200||!parsed.success||parsed.data.reviewCase.claimId!==claimId
        ||parsed.data.reviewCase.reviewRevision!==reviewRevision)throw new Error("unavailable");
      if(controller.signal.aborted)return;
      onVerified(parsed.data.reviewCase,parsed.data.verificationProof);
      setMessage(parsed.data.verificationProof===null?"No single record could be found. Do not choose a record.":
        "Read the details below against the birth record. More review is needed before any release.");
    }catch{if(active.current===controller)setMessage("The details could not be checked. Reload this page and open the case assigned to you.");}
    finally{clearTimeout(timeout);if(active.current===controller)setBusy(false);}
  }
  return <fieldset disabled={!documentsRead||busy} className="space-y-3 rounded-xl border p-4" aria-busy={busy}>
    <legend>Identity checked from both documents</legend>
    <label className="block">Document full name<input value={fullName} maxLength={120} onChange={event=>setFullName(event.target.value)}/></label>
    <label className="block">Document birth date<input type="date" value={dateOfBirth} onChange={event=>setDateOfBirth(event.target.value)}/></label>
    <label className="block"><input type="checkbox" checked={adult} onChange={event=>setAdult(event.target.checked)}/> Both documents show this person is an adult.</label>
    <button type="button" className="min-h-11" disabled={!adult||fullName.trim().length<2||dateOfBirth.length!==10} onClick={()=>void verify()}>
      {busy?"Checking details…":"Check document identity"}
    </button>
    {message&&<p role="status">{message}</p>}
  </fieldset>;
}
