import "server-only";
import {createHash,randomBytes,timingSafeEqual} from "node:crypto";
import {z} from "zod";
import {hmacSecret} from "@/lib/crypto";
import {EXPORT_OPERATION_LIFETIME_MS} from "./export-operation-token";

export const ACCOUNT_EXPORT_COOKIE="__Host-inherit-export";
export const accountExportActor=z.object({accountId:z.uuid(),sessionId:z.uuid()}).strict();
export type AccountExportActor=z.infer<typeof accountExportActor>;
const hash=z.string().regex(/^[a-f0-9]{64}$/u),secret=z.string().regex(/^[A-Za-z0-9_-]{43}$/u)
 .refine(value=>Buffer.from(value,"base64url").length===32&&Buffer.from(value,"base64url").toString("base64url")===value);
const proof=z.object({version:z.literal("account-export-csrf-v1"),actor:accountExportActor,originBinding:hash,
 authorityReceipt:hash,operation:z.enum(["create","open-ready"]),nonce:secret,
 issuedAt:z.number().int().nonnegative().safe(),expiresAt:z.number().int().nonnegative().safe()}).strict();
type CsrfContext=Pick<z.infer<typeof proof>,"actor"|"originBinding"|"authorityReceipt"|"operation">;
const csrfHash=(token:string)=>createHash("sha256").update(token).digest("hex");
const encode=(value:unknown)=>Buffer.from(JSON.stringify(value)).toString("base64url");
function same(a:string,b:string){return /^[a-f0-9]{64}$/u.test(a)&&/^[a-f0-9]{64}$/u.test(b)
 &&timingSafeEqual(Buffer.from(a,"hex"),Buffer.from(b,"hex"));}

/** Independently randomized, signed header proof. Presentation issues exactly
 * one operation nonce bound to this proof's digest; SQL consumes that unique
 * nonce and digest atomically. Neither proof is a cookie or polling credential. */
export function mintAccountExportCsrf(context:CsrfContext,now=Date.now()){
 const value=proof.parse({version:"account-export-csrf-v1",...context,nonce:randomBytes(32).toString("base64url"),
  issuedAt:now,expiresAt:now+EXPORT_OPERATION_LIFETIME_MS});
 const payload=encode(value),token=`${payload}.${hmacSecret(payload,"account-export-csrf-v1")}`;
 return {token,binding:csrfHash(token)};
}
export function verifyAccountExportCsrf(token:unknown,context:CsrfContext,now=Date.now()):string|null{
 if(typeof token!=="string"||token.length>2048||!Number.isSafeInteger(now)||now<0)return null;
 const match=/^([A-Za-z0-9_-]+)\.([a-f0-9]{64})$/u.exec(token);
 if(!match||!same(match[2],hmacSecret(match[1],"account-export-csrf-v1")))return null;
 let value:unknown;try{value=JSON.parse(Buffer.from(match[1],"base64url").toString());}catch{return null;}
 const checked=proof.safeParse(value);if(!checked.success)return null;const p=checked.data;
 if(encode(p)!==match[1]||p.issuedAt>now||p.expiresAt<=now||p.expiresAt-p.issuedAt!==EXPORT_OPERATION_LIFETIME_MS
  ||JSON.stringify(p.actor)!==JSON.stringify(accountExportActor.parse(context.actor))||p.originBinding!==context.originBinding
  ||p.authorityReceipt!==context.authorityReceipt||p.operation!==context.operation)return null;
 return csrfHash(token);
}
export function createAccountExportCookie(actor:AccountExportActor){
 accountExportActor.parse(actor);const value=randomBytes(32).toString("base64url");
 return {hash:accountExportCookieHash(value,actor),header:(exportId:string)=>{
  z.uuid().parse(exportId);return `${ACCOUNT_EXPORT_COOKIE}=${exportId}.${value}; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=86400`;
 }};
}
export function accountExportCookieHash(value:string,actor:AccountExportActor){
 secret.parse(value);return hmacSecret(JSON.stringify([accountExportActor.parse(actor),value]),"account-export-cookie-v1");
}
/** Duplicate cookies are ambiguous. A malformed present cookie never falls
 * through to the synchronous exporter or creates a replacement credential. */
export function readAccountExportCookie(request:Request,actor:AccountExportActor){
 const matches=(request.headers.get("cookie")??"").split(";").map(v=>v.trim()).filter(v=>v.split("=")[0]===ACCOUNT_EXPORT_COOKIE);
 if(matches.length!==1)return null;
 const token=matches[0].slice(ACCOUNT_EXPORT_COOKIE.length+1),match=/^([a-f0-9-]{36})\.([A-Za-z0-9_-]{43})$/u.exec(token);
 if(!match||!z.uuid().safeParse(match[1]).success||Buffer.from(match[2],"base64url").toString("base64url")!==match[2])return null;
 return {exportId:match[1],hash:accountExportCookieHash(match[2],actor)};
}
export function hasAccountExportCookie(request:Request){
 return (request.headers.get("cookie")??"").split(";").some(v=>v.trim().split("=")[0]===ACCOUNT_EXPORT_COOKIE);
}
