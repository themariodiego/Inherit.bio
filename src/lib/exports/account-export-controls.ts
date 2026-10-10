import "server-only";
import {accountExportHttpDependencies,presentAccountExportCreate,presentAccountExportOpen,type AccountExportHttpDependencies} from "./account-export-http";
import {cookies} from "next/headers";
import {ACCOUNT_EXPORT_COOKIE} from "./account-export-session";
import type {AccountExportControl} from "./account-export-control";

/** No provider selection or enqueue occurs while presenting settings. An
 * unconfigured worker supplies no usable action. Configured actions still
 * need genuine current Auth plus complete SQL capture, and POST repeats both. */
export async function accountExportControls(deps:AccountExportHttpDependencies=accountExportHttpDependencies()):Promise<AccountExportControl>{
 if(!deps.generation)return {available:false};
 const stop=new AbortController();
 try{const create=await presentAccountExportCreate(deps,stop.signal);
  if(!create)return {available:false};
  if(deps.delivery){
   const selected=(await cookies()).getAll(ACCOUNT_EXPORT_COOKIE);
   if(selected.length>1)return {available:false};
   if(selected.length===1){
    const request=new Request(new URL("/api/export",deps.origin()),{headers:{cookie:`${ACCOUNT_EXPORT_COOKIE}=${selected[0].value}`}});
    const open=await presentAccountExportOpen(request,deps,stop.signal);
    if(open)return {available:true,create,open};
   }
  }
  return {available:true,create};
 }catch{return {available:false};}finally{stop.abort();}
}
