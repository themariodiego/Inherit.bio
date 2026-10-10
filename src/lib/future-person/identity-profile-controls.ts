import "server-only";

import {z} from "zod";
import {getSensitiveAccountContext} from "@/lib/account-deletion";
import {createAdminClient} from "@/lib/supabase/admin";
import {futurePersonClaimsOpen} from "./claims-open";
import {identityProfileContext,mintIdentityProfileOperation} from "./identity-profile-operation";
import {profileProofFailure,profileRpcFailure,profileSchemaFailure} from "./identity-profile-diagnostics";

const row=z.object({embryoId:z.uuid(),label:z.string().min(1).max(240),hasProfile:z.boolean(),
  expiresAt:z.iso.datetime({offset:true}),saveContext:identityProfileContext.nullable(),
  deleteContext:identityProfileContext}).strict().superRefine((value,ctx)=>{
  const current=value.deleteContext;
  if(current.embryoId!==value.embryoId||current.consentSignatureId!==null
    ||(current.currentProfileId!==null)!==value.hasProfile||current.expiresAt!==value.expiresAt
    ||(value.saveContext&&(value.saveContext.embryoId!==value.embryoId||value.saveContext.consentSignatureId===null
      ||value.saveContext.expiresAt!==value.expiresAt||Object.entries(current).some(([key,field])=>key!=="basisFingerprint"&&key!=="consentSignatureId"
        &&value.saveContext![key as keyof typeof current]!==field))))
    ctx.addIssue({code:"custom",message:"Profile control authority is inconsistent"});
});
const inventory=z.object({items:z.array(row).max(64),nextCursor:z.uuid().nullable()}).strict()
  .superRefine((value,ctx)=>{
    if(new Set(value.items.map(item=>item.embryoId)).size!==value.items.length)
      ctx.addIssue({code:"custom",message:"Duplicate profile control"});
  });
type Proof=Readonly<{operationNonce:string;csrf:string}>;
export type IdentityProfileControl=Readonly<{embryoId:string;label:string;hasProfile:boolean;expiresAt:string;
  save:Readonly<Proof&{consentSignatureId:string}>|null;delete:Proof|null}>;
export type IdentityProfileControls=Readonly<{items:IdentityProfileControl[];nextCursor:string|null;unavailable:boolean}>;

/** No profile plaintext, ciphertext, index or key is selected or serialized.
 * The settings GET performs read-only checks, then mints stateless proofs. */
export async function identityProfileControls(after:string|null=null,now=Date.now()):Promise<IdentityProfileControls|null>{
  if(!futurePersonClaimsOpen())return null;
  if(after!==null&&!z.uuid().safeParse(after).success)return {items:[],nextCursor:null,unavailable:true};
  const account=await getSensitiveAccountContext();if(!account)return null;
  const unavailable={items:[],nextCursor:null,unavailable:true} as const;
  const result=await (async()=>{
    try{
      const {data,error}=await createAdminClient().rpc("future_person_profile_controls_v1",{
        p_account:account.user.id,p_session:account.sessionId,p_after:after,
      });
      if(error){profileRpcFailure(error);return null;}
      return {data};
    }catch(error){profileRpcFailure(error);return null;}
  })();
  if(!result)return {...unavailable,items:[]};
  const parsed=(()=>{
    try{return inventory.safeParse(result.data);}
    catch{profileSchemaFailure([{code:"unavailable",path:[]}]);return null;}
  })();
  if(!parsed)return {...unavailable,items:[]};
  if(!parsed.success){profileSchemaFailure(parsed.error.issues);return {...unavailable,items:[]};}
  try{
    const binding={accountId:account.user.id,sessionId:account.sessionId};
    const items=parsed.data.items.map(item=>({embryoId:item.embryoId,label:item.label,hasProfile:item.hasProfile,expiresAt:item.expiresAt,
      save:item.saveContext?{...mintIdentityProfileOperation({...binding,embryoId:item.embryoId,operation:"save"},item.saveContext,now),
        consentSignatureId:item.saveContext.consentSignatureId!}:null,
      delete:item.hasProfile?mintIdentityProfileOperation({...binding,embryoId:item.embryoId,operation:"delete"},item.deleteContext,now):null,
    }));
    return {items,nextCursor:parsed.data.nextCursor,unavailable:false};
  }catch{profileProofFailure();return {...unavailable,items:[]};}
}
