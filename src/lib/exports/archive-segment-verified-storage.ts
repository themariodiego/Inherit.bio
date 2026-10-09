import "server-only";
import {createHash} from "node:crypto";
import {createSupabaseArchiveWriter} from "./archive-segment-storage";
import {createSupabaseArchiveReader} from "./archive-segment-read-storage";
import {ARCHIVE_OPERATION_TIMEOUT_MS,ARCHIVE_SEGMENT_BYTES,ArchiveSegmentationError,
 validateArchiveSegment,type ArchiveAttempt,type ArchiveSegment,type ArchiveSegmentationOptions} from "./archive-segments";
import type {ArchiveSegmentObject} from "./archive-segment-reader";

/** An internal transport seam, not provider approval or an authority door.
 * assertCurrent must independently prove the exact current store configuration,
 * live originating authority, exact reserved segment and deployed late-write
 * fence/cleanup contract. A bucket setting, service key, historical test receipt
 * or request flag is insufficient.
 * No such live proof is currently supplied; the default generation stays null.
 * Only the existing durable segment core may supply an authorized reservation.
 * This adapter proves physical segment bytes, not ZIP/member completion, READY,
 * erasure, a download or mail. It never cleans up or adopts an uncertain write. */
export function createVerifiedSupabaseArchiveWriter(config:{
 origin:string;serviceRoleKey:string;fetch?:typeof fetch;
 assertCurrent:(attempt:ArchiveAttempt,segment:ArchiveSegment,signal:AbortSignal)=>Promise<void>;
}):ArchiveSegmentationOptions["write"]{
 if(typeof config.assertCurrent!=="function")throw new ArchiveSegmentationError("invalid_input");
 // Both adapters receive the same immutable configuration. Later mutation of
 // the caller's configuration cannot retarget the POST, credentials or readback.
 const pinned=Object.freeze({origin:config.origin,serviceRoleKey:config.serviceRoleKey,fetch:config.fetch});
 const current=config.assertCurrent,transport=pinned.fetch??fetch;
 // Reuse both existing constructors' exact configuration refusals, without IO.
 createSupabaseArchiveWriter(pinned);createSupabaseArchiveReader(pinned);
 return async(givenAttempt,givenSegment,bytes,callerSignal)=>{
  validateArchiveSegment(givenAttempt,givenSegment);
  const attempt=Object.freeze({...givenAttempt}),segment=Object.freeze({...givenSegment});
  validateArchiveSegment(attempt,segment);
  if(!(callerSignal instanceof AbortSignal)||!(bytes instanceof Uint8Array)
   ||bytes.byteLength!==segment.sizeBytes||bytes.byteLength<1||bytes.byteLength>ARCHIVE_SEGMENT_BYTES
   ||createHash("sha256").update(bytes).digest("hex")!==segment.sha256)
   throw new ArchiveSegmentationError("invalid_input");
  const stop=new AbortController(),signal=AbortSignal.any([callerSignal,stop.signal]);
  const deadline=Date.now()+ARCHIVE_OPERATION_TIMEOUT_MS;
  let closed=false,body:ReadableStream<Uint8Array>|undefined,reader:ReadableStreamDefaultReader<Uint8Array>|undefined;
  const cancel=()=>{try{void(reader?reader.cancel():body?.cancel())?.catch(()=>{});}catch{/* Never await cancellation. */}};
  const fail=()=>new ArchiveSegmentationError("storage",true);
  const active=()=>{if(closed||signal.aborted||Date.now()>=deadline)throw fail();};
  let interrupt=()=>{};
  const interrupted=new Promise<never>((_,reject)=>{interrupt=()=>{cancel();reject(fail());};});
  void interrupted.catch(()=>{});
  signal.addEventListener("abort",interrupt,{once:true});
  const timer=setTimeout(()=>stop.abort(),ARCHIVE_OPERATION_TIMEOUT_MS);timer.unref();
  async function bounded<T>(work:()=>Promise<T>):Promise<T>{
   active();const value=await Promise.race([Promise.resolve().then(()=>{active();return work();}),interrupted]);
   active();return value;
  }
  function cancelLate(object:ArchiveSegmentObject){
   if(closed||signal.aborted){try{void object.body.cancel().catch(()=>{});}catch{/* Late bytes stay private. */}}
  }
  const guardedFetch:typeof fetch=async(input,init)=>{
   if(init?.signal!==signal)throw fail();
   // Recheck before each POST, metadata GET and full-object GET, not just once
   // for the multi-request readback. This cannot approve a provider by itself.
   await bounded(()=>current(attempt,segment,signal));active();
   const pending=transport(input,init);
   void pending.then(value=>{if(closed||signal.aborted){try{void value.body?.cancel().catch(()=>{});}catch{/* Late response. */}}},()=>{});
   const value=await pending;
   try{active();}catch(error){try{void value.body?.cancel().catch(()=>{});}catch{/* No erasure claim. */}throw error;}
   return value;
  };
  const scoped=Object.freeze({...pinned,fetch:guardedFetch});
  const write=createSupabaseArchiveWriter(scoped),read=createSupabaseArchiveReader(scoped);
  try{
   active();
   const ack=await bounded(()=>write(attempt,segment,bytes,signal));
   const stored=Object.freeze({...segment,objectId:ack.objectId});validateArchiveSegment(attempt,stored,true);
   const object=await bounded(()=>{
    const pending=read(attempt,stored,signal);void pending.then(cancelLate,()=>{});return pending;
   });
   body=object.body;
   if(object.objectId!==stored.objectId||object.objectKey!==stored.objectKey||object.sizeBytes!==stored.sizeBytes
    ||!(body instanceof ReadableStream))throw fail();
   reader=body.getReader();let length=0;const hash=createHash("sha256");
   for(;;){
    const next=await bounded(()=>reader!.read());if(next.done)break;
    if(!(next.value instanceof Uint8Array)||!next.value.byteLength||next.value.byteLength>segment.sizeBytes-length)throw fail();
    length+=next.value.byteLength;hash.update(next.value);
   }
   // The storage reader checks immutable object/version/ETag again at EOF.
   // No segment buffer or provider bytes are returned to any request caller.
   if(length!==segment.sizeBytes||hash.digest("hex")!==segment.sha256
    ||createHash("sha256").update(bytes).digest("hex")!==segment.sha256)throw fail();
   await bounded(()=>current(attempt,segment,signal));active();
   return Object.freeze({objectId:stored.objectId});
  }catch{throw fail();}
  finally{
   closed=true;clearTimeout(timer);signal.removeEventListener("abort",interrupt);stop.abort();cancel();
   try{reader?.releaseLock();}catch{/* An aborted read may still be settling. */}
  }
 };
}
