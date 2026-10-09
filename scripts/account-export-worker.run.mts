/** Closed provider boundary, operator-started consumed account generation.
 * No target arguments, human JWT, ambient Storage writer or READY publisher. */
import {createAdminClient} from "../src/lib/supabase/admin";
import {approvedAccountArchiveGeneration,runAccountArchiveGeneration,type AccountArchiveDueRpc} from "../src/lib/exports/account-archive-generation";
const stop=new AbortController(),cancel=()=>stop.abort();
process.once("SIGINT",cancel);process.once("SIGTERM",cancel);
try{
 if(process.argv.length!==2)throw new Error("worker_closed");
 await runAccountArchiveGeneration({capability:approvedAccountArchiveGeneration(),signal:stop.signal,rpc:()=>{
  const admin=createAdminClient();
  type Query={retry:(enabled:false)=>{abortSignal:(signal:AbortSignal)=>PromiseLike<{data:unknown;error:unknown}>}};
  const invoke=admin.rpc.bind(admin) as unknown as(name:string,args:unknown,options:{get:false;head:false})=>Query;
  const rpc:AccountArchiveDueRpc=(name,args,signal)=>invoke(name,args,{get:false,head:false}).retry(false).abortSignal(signal);return rpc;
 }});
 process.stdout.write("account_export_generation_drained\n");
}catch{
 process.stderr.write("account_export_generation_unavailable\n");process.exitCode=1;
}finally{stop.abort();process.removeListener("SIGINT",cancel);process.removeListener("SIGTERM",cancel);}
