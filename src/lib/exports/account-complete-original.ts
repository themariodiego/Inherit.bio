import "server-only";
import {createHash} from "node:crypto";
import {createGunzip} from "node:zlib";
import {z} from "zod";
import {preparedOriginalDownloadSourceSchema,streamVerifiedOriginalRanges,type OriginalRangeOptions} from "@/lib/uploads/prepared-original-download";
import {originalFileExtension} from "@/lib/uploads/original-download-name";
import type {prepareAccountCompleteReader} from "./account-complete-reader";
import type {RequesterStatementRuntime} from "./requester-statement-runtime";
import type {Zip64Member} from "./archive-zip64";

const uuid=z.uuid(),hash=z.string().regex(/^[a-f0-9]{64}$/u),date=z.iso.datetime({offset:true}),positive=z.number().int().positive().safe();
const ordinary=z.object({version:z.literal("account-original-download-v1"),fileId:uuid,sourceRevision:positive,
 rawSha256:hash,bucket:z.literal("genomes"),objectId:uuid,objectKey:uuid,storageVersion:z.uuid({version:"v4"}),
 sizeBytes:positive,expiresAt:date}).strict();
const byteSource=z.discriminatedUnion("version",[ordinary,preparedOriginalDownloadSourceSchema]);
const receiptSchema=z.object({version:z.literal("account-complete-original-v1"),exportId:uuid,attemptId:uuid,
 authorityReceipt:hash,fileId:uuid,subjectId:uuid,rawAuthoritySha256:hash,decodedSha256:hash,
 state:z.object({version:z.literal("own-original-download-state-v1"),fileId:uuid,prepared:z.boolean(),retired:z.boolean(),expiresAt:date.nullable()}).strict(),
 source:byteSource.nullable(),actor:z.object({accountId:uuid,sessionId:uuid}).strict()}).strict();
type Source=z.infer<typeof byteSource>;
type Reader=Awaited<ReturnType<typeof prepareAccountCompleteReader>>;
type File={fileId:string;subjectId:string;fileType:string;sourceRevision:number;sizeBytes:number;rawSha256:string;
 decodedSha256:string;rawAuthoritySha256:string;originalRetired:boolean;preparedSource:{manifestId:string}|null};
const unavailable=()=>new Error("account_complete_original_unavailable");

/** The foreign physical source remains owned by its genuine uploader. Only the
 * consumed requesting-account attempt and its distinct current raw-export
 * tuple authorize this read; no own-subject snapshot or foreign session is
 * fabricated. Both raw EOF and decoded identity are checked before assembly. */
export async function prepareAccountCompleteOriginal(options:{reader:Reader;file:File;
 reference:{exportId:string;attemptId:string;authorityReceipt:string};signal:AbortSignal;
 runtime:RequesterStatementRuntime;readRange?:OriginalRangeOptions<Source>["readRange"]}){
 const {file,reader,runtime}=options,context=reader.context;
 if(!context.partitions.some(p=>p.class==="consent-covered"&&p.subjectId===file.subjectId&&p.fileIds.includes(file.fileId))
  ||context.authorityReceipt!==options.reference.authorityReceipt)throw unavailable();
 let captured:z.infer<typeof receiptSchema>|undefined;
 const active=(signal:AbortSignal)=>{if(options.signal.aborted||signal.aborted||Date.now()>=Date.parse(context.deadline)
  ||captured?.source&&Date.now()>=Date.parse(captured.source.expiresAt))throw unavailable();};
 async function check(signal:AbortSignal){
  active(signal);await reader.check(signal);
  const value=receiptSchema.parse(await reader.original(file.fileId,captured??null,signal));
  if(value.exportId!==options.reference.exportId||value.attemptId!==options.reference.attemptId
   ||value.authorityReceipt!==context.authorityReceipt||value.fileId!==file.fileId||value.subjectId!==file.subjectId
   ||value.rawAuthoritySha256!==file.rawAuthoritySha256||value.decodedSha256!==file.decodedSha256
   ||value.actor.accountId!==context.actor.accountId||value.actor.sessionId!==context.actor.sessionId
   ||value.state.fileId!==file.fileId||value.state.prepared!==Boolean(file.preparedSource)
   ||value.state.retired!==file.originalRetired||value.state.retired!==(value.source===null)
   ||value.state.retired&&!value.state.prepared||captured&&JSON.stringify(value)!==JSON.stringify(captured))throw unavailable();
  const source=value.source;
  if(source&&(source.fileId!==file.fileId||source.sourceRevision!==file.sourceRevision||source.rawSha256!==file.rawSha256
   ||source.sizeBytes!==file.sizeBytes||Date.parse(source.expiresAt)>Date.parse(context.deadline)||Date.parse(source.expiresAt)<=Date.now()
   ||(source.version==="prepared-original-download-v1")!==Boolean(file.preparedSource)
   ||source.version==="prepared-original-download-v1"&&source.manifestId!==file.preparedSource?.manifestId))throw unavailable();
  captured??=value;await reader.check(signal);active(signal);
 }
 await check(options.signal);const receipt=captured!;
 if(receipt.state.retired)return {member:null,check};
 const source=receipt.source!;
 async function* chunks(signal:AbortSignal){
  for await(const bytes of streamVerifiedOriginalRanges({source,signal:AbortSignal.any([options.signal,signal]),
   check:async(_expected,current)=>check(current),readRange:options.readRange},byteSource)){
   runtime.own(bytes);try{active(signal);yield bytes;}finally{runtime.clear(bytes);}
  }
 }
 const stop=new AbortController(),signal=AbortSignal.any([options.signal,stop.signal]),iterator=chunks(signal),digest=createHash("sha256");
 let decoded:ReturnType<typeof createGunzip>|undefined,closed:Promise<void>|undefined;
 let abortDecode:()=>void=()=>{},removeDecodeListeners:()=>void=()=>{};
 try{
  let next=await runtime.track("complete-original-first",()=>iterator.next());active(signal);
  if(next.done||!next.value.length)throw unavailable();
  if(next.value[0]===0x1f&&next.value[1]===0x8b){
   const decoder=decoded=createGunzip();let ended=false,decodeFailed=false;
   closed=new Promise<void>(resolve=>decoder.once("close",resolve));
   const consume=(raw:Buffer)=>{
    let bytes:Buffer|undefined;
    try{bytes=runtime.own(raw);active(signal);digest.update(bytes);}
    catch{decodeFailed=true;decoder.destroy(unavailable());}
    finally{if(bytes)try{runtime.clear(bytes);}catch{decodeFailed=true;decoder.destroy(unavailable());}}
   };
   decoder.on("data",consume);
   const decodedCompletion=new Promise<void>((resolve,reject)=>{
    const finish=()=>{ended=true;if(decodeFailed)reject(unavailable());else resolve();};
    const error=()=>{decodeFailed=true;reject(unavailable());};
    const close=()=>{if(!ended){decodeFailed=true;reject(unavailable());}};
    decoder.once("end",finish);decoder.on("error",error);decoder.once("close",close);
    removeDecodeListeners=()=>{decoder.removeListener("data",consume);decoder.removeListener("end",finish);
     decoder.removeListener("error",error);decoder.removeListener("close",close);};
   });
   // All actual decoder listeners and the tracked EOF task precede its first write.
   void decodedCompletion.catch(()=>{});
   const completion=runtime.track("complete-original-decode-eof",()=>decodedCompletion);
   abortDecode=()=>{decodeFailed=true;decoder.destroy(unavailable());};
   signal.addEventListener("abort",abortDecode,{once:true});
   while(!next.done){
    active(signal);const bytes=next.value;
    await runtime.wait(runtime.track("complete-original-decode-write",()=>new Promise<void>((resolve,reject)=>{
     let settled=false;
     const settle=(refused:boolean)=>{
      if(settled)return;settled=true;
      decoder.removeListener("error",failed);decoder.removeListener("close",failed);
      if(refused||decodeFailed)reject(unavailable());else resolve();
     };
     const failed=()=>settle(true);
     // An actual error/close must settle this owned write even when the native
     // callback is absent. Only the actual successful callback may resolve it.
     decoder.once("error",failed);decoder.once("close",failed);
     try{
      if(decoder.destroyed||decoder.closed||decodeFailed)failed();
      else decoder.write(bytes,error=>settle(Boolean(error)));
     }catch{failed();}
    })),Date.parse(context.deadline));
    // Advancing clears the previous owned raw range. Its actual decoder write
    // callback has settled first, so a buffered consumer no longer uses it.
    next=await runtime.track("complete-original-verify-next",()=>iterator.next());
   }
   decoder.end();await runtime.wait(completion,Date.parse(context.deadline));active(signal);
  }else{
   while(!next.done){active(signal);digest.update(next.value);
    next=await runtime.track("complete-original-verify-next",()=>iterator.next());}
  }
  if(digest.digest("hex")!==file.decodedSha256)throw unavailable();await check(signal);
 }catch{throw unavailable();}
 finally{
  signal.removeEventListener("abort",abortDecode);stop.abort();decoded?.destroy();
  await runtime.wait(runtime.cleanup("complete-original-verify-close",async()=>{
   // Keep the decoder handlers and yielded raw range owned until actual close.
   // A timed-out caller cannot turn this pending cleanup into a disposition ACK.
   if(closed)await closed;
   try{removeDecodeListeners();}finally{await iterator.return(undefined);}
  }),Date.parse(context.deadline));
 }
 const extension=originalFileExtension({file_type:file.fileType,sha256:file.rawSha256,source_sha256:file.decodedSha256});
 const member:Zip64Member={name:`originals/${file.fileId}/original${extension}`,sizeBytes:source.sizeBytes,open:async current=>{
  await check(current);const stop=new AbortController(),signal=AbortSignal.any([options.signal,current,stop.signal]);
  const iterator=chunks(signal);let closed=false;
  const close=()=>runtime.wait(runtime.cleanup("complete-original-member-close",()=>iterator.return(undefined)),Date.parse(context.deadline));
  return new ReadableStream<Uint8Array>({async pull(controller){
   try{if(closed)throw unavailable();active(signal);const next=await runtime.track("complete-original-member-next",()=>iterator.next());active(signal);
    if(next.done){closed=true;stop.abort();controller.close();}else controller.enqueue(next.value);
   }catch{closed=true;stop.abort();controller.error(unavailable());await close();}
  },async cancel(){closed=true;stop.abort();await close();}},{highWaterMark:0});
 }};
 return {member,check};
}
