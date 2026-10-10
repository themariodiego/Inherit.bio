// SOURCE ONLY. The separate TEST service owns exactly one gateway namespace.
// A valid transport signature is service authentication, never domain authority.
import {z} from "zod";
export {RequesterStatementArchiveGateway} from "./requester-statement-r2-gateway";
import type {RequesterStatementArchiveGateway} from "./requester-statement-r2-gateway";
type Env={CASE_ARCHIVE_GATEWAYS:DurableObjectNamespace<RequesterStatementArchiveGateway>;
 CASE_ARCHIVE_TRANSPORT_KEY:string;CASE_ARCHIVE_TEST_ENABLED:string};
const hash=z.string().regex(/^[0-9a-f]{64}$/u),clock=z.number().int().nonnegative().safe();
const requestFrame=z.object({version:z.literal("case-archive-private-rpc-v1"),allocationSha256:hash,
 operation:z.enum(["describeConfiguration","createPayload","readPayload","beginCleanup","endCleanup","head","get","putEmpty"]),
 args:z.array(z.unknown()).max(3),nonce:hash,issuedAt:clock,expiresAt:clock}).strict();
const key=z.string().regex(/^export\/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u);
const claim=z.object({allocationSha256:hash,token:hash,expiresAt:clock}).strict();
const identity=z.object({purpose:z.literal("inherit-export-reservation-v1"),exportId:z.uuid(),attemptId:z.uuid(),ordinal:clock,offset:clock,byteCount:clock.min(1).max(4_000_000),sha256:hash,
 logicalKey:z.string().max(256),reservedAt:z.iso.datetime({offset:true}),authorityReceipt:hash,
 locator:z.object({provider:z.literal("archive-r2-current-object-v1"),bucket:z.string().regex(/^inherit-export-[a-z0-9-]{1,40}$/u),objectKey:key,byteCount:clock.min(1).max(4_000_000),sha256:hash}).strict()}).strict();
const frame=z.object({objectId:z.uuid(),writeIdentity:identity,writeBindingSha256:hash,allocationSha256:hash,
 configurationSha256:hash,originalDeadline:z.iso.datetime({offset:true})}).strict();
const headers=z.array(z.tuple([z.enum(["if-match","if-none-match"]),z.string().regex(/^[\x21-\x7e]{1,258}$/u)])).max(2)
 .refine(v=>new Set(v.map(x=>x[0])).size===v.length);
function encode(bytes:Uint8Array){let out="";for(const byte of bytes)out+=String.fromCharCode(byte);return btoa(out).replace(/\+/gu,"-").replace(/\//gu,"_").replace(/=+$/u,"");}
const denied=()=>new Response("Unavailable",{status:404,headers:{"Cache-Control":"no-store"}});
const requesterStatementPrivateTransport = {async fetch(request:Request,env:Env){
 const chunks:Uint8Array[]=[];
 let raw:Uint8Array|undefined,secret:Uint8Array|undefined,mac:Uint8Array|undefined;
 try{
  const url=new URL(request.url),signature=request.headers.get("X-Case-Archive-Signature");
  if(env.CASE_ARCHIVE_TEST_ENABLED!=="1"||request.method!=="POST"||url.pathname!=="/private/case-archive/v1"||url.search
   ||request.headers.get("Content-Type")!=="application/json"||!signature||!/^[A-Za-z0-9_-]{43}$/u.test(signature))return denied();
  // Bound the stream before JSON/base64 allocation; content-length is not proof.
  const reader=request.body?.getReader();if(!reader)return denied();let size=0;
  try{for(;;){const next=await reader.read();if(next.done)break;
   // Retain even an overflowing chunk so the outer finally clears it.
   chunks.push(next.value);size+=next.value.byteLength;if(size>6_000_000)return denied();}}
  finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
  raw=new Uint8Array(size);let at=0;for(const chunk of chunks){raw.set(chunk,at);at+=chunk.byteLength;chunk.fill(0);}
  secret=Uint8Array.from(atob(env.CASE_ARCHIVE_TRANSPORT_KEY??""),c=>c.charCodeAt(0));if(secret.byteLength!==32)return denied();
  const signingKey=await crypto.subtle.importKey("raw",secret,{name:"HMAC",hash:"SHA-256"},false,["verify"]);secret.fill(0);
  mac=Uint8Array.from(atob(signature.replace(/-/gu,"+").replace(/_/gu,"/")+"="),c=>c.charCodeAt(0));
  if(!await crypto.subtle.verify("HMAC",signingKey,mac,raw)){raw.fill(0);return denied();}
  const input=requestFrame.parse(JSON.parse(new TextDecoder("utf-8",{fatal:true,ignoreBOM:false}).decode(raw)));raw.fill(0);
  const now=Date.now();if(input.issuedAt>now+1000||input.issuedAt<now-20_000||input.expiresAt<=now
   ||input.expiresAt>input.issuedAt+15_000)return denied();
  const stub=env.CASE_ARCHIVE_GATEWAYS.get(env.CASE_ARCHIVE_GATEWAYS.idFromName(input.allocationSha256));
  if(await stub.consumeTransportNonce(input.allocationSha256,input.nonce,input.expiresAt)!==true)return denied();
  let result:unknown;
  switch(input.operation){
   case "describeConfiguration":z.tuple([]).parse(input.args);result=await stub.describeConfiguration();break;
   case "createPayload":{const [f,b]=z.tuple([frame,z.string().max(5_333_336)]).parse(input.args);
    if(f.allocationSha256!==input.allocationSha256)return denied();
    const bytes=Uint8Array.from(atob(b),c=>c.charCodeAt(0));try{result=await stub.createPayload(f,bytes);}finally{bytes.fill(0);}break;}
   case "readPayload":{const [f]=z.tuple([frame]).parse(input.args);if(f.allocationSha256!==input.allocationSha256)return denied();result=await stub.readPayload(f);break;}
   case "beginCleanup":case "endCleanup":{const [c]=z.tuple([claim]).parse(input.args);if(c.allocationSha256!==input.allocationSha256)return denied();
    result=input.operation==="beginCleanup"?await stub.beginCleanup(c):await stub.endCleanup(c);break;}
   case "head":{const [c,k]=z.tuple([claim,key]).parse(input.args);if(c.allocationSha256!==input.allocationSha256)return denied();result=await stub.head(c,k);break;}
   case "get":case "putEmpty":{const [c,k,h]=z.tuple([claim,key,headers]).parse(input.args);if(c.allocationSha256!==input.allocationSha256)return denied();
    result=input.operation==="get"?await stub.get(c,k,new Headers(h)):await stub.putEmpty(c,k,new Headers(h));break;}
  }
  if(input.operation==="get"||input.operation==="readPayload"){
   if(result===null)return new Response(null,{headers:{"X-Case-Archive-Null":"1","Cache-Control":"no-store"}});
   const response=result as {descriptor?:unknown;body:ReadableStream<Uint8Array>};
   const descriptor=response.descriptor??Object.fromEntries(Object.entries(response).filter(([name])=>name!=="body"));
   return new Response(response.body,{headers:{"Content-Type":"application/octet-stream","Cache-Control":"no-store",
    "X-Case-Archive-Descriptor":encode(new TextEncoder().encode(JSON.stringify(descriptor)))}});
  }
  return new Response(JSON.stringify(result),{headers:{"Content-Type":"application/json","Cache-Control":"no-store"}});
 }catch{return denied();}
 finally{
  // Owned mutable request material is cleared on every return and exception.
  // CryptoKey, immutable JS strings, platform buffers and provider copies
  // remain subject to the separate real runtime/disposal qualification.
  for(const chunk of chunks)chunk.fill(0);
  raw?.fill(0);secret?.fill(0);mac?.fill(0);
 }
}};
export default requesterStatementPrivateTransport;
