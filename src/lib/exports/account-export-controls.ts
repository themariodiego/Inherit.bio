import "server-only";
import {accountExportHttpDependencies,presentAccountExportCreate,type AccountExportHttpDependencies} from "./account-export-http";
import type {AccountExportControl} from "./account-export-control";

/** No provider selection or enqueue occurs while presenting settings. An
 * unconfigured worker supplies no usable action. Configured actions still
 * need genuine current Auth plus complete SQL capture, and POST repeats both. */
export async function accountExportControls(deps:AccountExportHttpDependencies=accountExportHttpDependencies()):Promise<AccountExportControl>{
 if(!deps.generation)return {available:false};
 const stop=new AbortController();
 try{const create=await presentAccountExportCreate(deps,stop.signal);
  return create?{available:true,create}:{available:false};
 }catch{return {available:false};}finally{stop.abort();}
}
