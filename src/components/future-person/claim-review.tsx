"use client";

import {useCallback,useEffect,useRef,useState,type FormEvent} from "react";
import Image from "next/image";
import {KeylessPendingReview} from "./keyless-pending-review";
import {ReviewPdfDocument} from "./review-pdf";
import {ReviewReason} from "./review-reason";
import {KeylessDocumentVerification} from "./keyless-verification";
import {DOCUMENT_LABELS} from "@/copy/rights/future-person-claim";
import {readReviewDocument} from "@/lib/future-person/read-review-document";
import {reviewPageCase,reviewPageDecisions,type ReviewPageCase,type ReviewDecision} from "@/lib/future-person/review-page-contract";

type DocumentKind="photo"|"birth";
type Loaded={record:ReviewPageCase;csrf:string;nonce:string;photoNonce:string;birthNonce:string;lookupNonce:string|null;operation:"documentary"|"claim-objection"|"claim-release";objectionId:string|null};
type View={url:string;type:string;ready:boolean;failed:boolean};
const HEX=/^[0-9a-f]{64}$/u;
const LABEL:Record<ReviewDecision,string>={reject:"Refuse claim","needs-more-information":"Ask for more information","approve-record-key":"Approve claim",
  "approve-recovery-key":"Approve claim","approve-claimed-unbound-no-key-recovery":"Approve claim","keyless-document-match":"Start owner notice"};
const MIME:Record<string,string>={pdf:"application/pdf",jpg:"image/jpeg",png:"image/png"};

export function ReviewDocumentView({kind,view,onState}:{kind:DocumentKind;view:View;onState:(kind:DocumentKind,ready:boolean,failed:boolean)=>void}) {
  const rendered=useCallback(()=>onState(kind,true,false),[kind,onState]);
  const pending=useCallback(()=>onState(kind,false,false),[kind,onState]);
  const failed=useCallback(()=>onState(kind,false,true),[kind,onState]);
  const title=kind==="photo"?"Photo identity document":"Birth record";
  if(view.type==="application/pdf")return <ReviewPdfDocument key={view.url} url={view.url} title={title} onRendered={rendered} onPending={pending} onFailure={failed}/>;
  return <Image src={view.url} alt={title} width={400} height={500} unoptimized referrerPolicy="no-referrer"
    onLoad={event=>{const image=event.currentTarget;if(image.complete&&image.naturalWidth>0&&image.naturalHeight>0)rendered();else failed();}}
    onError={failed} className="max-h-96 w-full object-contain"/>;
}

export function ClaimReview({claimId}:{claimId:string}) {
  const [loaded,setLoaded]=useState<Loaded|null>(null);
  const [message,setMessage]=useState("Loading claim…");
  const [busy,setBusy]=useState<string|null>("load");
  const [views,setViews]=useState<Partial<Record<DocumentKind,View>>>({});
  const [checked,setChecked]=useState({photo:false,birth:false,adult:false,parent:false});
  const [decision,setDecision]=useState<ReviewDecision>("reject");
  const [fullName,setFullName]=useState("");const [dateOfBirth,setDateOfBirth]=useState("");const [reason,setReason]=useState("");
  const operation=useRef<AbortController|null>(null);const urls=useRef<string[]>([]);
  const verificationProof=useRef<string|null>(null);
  const [verificationReady,setVerificationReady]=useState(false);
  const documentState=useCallback((kind:DocumentKind,ready:boolean,failed:boolean)=>{
    setViews(previous=>previous[kind]?{...previous,[kind]:{...previous[kind],ready,failed}}:previous);
    if(!ready)setChecked(previous=>({...previous,[kind]:false}));
    if(failed)setMessage("The file could not be shown. Reload this page before trying again.");
  },[]);
  const clearViews=()=>{for(const url of urls.current)URL.revokeObjectURL(url);urls.current=[];setViews({});};
  useEffect(()=>{
    const controller=new AbortController();operation.current=controller;
    (async()=>{
      try {
        const response=await fetch(`/api/reviews/future-person/claims/${claimId}`,{credentials:"same-origin",cache:"no-store",signal:controller.signal});
        const record=reviewPageCase.safeParse(await response.json());
        const csrf=response.headers.get("x-inherit-csrf");const nonce=response.headers.get("x-inherit-review-nonce");
        const photoNonce=response.headers.get("x-inherit-photo-receipt-nonce");const birthNonce=response.headers.get("x-inherit-birth-receipt-nonce");
        const lookupNonce=response.headers.get("x-inherit-keyless-lookup-nonce");
        if(response.status!==200||!record.success||record.data.claimId!==claimId||!csrf||!HEX.test(csrf)
          ||!nonce||!photoNonce||!birthNonce||[nonce,photoNonce,birthNonce].some(value=>value.length>2048))throw new Error("unavailable");
        if(record.data.mode==="keyless"&&record.data.state!=="approved_pending_owner_notice"&&(!lookupNonce||lookupNonce.length>2048))throw new Error("unavailable");
        if(controller.signal.aborted)return;
        const currentOperation=response.headers.get("x-inherit-review-operation")??"documentary";
        if(!["documentary","claim-objection","claim-release"].includes(currentOperation))throw new Error("unavailable");
        const objectionId=response.headers.get("x-inherit-objection-review-id");
        if(currentOperation==="claim-objection"&&(!objectionId||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(objectionId)))throw new Error("unavailable");
        setLoaded({record:record.data,csrf,nonce,photoNonce,birthNonce,lookupNonce,operation:currentOperation as Loaded["operation"],objectionId});setVerificationReady(false);setMessage("");
      } catch {if(!controller.signal.aborted)setMessage("This claim is not available. Sign in again and open the case assigned to you.");}
      finally{if(!controller.signal.aborted)setBusy(null);}
    })();
    return ()=>{controller.abort();operation.current?.abort();verificationProof.current=null;for(const url of urls.current)URL.revokeObjectURL(url);urls.current=[];};
  },[claimId]);
  const received=Boolean(views.photo?.ready&&views.birth?.ready);
  const approval=decision.startsWith("approve-")||decision==="keyless-document-match";
  const parentLink=decision==="approve-record-key"||decision==="keyless-document-match";
  const canSubmit=loaded&&received&&checked.photo&&checked.birth&&!busy&&reason.trim().length>=20&&reason.length<=2000
    &&(!approval||(checked.adult&&(!parentLink||checked.parent)&&fullName.trim().length>=2&&dateOfBirth.length===10))
    &&(!["approve-claimed-unbound-no-key-recovery","keyless-document-match"].includes(decision)||verificationReady);

  async function openDocument(kind:DocumentKind) {
    if(!loaded||busy)return;
    const controller=new AbortController();operation.current=controller;setBusy(kind);setMessage("");
    let bytes:Uint8Array|undefined;
    try {
      // One browser download cookie: serialize reads, including every acknowledgement.
      const result=await readReviewDocument(kind==="photo"?loaded.record.evidence.photoIdentityDocumentId:loaded.record.evidence.birthRecordDocumentId,
        kind==="photo"?loaded.photoNonce:loaded.birthNonce,loaded.csrf,controller.signal);
      bytes=result.bytes;
      const type=MIME[result.filename.split(".").at(-1)??""];
      if(!type||controller.signal.aborted)throw new Error("unavailable");
      const url=URL.createObjectURL(new Blob([Uint8Array.from(bytes)],{type}));urls.current.push(url);
      setViews(previous=>({...previous,[kind]:{url,type,ready:false,failed:false}}));
      setChecked(previous=>({...previous,[kind]:false}));
    } catch {if(!controller.signal.aborted)setMessage("The full document could not be read. Reload this page before trying again.");}
    finally {bytes?.fill(0);if(!controller.signal.aborted)setBusy(null);}
  }
  async function submit(event:FormEvent) {
    event.preventDefault();if(!loaded||!canSubmit)return;
    const controller=new AbortController();operation.current=controller;setBusy("decision");setMessage("");
    const body={reviewRevision:loaded.record.reviewRevision,decision,reason,nonce:loaded.nonce,
      ...(approval?{documentaryAttestation:{fullName,dateOfBirth,photoIdentityReviewed:true,birthRecordReviewed:true,adultAgeConfirmed:true,
        ...(parentLink?{recordedParentLinkConfirmed:true}:{})}}:{}),
      ...(["approve-claimed-unbound-no-key-recovery","keyless-document-match"].includes(decision)?{verificationProof:verificationProof.current}:{})};
    try {
      const response=await fetch(`/api/reviews/future-person/claims/${claimId}`,{method:"POST",credentials:"same-origin",signal:controller.signal,
        headers:{"content-type":"application/json","x-inherit-csrf":loaded.csrf},body:JSON.stringify(body)});
      const result:unknown=await response.json();
      if(response.status!==200||result===null||typeof result!=="object"||Array.isArray(result))throw new Error("unavailable");
      const row=result as Record<string,unknown>;
      if(Object.keys(row).sort().join("|")!=="claimId|reviewRevision|state"||row.claimId!==claimId||row.reviewRevision!==loaded.record.reviewRevision+1
        ||row.state!==({reject:"refused","needs-more-information":"more_information_required","approve-record-key":"release_queued",
          "approve-recovery-key":"release_queued","approve-claimed-unbound-no-key-recovery":"release_queued","keyless-document-match":"approved_pending_owner_notice"} as const)[decision])throw new Error("unavailable");
      clearViews();verificationProof.current=null;setVerificationReady(false);setLoaded(null);setFullName("");setDateOfBirth("");setReason("");setMessage("Decision saved.");
    } catch {if(!controller.signal.aborted)setMessage("The decision was not saved. Reload this page and check the current case before trying again.");}
    finally {if(!controller.signal.aborted)setBusy(null);}
  }
  return <section className="mt-6 space-y-6" aria-busy={busy!==null}>
    {message&&<p role="status">{message}</p>}
    {loaded&&<>
      <p>Claimant: {loaded.record.claimant.fullName}. Birth date: {loaded.record.claimant.dateOfBirth}.</p>
      <p>Read both full documents. Then record what you checked and why you made this decision.</p>
      {loaded.record.case.kind==="record_key"&&<p>Recorded parent names: {loaded.record.case.recordedParentLink.recordedParentNames.join(", ")}.</p>}
      {(["photo","birth"] as const).map(kind=><section key={kind} className="space-y-3 rounded-xl border p-4">
        <h2>{DOCUMENT_LABELS[kind==="photo"?"future-photo-identity":"future-birth-record"]}</h2>
        <button type="button" aria-label={`Open ${DOCUMENT_LABELS[kind==="photo"?"future-photo-identity":"future-birth-record"]}`} disabled={Boolean(busy)||Boolean(views[kind])} onClick={()=>void openDocument(kind)}>
          {busy===kind?"Reading file…":"Open file"}
        </button>
        {views[kind]&&<>
          <ReviewDocumentView kind={kind} view={views[kind]} onState={documentState}/>
          {views[kind].ready&&!views[kind].failed&&<label className="block"><input type="checkbox" checked={checked[kind]} disabled={Boolean(busy)}
            onChange={event=>setChecked(previous=>({...previous,[kind]:event.target.checked}))}/>
             I read this file.</label>}
        </>}
      </section>)}
      {loaded.record.mode==="keyless"&&loaded.record.state!=="approved_pending_owner_notice"&&loaded.lookupNonce&&received&&checked.photo&&checked.birth&&<KeylessDocumentVerification claimId={claimId}
        reviewRevision={loaded.record.reviewRevision} csrf={loaded.csrf} nonce={loaded.lookupNonce}
        documentsRead={received&&checked.photo&&checked.birth&&!busy}
        onVerified={(record,proof)=>{verificationProof.current=proof;setVerificationReady(proof!==null);setLoaded(previous=>previous?{...previous,record}:null);setDecision("reject");}}/>}
      {loaded.record.case.kind==="unclaimed_keyless"&&<section className="space-y-2 rounded-xl border p-4">
        <h2>Parent details</h2>
        <p>Birth date: {loaded.record.case.selectedProfile.childDateOfBirth}.</p>
        <p>Birth place: {loaded.record.case.selectedProfile.childPlaceOfBirth}.</p>
        <p>Parent names: {loaded.record.case.selectedProfile.parentNames.join(", ")}.</p>
      </section>}
      {loaded.record.case.kind==="claimed_unbound_no_key_recovery"&&<p>The document identity matches one previously claimed record. A new rights session needs its own review.</p>}
      {loaded.record.state==="approved_pending_owner_notice"?<KeylessPendingReview claimId={claimId} record={loaded.record}
        csrf={loaded.csrf} nonce={loaded.nonce} operation={loaded.operation} objectionId={loaded.objectionId}
        documentsRead={received&&checked.photo&&checked.birth} onSaved={()=>{clearViews();setLoaded(null);setMessage("Decision saved.");}}/>:<form onSubmit={submit} className="space-y-4">
        <div>
          <label className="block" htmlFor="claim-review-choice">Choice</label>
          <select id="claim-review-choice" value={decision} disabled={Boolean(busy)} onChange={event=>setDecision(event.target.value as ReviewDecision)}>
            {reviewPageDecisions(loaded.record).map(value=><option key={value} value={value}>{LABEL[value]}</option>)}
          </select>
        </div>
        {approval&&received&&checked.photo&&checked.birth&&<fieldset disabled={Boolean(busy)} className="space-y-3">
          <legend>Identity checked from the documents</legend>
          <label className="block">Full name<input value={fullName} maxLength={120} onChange={event=>setFullName(event.target.value)} required/></label>
          <label className="block">Birth date<input type="date" value={dateOfBirth} onChange={event=>setDateOfBirth(event.target.value)} required/></label>
          <label className="block"><input type="checkbox" checked={checked.adult} onChange={event=>setChecked(previous=>({...previous,adult:event.target.checked}))}/> This person is an adult.</label>
          {parentLink&&<label className="block"><input type="checkbox" checked={checked.parent} onChange={event=>setChecked(previous=>({...previous,parent:event.target.checked}))}/> The birth record and the parent name match.</label>}
        </fieldset>}
        <ReviewReason value={reason} disabled={Boolean(busy)} onChange={setReason}/>
        <button type="submit" disabled={!canSubmit}>Save choice</button>
      </form>}
    </>}
  </section>;
}
