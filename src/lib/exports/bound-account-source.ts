import "server-only";
import {z} from "zod";
import {boundSourceManifestSchema} from "@/lib/future-person/bound-source-reader";
import {futurePersonClaimsOpen} from "@/lib/future-person/claims-open";
import {readRelocation} from "@/lib/future-person/relocation-transport";
import type {Zip64Member} from "./archive-zip64";
const reference=z.object({exportId:z.uuid(),attemptId:z.uuid(),authorityReceipt:z.string().regex(/^[a-f0-9]{64}$/)}).strict();
const envelope=reference.extend({version:z.literal("bound-account-archive-source-v1"),source:boundSourceManifestSchema}).strict();
type Reference=z.infer<typeof reference>;
export type BoundArchiveSourceRpc=(name:"export_archive_bound_source_v1",args:{p_operation:"manifest"|"check";
 p_export_id:string;p_attempt_id:string;p_authority_receipt:string;p_expected:unknown},signal:AbortSignal)=>PromiseLike<{data:unknown;error:unknown}>;
const unavailable=()=>new Error("bound_account_archive_source_unavailable");
/** One required source partition for the complete account archive executor.
 * Never an archive by itself. The SQL door selects the account/session from
 * the genuine consumed request and writing attempt, not a human JWT supplied
 * to a background worker. Provider bytes are read through the distinct current
 * relocation audience to complete EOF before even a member descriptor returns.
 * No provider paths, signing capabilities or historical actor guess enters ZIP. */
export async function prepareBoundAccountArchiveSource(value:unknown,rpc:BoundArchiveSourceRpc,signal:AbortSignal,preparationSignal:AbortSignal=signal){
 const selected=reference.safeParse(value);if(!selected.success||!futurePersonClaimsOpen()||signal.aborted)throw unavailable();
 const ref:Reference=selected.data;let receipt:z.infer<typeof envelope>|undefined;
 async function call(operation:"manifest"|"check",current:AbortSignal){
  const timeout=new AbortController(),combined=AbortSignal.any([signal,current,timeout.signal]);
  const end=Math.min(Date.now()+30_000,receipt?Date.parse(receipt.source.expiresAt):Infinity);
  const timer=setTimeout(()=>timeout.abort(),Math.max(0,end-Date.now()));timer.unref();let abort=()=>{};
  const interrupted=new Promise<never>((_,reject)=>{abort=()=>reject(unavailable());combined.addEventListener("abort",abort,{once:true});});
  try{
   if(combined.aborted||Date.now()>=end)throw unavailable();
   const reply=await Promise.race([Promise.resolve(rpc("export_archive_bound_source_v1",{p_operation:operation,
    p_export_id:ref.exportId,p_attempt_id:ref.attemptId,p_authority_receipt:ref.authorityReceipt,
    p_expected:operation==="check"?receipt!.source:null},combined)),interrupted]);
   if(combined.aborted||Date.now()>=end||reply.error!==null)throw unavailable();
   const parsed=envelope.safeParse(reply.data);
   if(!parsed.success||parsed.data.exportId!==ref.exportId||parsed.data.attemptId!==ref.attemptId
    ||parsed.data.authorityReceipt!==ref.authorityReceipt||(receipt&&JSON.stringify(parsed.data)!==JSON.stringify(receipt)))throw unavailable();
   if(Date.parse(parsed.data.source.expiresAt)<=Date.now())throw unavailable();return parsed.data;
  }finally{clearTimeout(timer);combined.removeEventListener("abort",abort);timeout.abort();}
 }
 try{
  receipt=await call("manifest",preparationSignal);const source=receipt.source;
  const members:Zip64Member[]=[],descriptors=[];
  for(const part of source.parts){
   await call("check",preparationSignal);const data=await readRelocation(part.target,part.identity,AbortSignal.any([signal,preparationSignal]));await call("check",preparationSignal);
   const name=`originals/${source.fileId}/canonical-part-${String(part.sequence).padStart(4,"0")}.vcf`;
   descriptors.push({name,sequence:part.sequence,partId:part.partId,sizeBytes:data.byteLength,sha256:part.target.sha256});
   members.push({name,sizeBytes:data.byteLength,open:async current=>{
    await call("check",current);let offset=0;return new ReadableStream<Uint8Array>({async pull(controller){
     try{await call("check",current);if(offset===data.byteLength){controller.close();return;}
      const next=data.slice(offset,offset+4_000_000);offset+=next.byteLength;controller.enqueue(next);
     }catch{controller.error(unavailable());}
    }},{highWaterMark:0});
   }});
  }
  await call("check",preparationSignal);
  // Closed archival provenance, deliberately excludes actor sessions, source
  // provider locators/versions, parent identifiers and credential machinery.
  const provenance={version:"bound-account-archive-source-v1",projection:"sanitized-autosomal-canonical-parts",
   byteIdenticalToUpload:false,subjectId:source.subjectId,fileId:source.fileId,
   sourceSha256:source.sourceSha256,membershipSha256:source.membershipSha256,publicationRevision:source.publicationRevision,
   byteCount:source.byteCount,partCount:source.partCount,parts:descriptors};
  return {members,provenance};
 }catch{throw unavailable();}
}
