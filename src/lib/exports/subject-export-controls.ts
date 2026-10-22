import "server-only";
import {cookies} from "next/headers";
import {z} from "zod";
import {createAdminClient} from "@/lib/supabase/admin";
import {ACCOUNT_EXPORT_COOKIE} from "./account-export-session";
import type {AccountExportControl} from "./account-export-control";
import {presentSubjectExportCreate,presentSubjectExportOpen,subjectExportHttpDependencies,
 type SubjectExportHttpDependencies,type SubjectExportRefusal} from "./subject-export-http";

export type SubjectExportControl=AccountExportControl|{available:false;refusal:SubjectExportRefusal};
export type SubjectExportItem={subjectId:string;self:boolean;label:string|null;route:string;control:SubjectExportControl};
type Records=()=>Promise<{id:string;subject_class:string;display_label:string|null}[]>;
const row=z.object({id:z.uuid(),subject_class:z.enum(["self","other_adult"]),display_label:z.string().max(200).nullable()}).strict();

/** The caller's own ordinary records: the self record and adult records whose
 * own account is the caller, as the request door admits them. */
function ownRecords(accountId:string):Records{
 return async()=>{
  const {data,error}=await createAdminClient().from("subjects").select("id,subject_class,display_label")
   .eq("subject_account_id",accountId).in("subject_class",["self","other_adult"]).in("lifecycle",["active","restricted"])
   .order("id").limit(20);
  if(error)throw new Error("subject_export_unavailable");return z.array(row).parse(data);
 };
}

/** Settings presentation for one-record exports. Nothing is shown while no
 * generation capability is configured, as for the account export. Each
 * record's action is the route's own server presentation: a record with live
 * joint results gets its stated refusal and no proof. No job, cookie or
 * session is created here. */
export async function subjectExportControls(deps:SubjectExportHttpDependencies=subjectExportHttpDependencies(),
 records?:Records):Promise<SubjectExportItem[]|null>{
 if(!deps.generation)return null;
 const stop=new AbortController();
 try{
  const actor=await deps.actor();if(!actor)return null;
  const items:SubjectExportItem[]=[];
  const selected=deps.delivery?(await cookies()).getAll(ACCOUNT_EXPORT_COOKIE):[];
  for(const record of await (records??ownRecords(actor.accountId))()){
   const route=`/api/subjects/${record.id}/export`;let control:SubjectExportControl={available:false};
   try{
    const create=await presentSubjectExportCreate(deps,record.id,stop.signal);
    if(create&&"refusal" in create)control={available:false,refusal:create.refusal};
    else if(create){
     control={available:true,create};
     if(selected.length===1){
      const request=new Request(new URL(route,deps.origin()),{headers:{cookie:`${ACCOUNT_EXPORT_COOKIE}=${selected[0].value}`}});
      const open=await presentSubjectExportOpen(request,deps,record.id,stop.signal).catch(()=>null);
      if(open)control={available:true,create,open};
     }
    }
   }catch{control={available:false};}
   items.push({subjectId:record.id,self:record.subject_class==="self",label:record.display_label,route,control});
  }
  return items;
 }catch{return null;}finally{stop.abort();}
}
