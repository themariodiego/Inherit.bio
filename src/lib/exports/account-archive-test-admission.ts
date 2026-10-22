import "server-only";
import {createHash} from "node:crypto";
import {z} from "zod";
import {configuredTestAccountArchive} from "./account-archive-test-capabilities";
import {withAccountArchiveR2Owner} from "./account-archive-r2";
import {createRequesterStatementRuntime} from "./requester-statement-runtime";

const configuration=z.object({bucket:z.string().regex(/^inherit-export-[a-z0-9-]{1,40}$/u),
 bindingSha256:z.string().regex(/^[a-f0-9]{64}$/u),protocol:z.literal("r2-current-object-qualified-all-writer-gateway-v1")}).strict();
const state=z.object({configuration,accountJobs:z.number().int().nonnegative().safe(),
 liveDownloads:z.number().int().nonnegative().safe(),undisposedAllocations:z.number().int().nonnegative().safe()}).strict();
const unavailable=()=>new Error("account_archive_test_fixture_unavailable");
/** Read-only fixture admission. Root provisions the genuine private TEST
 * service/configuration first; this function never enables it, creates a fake
 * provider receipt, chooses an origin, resets a queue or writes a consent.
 * A prior archive obligation refuses this fresh controlled fixture. */
export async function assertTestAccountArchiveFixtureAdmission(options:{signal:AbortSignal;
 env?:Readonly<Record<string,string|undefined>>}){
 const env=options.env??process.env,selected=configuredTestAccountArchive(env);
 if(!selected||options.signal.aborted)throw unavailable();
 const runtime=createRequesterStatementRuntime(),deadline=Date.now()+30_000;
 try{
  await selected.generation.assertReady(options.signal);
  const value=await withAccountArchiveR2Owner(env,options.signal,runtime,async tx=>{
   const rows=await tx<{state:unknown}[]>`select jsonb_build_object(
    'configuration',private.account_archive_test_configuration_v1(),
    'accountJobs',(select count(*) from private.export_archive_jobs j join public.generated_exports e on e.id=j.export_id
     where j.origin->>'kind'='account' and e.origin_kind='account' and e.target_kind='account'),
    'liveDownloads',(select count(*) from private.export_archive_downloads d join private.export_archive_jobs j on j.export_id=d.export_id
     where j.origin->>'kind'='account' and d.revoked_at is null and d.expires_at>clock_timestamp()),
    'undisposedAllocations',(select count(*) from private.account_archive_r2_allocations where disposed_at is null)
   ) as state`;
   if(rows.length!==1)throw unavailable();return state.parse(rows[0]?.state);
  });
  if(value.accountJobs!==0||value.liveDownloads!==0||value.undisposedAllocations!==0||options.signal.aborted)throw unavailable();
  await selected.generation.assertReady(options.signal);
  return Object.freeze({version:"account-archive-test-fixture-admission-v1" as const,
   configurationSha256:createHash("sha256").update(JSON.stringify(value.configuration)).digest("hex"),
   accountJobs:0 as const,liveDownloads:0 as const,undisposedAllocations:0 as const});
 }catch{throw unavailable();}
 finally{await runtime.settle(deadline);runtime.assertSettled();}
}
