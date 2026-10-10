import "server-only";
import {createHmac,randomBytes} from "node:crypto";
import {z} from "zod";
import {createRequesterStatementGateway,type RequesterStatementGatewayNamespace} from "./requester-statement-r2-gateway";
import type {RequesterStatementR2Gateway} from "./requester-statement-r2";
import {requesterStatementsOpen} from "@/lib/future-person/requester-statement";
import type {RequesterStatementRuntime} from "./requester-statement-runtime";
const hash=z.string().regex(/^[0-9a-f]{64}$/u),uuidKey=z.string().regex(/^export\/[0-9a-f-]{36}$/u);
const descriptor=z.object({key:uuidKey,version:z.string().max(256),etag:z.string().max(256),size:z.number().int().min(0).max(4_000_000),
 customMetadata:z.record(z.string(),z.string())}).strict();
const unavailable=()=>new Error("statement_private_gateway_unavailable");
/** Private inter-host transport. A service credential authenticates the
 * existing trusted writer; it never grants claimant/account/reviewer access.
 * Every call starts after the real native authority/claim check. No redirects,
 * retry, provider URL, request-selected host or credential enters an archive. */
export function configuredRequesterStatementGateway(env:Readonly<Record<string,string|undefined>>=process.env,runtime?:RequesterStatementRuntime){
 if(!requesterStatementsOpen(env))throw unavailable();
 const url=new URL(env.INHERIT_TEST_STATEMENT_GATEWAY_URL??"");
 if(url.protocol!=="https:"||url.username||url.password||url.search||url.hash||url.pathname!=="/private/case-archive/v1")throw unavailable();
 const secret=Buffer.from(env.INHERIT_TEST_STATEMENT_GATEWAY_KEY??"","base64");
 if(secret.byteLength!==32||secret.toString("base64")!==env.INHERIT_TEST_STATEMENT_GATEWAY_KEY){secret.fill(0);throw unavailable();}
 runtime?.own(secret);
 const expected={bucket:env.INHERIT_TEST_STATEMENT_R2_BUCKET??"",bindingSha256:env.INHERIT_TEST_STATEMENT_R2_BINDING_SHA256??"",
  protocol:"r2-current-object-qualified-all-writer-gateway-v1" as const};
 async function call(allocation:string,operation:string,args:unknown[]){
  hash.parse(allocation);const now=Date.now();
  const nonceBytes=randomBytes(32);let nonce:string;
  try{runtime?.own(nonceBytes);nonce=nonceBytes.toString("hex");}finally{if(runtime)runtime.clear(nonceBytes);else nonceBytes.fill(0);}
  const raw=JSON.stringify({version:"case-archive-private-rpc-v1",allocationSha256:allocation,operation,args,
   nonce,issuedAt:now,expiresAt:now+15_000});
  const signature=createHmac("sha256",secret).update(raw).digest("base64url");
  const response=await fetch(url,{method:"POST",redirect:"error",cache:"no-store",signal:AbortSignal.timeout(20_000),
   headers:{"Content-Type":"application/json","X-Case-Archive-Signature":signature},body:raw});
  let transferred=false;
  try{
  if(!response.ok)throw unavailable();
  if(operation==="readPayload"||operation==="get"){
   if(response.headers.get("X-Case-Archive-Null")==="1")return null;
   const encoded=response.headers.get("X-Case-Archive-Descriptor");
   if(!encoded||encoded.length>4096||!response.body)throw unavailable();
   const decoded=Buffer.from(encoded,"base64url");let actual:z.infer<typeof descriptor>;
   try{runtime?.own(decoded);actual=descriptor.parse(JSON.parse(decoded.toString("utf8")));}finally{if(runtime)runtime.clear(decoded);else decoded.fill(0);}
   transferred=true;
   return operation==="readPayload"?{descriptor:actual,body:response.body}:{...actual,body:response.body};
  }
  if(response.headers.get("Content-Type")!=="application/json"||Number(response.headers.get("Content-Length")??"0")>8192)throw unavailable();
  const text=await response.text();if(Buffer.byteLength(text)>8192)throw unavailable();return JSON.parse(text) as unknown;
  }finally{
   // On refusal, the actual response body is still ours. A transferred payload
   // is closed by the registered whole-read owner; failed metadata is not.
   if(!transferred&&response.body){const body=response.body;
    if(runtime)await runtime.wait(runtime.cleanup("private-transport-response-body-cancel",()=>body.cancel()),now+20_000);
    else await body.cancel();}
  }
 }
 const namespace:RequesterStatementGatewayNamespace={idFromName:allocation=>hash.parse(allocation),get:id=>{
  const allocation=hash.parse(id);
  return {describeConfiguration:()=>call(allocation,"describeConfiguration",[]),
   createPayload:async(frame,bytes)=>{
    const owned=Buffer.from(bytes);
    try{runtime?.own(owned);return await call(allocation,"createPayload",[frame,owned.toString("base64")]);}
    finally{if(runtime)runtime.clear(owned);else owned.fill(0);}
   },
   readPayload:frame=>call(allocation,"readPayload",[frame]) as ReturnType<RequesterStatementR2Gateway["readPayload"]>,
   beginCleanup:claim=>call(allocation,"beginCleanup",[claim]) as Promise<boolean>,endCleanup:claim=>call(allocation,"endCleanup",[claim]) as Promise<boolean>,
   head:(claim,key)=>call(allocation,"head",[claim,key]),
   get:(claim,key,headers)=>call(allocation,"get",[claim,key,Array.from(headers.entries())]),
   putEmpty:(claim,key,headers)=>call(allocation,"putEmpty",[claim,key,Array.from(headers.entries())])};
 }};
 try{return createRequesterStatementGateway(namespace,expected,env,runtime);}
 catch(error){if(runtime)runtime.clear(secret);else secret.fill(0);throw error;}
}
