import "server-only";

import {z} from "zod";
import {getSensitiveAccountContext} from "@/lib/account-deletion";
import {futurePersonClaimsOpen} from "@/lib/future-person/claims-open";
import {createAdminClient} from "@/lib/supabase/admin";
import {mintEmbryoOperation} from "./operation-token";

const proposal=z.object({id:z.uuid(),disposition:z.enum(["stored","transferred","donated","discarded"]),
  expiresAt:z.iso.datetime({offset:true}),callerIsProposer:z.boolean()}).strict();
const row=z.object({embryoId:z.uuid(),label:z.string().min(1).max(240),
  mode:z.enum(["two-parent-propose-confirm","single-authority-direct"]),
  currentDisposition:z.enum(["unknown","stored"]),proposal:proposal.nullable()}).strict().superRefine((value,ctx)=>{
  if(value.mode==="single-authority-direct"&&value.proposal!==null
    ||value.currentDisposition==="stored"&&value.proposal?.disposition==="stored")
    ctx.addIssue({code:"custom",message:"Inconsistent disposition control"});
});
const inventory=z.object({items:z.array(row).max(64),nextCursor:z.uuid().nullable()}).strict().superRefine((value,ctx)=>{
  if(new Set(value.items.map(item=>item.embryoId)).size!==value.items.length)
    ctx.addIssue({code:"custom",message:"Duplicate disposition control"});
});
export type EmbryoDispositionControl=z.infer<typeof row>&Readonly<{nonce:string|null}>;
export type EmbryoDispositionControls=Readonly<{items:EmbryoDispositionControl[];nextCursor:string|null;unavailable:boolean}>;

/** Only current parent rights and neutral disposition facts reach the page.
 * This read mints no database nonce, grant, proposal or review approval. */
export async function embryoDispositionControls(after:string|null=null,now=Date.now()):Promise<EmbryoDispositionControls|null>{
  if(!futurePersonClaimsOpen())return null;
  if(after!==null&&!z.uuid().safeParse(after).success)return {items:[],nextCursor:null,unavailable:true};
  const account=await getSensitiveAccountContext();if(!account)return null;
  try{
    const result=await createAdminClient().rpc("embryo_disposition_controls_v1",{
      p_account:account.user.id,p_session:account.sessionId,p_after:after,
    });
    const parsed=inventory.safeParse(result.data);
    if(result.error||!parsed.success||parsed.data.items.some(item=>item.proposal&&Date.parse(item.proposal.expiresAt)<=now))
      return {items:[],nextCursor:null,unavailable:true};
    return {items:parsed.data.items.map(item=>({...item,nonce:item.proposal?.callerIsProposer?null:mintEmbryoOperation({
      accountId:account.user.id,sessionId:account.sessionId,operation:"embryo_disposition",targetKind:"embryo",targetId:item.embryoId,
    },now)})),nextCursor:parsed.data.nextCursor,unavailable:false};
  }catch{return {items:[],nextCursor:null,unavailable:true};}
}
