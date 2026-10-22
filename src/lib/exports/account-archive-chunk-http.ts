import "server-only";
import {createHash,randomBytes,timingSafeEqual} from "node:crypto";
import {z} from "zod";
import {hmacSecret} from "@/lib/crypto";
import {hasEmptyRequestBody} from "@/lib/empty-request-body";
import {isTestJurisdictionEnabled} from "@/lib/legal/jurisdictions";
import {applicationOrigin} from "@/lib/app-origin";
import {currentAccountExportActor} from "./account-export-http";
import {accountExportActor,type AccountExportActor} from "./account-export-session";
import {accountArchiveReadySchema,readTestAccountArchiveChunk,type TestAccountArchiveReady} from "./account-archive-test-publication";
import {withAccountArchiveR2Owner} from "./account-archive-r2";
import {configuredRequesterStatementGateway} from "./requester-statement-private-transport";
import {createRequesterStatementRuntime} from "./requester-statement-runtime";

const hash=z.string().regex(/^[a-f0-9]{64}$/u),count=z.number().int().nonnegative().safe();
const sessionSchema=z.object({sessionId:z.uuid(),nextSequence:count,ready:accountArchiveReadySchema}).strict();
type Input={sessionId:string;downloadHash:string;actor:AccountExportActor};
// NULL is used only for native target discrimination, never for an account read.
type ContextInput=Omit<Input,"downloadHash">&{downloadHash:string|null};
type Lease=Readonly<{bytes:Uint8Array;release():Promise<void>}>;
export type AccountArchiveChunkDependencies=Readonly<{
 enabled:boolean;origin():string;actor():Promise<AccountExportActor|null>;
 context(input:ContextInput,signal:AbortSignal):Promise<unknown|null>;
 read(input:Input&{ready:TestAccountArchiveReady;ordinal:number;challengeHash:string},signal:AbortSignal):Promise<Lease>;
 acknowledge(input:Input&{ordinal:number;challengeHash:string;sha256:string;sizeBytes:number},signal:AbortSignal):Promise<boolean>;
}>;
const headers={"Cache-Control":"private, no-store","Referrer-Policy":"no-referrer","X-Content-Type-Options":"nosniff"};
const missing=()=>Response.json({error:"not_found"},{status:404,headers});
const unavailable=()=>new Error("account_archive_chunk_unavailable");
function cookieHash(request:Request){
 const selected=(request.headers.get("cookie")??"").split(";").map(value=>value.trim())
  .filter(value=>value.split("=")[0]==="__Host-inherit-download");
 if(selected.length!==1)return null;const raw=selected[0].slice("__Host-inherit-download=".length);
 if(!/^[A-Za-z0-9_-]{43}$/u.test(raw)||Buffer.from(raw,"base64url").byteLength!==32
  ||Buffer.from(raw,"base64url").toString("base64url")!==raw)return null;
 return createHash("sha256").update(raw).digest("hex");
}
function csrf(input:Input,ordinal:number,challengeHash:string,sha256:string,sizeBytes:number){
 return hmacSecret(JSON.stringify([accountExportActor.parse(input.actor),input.sessionId,input.downloadHash,
  ordinal,challengeHash,sha256,sizeBytes]),"account-export-chunk-csrf-v1");
}
function sameHash(actual:unknown,expected:string){return typeof actual==="string"&&hash.safeParse(actual).success
 &&timingSafeEqual(Buffer.from(actual,"hex"),Buffer.from(expected,"hex"));}
async function acknowledgementBody(request:Request){
 if(!request.body)throw unavailable();const reader=request.body.getReader(),chunks:Uint8Array[]=[];
 let size=0,timer:ReturnType<typeof setTimeout>|undefined,cleanup:ReturnType<typeof setTimeout>|undefined,interrupt=()=>{};
 const stopped=new Promise<never>((_,reject)=>{interrupt=()=>reject(unavailable());request.signal.addEventListener("abort",interrupt,{once:true});
  timer=setTimeout(interrupt,1_000);timer.unref();});
 try{
  if(request.signal.aborted)throw unavailable();
  for(;;){const next=await Promise.race([reader.read(),stopped]);if(next.done)break;
   if(!(next.value instanceof Uint8Array)||size+next.value.byteLength>4096)throw unavailable();
   size+=next.value.byteLength;chunks.push(next.value);
  }
  if(request.signal.aborted||size===0)throw unavailable();
  return JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(Buffer.concat(chunks)));
 }finally{
  if(timer)clearTimeout(timer);request.signal.removeEventListener("abort",interrupt);
  try{await Promise.race([reader.cancel(),new Promise<never>((_,reject)=>{cleanup=setTimeout(()=>reject(unavailable()),5_000);cleanup.unref();})]);}
  finally{if(cleanup)clearTimeout(cleanup);for(const value of chunks)value.fill(0);reader.releaseLock();}
 }
}
async function admission(request:Request,params:{session:string;sequence:string},deps:AccountArchiveChunkDependencies){
 const url=new URL(request.url);
 if(!z.uuid().safeParse(params.session).success||!/^[a-f0-9-]{36}$/u.test(params.session)||!/^(0|[1-9][0-9]{0,9})$/u.test(params.sequence)||url.search
  ||url.origin!==deps.origin()||request.headers.has("range")||request.headers.get("sec-fetch-site")!=="same-origin"
  ||request.headers.has("origin")&&request.headers.get("origin")!==url.origin)throw unavailable();
 const ordinal=Number(params.sequence),downloadHash=cookieHash(request),actor=await deps.actor();
 if(!actor||!Number.isSafeInteger(ordinal)||ordinal>2_251_799_813||request.signal.aborted)throw unavailable();
 const candidate={actor:accountExportActor.parse(actor),sessionId:params.session,downloadHash};
 const raw=await deps.context(candidate,request.signal);
 if(raw===null)return null; // Only a native non-account target may select the original reviewer flow.
 // Native refuses a wrong cookie on an actual account target. A non-NULL
 // account frame still cannot adopt a missing/malformed account cookie.
 if(!downloadHash)throw unavailable();
 const input:Input={...candidate,downloadHash};
 const session=sessionSchema.parse(raw);
 if(session.sessionId!==params.session||ordinal!==session.nextSequence||ordinal>=session.ready.segmentCount
  ||session.ready.segmentCount!==Math.ceil(session.ready.sizeBytes/4_000_000)||Date.parse(session.ready.expiresAt)<=Date.now())throw unavailable();
 return {input,ordinal,session};
}
/** Distinct TEST account authority; it never grants claim reviewer authority.
 * NULL means this is a different native target and leaves its old route intact. */
export async function getAccountArchiveChunk(request:Request,params:{session:string;sequence:string},deps:AccountArchiveChunkDependencies):Promise<Response|null>{
 if(!deps.enabled)return null;let lease:Lease|undefined;
 try{
  if(request.method!=="GET"||!(await hasEmptyRequestBody(request)))return missing();
  const current=await admission(request,params,deps);if(!current)return null;
  const secret=randomBytes(32);let receipt:string;
  try{receipt=secret.toString("base64url");}finally{secret.fill(0);}
  const challengeHash=createHash("sha256").update(receipt).digest("hex");
  lease=await deps.read({...current.input,ready:current.session.ready,ordinal:current.ordinal,challengeHash},request.signal);
  const expected=Math.min(4_000_000,current.session.ready.sizeBytes-current.ordinal*4_000_000),owned=lease;
  if(!(owned.bytes instanceof Uint8Array)||owned.bytes.byteLength!==expected||request.signal.aborted)throw unavailable();
  const sha256=createHash("sha256").update(owned.bytes).digest("hex");let sent=false,closing:Promise<void>|undefined;
  const close=()=>closing??=owned.release();
  const body=new ReadableStream<Uint8Array>({async pull(controller){
   if(request.signal.aborted){await close();controller.error(unavailable());return;}
   if(sent){await close();controller.close();return;}sent=true;controller.enqueue(owned.bytes);
  },cancel(){return close();}},{highWaterMark:0});
  lease=undefined;
  return new Response(body,{status:200,headers:{...headers,"Content-Type":"application/octet-stream","Content-Encoding":"identity",
   "Content-Length":String(expected),"X-Inherit-Chunk-Sha256":sha256,"X-Inherit-Chunk-Receipt":receipt,
   "X-Inherit-CSRF":csrf(current.input,current.ordinal,challengeHash,sha256,expected)}});
 }catch{return missing();}finally{if(lease)await lease.release();}
}
export async function acknowledgeAccountArchiveChunk(request:Request,params:{session:string;sequence:string},deps:AccountArchiveChunkDependencies):Promise<Response|null>{
 if(!deps.enabled)return null;
 try{
  if(request.method!=="POST"||request.headers.get("origin")!==new URL(request.url).origin
   ||request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase()!=="application/json")return missing();
  const current=await admission(request,params,deps);if(!current)return null;
  const value=z.object({receipt:z.string().regex(/^[A-Za-z0-9_-]{43}$/u),sha256:hash,sizeBytes:count.min(1).max(4_000_000)}).strict()
   .parse(await acknowledgementBody(request));
  if(Buffer.from(value.receipt,"base64url").byteLength!==32||Buffer.from(value.receipt,"base64url").toString("base64url")!==value.receipt)throw unavailable();
  const challengeHash=createHash("sha256").update(value.receipt).digest("hex");
  if(!sameHash(request.headers.get("x-inherit-csrf"),csrf(current.input,current.ordinal,challengeHash,value.sha256,value.sizeBytes)))throw unavailable();
  if(await deps.acknowledge({...current.input,ordinal:current.ordinal,challengeHash,sha256:value.sha256,sizeBytes:value.sizeBytes},request.signal)!==true)throw unavailable();
  return new Response(null,{status:204,headers});
 }catch{return missing();}
}
export function accountArchiveChunkDependencies(env:Readonly<Record<string,string|undefined>>=process.env):AccountArchiveChunkDependencies{
 const enabled=isTestJurisdictionEnabled(env)&&env.INHERIT_TEST_ACCOUNT_ARCHIVE_R2==="1";
 async function owner<T>(signal:AbortSignal,work:Parameters<typeof withAccountArchiveR2Owner<T>>[3]){
  const runtime=createRequesterStatementRuntime(),deadline=Date.now()+30_000;
  try{return await withAccountArchiveR2Owner(env,signal,runtime,work);}
  finally{await runtime.settle(deadline);runtime.assertSettled();}
 }
 return {enabled,origin:applicationOrigin,actor:currentAccountExportActor,
  context:async(input,signal)=>owner(signal,async tx=>{
   const rows=await tx<{context:unknown}[]>`select private.account_archive_test_delivery_context_v1(${input.sessionId}::uuid,
    ${input.downloadHash},${JSON.stringify({kind:"account",...input.actor})}::jsonb) as context`;
   if(rows.length!==1)throw unavailable();return rows[0]?.context;
  }),
  read:async(input,signal)=>{
   const runtime=createRequesterStatementRuntime();
   try{return await readTestAccountArchiveChunk({ready:input.ready,ordinal:input.ordinal,downloadHash:input.downloadHash,
    origin:{kind:"account",...input.actor},gateway:configuredRequesterStatementGateway(env,runtime),runtime,signal,env,
    receiptIssue:{downloadId:input.sessionId,challengeHash:input.challengeHash}});
   }catch(error){await runtime.settle(Date.parse(input.ready.expiresAt));runtime.assertSettled();throw error;}
  },
  acknowledge:async(input,signal)=>owner(signal,async tx=>{
   const rows=await tx<{acknowledged:boolean}[]>`select private.ack_account_archive_test_chunk_v1(${input.sessionId}::uuid,
    ${input.downloadHash},${JSON.stringify({kind:"account",...input.actor})}::jsonb,${input.ordinal},${input.challengeHash},${input.sha256},${input.sizeBytes}) as acknowledged`;
   return rows.length===1&&rows[0]?.acknowledged===true;
  })};
}
