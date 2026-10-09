import "server-only";
import {createHash} from "node:crypto";
import {z} from "zod";
import {withAccountArchiveR2Owner} from "./account-archive-r2";
import {readRequesterStatementWholeObject} from "./requester-statement-r2-read";
import type {RequesterStatementR2Gateway} from "./requester-statement-r2";
import type {RequesterStatementRuntime} from "./requester-statement-runtime";
import type {buildAccountArchive} from "./account-archive-worker";
import type {AccountArchiveJob} from "./account-archive-generation";
import {r2CurrentReservationSchema,r2AllocationDigest} from "./archive-r2-current-fence";
import {ARCHIVE_METADATA_PAGE_SEGMENTS,ARCHIVE_SEGMENT_BYTES,validateArchiveSegment,type StoredArchiveSegment} from "./archive-segments";

const uuid=z.uuid(),hash=z.string().regex(/^[a-f0-9]{64}$/u),count=z.number().int().nonnegative().safe();
const providerId=z.string().regex(/^[A-Za-z0-9._-]{1,256}$/u);
const frameSchema=z.object({objectId:uuid,writeIdentity:r2CurrentReservationSchema.shape.writeIdentity,
 writeBindingSha256:hash,allocationSha256:hash,configurationSha256:hash,originalDeadline:z.iso.datetime({offset:true})}).strict();
const segmentSchema=z.object({ordinal:count,offset:count,sizeBytes:count.min(1).max(ARCHIVE_SEGMENT_BYTES),
 sha256:hash,objectKey:z.string(),objectId:uuid}).strict();
const entrySchema=z.object({segment:segmentSchema,frame:frameSchema,providerVersion:providerId,providerEtag:providerId}).strict();
const pageSchema=z.object({page:count,sizeBytes:count.positive(),segmentCount:count.positive(),pageCount:count.positive(),
 sha256:hash,manifestSha256:hash,segments:z.array(entrySchema).min(1).max(ARCHIVE_METADATA_PAGE_SEGMENTS)}).strict();
const objectSchema=z.object({frame:frameSchema,providerVersion:providerId,providerEtag:providerId}).strict();
export const accountArchiveProducerCompletion=z.object({version:z.literal("complete-account-zip64-producer-v1"),
 memberCount:count.positive(),payloadBytes:count.positive(),memberSha256:hash,manifestMemberSha256:hash}).strict();
const readySchema=z.object({status:z.literal("ready"),exportId:uuid,attemptId:uuid,sizeBytes:count.positive(),sha256:hash,
 manifestSha256:hash,expiresAt:z.iso.datetime({offset:true}),authorityReceipt:hash,principalHash:hash,segmentCount:count.positive(),pageCount:count.positive(),
 memberCount:count.positive(),payloadBytes:count.positive(),memberSha256:hash,manifestMemberSha256:hash}).strict();
export type TestAccountArchiveReady=z.infer<typeof readySchema>;
type Environment=Readonly<Record<string,string|undefined>>;
const unavailable=()=>new Error("test_account_archive_publication_unavailable");
type Result=Awaited<ReturnType<typeof buildAccountArchive>>;
type Entry=z.infer<typeof entrySchema>;
function same(a:unknown,b:unknown){if(JSON.stringify(a)!==JSON.stringify(b))throw unavailable();}
function validate(entry:Entry,summary:Result["summary"]){
 const {segment,frame}=entry,identity=frame.writeIdentity;
 validateArchiveSegment(summary.attempt,segment,true);
 if(frame.objectId!==segment.objectId||identity.exportId!==summary.attempt.exportId
  ||identity.attemptId!==summary.attempt.attemptId||identity.ordinal!==segment.ordinal||identity.offset!==segment.offset
  ||identity.logicalKey!==segment.objectKey||identity.byteCount!==segment.sizeBytes||identity.sha256!==segment.sha256
  ||identity.authorityReceipt!==summary.authorityReceipt||identity.locator.byteCount!==segment.sizeBytes
  ||identity.locator.sha256!==segment.sha256||frame.allocationSha256!==r2AllocationDigest(identity.locator.bucket,identity.locator.objectKey)
  ||Date.parse(frame.originalDeadline)<=Date.now())throw unavailable();
}
function tuple(segment:StoredArchiveSegment){return JSON.stringify([segment.ordinal,segment.offset,segment.sizeBytes,
 segment.sha256,segment.objectKey,segment.objectId])+"\n";}

/** No native READY is submitted until the actual complete producer succeeded
 * and a new same-version EOF/hash pass proves every native manifest segment.
 * Native source authority remains locked during each physical read, is checked
 * again before COMMIT, and is recaptured inside the final atomic READY door.
 * Unknown writes/COMMITs are never retried. Production generation stays closed. */
export async function completeTestAccountArchive(options:{job:AccountArchiveJob;result:Result;
 gateway:RequesterStatementR2Gateway;runtime:RequesterStatementRuntime;signal:AbortSignal;env:Environment}){
 const {job,result,gateway,runtime,signal,env}=options,summary=result.summary;
 const producer=accountArchiveProducerCompletion.parse(result.completionProof);
 if(signal.aborted||summary.state!=="bytes-complete"||summary.attempt.exportId!==job.exportId
  ||summary.attempt.principalHash!==job.principalHash||summary.authorityReceipt!==job.authorityReceipt
  ||producer.memberCount!==result.memberCount||producer.payloadBytes!==result.payloadBytes
  ||summary.segmentCount!==Math.ceil(summary.sizeBytes/ARCHIVE_SEGMENT_BYTES)
  ||summary.pageCount!==Math.ceil(summary.segmentCount/ARCHIVE_METADATA_PAGE_SEGMENTS))throw unavailable();
 const archive=createHash("sha256"),manifest=createHash("sha256");let bytes=0,ordinal=0;
 for(let number=0;number<summary.pageCount;number++){
  const page=await withAccountArchiveR2Owner(env,signal,runtime,async tx=>{
   const rows=await tx<{page:unknown}[]>`select private.account_archive_test_manifest_page_v1(${summary.attempt.attemptId}::uuid,${job.authorityReceipt},${number}) as page`;
   if(rows.length!==1)throw unavailable();return pageSchema.parse(rows[0]?.page);
  });
  if(page.page!==number||page.sizeBytes!==summary.sizeBytes||page.segmentCount!==summary.segmentCount
   ||page.pageCount!==summary.pageCount||page.sha256!==summary.sha256||page.manifestSha256!==summary.manifestSha256
   ||page.segments.length!==Math.min(128,summary.segmentCount-number*128))throw unavailable();
  for(const entry of page.segments){
   validate(entry,summary);if(entry.segment.ordinal!==ordinal++)throw unavailable();
   await withAccountArchiveR2Owner(env,signal,runtime,async tx=>{
    const current=async()=>{
     const rows=await tx<{entry:unknown}[]>`select private.current_account_archive_test_object_v1(${summary.attempt.attemptId}::uuid,
      ${entry.segment.ordinal},${job.authorityReceipt}) as entry`;
     if(rows.length!==1)throw unavailable();return objectSchema.parse(rows[0]?.entry);
    };
    same(await current(),{frame:entry.frame,providerVersion:entry.providerVersion,providerEtag:entry.providerEtag});
    const read=await readRequesterStatementWholeObject(gateway,entry.frame,signal,runtime);
    try{
     if(read.metadata.version!==entry.providerVersion||read.metadata.etag!==entry.providerEtag)throw unavailable();
     archive.update(read.bytes);bytes+=read.bytes.byteLength;manifest.update(tuple(entry.segment));
     same(await current(),{frame:entry.frame,providerVersion:entry.providerVersion,providerEtag:entry.providerEtag});
    }finally{runtime.clear(read.bytes);}
   });
  }
 }
 if(ordinal!==summary.segmentCount||bytes!==summary.sizeBytes||archive.digest("hex")!==summary.sha256
  ||manifest.digest("hex")!==summary.manifestSha256||signal.aborted)throw unavailable();
 return withAccountArchiveR2Owner(env,signal,runtime,async tx=>{
  const rows=await tx<{ready:unknown}[]>`select private.complete_test_account_archive_v1(${summary.attempt.attemptId}::uuid,
   ${job.authorityReceipt},${JSON.stringify(producer)}::jsonb) as ready`;
  if(rows.length!==1)throw unavailable();const value=readySchema.parse(rows[0]?.ready);
  if(value.exportId!==job.exportId||value.attemptId!==summary.attempt.attemptId||value.sizeBytes!==summary.sizeBytes
   ||value.sha256!==summary.sha256||value.manifestSha256!==summary.manifestSha256
   ||value.authorityReceipt!==job.authorityReceipt||value.principalHash!==job.principalHash||value.segmentCount!==summary.segmentCount||value.pageCount!==summary.pageCount
   ||value.memberCount!==producer.memberCount||value.payloadBytes!==producer.payloadBytes||value.memberSha256!==producer.memberSha256
   ||value.manifestMemberSha256!==producer.manifestMemberSha256
   ||Date.parse(value.expiresAt)<=Date.now()||Date.parse(value.expiresAt)>Date.parse(job.deadline))throw unavailable();return value;
 });
}

/** Private TEST download, backed by the existing consumed open-ready grant.
 * Complete native page/descriptor hashing precedes the selected physical read.
 * No range/URL/foreign actor/parallel sequence or status-only READY is accepted.
 * The caller owns the returned buffer lease and must release it after the actual
 * consumer finishes; this is not a production HTTP lifetime/disposal claim. */
export async function readTestAccountArchiveChunk(options:{ready:TestAccountArchiveReady;ordinal:number;
 downloadHash:string;origin:{kind:"account";accountId:string;sessionId:string};gateway:RequesterStatementR2Gateway;
 runtime:RequesterStatementRuntime;signal:AbortSignal;env:Environment}){
 const ready=readySchema.parse(options.ready),origin=z.object({kind:z.literal("account"),accountId:uuid,sessionId:uuid}).strict().parse(options.origin);
 const {gateway,runtime,signal,env}=options,downloadHash=hash.parse(options.downloadHash),ordinal=count.parse(options.ordinal);
 if(signal.aborted||ordinal>=ready.segmentCount||Date.parse(ready.expiresAt)<=Date.now()
  ||ready.segmentCount!==Math.ceil(ready.sizeBytes/ARCHIVE_SEGMENT_BYTES)
  ||ready.pageCount!==Math.ceil(ready.segmentCount/ARCHIVE_METADATA_PAGE_SEGMENTS))throw unavailable();
 const attempt={version:"archive-segments-v1" as const,exportId:ready.exportId,principalHash:ready.principalHash,attemptId:ready.attemptId,bucket:"exports" as const};
 const summary={state:"bytes-complete" as const,attempt,authorityReceipt:ready.authorityReceipt,sizeBytes:ready.sizeBytes,sha256:ready.sha256,
  segmentCount:ready.segmentCount,pageCount:ready.pageCount,manifestSha256:ready.manifestSha256};
 const manifest=createHash("sha256");let nextOrdinal=0,size=0,selected:Entry|undefined;
 for(let number=0;number<ready.pageCount;number++){
  const page=await withAccountArchiveR2Owner(env,signal,runtime,async tx=>{
   // Receipt is read from the native completion returned by the trusted caller,
   // never adopted from arbitrary provider descriptors.
   const rows=await tx<{page:unknown}[]>`select private.account_archive_test_manifest_page_v1(${attempt.attemptId}::uuid,
    ${ready.authorityReceipt},${number},${downloadHash},${JSON.stringify(origin)}::jsonb) as page`;
   if(rows.length!==1)throw unavailable();return pageSchema.parse(rows[0]?.page);
  });
  if(page.page!==number||page.sizeBytes!==ready.sizeBytes||page.segmentCount!==ready.segmentCount
   ||page.pageCount!==ready.pageCount||page.sha256!==ready.sha256||page.manifestSha256!==ready.manifestSha256
   ||page.segments.length!==Math.min(128,ready.segmentCount-number*128))throw unavailable();
  for(const entry of page.segments){
   validate(entry,summary);
   if(entry.segment.ordinal!==nextOrdinal++||entry.segment.ordinal<ready.segmentCount-1&&entry.segment.sizeBytes!==ARCHIVE_SEGMENT_BYTES)throw unavailable();
   size+=entry.segment.sizeBytes;manifest.update(tuple(entry.segment));if(entry.segment.ordinal===ordinal)selected=entry;
  }
 }
 if(!selected||nextOrdinal!==ready.segmentCount||size!==ready.sizeBytes||manifest.digest("hex")!==ready.manifestSha256||signal.aborted)throw unavailable();
 const entry=selected;let bytes:Uint8Array|undefined;
 try{
  await withAccountArchiveR2Owner(env,signal,runtime,async tx=>{
   const current=async()=>{
    const rows=await tx<{entry:unknown}[]>`select private.current_account_archive_test_object_v1(${attempt.attemptId}::uuid,
     ${ordinal},${ready.authorityReceipt},${downloadHash},${JSON.stringify(origin)}::jsonb) as entry`;
    if(rows.length!==1)throw unavailable();return objectSchema.parse(rows[0]?.entry);
   };
   same(await current(),{frame:entry.frame,providerVersion:entry.providerVersion,providerEtag:entry.providerEtag});
   const actual=await readRequesterStatementWholeObject(gateway,entry.frame,signal,runtime);bytes=actual.bytes;
   if(actual.metadata.version!==entry.providerVersion||actual.metadata.etag!==entry.providerEtag)throw unavailable();
   same(await current(),{frame:entry.frame,providerVersion:entry.providerVersion,providerEtag:entry.providerEtag});
   const rows=await tx<{acknowledged:boolean}[]>`select private.ack_test_account_archive_download_v1(${attempt.attemptId}::uuid,
    ${ordinal},${ready.authorityReceipt},${downloadHash},${JSON.stringify(origin)}::jsonb) as acknowledged`;
   if(rows.length!==1||rows[0]?.acknowledged!==true||signal.aborted)throw unavailable();
  });
  if(!bytes||signal.aborted)throw unavailable();const owned=bytes;let settlement:Promise<void>|undefined;
  const release=()=>settlement??=(async()=>{
   signal.removeEventListener("abort",aborted);runtime.clear(owned);
   await runtime.settle(Date.parse(ready.expiresAt));runtime.assertSettled();
  })();
  const aborted=()=>{void release().catch(()=>{});};signal.addEventListener("abort",aborted,{once:true});
  if(signal.aborted){await release();throw unavailable();}
  return Object.freeze({bytes:owned,release});
 }catch{if(bytes)runtime.clear(bytes);throw unavailable();}
}
