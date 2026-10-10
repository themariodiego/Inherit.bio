import "server-only";
import crypto from "node:crypto";
import {z} from "zod";
import {applicationOrigin} from "@/lib/app-origin";
import {newCaseHmac} from "./new-case-envelope-crypto";
const production=process.env.NODE_ENV==="production";
export const APPEAL_FORM_COOKIE=production?"__Host-inherit-appeal-form":"inherit-appeal-form";
export const APPEAL_FORM_TOKEN_HEADER="x-inherit-appeal-form-token";
const secret=/^[A-Za-z0-9_-]{43}$/u,nonce=/^[A-Za-z0-9_-]{16,256}$/u;
const tokenShape=z.object({version:z.literal(1),form:z.literal("appeal-intake"),candidateHash:z.string().regex(/^[0-9a-f]{64}$/u),
 nonce:z.string().regex(nonce),expiresAt:z.number().int().safe().nonnegative()}).strict();
const context="new-appeal-public-form-v1",hash=(value:string)=>crypto.createHash("sha256").update(value,"utf8").digest("hex");
export function appealFormSecret(request:Request){
 const values=(request.headers.get("cookie")??"").split(";").map(part=>part.trim())
  .filter(part=>part.slice(0,part.indexOf("="))===APPEAL_FORM_COOKIE).map(part=>part.slice(part.indexOf("=")+1));
 return values.length===1&&secret.test(values[0]!)?values[0]!:null;
}
/** Generic TEST page render only. No native/target/account read or write.
 * Keep one existing browser cookie across prefetches; each token is one-use
 * only when the actual POST commits its nonce hash with the complete case. */
export function mintAppealForm(now=Date.now(),existing:string|null=null){
 if(!Number.isSafeInteger(now)||now<0)throw new Error("appeal_unavailable");
 let random:Buffer|undefined,nonceBytes:Buffer|undefined,payloadBytes:Buffer|undefined;
 try{
  const selected=existing&&secret.test(existing)?existing:(random=crypto.randomBytes(32)).toString("base64url");
  nonceBytes=crypto.randomBytes(24);const claims=tokenShape.parse({version:1,form:"appeal-intake",candidateHash:hash(selected),
   nonce:nonceBytes.toString("base64url"),expiresAt:now+600_000});payloadBytes=Buffer.from(JSON.stringify(claims),"utf8");
  const payload=payloadBytes.toString("base64url");return {formToken:`${payload}.${newCaseHmac(payload,context)}`,
   setCookie:[`${APPEAL_FORM_COOKIE}=${selected}`,"Path=/","Max-Age=600","HttpOnly","SameSite=Strict",...(production?["Secure"]:[])].join("; ")};
 }finally{random?.fill(0);nonceBytes?.fill(0);payloadBytes?.fill(0);}
}
/** Origin is the configured canonical origin, never a caller Host value.
 * This cookie/form proves no account, identity, case, target or genetic right. */
export function readAppealForm(request:Request,now=Date.now()){
 let expected:Buffer|undefined,supplied:Buffer|undefined,payloadBytes:Buffer|undefined;
 try{
  if(!Number.isSafeInteger(now)||now<0||request.method!=="POST"||new URL(request.url).search!==""
   ||request.headers.get("origin")!==new URL(applicationOrigin()).origin||request.headers.get("sec-fetch-site")!=="same-origin"
   ||request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase()!=="application/json")return null;
  const token=request.headers.get("x-inherit-csrf"),selected=appealFormSecret(request);if(!token||token.length>2048||!selected)return null;
  const parts=token.split(".");if(parts.length!==2||!/^[A-Za-z0-9_-]+$/u.test(parts[0]!)||!/^[0-9a-f]{64}$/u.test(parts[1]!))return null;
  expected=Buffer.from(newCaseHmac(parts[0]!,context),"utf8");supplied=Buffer.from(parts[1]!,"utf8");
  if(!crypto.timingSafeEqual(expected,supplied))return null;payloadBytes=Buffer.from(parts[0]!,"base64url");
  const parsed=tokenShape.safeParse(JSON.parse(payloadBytes.toString("utf8")));
  if(!parsed.success||parsed.data.candidateHash!==hash(selected)||parsed.data.expiresAt<=now||parsed.data.expiresAt>now+600_000)return null;
  return {nonce:parsed.data.nonce,nonceHash:hash(parsed.data.nonce)};
 }catch{return null;}finally{expected?.fill(0);supplied?.fill(0);payloadBytes?.fill(0);}
}
