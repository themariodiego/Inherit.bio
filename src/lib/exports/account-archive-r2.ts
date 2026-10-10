import "server-only";
import {createHash,randomBytes} from "node:crypto";
import postgres from "postgres";
import {z} from "zod";
import {isTestJurisdictionEnabled} from "@/lib/legal/jurisdictions";
import {normalizationDatabaseConfig} from "@/lib/uploads/normalization-database";
import {validateArchiveSegment,type ArchiveAttempt,type ArchiveSegment} from "./archive-segments";
import {fenceR2CurrentReservation,r2AllocationDigest,r2CurrentReservationSchema} from "./archive-r2-current-fence";
import type {RequesterStatementR2Gateway} from "./requester-statement-r2";
import {readRequesterStatementWholeObject,verifyRequesterStatementObject} from "./requester-statement-r2-read";
import type {RequesterStatementRuntime} from "./requester-statement-runtime";

const hash=z.string().regex(/^[0-9a-f]{64}$/u),uuid=z.uuid();
const frameSchema=z.object({objectId:uuid,writeIdentity:r2CurrentReservationSchema.shape.writeIdentity,
 writeBindingSha256:hash,allocationSha256:hash,configurationSha256:hash,
 originalDeadline:z.iso.datetime({offset:true})}).strict();
type Frame=z.infer<typeof frameSchema>;
const unavailable=()=>new Error("account_archive_r2_unavailable");
type Environment=Readonly<Record<string,string|undefined>>;
function defaultEnvironment():Environment{return {...process.env,
 INHERIT_TEST_ACCOUNT_ARCHIVE_R2:process.env.INHERIT_TEST_ACCOUNT_ARCHIVE_R2,
 INHERIT_TEST_ACCOUNT_ARCHIVE_R2_DATABASE:process.env.INHERIT_TEST_ACCOUNT_ARCHIVE_R2_DATABASE,
 INHERIT_TEST_ACCOUNT_ARCHIVE_R2_DATABASE_CA_CERT:process.env.INHERIT_TEST_ACCOUNT_ARCHIVE_R2_DATABASE_CA_CERT};}
function configuration(env:Environment){
 if(!isTestJurisdictionEnabled(env)||env.INHERIT_TEST_ACCOUNT_ARCHIVE_R2!=="1")throw unavailable();
 const value=normalizationDatabaseConfig({...env,INHERIT_NORMALIZATION_DIRECT_DATABASE:"true",
  DATABASE_URL:env.INHERIT_TEST_ACCOUNT_ARCHIVE_R2_DATABASE,
  INHERIT_NORMALIZATION_DATABASE_CA_CERT:env.INHERIT_TEST_ACCOUNT_ARCHIVE_R2_DATABASE_CA_CERT});
 if(!value)throw unavailable();return value;
}
/** The dedicated account owner keeps live authority locks through provider EOF
 * and COMMIT. No service-role/case RPC or storage.objects identity is adopted. */
export async function withAccountArchiveR2Owner<T>(env:Environment,signal:AbortSignal,runtime:RequesterStatementRuntime,
 work:(tx:postgres.TransactionSql)=>Promise<T>):Promise<T>{
 const sql=postgres({...configuration(env),max:1,prepare:false,fetch_types:false,connect_timeout:5,idle_timeout:5,
  max_lifetime:40,connection:{application_name:"inherit-test-account-archive-r2"},onnotice:()=>{},debug:false});
 let closing:Promise<void>|undefined;
 const close=()=>closing??=runtime.cleanup("account-r2-native-close",()=>sql.end({timeout:0}));
 let abort=()=>{};
 const interrupted=new Promise<never>((_,reject)=>{abort=()=>{void close().catch(()=>{});reject(unavailable());};
  signal.addEventListener("abort",abort,{once:true});});
 const timer=setTimeout(abort,30_000);timer.unref();
 try{
  if(signal.aborted)throw unavailable();
  const value=await Promise.race([runtime.track("account-r2-native-owner",()=>sql.begin(async tx=>{
   const rows=await tx<{allowed:boolean}[]>`select current_user='postgres' and session_user='postgres' as allowed`;
   if(rows.length!==1||rows[0]?.allowed!==true)throw unavailable();
   await tx`select set_config('statement_timeout','25000',true),set_config('lock_timeout','5000',true),set_config('idle_in_transaction_session_timeout','25000',true)`;
   if(signal.aborted)throw unavailable();return work(tx);
  })),interrupted]);
  if(signal.aborted)throw unavailable();return value as T;
 }catch{throw unavailable();}
 finally{clearTimeout(timer);signal.removeEventListener("abort",abort);try{await close();}catch{throw unavailable();}}
}
function binding(raw:unknown,attempt:ArchiveAttempt,segment:ArchiveSegment,receipt:string,deadline:number):Frame{
 const frame=frameSchema.parse(raw),identity=frame.writeIdentity;
 if(identity.exportId!==attempt.exportId||identity.attemptId!==attempt.attemptId||identity.ordinal!==segment.ordinal
  ||identity.offset!==segment.offset||identity.logicalKey!==segment.objectKey||identity.byteCount!==segment.sizeBytes
  ||identity.sha256!==segment.sha256||identity.authorityReceipt!==receipt
  ||identity.locator.byteCount!==segment.sizeBytes||identity.locator.sha256!==segment.sha256
  ||frame.allocationSha256!==r2AllocationDigest(identity.locator.bucket,identity.locator.objectKey)
  ||Date.parse(frame.originalDeadline)<=Date.now()||Date.parse(frame.originalDeadline)>deadline)throw unavailable();
 return frame;
}
/** The ordinary archive core already committed its exact segment reservation.
 * This INSERT commits a separate opaque R2 allocation before any provider call.
 * Unknown reservation/CREATE/COMMIT responses refuse; there is no retry/adoption.
 * Publication remains closed in approvedAccountArchiveGeneration(). */
export function createAccountArchiveR2Writer(options:{gateway:RequesterStatementR2Gateway;authorityReceipt:string;
 deadline:number;runtime:RequesterStatementRuntime;env?:Environment}){
 const {gateway,runtime}=options,receipt=hash.parse(options.authorityReceipt),env=options.env??defaultEnvironment();
 configuration(env);if(!Number.isSafeInteger(options.deadline)||options.deadline<=Date.now())throw unavailable();
 const submitted=new Set<string>();
 return async(attempt:ArchiveAttempt,segment:ArchiveSegment,bytes:Uint8Array,signal:AbortSignal)=>{
  validateArchiveSegment(attempt,segment);
  if(signal.aborted||Date.now()>=options.deadline||bytes.byteLength!==segment.sizeBytes
   ||createHash("sha256").update(bytes).digest("hex")!==segment.sha256)throw unavailable();
  const identity=`${attempt.attemptId}:${segment.ordinal}`;if(submitted.has(identity))throw unavailable();submitted.add(identity);
  const nonce=runtime.own(randomBytes(32));let claim:string;
  try{claim=nonce.toString("hex");}finally{runtime.clear(nonce);}
  const reserved=await withAccountArchiveR2Owner(env,signal,runtime,async tx=>{
   const rows=await tx<{frame:unknown}[]>`select private.reserve_account_archive_r2_write_v1(${attempt.attemptId}::uuid,${segment.ordinal},${receipt},${claim}) as frame`;
   if(rows.length!==1)throw unavailable();return binding(rows[0]?.frame,attempt,segment,receipt,options.deadline);
  });
  return withAccountArchiveR2Owner(env,signal,runtime,async tx=>{
   const rows=await tx<{frame:unknown}[]>`select private.current_account_archive_r2_write_v1(${attempt.attemptId}::uuid,${segment.ordinal},${receipt},${claim}) as frame`;
   if(rows.length!==1)throw unavailable();const frame=binding(rows[0]?.frame,attempt,segment,receipt,options.deadline);
   if(JSON.stringify(frame)!==JSON.stringify(reserved))throw unavailable();
   await gateway.assertReady(frame,signal);
   const created=verifyRequesterStatementObject(await runtime.track("account-r2-create",()=>gateway.createPayload(frame,bytes,signal)),frame);
   const read=await readRequesterStatementWholeObject(gateway,frame,signal,runtime);
   try{
    if(read.metadata.version!==created.version||read.metadata.etag!==created.etag||signal.aborted)throw unavailable();
   }finally{runtime.clear(read.bytes);}
   await gateway.assertReady(frame,signal);if(signal.aborted)throw unavailable();
   const actual=await tx<{id:string}[]>`select private.complete_account_archive_r2_write_v1(${attempt.attemptId}::uuid,
    ${segment.ordinal},${receipt},${claim},${JSON.stringify(frame)}::jsonb,${created.version},${created.etag}) as id`;
   if(actual.length!==1||actual[0]?.id!==frame.objectId)throw unavailable();return {objectId:frame.objectId};
  });
 };
}
/** Logout/revocation cannot erase a committed reservation. Disposal selects one
 * native owned allocation, permanently excludes later writes through the same
 * gateway, verifies complete payload/empty-marker EOF and only then ACKs it.
 * Current-object fencing supplies no history/delete or READY capability. */
export async function disposeAccountArchiveR2Segment(options:{attemptId:string;ordinal:number;
 gateway:RequesterStatementR2Gateway;runtime:RequesterStatementRuntime;signal:AbortSignal;env?:Environment}){
 uuid.parse(options.attemptId);z.number().int().min(0).max(2_251_799_813).parse(options.ordinal);
 const {runtime,signal,gateway}=options,env=options.env??defaultEnvironment();
 const nonce=runtime.own(randomBytes(32));let claim:string;
 try{claim=nonce.toString("hex");}finally{runtime.clear(nonce);}
 const reservation=await withAccountArchiveR2Owner(env,signal,runtime,async tx=>{
  const rows=await tx<{frame:unknown}[]>`select private.claim_account_archive_r2_disposal_v1(${options.attemptId}::uuid,${options.ordinal},${claim}) as frame`;
  if(rows.length!==1)throw unavailable();const value=r2CurrentReservationSchema.parse(rows[0]?.frame);
  if(value.attemptId!==options.attemptId||value.ordinal!==options.ordinal)throw unavailable();return value;
 });
 // The shared fence owns identity/CAS/EOF. This adapter additionally owns the
 // actual native response cancellation and mutable chunks; an asynchronous
 // cancel cannot become a disposal ACK merely because the fence returned.
 const dispositions:Promise<void>[]=[];
 const provider={...gateway.disposalProvider,readCurrent:async(binding:Readonly<typeof reservation>,expected:Parameters<typeof gateway.disposalProvider.readCurrent>[1],current:AbortSignal)=>{
  const response=await runtime.track("account-r2-disposal-read",()=>gateway.disposalProvider.readCurrent(binding,expected,current));
  if(!(response.body instanceof ReadableStream))throw unavailable();
  const reader=response.body.getReader();let previous:Uint8Array|undefined,closing:Promise<void>|undefined;
  let resolve!:()=>void,reject!:(error:unknown)=>void;
  const disposition=new Promise<void>((yes,no)=>{resolve=yes;reject=no;});dispositions.push(disposition);void disposition.catch(()=>{});
  const clear=()=>{if(previous){runtime.clear(previous);previous=undefined;}};
  const close=()=>closing??=runtime.cleanup("account-r2-disposal-body-close",async()=>{
   try{clear();await reader.cancel();reader.releaseLock();resolve();}catch(error){reject(error);throw error;}
   finally{current.removeEventListener("abort",abort);}
  });
  const abort=()=>{void close().catch(()=>{});};current.addEventListener("abort",abort,{once:true});
  if(current.aborted)abort();
  return {descriptor:response.descriptor,body:new ReadableStream<Uint8Array>({
   async pull(controller){
    try{
     if(current.aborted)throw unavailable();clear();
     const item=await runtime.track("account-r2-disposal-body-read",()=>reader.read());
     if(item.done){await close();controller.close();return;}
     if(!(item.value instanceof Uint8Array))throw unavailable();previous=runtime.own(item.value);controller.enqueue(previous);
    }catch(error){await close();controller.error(error);}
   },cancel(){return close();}
  },{highWaterMark:0})};
 }};
 const evidence=await runtime.track("account-r2-permanent-fence",()=>fenceR2CurrentReservation({reservation,
  provider,signal,checkCurrent:(expected,current)=>withAccountArchiveR2Owner(env,current,runtime,async tx=>{
   const rows=await tx<{frame:unknown}[]>`select private.check_account_archive_r2_disposal_v1(${options.attemptId}::uuid,
    ${options.ordinal},${claim},${JSON.stringify(expected)}::jsonb) as frame`;
   if(rows.length!==1)throw unavailable();return rows[0]?.frame;
  })}));
 await runtime.wait(Promise.all(dispositions),Date.parse(reservation.claimExpiresAt));
 await withAccountArchiveR2Owner(env,signal,runtime,async tx=>{
  const rows=await tx<{acknowledged:boolean}[]>`select private.ack_account_archive_r2_disposal_v1(${options.attemptId}::uuid,
   ${options.ordinal},${claim},${JSON.stringify(reservation)}::jsonb,${JSON.stringify(evidence)}::jsonb) as acknowledged`;
  if(rows.length!==1||rows[0]?.acknowledged!==true)throw unavailable();
 });
}
