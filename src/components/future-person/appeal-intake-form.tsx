"use client";
import {useState,type FormEvent} from "react";
export function AppealIntakeForm({formToken}:{formToken:string}){
 const [kind,setKind]=useState("subject-objection"),[status,setStatus]=useState<"ready"|"sending"|"received"|"failed">("ready");
 async function submit(event:FormEvent<HTMLFormElement>){
  event.preventDefault();if(status==="sending")return;setStatus("sending");const form=event.currentTarget,values=new FormData(form);
  const reference=String(values.get("reference")??"").trim(),body:Record<string,unknown>={kind,claimantName:String(values.get("claimantName")??""),
   contactEmail:String(values.get("contactEmail")??""),statement:String(values.get("statement")??""),affirmed:values.get("affirmed")==="on"};
  if(reference)body[kind==="subject-objection"?"subjectReference":kind==="genetic-parent-objection"?"cohortReference":"decisionReference"]=reference;
  try{const response=await fetch("/api/appeals",{method:"POST",credentials:"same-origin",headers:{"content-type":"application/json","x-inherit-csrf":formToken},
   body:JSON.stringify(body)});const reply:unknown=await response.json();
   if(response.status===202&&typeof reply==="object"&&reply!==null&&Object.keys(reply).length===1&&"status" in reply&&reply.status==="received"){
    form.reset();setStatus("received");return;}setStatus("failed");}
  catch{setStatus("failed");}
 }
 return <section aria-labelledby="test-appeal-intake-title"><h2 id="test-appeal-intake-title">Send a request</h2>
  <p>This form is for the test service. Do not send DNA or identity documents here.</p>
  <form onSubmit={submit} hidden={status==="received"}>
   <label htmlFor="appeal-request-type">Request type</label>
   <select id="appeal-request-type" name="kind" value={kind} onChange={event=>setKind(event.target.value)}>
    <option value="subject-objection">My DNA was used without my consent</option><option value="genetic-parent-objection">Genetic parent objection</option>
    <option value="access-or-review-appeal">Review a decision</option></select>
   <label>Your name<input name="claimantName" autoComplete="name" required minLength={2} maxLength={240}/></label>
   <label>Your email address<input name="contactEmail" type="email" autoComplete="email" required maxLength={254}/></label>
   <label>Request or record reference, if available<input name="reference" maxLength={240}/></label>
   <label>Why do you want to make this request? Use 20 to 8,000 characters.<textarea name="statement" required minLength={20} maxLength={8000}/></label>
   <label><input name="affirmed" type="checkbox" required/>These details match what I know.</label>
   <button type="submit" disabled={status==="sending"}>{status==="sending"?"We send your request now":"Send request"}</button>
  </form>
  <p role="status">{status==="received"?"Request sent.":status==="failed"?"The request could not be sent. Check your details and try again.":""}</p>
 </section>;
}
