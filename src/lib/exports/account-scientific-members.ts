import "server-only";
import {createHash} from "node:crypto";
import type {createAccountContentReader} from "./account-content-reader";
import type {prepareAccountArchiveMetadata} from "./account-member-metadata";
import {renderOwnSubjectReport,type OwnExportSnapshot} from "./own-subject-content";
import type {FuturePersonMemberFactory} from "./future-person-member-plan";
import {canonicalRecordSchema,type CanonicalRecord} from "@/lib/genome/prepared-source/canonical-schema";
import type {OwnPreparedExportHeader} from "@/lib/genome/prepared-source/export-source";
import {callbackSource} from "./callback-source";

type Reader=Awaited<ReturnType<typeof createAccountContentReader>>;
type Metadata=Awaited<ReturnType<typeof prepareAccountArchiveMetadata>>;
type PreparedRow={type:"header";header:OwnPreparedExportHeader}|{type:"record";record:CanonicalRecord};
const unavailable=()=>new Error("account_archive_science_unavailable"),encoder=new TextEncoder();
const sha=(value:unknown)=>createHash("sha256").update(JSON.stringify(value)).digest("hex");
const chunk=(value:string)=>encoder.encode(value);
function* boundedBytes(value:string){const bytes=chunk(value);for(let i=0;i<bytes.byteLength;i+=1_048_576)yield bytes.subarray(i,i+1_048_576);}
const csv=(value:unknown)=>value===null?"":`"${String(value).replaceAll('"','""')}"`;

/** Generate complete ordinary scientific members exclusively through the
 * consumed-request content reader. Stored report/score/ancestry projections
 * keep their original source/purpose checks; no recalculation occurs. Prepared
 * canonical evidence includes every disposition and original header, not just
 * normalized variants. Counts and identities are captured from complete EOF
 * and checked again on every member read. This creates no source authority or
 * public delivery and does not accept unsupported nonempty graph classes. */
export async function prepareAccountScientificMembers(options:{reader:Reader;metadata:Metadata;
 signal:AbortSignal;check:(signal:AbortSignal)=>Promise<unknown>}){
 const reader=options.reader,files=reader.files,context=reader.context;
 const counts=new Map(options.metadata.fileCounts.map(row=>[row.fileId,row]));
 if(counts.size!==files.length||files.some(file=>counts.get(file.file.id)?.subjectId!==file.file.subject_id))throw unavailable();
 async function bounded<T>(signal:AbortSignal,operation:(current:AbortSignal)=>PromiseLike<T>){
  const remaining=Date.parse(context.deadline)-Date.now();if(signal.aborted||options.signal.aborted||remaining<=0)throw unavailable();
  const stop=new AbortController(),current=AbortSignal.any([options.signal,signal,stop.signal]);let abort=()=>{};
  const timer=setTimeout(()=>stop.abort(),Math.min(30_000,remaining));timer.unref();
  const canceled=new Promise<never>((_,reject)=>{abort=()=>reject(unavailable());current.addEventListener("abort",abort,{once:true});});
  try{if(current.aborted)throw unavailable();const value=await Promise.race([Promise.resolve().then(()=>operation(current)),canceled]);
   if(current.aborted||Date.now()>=Date.parse(context.deadline))throw unavailable();return value;
  }finally{clearTimeout(timer);current.removeEventListener("abort",abort);stop.abort();}
 }
 async function check(signal:AbortSignal){
  await bounded(signal,current=>options.check(current));await reader.check(signal);await options.metadata.check(signal);
  for(const file of files)await bounded(signal,()=>reader.own.check(file));
 }
 const outputs=new Map<string,{reports:Awaited<ReturnType<Reader["own"]["reports"]>>;
  prs:Awaited<ReturnType<Reader["own"]["prs"]>>;ancestry:Awaited<ReturnType<Reader["own"]["ancestry"]>>}>();
 async function scientific(file:OwnExportSnapshot,signal:AbortSignal){
  const value={reports:await bounded(signal,()=>reader.own.reports(file)),
   prs:await bounded(signal,()=>reader.own.prs(file)),ancestry:await bounded(signal,()=>reader.own.ancestry(file))};
  await check(signal);const before=outputs.get(file.file.id);if(before&&sha(value)!==sha(before))throw unavailable();return value;
 }
 await check(options.signal);
 for(const file of files)outputs.set(file.file.id,await scientific(file,options.signal));
 const factories:FuturePersonMemberFactory[]=[];
 function json(name:string,rows:number,records:(signal:AbortSignal)=>AsyncIterable<unknown>){
  factories.push({name,rows,chunks:async function*(signal){await check(signal);yield chunk('{"schemaVersion":"subject-partitioned-archive-v1","rows":[');
   let n=0;for await(const value of records(signal)){if(++n>rows)throw unavailable();yield* boundedBytes((n===1?"":",")+JSON.stringify(value));}
   if(n!==rows)throw unavailable();await check(signal);yield chunk("]}\n");}});
 }
 for(const subject of context.partitions.filter(part=>part.class==="ordinary")){
  const selected=files.filter(file=>file.file.subject_id===subject.subjectId),prefix=`subjects/${subject.subjectId}/`;
  for(const kind of ["reports","prs","ancestry"] as const){
   const rows=kind==="reports"?selected.length:selected.reduce((n,file)=>n+outputs.get(file.file.id)![kind].length,0);
   json(`${prefix}${kind}.json`,rows,async function*(signal){
    for(const file of selected){const value=await scientific(file,signal);if(kind==="reports")yield value.reports;else yield* value[kind];}
   });
  }
  const rows=selected.reduce((n,file)=>n+outputs.get(file.file.id)!.reports.report_count,0);
  factories.push({name:`${prefix}reports.txt`,rows,chunks:async function*(signal){
   await check(signal);yield chunk("Your stored reports\n");let n=0;
   for(const file of selected){const value=(await scientific(file,signal)).reports;
    yield* boundedBytes(`\nFile: ${value.file_id}\nSource revision: ${value.source_revision}\nSHA-256: ${value.source_sha256}\n`);
    if(!value.report_count)yield chunk("No completed reports for this file.\n");
    for(const report of value.reports){n++;yield* boundedBytes(renderOwnSubjectReport(report)+"\n\n");}
   }if(n!==rows)throw unavailable();await check(signal);
  }});
 }
 const preparedCounts=new Map<string,{headerHash:string;records:number;variants:number;observations:number}>();
 async function* prepared(file:OwnExportSnapshot,signal:AbortSignal):AsyncGenerator<PreparedRow>{
  let headerHash:string|undefined,records=0,variants=0,observations=0;
  for await(const item of callbackSource<PreparedRow>(AbortSignal.any([options.signal,signal]),async(emit,current)=>{
   const value=await reader.own.preparedRecords(file,async(page,sourceSignal,header)=>{
    if(current.aborted||sourceSignal.aborted)throw unavailable();
    if(header.type!=="prepared-export-source"||header.version!=="own-prepared-export-v1"||header.manifestId!==file.preparedSource!.manifestId
     ||header.binding.source.fileId!==file.file.id||header.binding.source.subjectId!==file.file.subject_id
     ||header.binding.source.sourceRevision!==file.file.upload_revision||header.binding.source.rawSha256!==file.file.sha256
     ||header.binding.source.decodedSha256!==file.file.source_sha256)throw unavailable();
    const digest=sha(header);if(headerHash!==undefined&&headerHash!==digest)throw unavailable();
    if(headerHash===undefined){headerHash=digest;await emit({type:"header",header});}
    for(const raw of page){if(current.aborted||sourceSignal.aborted)throw unavailable();
     const record=canonicalRecordSchema.parse(raw);records++;if(!Number.isSafeInteger(records))throw unavailable();
     if(record.event.type==="variant"&&record.normalization.status==="normalized")variants++;
     if(record.event.type==="observed")observations++;await emit({type:"record",record});
    }
   },current);
   if(!headerHash||value.recordCount!==records||value.variantCount!==variants
    ||file.file.variant_count!==null&&file.file.variant_count!==variants)throw unavailable();
  }))yield item;
  const current={headerHash:headerHash!,records,variants,observations},expected=preparedCounts.get(file.file.id);
  if(expected&&JSON.stringify(current)!==JSON.stringify(expected))throw unavailable();
  await check(signal);preparedCounts.set(file.file.id,current);
 }
 for(const file of files){
  if(file.preparedSource){for await(const item of prepared(file,options.signal))void item;
   const counts=preparedCounts.get(file.file.id)!;
   factories.push({name:`canonical/${file.file.id}.jsonl`,rows:counts.records,chunks:async function*(signal){
    for await(const item of prepared(file,signal))yield* boundedBytes(JSON.stringify(item.type==="header"?item.header:item.record)+"\n");
   }});
   factories.push({name:`variants/${file.file.id}.csv`,rows:counts.variants,chunks:async function*(signal){
    yield chunk("rsid,chrom,pos,ref,alt,genotype\n");
    for await(const item of prepared(file,signal))if(item.type==="record"&&item.record.event.type==="variant"&&item.record.normalization.status==="normalized"){
     const row=item.record.normalization.record;yield* boundedBytes(`${row.rsid===null?"":`rs${row.rsid}`},${row.chrom},${row.pos},${csv(row.ref)},${csv(row.alt)},${csv(row.genotype)}\n`);
    }
   }});
   factories.push({name:`observed/${file.file.id}.jsonl`,rows:counts.observations,chunks:async function*(signal){
    for await(const item of prepared(file,signal))if(item.type==="record"&&item.record.event.type==="observed")yield* boundedBytes(JSON.stringify(item.record)+"\n");
   }});
  }else{
   const expected=counts.get(file.file.id)!;
   for(const kind of ["variants","observed"] as const){
    const maximum=kind==="variants"?expected.variantCount:expected.observedCallCount;
    factories.push({name:kind==="variants"?`variants/${file.file.id}.csv`:`observed/${file.file.id}.jsonl`,rows:maximum,chunks:async function*(signal){
     await check(signal);if(kind==="variants")yield chunk("rsid,chrom,pos,ref,alt,genotype\n");let n=0;
     for await(const page of reader.own[kind](file))for(const row of page){if(++n>maximum)throw unavailable();
      yield* boundedBytes(kind==="variants"?`${row.rsid===null?"":`rs${row.rsid}`},${row.chrom},${row.pos},${csv(row.ref)},${csv(row.alt)},${csv(row.genotype)}\n`:JSON.stringify(row)+"\n");
     }if(n!==maximum)throw unavailable();await check(signal);
    }});
   }
  }
 }
 await check(options.signal);return {factories,check};
}
