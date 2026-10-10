import "server-only";
import type {CorrectionIntakeRuntime} from "./correction-intake-runtime";
import {parseUniqueAppealObject} from "./appeal-intake-json";
const maximumBytes=32*1024;
/** Byte limit and shared original caller clock. Clear owned mutable bytes
 * before waiting for cancellation. Late reads remain owned, and release the
 * reader lock only after its real read/cancel tasks settle. A bounded caller
 * refusal never acknowledges native, provider or platform disposal. */
export async function readCorrectionIntakeJson(request:Request,owner:CorrectionIntakeRuntime):Promise<unknown|null>{
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
  const value=parseUniqueAppealObject(new TextDecoder("utf8",{fatal:true,ignoreBOM:false}).decode(whole));
  return validUnicodeFields(value)?value:null;
 }catch{return null;}
 finally{
  for(const chunk of chunks)owner.clear(chunk);if(whole)owner.clear(whole);
  const cancellation=owner.cleanup(()=>reader.cancel());
  const release=owner.cleanup(async()=>{await Promise.allSettled([lastRead,cancellation]);reader.releaseLock();});
  try{await owner.wait(cancellation);await owner.wait(release);}catch{owner.holdCleanup();throw new Error("correction_intake_body_held");}
 }
}

/** JSON escape sequences may contain lone surrogates even with fatal UTF-8.
 * Refuse them before Buffer encoding can silently replace the statement. */
function validUnicodeFields(value:unknown):boolean{
 if(typeof value!=="object"||value===null||Array.isArray(value))return false;
 for(const text of [...Object.keys(value),...Object.values(value)]){
  if(typeof text!=="string")continue;
  for(let i=0;i<text.length;i++){const code=text.charCodeAt(i);
   if(code>=0xd800&&code<=0xdbff){const next=text.charCodeAt(++i);if(!(next>=0xdc00&&next<=0xdfff))return false;}
   else if(code>=0xdc00&&code<=0xdfff)return false;
  }
 }return true;
}
