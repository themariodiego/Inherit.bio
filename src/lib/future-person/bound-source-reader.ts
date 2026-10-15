import "server-only";
import {z} from "zod";
import {createClient} from "@/lib/supabase/server";
import {futurePersonClaimsOpen} from "./claims-open";
import {readRelocation,relocationTargetSchema,relocatedIdentitySchema} from "./relocation-transport";
const revision=z.number().int().positive().safe(),hash=z.string().regex(/^[0-9a-f]{64}$/),uuid=z.uuid();
export const boundSourceManifestSchema=z.object({
 version:z.literal("bound-future-person-canonical-source-v1"),purpose:z.literal("approved-future-person-export-v1"),
 actor:z.object({accountId:uuid,sessionId:uuid,accountAuthSessionRevision:revision,sessionRevision:revision}).strict(),
 bindingId:uuid,claimId:uuid,claimantPrincipalId:uuid,claimantRevision:revision,releaseRevision:revision,principalRevision:revision,
 subjectId:uuid,subjectBindingRevision:revision,subjectLifecycleRevision:revision,fileId:uuid,sourceSha256:hash,membershipSha256:hash,
 publicationRevision:revision,byteCount:z.number().int().positive().max(50*4004096),partCount:z.number().int().min(1).max(50),
 expiresAt:z.iso.datetime({offset:true}),parts:z.array(z.object({sequence:z.number().int().min(0).max(49),partId:uuid,
  target:relocationTargetSchema,identity:relocatedIdentitySchema}).strict()).min(1).max(50)
}).strict().refine(v=>v.parts.length===v.partCount&&new Set(v.parts.map(p=>p.partId)).size===v.partCount
 &&new Set(v.parts.map(p=>p.target.relocationId)).size===v.partCount&&new Set(v.parts.map(p=>p.target.attemptId)).size===v.partCount
 &&v.parts.reduce((sum,p)=>sum+p.target.byteCount,0)===v.byteCount
 &&v.parts.every((p,i)=>p.sequence===i&&p.target.bindingId===v.bindingId&&p.target.accountId===v.actor.accountId
  &&p.target.expiresAt===v.expiresAt&&p.identity.byteCount===p.target.byteCount
  &&p.identity.providerVersion!==p.target.oldVersion));
export type BoundSourceManifest=z.infer<typeof boundSourceManifestSchema>;
export class BoundSourceUnavailable extends Error {
 constructor(){super("bound_future_person_source_unavailable");this.name="BoundSourceUnavailable";}
}
/** Closed server-only own-access reader. The actual caller's verified JWT and
 * scoped RPC select all parts; no service client, parent namespace or caller
 * path is accepted. No bytes leave this function until every EOF and final
 * current authority check succeeds. This is access, never analytic consent. */
export async function readBoundFuturePersonCanonicalSource(subjectId:string,signal:AbortSignal){
 try{
  if(!futurePersonClaimsOpen()||signal.aborted||!uuid.safeParse(subjectId).success)throw new BoundSourceUnavailable();
  const client=await createClient();
  const auth=async()=>{
   const [user,claims]=await Promise.all([client.auth.getUser(),client.auth.getClaims()]);const jwt=claims.data?.claims;
   if(user.error||claims.error||!user.data.user||jwt?.sub!==user.data.user.id||jwt.role!=="authenticated"
    ||typeof jwt.session_id!=="string"||!uuid.safeParse(jwt.session_id).success)throw new BoundSourceUnavailable();
   return {accountId:jwt.sub,sessionId:jwt.session_id};
  };
  const actor=await auth();
  const selected=await client.rpc("future_person_bound_source_manifest_v1",{p_subject:subjectId}).abortSignal(signal);
  const manifest=boundSourceManifestSchema.parse(selected.data);
  if(selected.error||manifest.subjectId!==subjectId||manifest.actor.accountId!==actor.accountId
   ||manifest.actor.sessionId!==actor.sessionId)throw new BoundSourceUnavailable();
  const current=async()=>{
   if(signal.aborted||Date.parse(manifest.expiresAt)<=Date.now())throw new BoundSourceUnavailable();
   const live=await auth();if(live.accountId!==actor.accountId||live.sessionId!==actor.sessionId)throw new BoundSourceUnavailable();
   const check=await client.rpc("check_future_person_bound_source_v1",{p_subject:subjectId,p_expected:manifest}).abortSignal(signal);
   if(check.error||check.data!==true)throw new BoundSourceUnavailable();
  };
  const parts:Array<{sequence:number;partId:string;bytes:Uint8Array}>=[];
  for(const part of manifest.parts){
   await current();const bytes=await readRelocation(part.target,part.identity,signal);await current();
   parts.push({sequence:part.sequence,partId:part.partId,bytes});
  }
  await current();return {manifest,parts};
 }catch{throw new BoundSourceUnavailable();}
}
