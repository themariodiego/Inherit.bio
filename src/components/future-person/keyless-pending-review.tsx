"use client";
import {useEffect,useRef,useState,type FormEvent} from "react";
import {z} from "zod";
import type {ReviewPageCase} from "@/lib/future-person/review-page-contract";
const revision=z.number().int().positive().safe();
const objectionCase=z.object({objectionId:z.uuid(),claimId:z.uuid(),statement:z.string().min(20).max(16000),
 objectionRevision:revision,claimReviewRevision:revision,noticeRevision:revision,
 noticeRecipientRole:z.literal("current-owner-pseudonymous-role"),deadline:z.iso.datetime({offset:true}),
 claimant:z.object({fullName:z.string().min(2).max(480),dateOfBirth:z.string().regex(/^\d{4}-\d{2}-\d{2}$/u)}).strict(),
 reviewPackage:z.object({photoIdentityDocumentId:z.uuid(),birthRecordDocumentId:z.uuid(),
 documentaryAttestation:z.object({outcome:z.literal("positive"),reviewRevision:revision}).strict(),
 selectedProfile:z.object({childDateOfBirth:z.string(),childPlaceOfBirth:z.string(),parentNames:z.array(z.string()).min(1).max(4)}).strict()}).strict(),
}).strict();
const refusalCodes={documentary_evidence_insufficient:"The documents do not support this claim.",identity_profile_conflict:"The parent details do not match.",
 notice_delivery_failed:"The owner notice could not be delivered.",claim_deadline_expired:"The claim deadline has passed.",record_state_changed:"The record has changed."} as const;
type RefusalCode=keyof typeof refusalCodes;
type Objection={record:z.infer<typeof objectionCase>;csrf:string;nonce:string};
/** Only this newly assigned operation gets a decision. The parent's document
 * controls use new GET-issued receipt proofs and the current full EOF/ACK
 * reader; no original documentary receipt or choice survives the operation. */
export function KeylessPendingReview({claimId,record,csrf,nonce,operation,objectionId,documentsRead,onSaved}:{claimId:string;record:ReviewPageCase;
 csrf:string;nonce:string;operation:"documentary"|"claim-objection"|"claim-release";objectionId:string|null;documentsRead:boolean;onSaved:()=>void}) {
 const submission=useRef<AbortController|null>(null);
 useEffect(()=>()=>submission.current?.abort(),[]);
 const [openedAt]=useState(()=>Date.now());
 const [choice,setChoice]=useState("refuse-release"),[code,setCode]=useState<RefusalCode>("documentary_evidence_insufficient");
 const [reason,setReason]=useState(""),[adult,setAdult]=useState(false),[parent,setParent]=useState(false),[identity,setIdentity]=useState(false);
 const [objection,setObjection]=useState<Objection|null>(null),[busy,setBusy]=useState(false),[message,setMessage]=useState("");
 useEffect(()=>{
  if(operation!=="claim-objection"||!objectionId)return;
  const controller=new AbortController();
  (async()=>{try{
   const response=await fetch(`/api/reviews/future-person/claim-objections/${objectionId}`,{credentials:"same-origin",cache:"no-store",signal:controller.signal});
   const parsed=objectionCase.safeParse(await response.json()),ownCsrf=response.headers.get("x-inherit-csrf"),ownNonce=response.headers.get("x-inherit-review-nonce");
   if(response.status!==200||!parsed.success||parsed.data.objectionId!==objectionId||parsed.data.claimId!==claimId
    ||parsed.data.claimReviewRevision!==record.reviewRevision||record.notice.state==="not_applicable"||parsed.data.noticeRevision!==record.notice.noticeRevision
    ||parsed.data.reviewPackage.photoIdentityDocumentId!==record.evidence.photoIdentityDocumentId
    ||parsed.data.reviewPackage.birthRecordDocumentId!==record.evidence.birthRecordDocumentId
    ||!ownCsrf||!/^[0-9a-f]{64}$/u.test(ownCsrf)||!ownNonce||ownNonce.length>2048)throw new Error("unavailable");
   if(!controller.signal.aborted){setObjection({record:parsed.data,csrf:ownCsrf,nonce:ownNonce});setChoice("uphold-objection");}
  }catch{if(!controller.signal.aborted)setMessage("This case is not available. Reload this page and sign in again.");}})();
  return()=>controller.abort();
 },[operation,objectionId,claimId,record]);
 if(record.notice.state==="not_applicable")return null;
 const due=record.notice.deadline!==null&&Date.parse(record.notice.deadline)<=openedAt;
 const approval=choice==="approve-release",needsDocuments=operation==="claim-objection"||approval
  ||code==="documentary_evidence_insufficient"||code==="identity_profile_conflict";
 const canSubmit=!busy&&reason.trim().length>=20&&reason.length<=2000&&(!needsDocuments||documentsRead)
  &&(!approval||(adult&&parent&&identity&&due))&&(operation!=="claim-objection"||objection!==null);
 async function submit(event:FormEvent){
  event.preventDefault();if(!canSubmit||record.notice.state==="not_applicable")return;const controller=new AbortController();submission.current=controller;setBusy(true);setMessage("");
  try{
   const isObjection=operation==="claim-objection";
   const body=isObjection?{decision:choice,objectionRevision:objection!.record.objectionRevision,claimReviewRevision:record.reviewRevision,
    noticeRevision:record.notice.noticeRevision,reason,nonce:objection!.nonce}:
    {decision:choice,reviewRevision:record.reviewRevision,noticeRevision:record.notice.noticeRevision,reason,nonce,
     ...(approval?{}:{refusalCode:code})};
   const url=isObjection?`/api/reviews/future-person/claim-objections/${objectionId}`:`/api/reviews/future-person/claims/${claimId}/release`;
   const response=await fetch(url,{method:"POST",signal:controller.signal,credentials:"same-origin",headers:{"content-type":"application/json","x-inherit-csrf":isObjection?objection!.csrf:csrf},body:JSON.stringify(body)});
   const value:unknown=await response.json();if(controller.signal.aborted)throw new Error("unavailable");if(response.status!==200||value===null||typeof value!=="object"||Array.isArray(value))throw new Error("unavailable");
   const result=value as Record<string,unknown>;
   if(isObjection){const expected:Record<string,string>={"uphold-objection":"claim_rejected","overrule-objection":"release_recheck_required","needs-more-information":"more_information_required"};
    if(Object.keys(result).sort().join("|")!=="objectionId|objectionRevision|state"||result.objectionId!==objectionId
     ||result.objectionRevision!==objection!.record.objectionRevision+1||result.state!==expected[choice])throw new Error("unavailable");
   }else if(Object.keys(result).sort().join("|")!=="claimId|reviewRevision|state"||result.claimId!==claimId
    ||result.reviewRevision!==record.reviewRevision+1||result.state!==(approval?"release_queued":"refused"))throw new Error("unavailable");
   setReason("");setAdult(false);setParent(false);setIdentity(false);setObjection(null);onSaved();
  }catch{if(!controller.signal.aborted)setMessage("The decision was not saved. Reload this page and check the current case.");}finally{if(!controller.signal.aborted)setBusy(false);}
 }
 if(operation==="documentary"||operation==="claim-release"&&!due)return <section className="space-y-3 rounded-xl border p-4">
  <h2>Claim</h2><p>{record.notice.deadline===null?"The owner notice is waiting for delivery.":"The owner has 30 days from delivery to object. A fresh review is needed after that time."}</p>
  {record.notice.deadline!==null&&<p>Owner deadline: <time dateTime={record.notice.deadline}>{record.notice.deadline}</time>.</p>}
  <p>This claim is waiting. Open the case again when its next review is assigned.</p>
 </section>;
 return <section className="space-y-4 rounded-xl border p-4" aria-busy={busy}>
  <h2>Review claim</h2>
  {message&&<p role="status">{message}</p>}
  {objection&&<><h3>Details</h3><p className="whitespace-pre-wrap">{objection.record.statement}</p></>}
  <p>Read both full documents again. The earlier review cannot be used for this choice.</p>
  <form onSubmit={submit} className="space-y-4">
   <label className="block" htmlFor="keyless-current-choice">Choice</label>
   <select id="keyless-current-choice" value={choice} disabled={busy} onChange={event=>setChoice(event.target.value)}>
    {operation==="claim-objection"?<><option value="uphold-objection">Uphold objection</option><option value="overrule-objection">Overrule objection</option><option value="needs-more-information">Ask for more information</option></>:
     <><option value="refuse-release">Refuse release</option><option value="approve-release">Approve release</option></>}
   </select>
   {operation==="claim-release"&&!approval&&<><label className="block" htmlFor="keyless-refusal-code">Reason</label>
    <select id="keyless-refusal-code" value={code} disabled={busy} onChange={event=>setCode(event.target.value as RefusalCode)}>
     {Object.entries(refusalCodes).map(([value,label])=><option key={value} value={value}>{label}</option>)}
    </select></>}
   {approval&&documentsRead&&<fieldset disabled={busy} className="space-y-3"><legend>Current document checks</legend>
    <label className="block"><input type="checkbox" checked={identity} onChange={event=>setIdentity(event.target.checked)}/> I checked the name and birth date in both files.</label>
    <label className="block"><input type="checkbox" checked={adult} onChange={event=>setAdult(event.target.checked)}/> This person is an adult.</label>
    <label className="block"><input type="checkbox" checked={parent} onChange={event=>setParent(event.target.checked)}/> The birth record and the parent name match.</label>
   </fieldset>}
   <label className="block">Reason<textarea minLength={20} maxLength={2000} value={reason} disabled={busy} rows={5} onChange={event=>setReason(event.target.value)} required/></label>
   <button type="submit" disabled={!canSubmit}>Save choice</button>
  </form>
 </section>;
}
