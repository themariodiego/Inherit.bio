import "server-only";
import {createHash} from "node:crypto";
import {Readable} from "node:stream";
import {createGunzip} from "node:zlib";
import {z} from "zod";
import {preparedOriginalDownloadSourceSchema,streamVerifiedOriginalRanges,type OriginalRangeOptions} from "@/lib/uploads/prepared-original-download";
import {originalFileExtension} from "@/lib/uploads/original-download-name";
import {accountArchiveContextSchema} from "./bound-account-archive-worker";
import {ownExportSnapshotSchema} from "./own-subject-content";
import type {Zip64Member} from "./archive-zip64";
const uuid=z.uuid(),hash=z.string().regex(/^[a-f0-9]{64}$/u),date=z.iso.datetime({offset:true});
const legacySource=z.object({version:z.literal("account-original-download-v1"),fileId:uuid,
 sourceRevision:z.number().int().positive().safe(),rawSha256:hash,bucket:z.literal("genomes"),objectId:uuid,objectKey:uuid,
 storageVersion:z.uuid({version:"v4"}),sizeBytes:z.number().int().positive().safe(),expiresAt:date}).strict();
const byteSource=z.discriminatedUnion("version",[legacySource,preparedOriginalDownloadSourceSchema]);
const receiptSchema=z.object({version:z.literal("account-archive-original-v1"),exportId:uuid,attemptId:uuid,
 authorityReceipt:hash,fileId:uuid,decodedSha256:hash,state:z.object({version:z.literal("own-original-download-state-v1"),
 fileId:uuid,prepared:z.boolean(),retired:z.boolean(),expiresAt:date.nullable()}).strict(),source:byteSource.nullable(),
 actor:z.object({accountId:uuid,sessionId:uuid}).strict()}).strict();
type Source=z.infer<typeof byteSource>;
export type AccountOriginalRpc=(name:"export_archive_account_original_v1",args:{p_operation:"descriptor"|"check";
 p_export_id:string;p_attempt_id:string;p_authority_receipt:string;p_file_id:string;p_expected:unknown},signal:AbortSignal)
 =>PromiseLike<{data:unknown;error:unknown}>;
const unavailable=()=>new Error("account_archive_original_unavailable");

/** One actual ordinary source, never whole-account completion. The SQL door
 * selects actor/attempt/source from the real consumed request. Complete raw EOF
 * and decoded identity are proved before a member descriptor returns; member
 * open re-reads its exact version through the same bounded current transport.
 * No human JWT, provider locator or invented prepared manifest enters ZIP. */
export async function prepareAccountOriginalSource(options:{reference:{exportId:string;attemptId:string;authorityReceipt:string};
 context:z.infer<typeof accountArchiveContextSchema>;snapshot:z.infer<typeof ownExportSnapshotSchema>;rpc:AccountOriginalRpc;
 signal:AbortSignal;preparationSignal?:AbortSignal;check:(signal:AbortSignal)=>Promise<unknown>;
 readRange?:OriginalRangeOptions<Source>["readRange"]}){
 const context=accountArchiveContextSchema.parse(options.context),snapshot=ownExportSnapshotSchema.parse(options.snapshot),ref=z.object({exportId:uuid,attemptId:uuid,authorityReceipt:hash}).strict().parse(options.reference);
 const partition=context.partitions.find(row=>row.class==="ordinary"&&row.subjectId===snapshot.file.subject_id);
 if(context.targetKind!=="account"||context.targetId!==context.actor.accountId||context.authorityReceipt!==ref.authorityReceipt
  ||!partition?.fileIds.includes(snapshot.file.id)||snapshot.binding.accountId!==context.actor.accountId
  ||snapshot.binding.sessionId!==context.actor.sessionId)throw unavailable();
 const held:{receipt?:z.infer<typeof receiptSchema>}={};
 const active=(signal:AbortSignal)=>{if(options.signal.aborted||signal.aborted||Date.now()>=Date.parse(context.deadline)
  ||(held.receipt?.source&&Date.now()>=Date.parse(held.receipt.source.expiresAt)))throw unavailable();};
 async function call(operation:"descriptor"|"check",signal:AbortSignal){
  active(signal);await options.check(signal);const stop=new AbortController(),combined=AbortSignal.any([options.signal,signal,stop.signal]);
  const end=Math.min(Date.now()+30_000,Date.parse(context.deadline),held.receipt?.source?Date.parse(held.receipt.source.expiresAt):Infinity);
  const timer=setTimeout(()=>stop.abort(),Math.max(0,end-Date.now()));timer.unref();let abort=()=>{};
  const stopped=new Promise<never>((_,reject)=>{abort=()=>reject(unavailable());combined.addEventListener("abort",abort,{once:true});});
  try{if(combined.aborted)throw unavailable();const reply=await Promise.race([Promise.resolve(options.rpc("export_archive_account_original_v1",{
   p_operation:operation,p_export_id:ref.exportId,p_attempt_id:ref.attemptId,p_authority_receipt:ref.authorityReceipt,
   p_file_id:snapshot.file.id,p_expected:operation==="check"?held.receipt:null},combined)),stopped]);
   active(combined);if(reply.error!==null)throw unavailable();const current=receiptSchema.parse(reply.data);
   if(current.exportId!==ref.exportId||current.attemptId!==ref.attemptId||current.authorityReceipt!==ref.authorityReceipt
    ||current.actor.accountId!==context.actor.accountId||current.actor.sessionId!==context.actor.sessionId
    ||current.fileId!==snapshot.file.id||current.state.fileId!==snapshot.file.id||current.decodedSha256!==snapshot.file.source_sha256
    ||current.state.prepared!==Boolean(snapshot.preparedSource)||(current.state.retired!==(current.source===null))
    ||(held.receipt&&JSON.stringify(current)!==JSON.stringify(held.receipt)))throw unavailable();
   const source=current.source;
   if(source&&(source.fileId!==snapshot.file.id||source.sourceRevision!==snapshot.file.upload_revision
    ||source.rawSha256!==snapshot.file.sha256||source.objectId!==snapshot.file.storage_object_id
    ||source.objectKey!==snapshot.file.bucket_path||source.sizeBytes!==snapshot.file.size_bytes
    ||Date.parse(source.expiresAt)>Date.parse(context.deadline)||Date.parse(source.expiresAt)<=Date.now()
    ||((source.version==="prepared-original-download-v1")!==current.state.prepared)
    ||(source.version==="prepared-original-download-v1"&&source.manifestId!==snapshot.preparedSource?.manifestId)))throw unavailable();
   if(current.state.retired&&!current.state.prepared)throw unavailable();await options.check(combined);active(combined);return current;
  }finally{clearTimeout(timer);combined.removeEventListener("abort",abort);stop.abort();}
 }
 const preparation=options.preparationSignal??options.signal;held.receipt=await call("descriptor",preparation);const receipt=held.receipt;
 const check=async(signal:AbortSignal)=>{await call("check",signal);};
 if(receipt.state.retired){await check(preparation);return {member:null,check,provenance:{fileId:snapshot.file.id,
  subjectId:snapshot.file.subject_id,originalRetired:true,byteIdenticalToUpload:false,
  warning:"The original retention period has ended. Prepared records and saved reports remain included."}};}
 const source=receipt.source!;
 const chunks=(signal:AbortSignal)=>streamVerifiedOriginalRanges({source,signal:AbortSignal.any([options.signal,signal]),
  check:async(_expected,current)=>check(current),readRange:options.readRange},byteSource);
 // The raw transport verifies every actual range and raw EOF. Decode once
 // without materializing the file, retaining the original decoded-source proof.
 const verifyStop=new AbortController(),verifySignal=AbortSignal.any([options.signal,preparation,verifyStop.signal]);
 const iterator=chunks(verifySignal),digest=createHash("sha256");let input:Readable|undefined,decoded:Readable|undefined;
 try{const first=await iterator.next();active(verifySignal);if(first.done||!first.value.length)throw unavailable();
  input=Readable.from((async function*(){yield first.value;yield* iterator;})(),{objectMode:false,highWaterMark:1});
  decoded=first.value[0]===0x1f&&first.value[1]===0x8b?input.pipe(createGunzip()):input;
  for await(const value of decoded){active(verifySignal);digest.update(value);}
  if(digest.digest("hex")!==receipt.decodedSha256)throw unavailable();await check(verifySignal);
 }catch{throw unavailable();}finally{verifyStop.abort();decoded?.destroy();input?.destroy();await iterator.return(undefined).catch(()=>{});}
 const name=`originals/${snapshot.file.id}/original${originalFileExtension(snapshot.file)}`;
 const member:Zip64Member={name,sizeBytes:source.sizeBytes,open:async signal=>{
  await check(signal);const stop=new AbortController(),current=AbortSignal.any([signal,stop.signal]),iterator=chunks(current);let closed=false;
  return new ReadableStream<Uint8Array>({async pull(controller){try{
   if(closed)throw unavailable();active(current);const next=await iterator.next();active(current);
   if(next.done){closed=true;stop.abort();controller.close();return;}controller.enqueue(next.value);
  }catch{closed=true;stop.abort();controller.error(unavailable());void iterator.return(undefined).catch(()=>{});}},
  async cancel(){closed=true;stop.abort();await iterator.return(undefined).catch(()=>{});}},{highWaterMark:0});
 }};
 return {member,check,provenance:{fileId:snapshot.file.id,subjectId:snapshot.file.subject_id,originalRetired:false,
  byteIdenticalToUpload:true,rawSha256:source.rawSha256,decodedSha256:receipt.decodedSha256,sizeBytes:source.sizeBytes}};
}
