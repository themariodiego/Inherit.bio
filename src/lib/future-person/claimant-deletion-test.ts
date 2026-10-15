import "server-only";
import postgres from "postgres";
import {z} from "zod";
import {isTestJurisdictionEnabled} from "@/lib/legal/jurisdictions";
import {normalizationDatabaseConfig} from "@/lib/uploads/normalization-database";
import {createAdminClient} from "@/lib/supabase/admin";
import {embryoFragmentStorageConfigured,type EmbryoFragmentRpc} from "@/lib/embryos/fragment-storage";
import {createRequesterStatementRuntime} from "@/lib/exports/requester-statement-runtime";
import type {ClaimantDeletionExecution} from "./claimant-deletion";

const configuration=z.object({bucket:z.string().regex(/^inherit-export-[a-z0-9-]{1,40}$/u),
 bindingSha256:z.string().regex(/^[0-9a-f]{64}$/u),protocol:z.literal("r2-current-object-qualified-all-writer-gateway-v1")}).strict();
const unavailable=()=>new Error("claimant_deletion_unavailable");
type Environment=Readonly<Record<string,string|undefined>>;
type Query=(name:string,args:unknown,options:{get:false;head:false})=>{retry(enabled:false):{abortSignal(signal:AbortSignal):PromiseLike<{data:unknown;error:unknown}>}};
/** No production composition. Fresh requests require a distinct default-OFF
 * claimant opt-in plus genuine enabled native TEST configuration. An already
 * sealed cleanup remains usable after that opt-in/configuration is revoked.
 * The existing dedicated TEST database is transport only, never account/raw
 * authority. No account writer, READY or disposal receipt is borrowed. */
export function configuredTestClaimantDeletion(env:Environment=process.env,
 purpose:"request"|"maintenance"="request"):ClaimantDeletionExecution|null{
 if(!isTestJurisdictionEnabled(env)||(purpose!=="request"&&purpose!=="maintenance")
  ||purpose==="request"&&(env.INHERIT_TEST_CLAIMANT_RIGHTS!=="1"||env.INHERIT_TEST_ACCOUNT_ARCHIVE_R2!=="1"))return null;
 // An unused optional continuation must not manufacture a retention failure.
 // A nonempty malformed transport remains configured-but-refused by the same
 // strict parser in owner(); sealed cleanup still ignores request activation.
 if(purpose==="maintenance"&&(env.INHERIT_TEST_ACCOUNT_ARCHIVE_R2_DATABASE===undefined
  ||env.INHERIT_TEST_ACCOUNT_ARCHIVE_R2_DATABASE===""))return null;
 async function owner<T>(signal:AbortSignal,work:(tx:postgres.TransactionSql)=>Promise<T>):Promise<T>{
  if(!isTestJurisdictionEnabled(env))throw unavailable();
  const config=normalizationDatabaseConfig({...env,INHERIT_NORMALIZATION_DIRECT_DATABASE:"true",
   DATABASE_URL:env.INHERIT_TEST_ACCOUNT_ARCHIVE_R2_DATABASE,
   INHERIT_NORMALIZATION_DATABASE_CA_CERT:env.INHERIT_TEST_ACCOUNT_ARCHIVE_R2_DATABASE_CA_CERT});
  if(!config)throw unavailable();
  const runtime=createRequesterStatementRuntime(),deadline=Date.now()+30_000;
  const sql=postgres({...config,max:1,prepare:false,fetch_types:false,connect_timeout:5,idle_timeout:5,
   max_lifetime:40,connection:{application_name:"inherit-test-claimant-deletion"},onnotice:()=>{},debug:false});
  let closing:Promise<void>|undefined;
  const close=()=>closing??=runtime.cleanup("claimant-native-close",()=>sql.end({timeout:0}));
  let abort=()=>{};
  const interrupted=new Promise<never>((_,reject)=>{abort=()=>{void close().catch(()=>{});reject(unavailable());};
   signal.addEventListener("abort",abort,{once:true});});
  const timer=setTimeout(abort,30_000);timer.unref();
  try{
   if(signal.aborted)throw unavailable();
   const value=await Promise.race([runtime.track("claimant-native-owner",()=>sql.begin(async tx=>{
    const rows=await tx<{allowed:boolean}[]>`select current_user='postgres' and session_user='postgres' as allowed`;
    if(rows.length!==1||rows[0]?.allowed!==true)throw unavailable();
    await tx`select set_config('statement_timeout','25000',true),set_config('lock_timeout','5000',true),set_config('idle_in_transaction_session_timeout','25000',true)`;
    if(signal.aborted)throw unavailable();return work(tx);
   })),interrupted]);
   if(signal.aborted)throw unavailable();return value as T;
  }catch{throw unavailable();}
  finally{
   clearTimeout(timer);signal.removeEventListener("abort",abort);
   try{await runtime.wait(close(),deadline);}finally{await runtime.settle(deadline);runtime.assertSettled();}
  }
 }
 async function assertReady(signal:AbortSignal){
  if(purpose!=="request"||!isTestJurisdictionEnabled(env)||env.INHERIT_TEST_CLAIMANT_RIGHTS!=="1"
   ||env.INHERIT_TEST_ACCOUNT_ARCHIVE_R2!=="1"||!embryoFragmentStorageConfigured()||signal.aborted)throw unavailable();
  await owner(signal,async tx=>{
   const rows=await tx<{configuration:unknown}[]>`select private.account_archive_test_configuration_v1() as configuration`;
   if(rows.length!==1)throw unavailable();configuration.parse(rows[0]?.configuration);
  });
 }
 const parts:EmbryoFragmentRpc=(name,args)=>({abortSignal:signal=>{
  if(name!=="future_person_deletion_parts_v1"||signal.aborted)throw unavailable();
  const admin=createAdminClient(),rpc=admin.rpc.bind(admin) as unknown as Query;
  return rpc("future_person_deletion_parts_v1",args,{get:false,head:false}).retry(false).abortSignal(signal);
 }});
 return Object.freeze({assertReady,parts,
  prepare:async(sessionHash,operationNonce,signal)=>{
   if(purpose!=="request"||env.INHERIT_TEST_CLAIMANT_RIGHTS!=="1"||env.INHERIT_TEST_ACCOUNT_ARCHIVE_R2!=="1"
    ||!embryoFragmentStorageConfigured()||signal.aborted)throw unavailable();
   return owner(signal,async tx=>{
    // Recheck configuration in the same transaction as the exact claimant
    // request. Its original independent attested-session/consent/custody gates
    // and all class-specific external-object refusals remain authoritative.
    const config=await tx<{configuration:unknown}[]>`select private.account_archive_test_configuration_v1() as configuration`;
    if(config.length!==1)throw unavailable();configuration.parse(config[0]?.configuration);
    const rows=await tx<{manifestId:unknown}[]>`select private.prepare_future_person_deletion_v1(${sessionHash},${operationNonce}) as "manifestId"`;
    if(rows.length!==1)throw unavailable();return z.uuid().parse(rows[0]?.manifestId);
   });
  },
  finish:(manifestId,claimTokenHash,signal)=>owner(signal,async tx=>{
   const rows=await tx<{result:unknown}[]>`select private.finish_future_person_deletion_v1(${manifestId}::uuid,${claimTokenHash}) as result`;
   if(rows.length!==1)throw unavailable();return rows[0]?.result;
  }),
  due:signal=>owner(signal,async tx=>{
   // One genuine native sealed manifest only; no HTTP selector, arbitrary
   // source, nonce replay, new request or changed deadline is accepted.
   return tx<{manifestId:string}[]>`select m.id as "manifestId" from public.purge_manifests m
    join public.retention_due_phases p on p.retention_row_id=m.retention_row_id and p.phase_id=m.phase_id and p.phase_revision=m.phase_revision
    join public.retention_rows r on r.id=p.retention_row_id
    where m.manifest_class='complete-retention' and m.state in('frozen','executing')
     and p.retention_id='future-person.claimant-reverification-until-request'
     and p.phase_id='future-person-claimed-source-disposal' and p.phase_kind='purge'
     and r.state='active' and r.target_kind='subject' and r.target_id=p.target_id
     and p.status in('pending','retry','claimed') and p.phase_deadline<=clock_timestamp()
     and (p.status<>'claimed' or p.claim_expires_at<=clock_timestamp())
    order by m.id limit 1`;
  }),
 });
}
