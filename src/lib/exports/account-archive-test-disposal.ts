import "server-only";
import {z} from "zod";
import {isTestJurisdictionEnabled} from "@/lib/legal/jurisdictions";
import {withAccountArchiveR2Owner,disposeAccountArchiveR2Object} from "./account-archive-r2";
import {configuredRequesterStatementGateway} from "./requester-statement-private-transport";
import {createRequesterStatementRuntime} from "./requester-statement-runtime";
import {configuredTestAccountArchive} from "./account-archive-test-capabilities";

const due=z.array(z.object({attemptId:z.uuid(),ordinal:z.number().int().min(0).max(2_251_799_813)}).strict()).max(128);
const cleanupDue=z.array(z.object({exportId:z.uuid(),attemptId:z.uuid()}).strict()).max(16);
const stopped=z.object({state:z.literal("cleanup-pending"),notBefore:z.iso.datetime({offset:true})}).strict();
const unavailable=()=>new Error("test_account_archive_disposal_unavailable");
/** Native due discovery includes every committed/uncertain reservation. No
 * account logout, failed download or lost CREATE erases disposal obligations.
 * A bounded page never adopts an object or ACKs an unknown delete/COMMIT. */
export async function runTestAccountArchiveDisposal(options:{env?:Readonly<Record<string,string|undefined>>;signal:AbortSignal}){
 const env=options.env??process.env;
 if(!isTestJurisdictionEnabled(env)||env.INHERIT_TEST_ACCOUNT_ARCHIVE_R2!=="1"||options.signal.aborted)throw unavailable();
 const selected=configuredTestAccountArchive(env);if(!selected)throw unavailable();
 await selected.generation.assertReady(options.signal);
 // The real original expiry/lease workflow must make the attempt disposable.
 // This account-only owner discovery preserves the original due predicate;
 // a poll, successful download or provider observation cannot stop a live job.
 const transition=createRequesterStatementRuntime(),transitionDeadline=Date.now()+30_000;
 try{await withAccountArchiveR2Owner(env,options.signal,transition,async tx=>{
  const rows=await tx<{due:unknown}[]>`select private.account_archive_test_cleanup_due_v1() as due`;
  if(rows.length!==1)throw unavailable();const values=cleanupDue.parse(rows[0]?.due);
  let previous="";for(const value of values){if(value.attemptId<=previous)throw unavailable();previous=value.attemptId;}
  for(const value of values){
   if(options.signal.aborted)throw unavailable();
   const result=await tx<{stopped:unknown}[]>`select public.export_archive_cleanup_v1('stop',${value.exportId}::uuid,${value.attemptId}::uuid,null) as stopped`;
   if(result.length!==1)throw unavailable();stopped.parse(result[0]?.stopped);
  }
 });}finally{await transition.settle(transitionDeadline);transition.assertSettled();}
 const discovery=createRequesterStatementRuntime(),deadline=Date.now()+30_000;
 let values:z.infer<typeof due>;
 try{values=await withAccountArchiveR2Owner(env,options.signal,discovery,async tx=>{
  const rows=await tx<{due:unknown}[]>`select private.account_archive_test_disposal_due_v1() as due`;
  if(rows.length!==1)throw unavailable();return due.parse(rows[0]?.due);
 });}finally{await discovery.settle(deadline);discovery.assertSettled();}
 let previous:z.infer<typeof due>[number]|undefined;
 for(const value of values){
  if(previous&&(value.attemptId<previous.attemptId||value.attemptId===previous.attemptId&&value.ordinal<=previous.ordinal))throw unavailable();
  previous=value;
 }
 let completed=0;
 for(const value of values){
  await selected.generation.assertReady(options.signal);
  if(options.signal.aborted)throw unavailable();const runtime=createRequesterStatementRuntime(),settleBy=Date.now()+30_000;
  try{await disposeAccountArchiveR2Object({...value,signal:options.signal,runtime,env,
   gateway:configuredRequesterStatementGateway(env,runtime)});completed++;}
  finally{await runtime.settle(settleBy);runtime.assertSettled();}
 }
 return Object.freeze({completed});
}
