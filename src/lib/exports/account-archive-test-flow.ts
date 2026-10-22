import "server-only";
import {isTestJurisdictionEnabled} from "@/lib/legal/jurisdictions";
import {accountArchiveExecution} from "./account-archive-runtime";
import {createAccountArchiveR2Writer} from "./account-archive-r2";
import {createRequesterStatementRuntime,type RequesterStatementRuntime} from "./requester-statement-runtime";
import {runAccountArchiveGeneration,type AccountArchiveGenerationCapability,type AccountArchiveDueRpc} from "./account-archive-generation";
import {completeTestAccountArchive, type TestAccountArchiveReady} from "./account-archive-test-publication";
import type {RequesterStatementR2Gateway} from "./requester-statement-r2";

type Environment=Readonly<Record<string,string|undefined>>;
const unavailable=()=>new Error("test_account_archive_unavailable");
/** A closed TEST composition of the existing due reader, actual complete
 * account producer and account-native R2 writer. Every job gets its own tracked
 * runtime: the producer settles it permanently before completion starts.
 * The ordinary HTTP dependencies and approved generation remain closed. */
export async function runTestAccountArchiveFlow(options:{
 env?:Environment;signal:AbortSignal;rpc:()=>AccountArchiveDueRpc;
 assertReady:(signal:AbortSignal)=>Promise<void>;
 gateway:(runtime:RequesterStatementRuntime)=>RequesterStatementR2Gateway;
 /** Trusted synthetic reader fixture only; omitted uses actual service readers. */
 readers?:Omit<ReturnType<typeof accountArchiveExecution>,"write"|"statementRuntime">;
}){
 const env=options.env??process.env;
 if(!isTestJurisdictionEnabled(env)||env.INHERIT_TEST_ACCOUNT_ARCHIVE_R2!=="1"||options.signal.aborted)throw unavailable();
 const ready:TestAccountArchiveReady[]=[];
 const capability:AccountArchiveGenerationCapability={
  assertReady:options.assertReady,
  // This path is never used: executionForJob creates the actual owned writer.
  execution:accountArchiveExecution(async()=>{throw unavailable();}),
  executionForJob:async(job,signal)=>{
   if(signal.aborted)throw unavailable();
   const runtime=createRequesterStatementRuntime();
   try{
    const gateway=options.gateway(runtime),write=createAccountArchiveR2Writer({gateway,authorityReceipt:job.authorityReceipt,
     deadline:Date.parse(job.deadline),runtime,env});
    return {...(options.readers??accountArchiveExecution(write)),write,statementRuntime:runtime};
   }catch(error){await runtime.settle(Date.parse(job.deadline));runtime.assertSettled();throw error;}
  },
  completeBytes:async(job,result,signal)=>{
   const runtime=createRequesterStatementRuntime();
   try{ready.push(await completeTestAccountArchive({job,result,signal,runtime,
    gateway:options.gateway(runtime),env}));}
   finally{await runtime.settle(Date.parse(job.deadline));runtime.assertSettled();}
  },
 };
 const result=await runAccountArchiveGeneration({capability,rpc:options.rpc,signal:options.signal});
 if(result.completed!==ready.length)throw unavailable();
 return Object.freeze({completed:result.completed,ready:Object.freeze(ready)});
}
