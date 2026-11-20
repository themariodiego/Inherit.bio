import "server-only";
import crypto from "node:crypto";
import {z} from "zod";
import {createClient} from "@/lib/supabase/server";
import {mintPublicFormToken,readPublicFormToken} from "@/lib/embryos/operation-token";
import {claimantSessionHash} from "./rights";
import {futurePersonClaimsOpen} from "./claims-open";
const revision=z.number().int().positive().safe();
export const bindingContext=z.object({authorized:z.literal(true),account_auth_session_revision:revision,session_revision:revision,
 accountId:z.uuid(),sessionId:z.uuid(),rightsSessionId:z.uuid(),claimantPrincipalId:z.uuid(),claimId:z.uuid(),
 claimantRevision:revision,releaseRevision:revision,subjectId:z.uuid(),subjectBindingRevision:revision,subjectLifecycleRevision:revision}).strict();
export type BindingContext=z.infer<typeof bindingContext>;
function bindingHash(hash:string,context:BindingContext):string {
 return crypto.createHash("sha256").update(JSON.stringify([hash,bindingContext.parse(context)])).digest("hex");
}
export function mintBindingNonce(hash:string,context:BindingContext,now=Date.now()):string {
 return mintPublicFormToken("future-person-account-binding",now,bindingHash(hash,context));
}
export function readBindingNonce(token:string,hash:string,context:BindingContext,now=Date.now()):string|null {
 if(token.length>2048)return null;
 return readPublicFormToken(token,"future-person-account-binding",now,bindingHash(hash,context))?.nonce??null;
}
/** A verified own JWT precedes the scoped context RPC. No service client is used. */
export async function currentBindingContext(hash:string) {
 if(!futurePersonClaimsOpen())return null;
 const client=await createClient();
 const [user,claims]=await Promise.all([client.auth.getUser(),client.auth.getClaims()]);
 const jwt=claims.data?.claims;
 if(user.error||claims.error||!user.data.user||jwt?.sub!==user.data.user.id||jwt.role!=="authenticated"||typeof jwt.session_id!=="string")return null;
 const {data,error}=await client.rpc("future_person_binding_context_v1",{p_rights_session_hash:hash});
 const parsed=bindingContext.safeParse(data);
 if(error||!parsed.success||parsed.data.accountId!==jwt.sub||parsed.data.sessionId!==jwt.session_id)return null;
 return {client,context:parsed.data};
}
export async function loadAccountBinding(request:Request):Promise<string|null> {
 const hash=claimantSessionHash(request);if(!hash)return null;
 const actor=await currentBindingContext(hash);return actor?mintBindingNonce(hash,actor.context):null;
}
export const bindingBody=z.object({nonce:z.string().min(1).max(2048)}).strict();
/** The request's X-Inherit-CSRF is the signed-in account session's one-time
 * token (api.future-person-claimant-bind), verified and spent before the
 * handler runs (G8.5); the rights cookie and the one-time binding nonce, which
 * is bound to it and to the account context, are checked here as before. */
export function bindingRequestHash(request:Request):string|null {
 const url=new URL(request.url);const hash=claimantSessionHash(request);
 if(!hash||request.method!=="POST"||url.search!==""||request.headers.get("origin")!==url.origin||request.headers.get("sec-fetch-site")!=="same-origin"
  ||request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase()!=="application/json")return null;
 return hash;
}
