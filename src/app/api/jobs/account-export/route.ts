import {createAdminClient} from "@/lib/supabase/admin";
import {hasEmptyRequestBody} from "@/lib/empty-request-body";
import {ownUploadJson} from "@/lib/uploads/own-upload-context";
import {configuredTestAccountArchive} from "@/lib/exports/account-archive-test-capabilities";
import {runAccountArchiveGeneration,runSubjectArchiveGeneration,type AccountArchiveDueRpc,type SubjectArchiveDueRpc} from "@/lib/exports/account-archive-generation";
import {runTestAccountArchiveDisposal} from "@/lib/exports/account-archive-test-disposal";

export const maxDuration=300;
/** A closed operator TEST door. The only selector names a fixed worker; no
 * request can select an account, source, provider, allocation or deadline.
 * Native configuration and the actual private gateway must match before work.
 * Ordinary generation remains unapproved and is never selected here. */
export async function POST(request:Request){
 const authorization=request.headers.get("authorization");
 if(![process.env.JOBS_SECRET,process.env.CRON_SECRET].some(secret=>secret&&authorization===`Bearer ${secret}`))
  return ownUploadJson({error:"unauthorized"},401);
 const operation=request.headers.get("x-inherit-account-export-operation");
 if(request.method!=="POST"||new URL(request.url).search||request.bodyUsed
  ||request.headers.has("transfer-encoding")||!/^(?:0)?$/u.test(request.headers.get("content-length")??"")
  ||operation!=="generation"&&operation!=="subject-generation"&&operation!=="disposal")
  return ownUploadJson({error:"invalid_request"},400);
 try{if(!(await hasEmptyRequestBody(request)))return ownUploadJson({error:"invalid_request"},400);}
 catch{return ownUploadJson({error:"invalid_request"},400);}
 const signal=AbortSignal.any([request.signal,AbortSignal.timeout(maxDuration*1000)]);
 try{
  const selected=configuredTestAccountArchive();if(!selected||signal.aborted)throw new Error("closed");
  await selected.generation.assertReady(signal);
  const due=()=>{
   const admin=createAdminClient();
   type Query={retry:(enabled:false)=>{abortSignal:(current:AbortSignal)=>PromiseLike<{data:unknown;error:unknown}>}};
   const invoke=admin.rpc.bind(admin) as unknown as(name:string,args:unknown,options:{get:false;head:false})=>Query;
   return (name:string,args:{p_after:string|null},current:AbortSignal)=>invoke(name,args,{get:false,head:false}).retry(false).abortSignal(current);
  };
  if(operation==="disposal")await runTestAccountArchiveDisposal({signal});
  // The one-record export's queued jobs (api.subject-export) drain through
  // their own fixed selector; no request names a subject or a job.
  else if(operation==="subject-generation")await runSubjectArchiveGeneration({capability:selected.generation,signal,
   rpc:()=>{const rpc:SubjectArchiveDueRpc=due();return rpc;}});
  else await runAccountArchiveGeneration({capability:selected.generation,signal,rpc:()=>{
   const rpc:AccountArchiveDueRpc=due();
   return rpc;
  }});
  if(signal.aborted)throw new Error("closed");
  return new Response(null,{status:204,headers:{"Cache-Control":"no-store","X-Content-Type-Options":"nosniff"}});
 }catch{return ownUploadJson({error:"account_export_worker_unavailable"},503);}
}
