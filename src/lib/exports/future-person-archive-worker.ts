import "server-only";
import { createHash } from "node:crypto";
import { z } from "zod";
import { createArchivePersistence,type ArchiveWorkerRpc } from "./archive-persistence";
import { storeArchiveSegments,type ArchiveSegmentationOptions,type ArchiveAttempt,type StoredArchive } from "./archive-segments";
import { createZip64Archive,createZip64FileSpool,type Zip64Member } from "./archive-zip64";
import { futurePersonExportSnapshot } from "./future-person-content";
import { prepareFuturePersonArchiveMembers,type FuturePersonMemberOperation } from "./future-person-member-plan";

const unavailable=()=>new Error("export unavailable");
export type ClaimantMemberRpc=(name:"future_person_export_members_v1",args:{p_operation:FuturePersonMemberOperation;p_export_id:string;p_attempt_id:string;
  p_authority_receipt:string;p_after_id:string|null},signal:AbortSignal)=>PromiseLike<{data:unknown;error:unknown}>;
const encoder=new TextEncoder();const bytes=(value:string)=>encoder.encode(value);
function stream(source:AsyncIterable<Uint8Array>,signal:AbortSignal,expected?:{sizeBytes:number;sha256:string}) {
  const iterator=source[Symbol.asyncIterator]();let length=0;const digest=createHash("sha256");let closed=false;
  return new ReadableStream<Uint8Array>({async pull(controller){
    try{
      if(closed||signal.aborted)throw unavailable();const next=await iterator.next();
      if(signal.aborted)throw unavailable();
      if(next.done){if(expected&&(length!==expected.sizeBytes||digest.digest("hex")!==expected.sha256))throw unavailable();closed=true;controller.close();return;}
      if(!(next.value instanceof Uint8Array)||next.value.byteLength>4_000_000)throw unavailable();
      length+=next.value.byteLength;if(!Number.isSafeInteger(length)||(expected&&length>expected.sizeBytes))throw unavailable();
      digest.update(next.value);controller.enqueue(next.value);
    }catch{closed=true;controller.error(unavailable());try{void iterator.return?.().catch(()=>{});}catch{/* cleanup cannot admit bytes */}}
  },cancel(){closed=true;try{void iterator.return?.().catch(()=>{});}catch{/* bounded core owns cancellation */}}},{highWaterMark:0});
}

/** Actual unpublished archive attempt: real durable attempt/reservation/page
 * RPCs, complete required member set, ZIP64 EOF, create-only provider writes.
 * Byte completion is returned only after each member's count/length/SHA and
 * the whole ZIP/source authority checks. READY/delivery remain a separate CAS.
 * Nonempty unknown report/figure classes refuse the WHOLE attempt. */
export async function buildClaimantArchive(options:{job:{exportId:string;principalHash:string;authorityReceipt:string;deadline:string};
  workerRpc:ArchiveWorkerRpc;memberRpc:ClaimantMemberRpc;
  auditMemberSchema?:Parameters<typeof prepareFuturePersonArchiveMembers>[0]["auditMemberSchema"];
  sourceMembers?:(signal:AbortSignal,snapshot:z.infer<typeof futurePersonExportSnapshot>)=>Promise<{members:Zip64Member[];provenance:unknown}>;
  write:ArchiveSegmentationOptions["write"];signal:AbortSignal}) {
  const persistence=createArchivePersistence(options.job,options.workerRpc);
  let attempt:ArchiveAttempt|null=null;const plan:Zip64Member[]=[];let payloadBytes=0;let snapshot:z.infer<typeof futurePersonExportSnapshot>;
  const spool=await createZip64FileSpool();
  const active=()=>{if(options.signal.aborted||Date.now()>=persistence.job.deadline)throw unavailable();};
  const check=async(signal:AbortSignal)=>{active();if(!attempt)throw unavailable();return persistence.checkAuthority(attempt,signal);};
  async function call(operation:FuturePersonMemberOperation,signal:AbortSignal,after:string|null=null){
    await check(signal);const bound=new AbortController();const current=AbortSignal.any([signal,bound.signal]);
    const timeout=setTimeout(()=>bound.abort(),Math.min(30_000,persistence.job.deadline-Date.now()));timeout.unref();let rejectAbort=()=>{};
    const canceled=new Promise<never>((_,reject)=>{rejectAbort=()=>reject(unavailable());current.addEventListener("abort",rejectAbort,{once:true});});
    try{
      if(current.aborted)throw unavailable();const reply=await Promise.race([Promise.resolve(options.memberRpc("future_person_export_members_v1",{
        p_operation:operation,p_export_id:options.job.exportId,p_attempt_id:attempt!.attemptId,p_authority_receipt:options.job.authorityReceipt,p_after_id:after},current)),canceled]);
      if(current.aborted||reply.error)throw unavailable();await check(signal);return reply.data;
    }catch{throw unavailable();}finally{clearTimeout(timeout);current.removeEventListener("abort",rejectAbort);bound.abort();}
  }
  async function prepare(signal:AbortSignal){
    const prepared=await prepareFuturePersonArchiveMembers({authorityReceipt:options.job.authorityReceipt,signal,active,check,call,auditMemberSchema:options.auditMemberSchema});
    snapshot=prepared.snapshot;const factories=prepared.factories;
    const subjectId=snapshot.source.subjectId,fileId=snapshot.source.fileId;
    const descriptors=[];
    for(const factory of factories){let sizeBytes=0;const digest=createHash("sha256");for await(const chunk of factory.chunks(signal)){active();sizeBytes+=chunk.byteLength;if(!Number.isSafeInteger(sizeBytes))throw unavailable();digest.update(chunk);}
      const descriptor={name:factory.name,sizeBytes,sha256:digest.digest("hex"),rows:factory.rows};descriptors.push(descriptor);
      plan.push({name:factory.name,sizeBytes,open:async current=>stream(factory.chunks(current),current,descriptor)});payloadBytes+=sizeBytes;}
    const source=options.sourceMembers?await options.sourceMembers(signal,snapshot):null;
    if(source){for(const item of source.members){if(plan.some(existing=>existing.name===item.name)||!item.name.startsWith(`originals/${fileId}/`))throw unavailable();
      const input=await item.open(signal),reader=input.getReader(),digest=createHash("sha256");let sizeBytes=0;
      try{for(;;){await check(signal);const next=await reader.read();if(next.done)break;
        if(!(next.value instanceof Uint8Array)||next.value.byteLength>4_000_000)throw unavailable();sizeBytes+=next.value.byteLength;
        if(!Number.isSafeInteger(sizeBytes)||sizeBytes>item.sizeBytes)throw unavailable();digest.update(next.value);}}
      finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
      if(sizeBytes!==item.sizeBytes)throw unavailable();const descriptor={name:item.name,sizeBytes,sha256:digest.digest("hex"),rows:0};descriptors.push(descriptor);
      plan.push({...item,open:async current=>{const content=await item.open(current);return stream((async function*(){const reader=content.getReader();
        try{for(;;){await check(current);const next=await reader.read();if(next.done)return;yield next.value;}}
        finally{await reader.cancel().catch(()=>{});reader.releaseLock();}})(),current,descriptor);}});payloadBytes+=sizeBytes;
    }}
    const manifest=bytes(JSON.stringify({schemaVersion:"subject-partitioned-archive-v1",subjectPartitions:[subjectId],
      files:[{fileId,subjectId,sourceSha256:snapshot.source.sourceSha256,membershipSha256:snapshot.source.membershipSha256,byte_identical_to_upload:false}],members:descriptors,
      ...(source?{currentSource:source.provenance}:{})})+"\n");
    plan.push({name:"manifest.json",sizeBytes:manifest.byteLength,open:async current=>stream((async function*(){await check(current);yield manifest;await check(current);})(),current)});
    payloadBytes+=manifest.byteLength;plan.sort((a,b)=>a.name<b.name?-1:a.name>b.name?1:0);
  }
  try{
    const summary:StoredArchive=await storeArchiveSegments({exportId:options.job.exportId,principalHash:options.job.principalHash,
      authorityReceipt:options.job.authorityReceipt,deadline:persistence.job.deadline,signal:options.signal,checkAuthority:persistence.checkAuthority,
      beginAttempt:async(value,signal)=>{await persistence.beginAttempt(value,signal);attempt=value;await prepare(signal);},
      reserve:persistence.reserve,acknowledge:persistence.acknowledge,appendPage:persistence.appendPage,write:options.write,
      source:signal=>{return createZip64Archive({members:(async function*(){for(const item of plan)yield item;})(),expectedMemberCount:plan.length,
        expectedPayloadBytes:payloadBytes,modifiedAt:Date.parse(snapshot.source.publishedAt),deadline:persistence.job.deadline,signal,
        authorityReceipt:options.job.authorityReceipt,checkAuthority:check,spool});}});
    await persistence.recordBytesComplete(summary,options.signal);return {summary,memberCount:plan.length,payloadBytes};
  }finally{await spool.dispose();}
}
