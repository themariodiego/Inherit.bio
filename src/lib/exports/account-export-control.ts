import {z} from "zod";
import {accountExportPreparing,accountExportReady,accountExportDownload} from "./account-export-delivery-contract";

const proof=z.object({operation:z.literal("create"),nonce:z.string().min(1).max(2048),csrf:z.string().min(1).max(2048)}).strict();
export const accountExportOpenProof=accountExportReady.extend({operation:z.literal("open-ready"),
 nonce:z.string().min(1).max(2048),csrf:z.string().min(1).max(2048)}).strict();
export type AccountExportControl={available:false}|{available:true;create:z.infer<typeof proof>;open?:z.infer<typeof accountExportOpenProof>};
type Transport=(input:string,init:RequestInit)=>Promise<Response>;
const unavailable=()=>new Error("account_export_unavailable");

/** Same-origin browser transport only. The page's distinct CSRF/action pair
 * is used once by the explicit action; polling uses only the HttpOnly cookie.
 * READY metadata has no action secret. Opening uses only the distinct proof
 * from the server-rendered page; no caller scope or automatic retry exists. */
/** The two same-origin export routes this transport may address: the account
 * export, or one record's export (api.subject-export). */
const EXPORT_ROUTE=/^\/api\/(?:export|subjects\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/export)$/u;
export async function requestAccountExport(options:{operation:"create"|"check"|"open-ready";control:AccountExportControl;
 expectedExportId:string|null;signal:AbortSignal;transport?:Transport;route?:string}){
 const transport=options.transport??fetch,stop=new AbortController(),signal=AbortSignal.any([options.signal,stop.signal]);
 let interrupt=()=>{};const timer=setTimeout(()=>stop.abort(),30_000);
 const canceled=new Promise<never>((_,reject)=>{interrupt=()=>reject(unavailable());signal.addEventListener("abort",interrupt,{once:true});});
 let reader:ReadableStreamDefaultReader<Uint8Array>|undefined;
 let response:Response|undefined;
 try{
  const route=options.route??"/api/export";
  if(signal.aborted||!['create','check','open-ready'].includes(options.operation)||!EXPORT_ROUTE.test(route))throw unavailable();
  let init:RequestInit={method:"GET",cache:"no-store",credentials:"same-origin",redirect:"error",signal};
  if(options.operation==="create"){
   if(!options.control.available)throw unavailable();const create=proof.parse(options.control.create);
   init={...init,method:"POST",headers:{"Content-Type":"application/json","X-Inherit-CSRF":create.csrf},
    body:JSON.stringify({operation:create.operation,nonce:create.nonce})};
  }
  if(options.operation==="open-ready"){
   if(!options.control.available||!options.control.open)throw unavailable();
   const open=accountExportOpenProof.parse(options.control.open);
   if(options.expectedExportId!==open.exportId)throw unavailable();
   init={...init,method:"POST",headers:{"Content-Type":"application/json","X-Inherit-CSRF":open.csrf},
    body:JSON.stringify({operation:open.operation,nonce:open.nonce})};
  }
  const pending=transport(route,init);
  void pending.then(value=>{if(signal.aborted)void value.body?.cancel().catch(()=>{});},()=>{});
  response=await Promise.race([pending,canceled]);
  if(![200,202].includes(response.status)||response.redirected||response.headers.get("content-type")?.split(";")[0].trim().toLowerCase()!=="application/json"
   ||!response.body||signal.aborted)throw unavailable();
  reader=response.body.getReader();let bytes=0;const parts:Uint8Array[]=[];
  for(;;){const item=await Promise.race([reader.read(),canceled]);if(item.done)break;
   bytes+=item.value.byteLength;if(bytes>4096||signal.aborted)throw unavailable();parts.push(item.value);}
  const all=new Uint8Array(bytes);let offset=0;for(const part of parts){all.set(part,offset);offset+=part.byteLength;}
  const raw:unknown=JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(all));
  const result=options.operation==="open-ready"&&response.status===200?accountExportDownload.parse(raw)
   :options.operation!=="open-ready"&&response.status===202?accountExportPreparing.parse(raw)
   :options.operation==="check"&&response.status===200?accountExportReady.parse(raw):null;
  if(result===null||signal.aborted||"exportId" in result&&options.expectedExportId!==null&&result.exportId!==options.expectedExportId)throw unavailable();
  if(options.operation==="open-ready"){
   if(!options.control.available||!options.control.open||!("session" in result)
    ||result.sizeBytes!==options.control.open.sizeBytes||result.sha256!==options.control.open.sha256
    ||result.filename!==options.control.open.filename)throw unavailable();
  }
  return result;
 }finally{clearTimeout(timer);signal.removeEventListener("abort",interrupt);stop.abort();
  if(reader){void reader.cancel().catch(()=>{});reader.releaseLock();}
  else if(response?.body)void response.body.cancel().catch(()=>{});}
}
