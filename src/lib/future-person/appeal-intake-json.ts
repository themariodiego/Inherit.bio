import "server-only";
import type {AppealIntakeRuntime} from "./appeal-intake-runtime";
const maximumBytes=64*1024;
/** The registered appeal body is flat: strings plus affirmed:true. Detect
 * repeated decoded property names before JSON.parse can silently select one.
 * No thrown error contains a field, value or request fragment. */
export function parseUniqueAppealObject(text:string):unknown|null{
 const token=/\s+|"(?:[^"\\\u0000-\u001f]|\\(?:["\\/bfnrt]|u[0-9a-fA-F]{4}))*"|true|false|[{}:,]/uy;
 let at=0;
 function next(){for(;;){token.lastIndex=at;const match=token.exec(text);if(!match)return null;at=token.lastIndex;
  if(/^\s+$/u.test(match[0]))continue;return match[0];}}
 try{
  if(next()!=="{")return null;const seen=new Set<string>();let item=next();
  if(item!=="}")for(;;){
   if(item?.[0]!=="\"")return null;const key:unknown=JSON.parse(item);if(typeof key!=="string"||seen.has(key))return null;seen.add(key);
   if(next()!==":")return null;const value=next();if(value?.[0]!=="\""&&value!=="true"&&value!=="false")return null;
   item=next();if(item==="}")break;if(item!==",")return null;item=next();
  }
  if(text.slice(at).trim()!=="")return null;return JSON.parse(text);
 }catch{return null;}
}
/** Byte limit and shared original caller clock. Clear owned mutable bytes
 * before waiting for cancellation. Late reads remain owned, and release the
 * reader lock only after its real read/cancel tasks settle. A bounded caller
 * refusal never acknowledges native, provider or platform disposal. */
export async function readAppealIntakeJson(request:Request,owner:AppealIntakeRuntime):Promise<unknown|null>{
 if(!request.body)return null;const reader=request.body.getReader(),chunks:Uint8Array[]=[];let size=0,whole:Uint8Array|undefined;
 let lastRead:Promise<ReadableStreamReadResult<Uint8Array>>|undefined;
 try{
  for(;;){lastRead=owner.read(async()=>{const result=await reader.read();
    if(result.value instanceof Uint8Array)owner.own(result.value);return result;});
   const next=await owner.wait(lastRead);if(next.done)break;
   if(!(next.value instanceof Uint8Array))return null;chunks.push(next.value);size+=next.value.byteLength;if(size>maximumBytes)return null;
  }
  owner.assertOpen();whole=owner.own(new Uint8Array(size));let offset=0;
  for(const chunk of chunks){whole.set(chunk,offset);offset+=chunk.byteLength;owner.clear(chunk);}
  return parseUniqueAppealObject(new TextDecoder("utf8",{fatal:true}).decode(whole));
 }catch{return null;}
 finally{
  for(const chunk of chunks)owner.clear(chunk);if(whole)owner.clear(whole);
  const cancellation=owner.cleanup(()=>reader.cancel());
  const release=owner.cleanup(async()=>{await Promise.allSettled([lastRead,cancellation]);reader.releaseLock();});
  try{await owner.wait(cancellation);await owner.wait(release);}catch{owner.holdCleanup();throw new Error("appeal_intake_body_held");}
 }
}
