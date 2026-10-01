import "server-only";
import {z} from "zod";
import {buildAccountArchive} from "./account-archive-worker";

export type AccountArchiveGenerationCapability=Readonly<{
 /** Trusted provider/configuration proof, before discovery, create or begin.
  * This is a server-owned capability, never a request Boolean or environment
  * opt-in. Delivery/publication remain separate and are not authorized here. */
 assertReady:(signal:AbortSignal)=>Promise<void>;
 execution:Omit<Parameters<typeof buildAccountArchive>[0],"job"|"signal">;
}>;
/** The owner has not selected/proved export delivery. No ambient Supabase/R2
 * writer is adopted from existing source readers or configuration variables. */
export function approvedAccountArchiveGeneration():AccountArchiveGenerationCapability|null{return null;}
const job=z.object({exportId:z.uuid(),principalHash:z.string().regex(/^[a-f0-9]{64}$/u),
 authorityReceipt:z.string().regex(/^[a-f0-9]{64}$/u),deadline:z.iso.datetime({offset:true})}).strict();
export type AccountArchiveDueRpc=(name:"export_archive_account_due_v1",args:{p_after:string|null},signal:AbortSignal)
 =>PromiseLike<{data:unknown;error:unknown}>;
const unavailable=()=>new Error("account_archive_generation_unavailable");
/** One exact bounded account-only page. Discovery does not claim authority;
 * the real complete executor independently preflights, begins and recaptures
 * every source/member/attempt. No ready CAS, mail, retry or provider selection. */
export async function runAccountArchiveGeneration(options:{capability:AccountArchiveGenerationCapability|null;
 rpc:()=>AccountArchiveDueRpc;signal:AbortSignal}){
 if(!options.capability||options.signal.aborted)throw unavailable();
 const capability=options.capability;
 const bounded=async<T>(work:(signal:AbortSignal)=>PromiseLike<T>):Promise<T>=>{
  const stop=new AbortController(),signal=AbortSignal.any([options.signal,stop.signal]);let interrupt=()=>{};
  const timer=setTimeout(()=>stop.abort(),30_000);timer.unref();
  const aborted=new Promise<never>((_,reject)=>{interrupt=()=>reject(unavailable());signal.addEventListener("abort",interrupt,{once:true});});
  try{if(signal.aborted)throw unavailable();const value=await Promise.race([Promise.resolve().then(()=>work(signal)),aborted]);
   if(signal.aborted)throw unavailable();return value;
  }finally{clearTimeout(timer);signal.removeEventListener("abort",interrupt);stop.abort();}
 };
 await bounded(signal=>capability.assertReady(signal));
 const rpc=options.rpc(),reply=await bounded(signal=>rpc("export_archive_account_due_v1",{p_after:null},signal));
 if(reply.error!==null)throw unavailable();const jobs=z.array(job).max(16).parse(reply.data);
 let last="";for(const value of jobs){const now=Date.now(),deadline=Date.parse(value.deadline);
  if(value.exportId<=last||deadline<=now+30_000||deadline>now+86_400_000)throw unavailable();last=value.exportId;}
 let completed=0;
 for(const value of jobs){
  // Configuration may be revoked while another archive is generated. It must
  // still hold before this fresh attempt, then every write has its own proof.
  await bounded(signal=>capability.assertReady(signal));
  if(options.signal.aborted||Date.now()>=Date.parse(value.deadline))throw unavailable();
  await buildAccountArchive({...capability.execution,job:value,signal:options.signal});completed++;
 }
 return Object.freeze({completed});
}
