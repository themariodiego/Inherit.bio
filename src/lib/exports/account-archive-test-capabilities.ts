import "server-only";
import {z} from "zod";
import {isTestJurisdictionEnabled} from "@/lib/legal/jurisdictions";
import {configuredRequesterStatementGateway} from "./requester-statement-private-transport";
import {withAccountArchiveR2Owner,createAccountArchiveR2Writer} from "./account-archive-r2";
import {createRequesterStatementRuntime} from "./requester-statement-runtime";
import {accountArchiveExecution} from "./account-archive-runtime";
import {completeTestAccountArchive,accountArchiveReadySchema} from "./account-archive-test-publication";
import type {AccountArchiveGenerationCapability} from "./account-archive-generation";
import type {AccountExportDeliveryCapability} from "./account-export-delivery";

type Environment=Readonly<Record<string,string|undefined>>;
const config=z.object({bucket:z.string().regex(/^inherit-export-[a-z0-9-]{1,40}$/u),
 bindingSha256:z.string().regex(/^[0-9a-f]{64}$/u),protocol:z.literal("r2-current-object-qualified-all-writer-gateway-v1")}).strict();
const unavailable=()=>new Error("test_account_archive_unavailable");
/** Selecting TEST changes no production policy. Native configuration remains
 * default-OFF and actual private provider configuration must match it before
 * discovery/create; ordinary approved generation stays null. */
export function configuredTestAccountArchive(env:Environment=process.env):{
 generation:AccountArchiveGenerationCapability;delivery:AccountExportDeliveryCapability}|null{
 if(!isTestJurisdictionEnabled(env)||env.INHERIT_TEST_ACCOUNT_ARCHIVE_R2!=="1")return null;
 async function assertReady(signal:AbortSignal){
  const runtime=createRequesterStatementRuntime(),deadline=Date.now()+30_000;
  try{
   const expected=await withAccountArchiveR2Owner(env,signal,runtime,async tx=>{
    const rows=await tx<{configuration:unknown}[]>`select private.account_archive_test_configuration_v1() as configuration`;
    if(rows.length!==1)throw unavailable();return config.parse(rows[0]?.configuration);
   });
   await runtime.track("account-provider-configuration",()=>configuredRequesterStatementGateway(env,runtime).assertConfiguration(expected,signal));
   if(signal.aborted)throw unavailable();
  }finally{await runtime.settle(deadline);runtime.assertSettled();}
 }
 const generation:AccountArchiveGenerationCapability={assertReady,
  execution:accountArchiveExecution(async()=>{throw unavailable();},"complete-test"),
  executionForJob:async(job,signal)=>{
   const runtime=createRequesterStatementRuntime();
   try{
    const gateway=configuredRequesterStatementGateway(env,runtime);
    const write=createAccountArchiveR2Writer({gateway,authorityReceipt:job.authorityReceipt,deadline:Date.parse(job.deadline),runtime,env});
    if(signal.aborted)throw unavailable();return {...accountArchiveExecution(write,"complete-test"),statementRuntime:runtime};
   }catch(error){await runtime.settle(Date.parse(job.deadline));runtime.assertSettled();throw error;}
  },
  completeBytes:async(job,result,signal)=>{
   const runtime=createRequesterStatementRuntime();
   try{await completeTestAccountArchive({job,result,signal,runtime,gateway:configuredRequesterStatementGateway(env,runtime),env});}
   finally{await runtime.settle(Date.parse(job.deadline));runtime.assertSettled();}
  },
 };
 const delivery:AccountExportDeliveryCapability={assertReady,ready:async(input,signal)=>{
  const runtime=createRequesterStatementRuntime(),deadline=Date.now()+30_000;
  try{return await withAccountArchiveR2Owner(env,signal,runtime,async tx=>{
   const rows=await tx<{ready:unknown}[]>`select private.account_archive_test_ready_v1(${JSON.stringify({kind:"account",...input.actor})}::jsonb,
    ${input.exportId}::uuid,${input.exportCookieHash}) as ready`;
   if(rows.length!==1)throw unavailable();return accountArchiveReadySchema.parse(rows[0]?.ready);
  });}finally{await runtime.settle(deadline);runtime.assertSettled();}
 }};
 return Object.freeze({generation,delivery});
}
