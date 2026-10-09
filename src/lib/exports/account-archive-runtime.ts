import "server-only";
import {createAdminClient} from "@/lib/supabase/admin";
import {readConfiguredOriginalRange} from "@/lib/uploads/prepared-original-download";
import type {buildAccountArchive} from "./account-archive-worker";

type Execution=Omit<Parameters<typeof buildAccountArchive>[0],"job"|"signal">;
type Reply={data:unknown;error:unknown};
type Query={retry:(enabled:false)=>{abortSignal:(signal:AbortSignal)=>PromiseLike<Reply>}};

/** Actual service SDK wiring, separate from provider approval. No stored human
 * JWT, ambient archive writer, caller target, selector query or fake READY.
 * Each reader owns current consumed-request/attempt/source authority before
 * and after reads. Supabase range transport is the existing original store;
 * the explicit archive writer remains the owner's unresolved delivery choice. */
export function accountArchiveExecution(write:Execution["write"]):Execution{
 if(typeof write!=="function")throw new Error("account_archive_unavailable");
 let admin:ReturnType<typeof createAdminClient>|undefined;
 function query(name:string,args:unknown,signal?:AbortSignal){
  if(signal?.aborted)throw new Error("account_archive_unavailable");
  admin??=createAdminClient();
  const rpc=admin.rpc.bind(admin) as unknown as (name:string,args:unknown,options:{get:false;head:false})=>Query;
  const selected=rpc(name,args,{get:false,head:false});
  return signal?selected.retry(false).abortSignal(signal):selected;
 }
 function reader<Name extends string,Args>(expected:Name){
  return (name:Name,args:Args,signal:AbortSignal):PromiseLike<Reply>=>{
   if(name!==expected)throw new Error("account_archive_unavailable");return query(expected,args,signal) as PromiseLike<Reply>;
  };
 }
 const workerRpc:Execution["workerRpc"]=(name,args,options)=>{
  if(name!=="export_archive_worker_v1"||options.get!==false||options.head!==false)throw new Error("account_archive_unavailable");
  return query("export_archive_worker_v1",args) as Query;
 };
 return {workerRpc,
  memberRpc:reader("export_archive_account_members_v1"),contentRpc:reader("export_archive_account_content_v1"),
  metadataRpc:reader("export_archive_account_metadata_v1"),inventoryRpc:reader("export_archive_account_inventory_v1"),
  classRpc:reader("export_archive_account_classes_v1"),auditRpc:reader("export_archive_account_audit_v1"),
  originalRpc:reader("export_archive_account_original_v1"),boundSourceRpc:reader("export_archive_account_bound_source_v1"),
  graphRpc:reader("export_archive_account_graph_rows_v2"),pathBRpc:reader("export_archive_account_path_b_v1"),
  readOriginalRange:readConfiguredOriginalRange,write};
}
