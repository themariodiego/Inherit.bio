"use client";

import {useRef,useState,useTransition,type FormEvent} from "react";
import {useRouter} from "next/navigation";
import {Button} from "@/components/ui/button";
import {Input} from "@/components/ui/input";
import type {IdentityProfileControl} from "@/lib/future-person/identity-profile-controls";

export function FuturePersonProfile({control}:{control:IdentityProfileControl}){
  const router=useRouter(),[busy,setBusy]=useState<"save"|"delete"|null>(null),[refreshing,startRefresh]=useTransition();
  const formRef=useRef<HTMLFormElement>(null);
  const [message,setMessage]=useState<string|null>(null);
  const disabled=busy!==null||refreshing;
  async function mutate(operation:"save"|"delete",form:HTMLFormElement|null){
    const proof=operation==="save"?control.save:control.delete;if(!proof||disabled)return;
    const body=operation==="save"&&form?new FormData(form):null;
    const input=body&&control.save?{childDateOfBirth:String(body.get("birthDate")??""),
      childPlaceOfBirth:String(body.get("birthPlace")??""),
      parentNames:String(body.get("parentNames")??"").split(/\r?\n/u).map(name=>name.trim()).filter(Boolean),
      consentSignatureId:control.save.consentSignatureId}:null;
    setBusy(operation);setMessage(null);
    const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),20_000);
    try{
      const response=await fetch(`/api/embryos/${control.embryoId}/future-person-identity`,{
        method:operation==="save"?"PUT":"DELETE",cache:"no-store",credentials:"same-origin",signal:controller.signal,
        headers:{"X-Inherit-Operation-Nonce":proof.operationNonce,"X-Inherit-CSRF":proof.csrf,
          ...(input?{"Content-Type":"application/json"}:{})},...(input?{body:JSON.stringify(input)}:{}),
      });
      let complete=false;
      if(operation==="delete")complete=response.status===204&&(await response.text())==="";
      else if(response.status===200){
        const result:unknown=await response.json();
        if(result&&typeof result==="object"&&!Array.isArray(result)){
          const value=result as Record<string,unknown>;
          complete=Object.keys(value).sort().join(",")==="expiresAt,status"&&value.status==="saved"
            &&typeof value.expiresAt==="string"&&Date.parse(value.expiresAt)===Date.parse(control.expiresAt);
        }
      }
      if(!complete){setMessage("We could not confirm the change. Reload this page and check the details.");return;}
      form?.reset();setMessage(operation==="save"?"Details saved.":"Details deleted. The embryo record is kept.");
      startRefresh(()=>router.refresh());
    }catch{setMessage("We could not confirm the change. Reload this page and check the details.");}
    finally{clearTimeout(timeout);setBusy(null);}
  }
  function save(event:FormEvent<HTMLFormElement>){event.preventDefault();void mutate("save",event.currentTarget);}
  const label=`profile-${control.embryoId}`;
  return <article className="space-y-4 rounded-xl border border-line p-4" aria-labelledby={`${label}-heading`}>
    <h3 id={`${label}-heading`} className="font-medium">{control.label}</h3>
    <p className="text-sm text-ink-muted">{control.hasProfile?"Details are stored.":"No details are stored."} These details are kept only until <time dateTime={control.expiresAt}>
      {new Date(control.expiresAt).toLocaleDateString("en-GB",{year:"numeric",month:"long",day:"numeric"})}</time>, or deleted earlier.</p>
    {control.save?<form ref={formRef} onSubmit={save} autoComplete="off">
      <fieldset disabled={disabled} className="space-y-3">
        <legend className="sr-only">Matching details for {control.label}</legend>
        <div className="space-y-1"><label htmlFor={`${label}-birth-date`} className="text-sm">Child birth date</label>
          <Input id={`${label}-birth-date`} name="birthDate" type="date" required /></div>
        <div className="space-y-1"><label htmlFor={`${label}-birth-place`} className="text-sm">Where the child was born</label>
          <Input id={`${label}-birth-place`} name="birthPlace" minLength={2} maxLength={640} required /></div>
        <div className="space-y-1"><label htmlFor={`${label}-names`} className="text-sm">Parent name</label>
          <p id={`${label}-name-help`} className="text-sm text-ink-muted">Put each name on a new line. You can add one to four names.</p>
          <textarea id={`${label}-names`} name="parentNames" required maxLength={1924} aria-describedby={`${label}-name-help`}
            className="min-h-28 w-full rounded-md border border-line bg-transparent px-3 py-2 text-base focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent" /></div>
        <Button type="submit">{busy==="save"?"Saving…":"Save details"}</Button>
      </fieldset>
    </form>:<p className="text-sm text-ink-muted">To save new details, a current parent must first sign the current embryo upload consent.</p>}
    {control.delete?<Button type="button" variant="outline" disabled={disabled} onClick={()=>void mutate("delete",formRef.current)}>{busy==="delete"?"Working…":"Delete details"}</Button>:null}
    {message?<p role="status" className="text-sm">{message}</p>:null}
  </article>;
}
