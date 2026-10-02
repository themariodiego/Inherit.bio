import "server-only";

import crypto from "node:crypto";
import { z } from "zod";
import { hmacSecret } from "@/lib/crypto";

const revision=z.number().int().positive().safe();
export const identityProfileContext=z.object({
  embryoId:z.uuid(),subjectId:z.uuid(),actorPrincipal:z.uuid(),basisFingerprint:z.string().regex(/^[0-9a-f]{64}$/u),
  basisRevision:revision,participantSetRevision:revision,recipientSetRevision:revision,cohortLifecycleRevision:revision,
  subjectLifecycleRevision:revision,dispositionRevision:revision,accountRevision:revision,authSessionRevision:revision,
  sessionRevision:revision,consentSignatureId:z.uuid().nullable(),currentProfileId:z.uuid().nullable(),
  nextIdentityRevision:revision,expiresAt:z.iso.datetime({offset:true}),
}).strict();
export type IdentityProfileContext=z.infer<typeof identityProfileContext>;
const claims=z.object({version:z.literal(1),accountId:z.uuid(),sessionId:z.uuid(),embryoId:z.uuid(),
  operation:z.enum(["save","delete"]),receipt:z.string().regex(/^[0-9a-f]{64}$/u),
  nonce:z.string().regex(/^[A-Za-z0-9_-]{32}$/u),expiresAt:z.number().int().positive().safe(),
}).strict();
type Claims=z.infer<typeof claims>;
type Binding=Pick<Claims,"accountId"|"sessionId"|"embryoId"|"operation">;
function receipt(context:IdentityProfileContext):string {
  const parsed=identityProfileContext.parse(context);
  // Stable field order, including every closed authority field.
  const entries=Object.entries(parsed).sort(([a],[b])=>a<b?-1:a>b?1:0);
  return crypto.createHash("sha256").update(JSON.stringify(entries)).digest("hex");
}
function matches(a:string,b:string):boolean {
  return /^[0-9a-f]{64}$/u.test(a)&&/^[0-9a-f]{64}$/u.test(b)
    &&crypto.timingSafeEqual(Buffer.from(a),Buffer.from(b));
}
function csrf(value:Claims):string {return hmacSecret(JSON.stringify(value),"future-person-profile-csrf-v1");}
/** Stateless page issuance after the exact read-only authority resolution.
 * CSRF and the one-time mutation token use separate purpose keys and values. */
export function mintIdentityProfileOperation(binding:Binding,context:IdentityProfileContext,now=Date.now()) {
  const expiresAt=Math.min(now+600_000,Date.parse(context.expiresAt));
  if(expiresAt<=now||binding.embryoId!==context.embryoId)throw new Error("identity profile unavailable");
  const value=claims.parse({version:1,...binding,receipt:receipt(context),nonce:crypto.randomBytes(24).toString("base64url"),expiresAt});
  const payload=Buffer.from(JSON.stringify(value)).toString("base64url");
  return {operationNonce:`${payload}.${hmacSecret(payload,"future-person-profile-operation-v1")}`,csrf:csrf(value)};
}
/** Checks the current receipt as well as the caller/record/method. A stale
 * page cannot silently apply to a changed parent set, profile or deadline. */
export function readIdentityProfileOperation(token:string|null,csrfValue:string|null,binding:Binding,
  context:IdentityProfileContext,now=Date.now()):{nonce:string}|null {
  try{
    if(!token||token.length>4096||!csrfValue)return null;
    const parts=token.split(".");if(parts.length!==2||!/^[A-Za-z0-9_-]+$/u.test(parts[0]))return null;
    if(!matches(parts[1],hmacSecret(parts[0],"future-person-profile-operation-v1")))return null;
    const parsed=claims.safeParse(JSON.parse(Buffer.from(parts[0],"base64url").toString("utf8")));
    if(!parsed.success)return null;const value=parsed.data;
    if(value.expiresAt<=now||value.expiresAt>now+600_000||value.expiresAt>Date.parse(context.expiresAt)
      ||value.accountId!==binding.accountId||value.sessionId!==binding.sessionId||value.embryoId!==binding.embryoId
      ||value.operation!==binding.operation||value.receipt!==receipt(context)||!matches(csrfValue,csrf(value)))return null;
    return {nonce:value.nonce};
  }catch{return null;}
}
