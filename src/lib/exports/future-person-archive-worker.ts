import "server-only";
import { createHash } from "node:crypto";
import { z } from "zod";
import { createArchivePersistence,type ArchiveWorkerRpc } from "./archive-persistence";
import { storeArchiveSegments,type ArchiveSegmentationOptions,type ArchiveAttempt,type StoredArchive } from "./archive-segments";
import { createZip64Archive,createZip64FileSpool,type Zip64Member } from "./archive-zip64";
import { futurePersonExportSnapshot,projectFuturePersonAgreements,renderFuturePersonAgreement } from "./future-person-content";
import { projectFuturePersonFinding } from "./future-person-report-projection";
import { projectQc,type EmbryoQcRow } from "@/lib/embryos/projection";
import { historicalClaimantScore,historicalClaimantFigure,historicalClaimantReport,
  projectHistoricalClaimantFigure,projectHistoricalClaimantReport,projectHistoricalClaimantQc } from "./future-person-historical-members";

const unavailable=()=>new Error("export unavailable");
const variant=z.object({id:z.string().regex(/^[1-9][0-9]*$/u).refine(v=>BigInt(v)<=BigInt("9223372036854775807")),chromosome:z.number().int().min(1).max(22),position:z.number().int().positive().safe(),
  referenceAllele:z.string().nullable(),alternateAllele:z.string().nullable(),genotype:z.string()}).strict();
const score=historicalClaimantScore;
const page=z.object({rows:z.array(z.unknown()).max(500),nextAfterId:z.string().nullable(),count:z.number().int().min(0).max(500)}).strict();
type Operation="context"|"agreements"|"quality"|"scores"|"figures"|"reports"|"variants";
export type ClaimantMemberRpc=(name:"future_person_export_members_v1",args:{p_operation:Operation;p_export_id:string;p_attempt_id:string;
  p_authority_receipt:string;p_after_id:string|null},signal:AbortSignal)=>PromiseLike<{data:unknown;error:unknown}>;
type MemberFactory={name:string;rows:number;chunks:(signal:AbortSignal)=>AsyncIterable<Uint8Array>};
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
  workerRpc:ArchiveWorkerRpc;memberRpc:ClaimantMemberRpc;write:ArchiveSegmentationOptions["write"];signal:AbortSignal}) {
  const persistence=createArchivePersistence(options.job,options.workerRpc);
  let attempt:ArchiveAttempt|null=null;const plan:Zip64Member[]=[];let payloadBytes=0;let snapshot:z.infer<typeof futurePersonExportSnapshot>;
  const spool=await createZip64FileSpool();
  const active=()=>{if(options.signal.aborted||Date.now()>=persistence.job.deadline)throw unavailable();};
  const check=async(signal:AbortSignal)=>{active();if(!attempt)throw unavailable();return persistence.checkAuthority(attempt,signal);};
  async function call(operation:Operation,signal:AbortSignal,after:string|null=null){
    await check(signal);const bound=new AbortController();const current=AbortSignal.any([signal,bound.signal]);
    const timeout=setTimeout(()=>bound.abort(),Math.min(30_000,persistence.job.deadline-Date.now()));timeout.unref();let rejectAbort=()=>{};
    const canceled=new Promise<never>((_,reject)=>{rejectAbort=()=>reject(unavailable());current.addEventListener("abort",rejectAbort,{once:true});});
    try{
      if(current.aborted)throw unavailable();const reply=await Promise.race([Promise.resolve(options.memberRpc("future_person_export_members_v1",{
        p_operation:operation,p_export_id:options.job.exportId,p_attempt_id:attempt!.attemptId,p_authority_receipt:options.job.authorityReceipt,p_after_id:after},current)),canceled]);
      if(current.aborted||reply.error)throw unavailable();await check(signal);return reply.data;
    }catch{throw unavailable();}finally{clearTimeout(timeout);current.removeEventListener("abort",rejectAbort);bound.abort();}
  }
  async function* records<T>(operation:"scores"|"figures"|"reports"|"variants",schema:z.ZodType<T>,expectedRows:number,signal:AbortSignal){
    let after:string|null=null,total=0;
    for(;;){const parsed=page.safeParse(await call(operation,signal,after));if(!parsed.success)throw unavailable();const data=parsed.data;
      if(data.count!==data.rows.length||data.nextAfterId!==((data.rows.at(-1) as {id:string}|undefined)?.id??null))throw unavailable();
      if(!data.count){if(total!==expectedRows)throw unavailable();return;}
      for(const raw of data.rows){const row=schema.safeParse(raw);if(!row.success)throw unavailable();const identity=(raw as {id:string}).id;
        if(after!==null&&(operation==="variants"?BigInt(identity)<=BigInt(after):identity<=after))throw unavailable();after=identity;
        total++;if(total>expectedRows)throw unavailable();yield row.data;}
    }
  }
  async function prepare(signal:AbortSignal){
    const parsed=futurePersonExportSnapshot.safeParse(await call("context",signal));if(!parsed.success||parsed.data.authority.authorityReceipt!==options.job.authorityReceipt)throw unavailable();
    snapshot=parsed.data;
    const agreements=projectFuturePersonAgreements(await call("agreements",signal));if(agreements.length!==snapshot.membership.agreements)throw unavailable();
    const qcRows=await call("quality",signal);if(!Array.isArray(qcRows)||qcRows.length!==snapshot.membership.qualityReports)throw unavailable();
    const qc=qcRows.map(row=>{
      const complete=projectQc({...row,embryo_id:snapshot.source.subjectId} as EmbryoQcRow);
      return projectHistoricalClaimantQc(complete);
    });
    const subjectId=snapshot.source.subjectId,fileId=snapshot.source.fileId,prefix=`subjects/${subjectId}/`;
    const factories:MemberFactory[]=[];
    const fixed=(name:string,value:unknown,rows=0)=>{const content=bytes(typeof value==="string"?value:JSON.stringify(value)+"\n");factories.push({name,rows,chunks:async function*(current){await check(current);yield content;await check(current);}});};
    const empty={schemaVersion:"subject-partitioned-archive-v1",rows:[]};
    fixed("subjects.json",{schemaVersion:"subject-partitioned-archive-v1",rows:[{subjectId,path:prefix}]},1);
    for(const kind of ["consents","attestations","audit-log","legacy-consents","portrait","embryos"]){
      fixed(`${kind}.json`,{schemaVersion:"subject-partitioned-archive-v1",rows:[{subjectId,path:`${prefix}${kind}.json`}]},1);
      const ownRows=kind==="consents"?agreements.length:kind==="attestations"?agreements.flatMap(row=>row.attestations).length:kind==="embryos"?1:0;
      fixed(`${prefix}${kind}.json`,kind==="consents"?{schemaVersion:"subject-partitioned-archive-v1",rows:agreements}:kind==="attestations"?
        {schemaVersion:"subject-partitioned-archive-v1",rows:agreements.flatMap(row=>row.attestations)}:kind==="embryos"?
        {schemaVersion:"subject-partitioned-archive-v1",rows:[{source:snapshot.source}]}:empty,ownRows);
    }
    fixed("legal-audit.json",{schemaVersion:"legal-audit-export-v1",events:[],attribution:"No historical event is assigned without recorded proof of who acted."});
    fixed(`${prefix}subject.json`,{schemaVersion:"subject-partitioned-archive-v1",subjectId,subjectClass:"embryo",source:snapshot.source},1);
    for(const kind of ["prs","ancestry","chats"])fixed(`${prefix}${kind}.json`,empty);
    const reportRows=snapshot.membership.scores+qc.length+snapshot.membership.figures+snapshot.membership.reports;
    factories.push({name:`${prefix}reports.json`,rows:reportRows,chunks:async function*(current){
      yield bytes('{"schemaVersion":"future-person-historical-report-v1","rows":[');let comma=false;
      for(const quality of qc){yield bytes((comma?",":"")+JSON.stringify({kind:"quality",quality}));comma=true;}
      for await(const row of records("scores",score,snapshot.membership.scores,current)){
        const projected=projectFuturePersonFinding({embryo_label:"Your claimed record",condition_id:row.condition_id,condition_name:row.condition_name,
          finding:row.finding,evidence_label:row.evidence_label,coverage_state:row.coverage_state,citation_ids:row.citation_ids,not_covered_reason:row.not_covered_reason});
        yield bytes((comma?",":"")+JSON.stringify({kind:"finding",id:row.id,revision:row.computation_revision,computedAt:row.computed_at,modelId:row.model_id,modelVersion:row.model_version,sourceBindingFingerprint:row.source_binding_fingerprint,...projected}));comma=true;
      }
      for await(const row of records("figures",historicalClaimantFigure,snapshot.membership.figures,current)){
        yield bytes((comma?",":"")+JSON.stringify({kind:"historical-figure",...projectHistoricalClaimantFigure(row)}));comma=true;
      }
      for await(const row of records("reports",historicalClaimantReport,snapshot.membership.reports,current)){
        yield bytes((comma?",":"")+JSON.stringify({kind:"historical-report",...projectHistoricalClaimantReport(row)}));comma=true;
      }yield bytes("]}\n");}});
    factories.push({name:`${prefix}reports.txt`,rows:reportRows,chunks:async function*(current){
      yield bytes("Your claimed record\nQuality reports\n"+JSON.stringify(qc)+"\n\n");
      for await(const row of records("scores",score,snapshot.membership.scores,current)){
        const projected=projectFuturePersonFinding({embryo_label:"Your claimed record",condition_id:row.condition_id,condition_name:row.condition_name,
          finding:row.finding,evidence_label:row.evidence_label,coverage_state:row.coverage_state,citation_ids:row.citation_ids,not_covered_reason:row.not_covered_reason});
        yield bytes(`${row.condition_name}\nRecorded at: ${row.computed_at}\n${JSON.stringify(projected)}\n\n`);
      }
      for await(const row of records("figures",historicalClaimantFigure,snapshot.membership.figures,current))
        yield bytes(`Historical figure\n${JSON.stringify(projectHistoricalClaimantFigure(row))}\n\n`);
      for await(const row of records("reports",historicalClaimantReport,snapshot.membership.reports,current))
        yield bytes(`Historical report\n${JSON.stringify(projectHistoricalClaimantReport(row))}\n\n`);
      yield bytes(agreements.map(renderFuturePersonAgreement).join("\n\n"));}});
    const csv=(value:string|null)=>value===null?"":`"${value.replaceAll('"','""')}"`;
    factories.push({name:`variants/${fileId}.csv`,rows:snapshot.membership.variants,chunks:async function*(current){
      yield bytes("chromosome,position,reference_allele,alternate_allele,genotype\n");
      for await(const row of records("variants",variant,snapshot.membership.variants,current))yield bytes(`${row.chromosome},${row.position},${csv(row.referenceAllele)},${csv(row.alternateAllele)},${csv(row.genotype)}\n`);}});
    factories.push({name:`originals/${fileId}/embryo-autosomal-source.jsonl`,rows:snapshot.membership.variants,chunks:async function*(current){
      yield bytes(JSON.stringify({schemaVersion:"sanitized-embryo-calls-v1",source:snapshot.source})+"\n");
      for await(const row of records("variants",variant,snapshot.membership.variants,current))yield bytes(JSON.stringify(row)+"\n");}});
    const descriptors=[];
    for(const factory of factories){let sizeBytes=0;const digest=createHash("sha256");for await(const chunk of factory.chunks(signal)){active();sizeBytes+=chunk.byteLength;if(!Number.isSafeInteger(sizeBytes))throw unavailable();digest.update(chunk);}
      const descriptor={name:factory.name,sizeBytes,sha256:digest.digest("hex"),rows:factory.rows};descriptors.push(descriptor);
      plan.push({name:factory.name,sizeBytes,open:async current=>stream(factory.chunks(current),current,descriptor)});payloadBytes+=sizeBytes;}
    const manifest=bytes(JSON.stringify({schemaVersion:"subject-partitioned-archive-v1",subjectPartitions:[subjectId],
      files:[{fileId,subjectId,sourceSha256:snapshot.source.sourceSha256,membershipSha256:snapshot.source.membershipSha256}],members:descriptors})+"\n");
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
