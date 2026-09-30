import "server-only";
import {createHash} from "node:crypto";
import {z} from "zod";
import {mintSubjectRelocationCapability} from "@/lib/uploads/storage-upload-token";

const uuid=z.uuid().regex(/^[0-9a-f-]+$/), provider=z.string().regex(/^[0-9a-f]{32}$/);
const emptyHash="e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
export const relocationTargetSchema=z.object({bindingId:uuid,relocationId:uuid,attemptId:uuid,accountId:uuid,
 bucket:z.string().regex(/^inherit-embryo-[a-z0-9-]{1,40}$/),
 oldKey:z.string().regex(/^embryo\/[0-9a-f-]{36}$/),oldVersion:provider,oldEtag:provider,
 newKey:z.string().regex(/^claimant\/[0-9a-f-]{36}\/[0-9a-f-]{36}$/),
 byteCount:z.number().int().min(1).max(4004096),sha256:z.string().regex(/^[0-9a-f]{64}$/),
 expiresAt:z.iso.datetime({offset:true})}).strict().refine(v=>v.newKey===`claimant/${v.accountId}/${v.attemptId}`);
export type RelocationTarget=z.infer<typeof relocationTargetSchema>;
export const relocatedIdentitySchema=z.object({providerVersion:provider,etag:provider,
 byteCount:z.number().int().min(1).max(4004096)}).strict();
export type RelocatedIdentity=z.infer<typeof relocatedIdentitySchema>;
export const relocationTombstoneSchema=z.object({disposition:z.literal("payload-tombstoned"),providerVersion:provider,
 etag:z.literal("d41d8cd98f00b204e9800998ecf8427e"),byteCount:z.literal(0),sha256:z.literal(emptyHash)}).strict();
export type RelocationTombstone=z.infer<typeof relocationTombstoneSchema>;
export class RelocationTransportError extends Error {
 constructor(){super("relocation_transport_unavailable");this.name="RelocationTransportError";}
}
const fail=():never=>{throw new RelocationTransportError();};
const sha=(bytes:Uint8Array)=>createHash("sha256").update(bytes).digest("hex");
function origin(bucket:string){
 const url=new URL(process.env.INHERIT_EMBRYO_R2_ORIGIN??"");
 if(url.protocol!=="https:"||url.pathname!=="/"||url.search||url.hash||url.username||url.password
  ||bucket!==process.env.INHERIT_EMBRYO_R2_BUCKET)fail();
 return url.origin;
}
async function request(target:RelocationTarget,operation:"copy"|"get"|"dispose-old"|"dispose-new",
 signal:AbortSignal,identity?:RelocatedIdentity){
 const token=mintSubjectRelocationCapability({...target,operation,...(identity?
  {newVersion:identity.providerVersion,newEtag:identity.etag}:{})});
 return fetch(`${origin(target.bucket)}/relocation`,{method:operation==="get"?"GET":"PUT",
  signal,redirect:"error",cache:"no-store",headers:{Authorization:`Bearer ${token}`,"Accept-Encoding":"identity"}});
}
async function complete(response:Response,maximum:number,signal:AbortSignal){
 const body=response.body;if(!body)return fail();const reader=body.getReader(),chunks:Uint8Array[]=[];let size=0;
 try{for(;;){if(signal.aborted)fail();const next=await reader.read();if(next.done)break;
  size+=next.value.byteLength;if(size>maximum)fail();chunks.push(next.value);}}
 finally{void reader.cancel().catch(()=>{});reader.releaseLock();}
 return Uint8Array.from(Buffer.concat(chunks));
}
async function json(response:Response,signal:AbortSignal){
 if(response.status!==200){void response.body?.cancel().catch(()=>{});fail();}
 return JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(await complete(response,4096,signal))) as unknown;
}
function bounded(target:RelocationTarget,external:AbortSignal){
 const remaining=Date.parse(target.expiresAt)-Date.now();if(remaining<=0)fail();
 return AbortSignal.any([external,AbortSignal.timeout(Math.min(30000,remaining))]);
}
/** The gateway copies only the exact immutable source. Caller then rechecks
 * its SQL claim and uses the separate full-byte readback before any swap. */
export async function copyRelocation(raw:unknown,external:AbortSignal):Promise<RelocatedIdentity>{
 try{const target=relocationTargetSchema.parse(raw),signal=bounded(target,external);
  const identity=relocatedIdentitySchema.parse(await json(await request(target,"copy",signal),signal));
  if(identity.byteCount!==target.byteCount)fail();return identity;
 }catch{ return fail(); }
}
/** Independent EOF verification of the newly copied exact provider version. */
export async function readRelocation(raw:unknown,rawIdentity:unknown,external:AbortSignal):Promise<Uint8Array>{
 try{const target=relocationTargetSchema.parse(raw),identity=relocatedIdentitySchema.parse(rawIdentity),signal=bounded(target,external);
  if(identity.byteCount!==target.byteCount)fail();const response=await request(target,"get",signal,identity);
  if(response.status!==200||response.headers.has("content-range")
   ||response.headers.get("content-length")!==String(target.byteCount)
   ||response.headers.get("x-inherit-object-version")!==identity.providerVersion
   ||response.headers.get("etag")!==`"${identity.etag}"`
   ||![null,"identity"].includes(response.headers.get("content-encoding"))){void response.body?.cancel().catch(()=>{});fail();}
  const bytes=await complete(response,target.byteCount,signal);
  if(bytes.byteLength!==target.byteCount||sha(bytes)!==target.sha256)fail();return bytes;
 }catch{return fail();}
}
/** Exact permanent empty marker, verified by the gateway at EOF. This proves
 * payload removal and a late-write fence, never key absence or media erasure.
 * Old disposal requires a committed swap; new disposal requires a terminal
 * drained attempt. Both are selected by distinct current SQL receipts. */
export async function disposeRelocation(raw:unknown,which:"old"|"new",external:AbortSignal,rawIdentity?:unknown):Promise<RelocationTombstone>{
 try{const target=relocationTargetSchema.parse(raw),signal=bounded(target,external);
  const identity=which==="old"?relocatedIdentitySchema.parse(rawIdentity):undefined;
  if(identity&&identity.byteCount!==target.byteCount)fail();
  return relocationTombstoneSchema.parse(await json(await request(target,which==="old"?"dispose-old":"dispose-new",signal,identity),signal));
 }catch{return fail();}
}
