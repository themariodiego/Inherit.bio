import "server-only";

import crypto from "node:crypto";
import {z} from "zod";
import {hmacSecret} from "@/lib/crypto";
import {keyringRootKeys,type DigestSet} from "@/lib/hmac-keyring";
import {claimDataKey,newWrappedDocumentKey,openDocumentBytes,sealDocumentBytes} from "./document-envelope";

const invalid=()=>new Error("identity profile unavailable");
const text=(minimum:number,maximum:number)=>z.string().max(maximum*4)
  .transform(value=>value.normalize("NFC").trim().replace(/\s+/gu," "))
  .refine(value=>[...value].length>=minimum&&[...value].length<=maximum&&!/[\u0000-\u001f\u007f-\u009f]/u.test(value));
const birthDate=z.string().regex(/^\d{4}-\d{2}-\d{2}$/u).refine(value=>{
  const parsed=new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime())&&parsed.toISOString().slice(0,10)===value
    &&value<=new Date().toISOString().slice(0,10);
});
const fields={childDateOfBirth:birthDate,childPlaceOfBirth:text(2,160),parentNames:z.array(text(2,120)).min(1).max(4)};
export const identityProfileBody=z.object({...fields,consentSignatureId:z.uuid()}).strict();
const stored=z.object({version:z.literal(1),...fields}).strict();
const scope=z.object({profileId:z.uuid(),embryoId:z.uuid(),identityRevision:z.number().int().positive().safe()}).strict();
export type IdentityProfileScope=z.infer<typeof scope>;
export type ParentIdentityProfile=z.infer<typeof stored>;

/** Purpose-separated versioned match indexes. The tuple is a candidate signal,
 * never adult-age proof or permission to choose among twins or siblings. */
export function identityProfileDigestSet(input:Pick<ParentIdentityProfile,"childDateOfBirth"|"childPlaceOfBirth"|"parentNames">):DigestSet {
  const parsed=z.object(fields).strict().safeParse(input);if(!parsed.success)throw invalid();
  const value=JSON.stringify([parsed.data.childDateOfBirth,parsed.data.childPlaceOfBirth.toLowerCase(),
    parsed.data.parentNames.map(name=>name.toLowerCase()).sort()]);
  const result:DigestSet={"1":hmacSecret(value,"future-person-profile-match-v1")};
  for(const {revision,key} of keyringRootKeys(process.env.INHERIT_HMAC_KEYRING)){
    let purposeKey:Buffer|undefined;
    try{
      purposeKey=crypto.createHmac("sha256",key).update(`future-person-profile-match-v${revision}`).digest();
      result[String(revision)]=crypto.createHmac("sha256",purposeKey).update(value).digest("hex");
    }finally{purposeKey?.fill(0);key.fill(0);}
  }
  return result;
}
function aad(given:IdentityProfileScope):string {
  const parsed=scope.safeParse(given);if(!parsed.success)throw invalid();
  return `future-person-profile-v1|${parsed.data.profileId}|${parsed.data.embryoId}|${parsed.data.identityRevision}`;
}
/** One separately erasable random profile key, wrapped by the existing external
 * root. The scope is authenticated: ciphertext cannot change profile or record. */
export function sealIdentityProfile(input:z.infer<typeof identityProfileBody>,given:IdentityProfileScope) {
  const parsed=identityProfileBody.safeParse(input);if(!parsed.success)throw invalid();
  const binding=aad(given),wrappedKey=newWrappedDocumentKey();let key:Buffer|undefined,plaintext:Buffer|undefined;
  try{
    key=claimDataKey(wrappedKey.toString("hex"));
    const record=stored.parse({version:1,childDateOfBirth:parsed.data.childDateOfBirth,
      childPlaceOfBirth:parsed.data.childPlaceOfBirth,parentNames:parsed.data.parentNames});
    plaintext=Buffer.from(JSON.stringify(record),"utf8");
    const matchIndexes=identityProfileDigestSet({childDateOfBirth:record.childDateOfBirth,
      childPlaceOfBirth:record.childPlaceOfBirth,parentNames:record.parentNames});
    return {wrappedKey,ciphertext:sealDocumentBytes(key,binding,plaintext),matchIndexes};
  }catch{wrappedKey.fill(0);throw invalid();}finally{key?.fill(0);plaintext?.fill(0);}
}
/** Called only after an operation-specific named-reviewer RPC supplies the exact
 * authorized row. NULL legacy keys have no profile-match/decryption fallback. */
export function openIdentityProfile(ciphertext:Uint8Array,wrappedHex:string|null,given:IdentityProfileScope):ParentIdentityProfile|null {
  let key:Buffer|undefined,plaintext:Buffer|null=null;
  try{
    if(wrappedHex===null||ciphertext.byteLength<29||ciphertext.byteLength>16384)return null;
    key=claimDataKey(wrappedHex);plaintext=openDocumentBytes(key,aad(given),ciphertext);
    if(!plaintext)return null;
    const parsed=stored.safeParse(JSON.parse(plaintext.toString("utf8")));return parsed.success?parsed.data:null;
  }catch{return null;}finally{key?.fill(0);plaintext?.fill(0);}
}
