import "server-only";
import crypto from "node:crypto";
import {newCaseHmac} from "./new-case-envelope-crypto";
type Ring="contact"|"rate-limit";
/** Exact existing keyring layout, with ownership and clearing of every NEW
 * decoded root, purpose sub-key and digest on success or any parse failure. */
export function appealKeyedDigests(ring:Ring,value:string):Record<string,string>{
 const roots:Buffer[]=[],seen=new Set<number>();
 const result:Record<string,string>={"1":newCaseHmac(value,ring==="contact"?"contact-email-v1":"security-rate-limit-v1")};
 try{
  const setting=process.env.INHERIT_HMAC_KEYRING;
  if(setting===undefined||setting.trim()==="")return result;
  for(const raw of setting.split(",")){
   const match=/^([1-9][0-9]{0,5}):([A-Za-z0-9+/_-]{43}={0,1})$/u.exec(raw.trim());
   if(!match)throw new Error("appeal_unavailable");const revision=Number(match[1]),root=Buffer.from(match[2]!,"base64");roots.push(root);
   if(revision<2||root.length!==32||seen.has(revision)||roots.slice(0,-1).some(prior=>crypto.timingSafeEqual(prior,root)))throw new Error("appeal_unavailable");
   seen.add(revision);let sub:Buffer|undefined,digest:Buffer|undefined;
   try{sub=crypto.createHmac("sha256",root).update(`${ring}-hmac-v${revision}`,"utf8").digest();
    digest=crypto.createHmac("sha256",sub).update(value,"utf8").digest();result[String(revision)]=digest.toString("hex");}
   finally{sub?.fill(0);digest?.fill(0);}
  }return result;
 }finally{for(const root of roots)root.fill(0);}
}
