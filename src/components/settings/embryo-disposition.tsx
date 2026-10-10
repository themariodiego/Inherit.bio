"use client";

import {useState,useTransition,type FormEvent} from "react";
import {useRouter} from "next/navigation";
import {Button} from "@/components/ui/button";
import {RECORD_KEY_CARDS_HEADING,RECORD_KEY_CARDS_NOTE} from "@/copy/embryos/upload";
import type {EmbryoDispositionControl} from "@/lib/embryos/disposition-controls";
import {readEmbryoDispositionReceipt,type EmbryoDispositionReceipt,type DispositionValue} from "@/lib/embryos/disposition-receipt";

export function EmbryoDisposition({control}:{control:EmbryoDispositionControl}){
  const router=useRouter(),[busy,setBusy]=useState(false),[refreshing,startRefresh]=useTransition();
  const [message,setMessage]=useState<string|null>(null),[receipt,setReceipt]=useState<EmbryoDispositionReceipt|null>(null);
  const disabled=busy||refreshing||receipt!==null;
  function refresh(){setReceipt(null);startRefresh(()=>router.refresh());}
  async function submit(event:FormEvent<HTMLFormElement>){
    event.preventDefault();if(!control.nonce||disabled)return;
    const disposition=(control.proposal?.disposition??new FormData(event.currentTarget).get("disposition")) as DispositionValue;
    const action=control.proposal?"confirm":control.mode==="single-authority-direct"?"commit-single-authority":"propose";
    const body={action,disposition,nonce:control.nonce,...(control.proposal?{proposalId:control.proposal.id}:{})};
    setBusy(true);setMessage(null);
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),20_000);
    try{
      const response=await fetch(`/api/embryos/${control.embryoId}/disposition`,{method:"POST",credentials:"same-origin",
        cache:"no-store",signal:controller.signal,headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
      const next=readEmbryoDispositionReceipt(response.status,await response.json(),{embryoId:control.embryoId,action,disposition});
      if(!next){setMessage("We could not confirm the change. Refresh this page and check the record.");return;}
      if("disposition" in next&&next.disposition==="transferred"&&next.recordKeyCard!==null)setReceipt(next);
      else {setMessage("status" in next?"Waiting for the other parent.":"Change saved.");refresh();}
    }catch{setMessage("We could not confirm the change. Refresh this page and check the record.");}
    finally{clearTimeout(timer);setBusy(false);}
  }
  const label=`disposition-${control.embryoId}`;
  const card=receipt&&"recordKeyCard" in receipt?receipt.recordKeyCard:null;
  return <article data-slot="embryo-disposition-control" data-embryo-id={control.embryoId}
    className="space-y-4 rounded-xl border border-line p-4" aria-labelledby={`${label}-heading`}>
    <h3 id={`${label}-heading`} className="font-medium">{control.label}</h3>
    <p className="text-sm text-ink-muted">Record what happened to this embryo with your clinical team. This does not require permission for analysis.</p>
    {card?<section data-slot="transfer-record-key-card" className="space-y-3" aria-label={RECORD_KEY_CARDS_HEADING}>
      <h4 className="font-medium">{RECORD_KEY_CARDS_HEADING}</h4><p className="text-sm">{RECORD_KEY_CARDS_NOTE}</p>
      <p className="break-all font-mono text-sm">{card.recordKey}</p><p className="break-all text-sm">{card.claimUrl}</p>
      <p className="text-sm">Date: {card.closingDateWords}.</p>
      <Button type="button" variant="outline" onClick={()=>window.print()}>Print</Button>
      <Button type="button" onClick={refresh}>Continue</Button>
    </section>:control.proposal?.callerIsProposer?<p role="status" className="text-sm">Waiting for the other parent.</p>:<form onSubmit={submit}>
      <fieldset disabled={disabled||control.nonce===null} className="space-y-3">
        <legend className="sr-only">Embryo status for {control.label}</legend>
        {control.proposal?<p className="text-sm">The other parent recorded: <strong>{control.proposal.disposition}</strong>. Confirm only if this is right.
          This request closes on <time dateTime={control.proposal.expiresAt}>{new Date(control.proposal.expiresAt).toLocaleDateString("en-GB")}</time>.</p>:<div className="space-y-1">
          <label htmlFor={`${label}-status`} className="text-sm">Status</label>
          <select id={`${label}-status`} name="disposition" required defaultValue=""
            className="min-h-11 w-full rounded-md border border-line bg-transparent px-3 text-base focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">
            <option value="" disabled>Choose</option>{control.currentDisposition==="unknown"?<option value="stored">Stored</option>:null}
            <option value="transferred">Transferred</option><option value="donated">Donated</option><option value="discarded">Discarded</option>
          </select>
        </div>}
        <Button type="submit">{busy?"Working…":control.proposal?"Confirm change":"Record change"}</Button>
      </fieldset>
    </form>}
    {message&&!control.proposal?.callerIsProposer?<p role="status" className="text-sm">{message}</p>:null}
  </article>;
}
