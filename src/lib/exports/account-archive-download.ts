import {createSHA256} from "hash-wasm";
import {accountExportDownload,type AccountExportDownload} from "./account-export-delivery-contract";

export type AccountArchiveDownloadSink=Readonly<{
 write(bytes:Uint8Array):Promise<void>;close():Promise<void>;abort():Promise<void>;
}>;
type Transport=(input:string,init:RequestInit)=>Promise<Response>;
const unavailable=()=>new Error("account_archive_download_unavailable");
const digestPattern=/^[a-f0-9]{64}$/u,receiptPattern=/^[A-Za-z0-9_-]{43}$/u;
function hex(value:ArrayBuffer){return [...new Uint8Array(value)].map(byte=>byte.toString(16).padStart(2,"0")).join("");}
async function settle(operation:Promise<unknown>){
 let timer:ReturnType<typeof setTimeout>|undefined;
 try{await Promise.race([operation,new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(unavailable()),5_000);})]);}
 catch{throw unavailable();}finally{if(timer)clearTimeout(timer);}
}

/** The one archive is assembled into an explicit user-selected streaming sink.
 * At most one bounded chunk is retained. Every actual EOF/hash and sink write
 * precedes its once-only receipt; total ZIP bytes/SHA precede final sink close.
 * Refusal/cancellation aborts the partial sink and never retries a sequence. */
export async function downloadAccountArchive(options:{download:AccountExportDownload;sink:AccountArchiveDownloadSink;
 signal:AbortSignal;transport?:Transport}){
 let finished=false,abort:Promise<void>|undefined,closing:Promise<void>|undefined;
 const abortSink=()=>abort??=Promise.resolve().then(()=>options.sink.abort());
 try{
  const download=accountExportDownload.parse(options.download),transport=options.transport??fetch;
  const archive=await createSHA256();archive.init();let total=0;
  for(let sequence=0;sequence<download.chunkCount;sequence++){
   const expected=Math.min(download.chunkBytes,download.sizeBytes-sequence*download.chunkBytes);
   const stop=new AbortController(),signal=AbortSignal.any([options.signal,stop.signal]);
   let interrupt=()=>{},reader:ReadableStreamDefaultReader<Uint8Array>|undefined,response:Response|undefined;
   let write:Promise<void>|undefined,writeSettled=true;
   const timer=setTimeout(()=>stop.abort(),30_000);
   const canceled=new Promise<never>((_,reject)=>{interrupt=()=>reject(unavailable());signal.addEventListener("abort",interrupt,{once:true});});
   const bytes=new Uint8Array(expected);
   try{
    if(signal.aborted)throw unavailable();
    const pending=transport(`/api/downloads/${download.session}/chunks/${sequence}`,{
     method:"GET",cache:"no-store",credentials:"same-origin",redirect:"error",signal});
    void pending.then(value=>{if(signal.aborted)void value.body?.cancel().catch(()=>{});},()=>{});
    response=await Promise.race([pending,canceled]);
    const sha=response.headers.get("x-inherit-chunk-sha256"),receipt=response.headers.get("x-inherit-chunk-receipt"),csrf=response.headers.get("x-inherit-csrf");
    if(response.status!==200||response.redirected||response.headers.get("content-type")!=="application/octet-stream"
     ||response.headers.get("content-encoding")!=="identity"||response.headers.get("content-length")!==String(expected)
     ||!sha||!digestPattern.test(sha)||!receipt||!receiptPattern.test(receipt)||!csrf||!digestPattern.test(csrf)||!response.body)throw unavailable();
    reader=response.body.getReader();let count=0;
    for(;;){const next=await Promise.race([reader.read(),canceled]);if(next.done)break;
     if(!(next.value instanceof Uint8Array)||next.value.byteLength===0||count+next.value.byteLength>expected)throw unavailable();
     bytes.set(next.value,count);count+=next.value.byteLength;
    }
    if(signal.aborted||count!==expected||hex(await crypto.subtle.digest("SHA-256",bytes))!==sha)throw unavailable();
    archive.update(bytes);total+=count;
    writeSettled=false;write=Promise.resolve().then(()=>options.sink.write(bytes)).finally(()=>{writeSettled=true;});
    await Promise.race([write,canceled]);
    if(signal.aborted)throw unavailable();
    const ack=await Promise.race([transport(`/api/downloads/${download.session}/chunks/${sequence}/acknowledge`,{
     method:"POST",cache:"no-store",credentials:"same-origin",redirect:"error",signal,
     headers:{"Content-Type":"application/json","X-Inherit-CSRF":csrf},body:JSON.stringify({receipt,sha256:sha,sizeBytes:count})}),canceled]);
    try{
     if(ack.status!==204||ack.redirected||ack.headers.has("location")||ack.headers.has("set-cookie"))throw unavailable();
     if(ack.body){const ackReader=ack.body.getReader();try{const eof=await Promise.race([ackReader.read(),canceled]);if(!eof.done)throw unavailable();}
      finally{try{await settle(ackReader.cancel());}finally{ackReader.releaseLock();}}}
    }finally{if(ack.body&&!ack.body.locked)await settle(ack.body.cancel());}
   }finally{
    clearTimeout(timer);signal.removeEventListener("abort",interrupt);stop.abort();
    // A canceled sink write still owns this buffer until it really settles.
    // Keep the reference on refusal; do not clear data underneath an active write.
    if(write&&!writeSettled)void write.then(()=>bytes.fill(0),()=>bytes.fill(0));
    try{
     const cleanup:Promise<unknown>[]=[];
     if(reader)cleanup.push(reader.cancel());else if(response?.body)cleanup.push(response.body.cancel());
     if(write&&!writeSettled)cleanup.push(abortSink(),write.catch(()=>{}));
     await settle(Promise.all(cleanup));
    }finally{if(writeSettled)bytes.fill(0);if(reader)reader.releaseLock();}
   }
  }
  if(options.signal.aborted||total!==download.sizeBytes||archive.digest("hex")!==download.sha256)throw unavailable();
  const stop=new AbortController(),signal=AbortSignal.any([options.signal,stop.signal]);let interrupt=()=>{};
  const timer=setTimeout(()=>stop.abort(),30_000);
  const canceled=new Promise<never>((_,reject)=>{interrupt=()=>reject(unavailable());signal.addEventListener("abort",interrupt,{once:true});});
  try{
   if(signal.aborted)throw unavailable();closing=Promise.resolve().then(()=>options.sink.close());
   await Promise.race([closing,canceled]);if(signal.aborted)throw unavailable();finished=true;
  }finally{clearTimeout(timer);signal.removeEventListener("abort",interrupt);stop.abort();}
  return Object.freeze({sizeBytes:total,sha256:download.sha256});
 }finally{if(!finished)await settle(Promise.all([abortSink(),closing?.catch(()=>{})]));}
}

/** The file picker is invoked synchronously from the explicit click, before a
 * network await can consume its user activation. No whole-archive Blob fallback. */
export function chooseAccountArchiveSink():Promise<AccountArchiveDownloadSink>{
 const browser=globalThis as typeof globalThis&{showSaveFilePicker?:(options:{suggestedName:string;
  types:{description:string;accept:Record<string,string[]>}[]})=>Promise<{createWritable():Promise<AccountArchiveDownloadSink>}>};
 if(typeof browser.showSaveFilePicker!=="function")return Promise.reject(unavailable());
 return browser.showSaveFilePicker({suggestedName:"inherit-account-export.zip",
  types:[{description:"ZIP archive",accept:{"application/zip":[".zip"]}}]}).then(handle=>handle.createWritable());
}
