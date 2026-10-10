import {z} from "zod";

const proof=z.object({operation:z.literal("create"),nonce:z.string().min(1).max(2048),csrf:z.string().min(1).max(2048)}).strict();
export type AccountExportControl={available:false}|{available:true;create:z.infer<typeof proof>};
const preparing=z.object({status:z.literal("preparing"),exportId:z.uuid()}).strict();
type Transport=(input:string,init:RequestInit)=>Promise<Response>;
const unavailable=()=>new Error("account_export_unavailable");

/** Same-origin browser transport only. The page's distinct CSRF/action pair
 * is used once by the explicit action; polling uses only the HttpOnly cookie.
 * No READY/download fallback, caller account/subject or automatic retry. */
export async function requestAccountExport(options:{operation:"create"|"check";control:AccountExportControl;
 expectedExportId:string|null;signal:AbortSignal;transport?:Transport}){
 const transport=options.transport??fetch,stop=new AbortController(),signal=AbortSignal.any([options.signal,stop.signal]);
 let interrupt=()=>{};const timer=setTimeout(()=>stop.abort(),30_000);
 const canceled=new Promise<never>((_,reject)=>{interrupt=()=>reject(unavailable());signal.addEventListener("abort",interrupt,{once:true});});
 let reader:ReadableStreamDefaultReader<Uint8Array>|undefined;
 let response:Response|undefined;
 try{
  if(signal.aborted||!['create','check'].includes(options.operation))throw unavailable();
  let init:RequestInit={method:"GET",cache:"no-store",credentials:"same-origin",redirect:"error",signal};
  if(options.operation==="create"){
   if(!options.control.available)throw unavailable();const create=proof.parse(options.control.create);
   init={...init,method:"POST",headers:{"Content-Type":"application/json","X-Inherit-CSRF":create.csrf},
    body:JSON.stringify({operation:create.operation,nonce:create.nonce})};
  }
  const pending=transport("/api/export",init);
  void pending.then(value=>{if(signal.aborted)void value.body?.cancel().catch(()=>{});},()=>{});
  response=await Promise.race([pending,canceled]);
  if(response.status!==202||response.redirected||response.headers.get("content-type")?.split(";")[0].trim().toLowerCase()!=="application/json"
   ||!response.body||signal.aborted)throw unavailable();
  reader=response.body.getReader();let bytes=0;const parts:Uint8Array[]=[];
  for(;;){const item=await Promise.race([reader.read(),canceled]);if(item.done)break;
   bytes+=item.value.byteLength;if(bytes>4096||signal.aborted)throw unavailable();parts.push(item.value);}
  const all=new Uint8Array(bytes);let offset=0;for(const part of parts){all.set(part,offset);offset+=part.byteLength;}
  const result=preparing.parse(JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(all)));
  if(signal.aborted||options.expectedExportId!==null&&result.exportId!==options.expectedExportId)throw unavailable();
  return result;
 }finally{clearTimeout(timer);signal.removeEventListener("abort",interrupt);stop.abort();
  if(reader){void reader.cancel().catch(()=>{});reader.releaseLock();}
  else if(response?.body)void response.body.cancel().catch(()=>{});}
}
