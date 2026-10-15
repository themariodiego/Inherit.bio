import "server-only";
import {createHash} from "node:crypto";
import {ACCOUNT_COMPLETE_FILE_KINDS} from "./account-complete-context";
import type {prepareAccountCompleteReader} from "./account-complete-reader";
import {prepareAccountCompleteOriginal} from "./account-complete-original";
import {streamAccountCompletePreparedRecords} from "./account-complete-prepared";
import {ACCOUNT_COMPLETE_VARIANT_COLUMNS,ACCOUNT_COMPLETE_VARIANT_HEADER,streamAccountCompleteVariantCsv} from "./account-complete-variant-csv";
import type {AccountArchiveFile,AccountArchiveSourceMember} from "./account-archive-plan";
import type {FuturePersonMemberFactory} from "./future-person-member-plan";
import type {RequesterStatementRuntime} from "./requester-statement-runtime";

type Reader=Awaited<ReturnType<typeof prepareAccountCompleteReader>>;
const encoder=new TextEncoder(),unavailable=()=>new Error("account_complete_files_unavailable");
const csv=(value:unknown)=>value===null?"":`"${String(value).replaceAll('"','""')}"`;
function* bytes(text:string){const raw=encoder.encode(text);for(let i=0;i<raw.byteLength;i+=1_048_576)yield raw.subarray(i,i+1_048_576);}

/** All separately authorized foreign raw files are produced, not delegated to
 * own-upload session readers. The exact backend receipt remains in the archive
 * manifest. Database normalization has no prepared canonical materialization;
 * that explicit zero fact never replaces actual variants, observations or raw
 * source bytes. Prepared sources verify the genuine complete artifact stream. */
export async function prepareAccountCompleteFiles(options:{reader:Reader;reference:{exportId:string;attemptId:string;authorityReceipt:string};
 signal:AbortSignal;runtime:RequesterStatementRuntime;
 readRange?:Parameters<typeof prepareAccountCompleteOriginal>[0]["readRange"];
 readArtifact?:Parameters<typeof streamAccountCompletePreparedRecords>[0]["readArtifact"]}){
 const {reader}=options,files:AccountArchiveFile[]=[],sources:AccountArchiveSourceMember[]=[],factories:FuturePersonMemberFactory[]=[];
 for(const file of reader.context.completeReceipt.files){
  const original=await prepareAccountCompleteOriginal({...options,file:{...file,
   preparedSource:file.content.backend==="prepared-object-v1"?file.content.source:null}});
  files.push({fileId:file.fileId,subjectId:file.subjectId,projection:"consent-covered-upload",rawAuthoritySha256:file.rawAuthoritySha256,
   byte_identical_to_upload:!file.originalRetired,originalRetired:file.originalRetired,sourceSha256:file.rawSha256,decodedSha256:file.decodedSha256,
   contentBackend:file.content.backend,variantColumns:file.content.backend==="database-v1"?[...ACCOUNT_COMPLETE_VARIANT_COLUMNS]:["rsid","chrom","pos","ref","alt","genotype"]});
  if(original.member)sources.push({fileId:file.fileId,subjectId:file.subjectId,member:original.member});
  if(file.content.backend==="database-v1"){
   for(const kind of ACCOUNT_COMPLETE_FILE_KINDS){
    const receipt=file.content.receipts.find(r=>r.kind===kind)!;
    factories.push({name:kind==="variants"?`variants/${file.fileId}.csv`:`${kind}/${file.fileId}.jsonl`,rows:receipt.rows,
     chunks:async function*(signal){
      await reader.check(signal);if(kind==="variants")yield encoder.encode(ACCOUNT_COMPLETE_VARIANT_HEADER);
      if(kind==="canonical")yield encoder.encode(JSON.stringify({type:"canonical-materialization-disposition",backend:"database-v1",
       fileId:file.fileId,rows:0,reason:"canonical-materialization-is-prepared-only"})+"\n");
      let n=0;for await(const record of reader.fileRecords(file.fileId,kind,signal)){
       if(++n>receipt.rows)throw unavailable();
       if(kind==="variants")yield* streamAccountCompleteVariantCsv(record.bytes(signal));
       else{yield* record.bytes(signal);yield encoder.encode("\n");}
      }
      if(n!==receipt.rows)throw unavailable();await original.check(signal);await reader.check(signal);
     }});
   }
   continue;
  }
  const source=file.content.source;
  let captured:{records:number;variants:number;observations:number;headerSha256:string}|undefined;
  async function* prepared(signal:AbortSignal){
   let records=0,variants=0,observations=0,headerSha256:string|undefined;
   for await(const item of streamAccountCompletePreparedRecords({reader,source,signal:AbortSignal.any([options.signal,signal]),
    runtime:options.runtime,readArtifact:options.readArtifact})){
    if(item.type==="header"){
     if(headerSha256!==undefined||item.header.binding.source.fileId!==file.fileId||item.header.binding.source.subjectId!==file.subjectId
      ||item.header.binding.source.sourceRevision!==file.sourceRevision||item.header.binding.source.rawSha256!==file.rawSha256
      ||item.header.binding.source.decodedSha256!==file.decodedSha256)throw unavailable();
     headerSha256=createHash("sha256").update(JSON.stringify(item.header)).digest("hex");
    }else{
     if(headerSha256===undefined)throw unavailable();records++;if(!Number.isSafeInteger(records))throw unavailable();
     if(item.record.event.type==="variant"&&item.record.normalization.status==="normalized")variants++;
     if(item.record.event.type==="observed")observations++;
    }
    yield item;
   }
   if(headerSha256===undefined)throw unavailable();const current={records,variants,observations,headerSha256};
   if(captured&&JSON.stringify(current)!==JSON.stringify(captured))throw unavailable();captured??=current;
   await original.check(signal);await reader.check(signal);
  }
  for await(const item of prepared(options.signal))void item;
  for(const kind of ACCOUNT_COMPLETE_FILE_KINDS){
   const count=kind==="canonical"?captured!.records:kind==="variants"?captured!.variants:captured!.observations;
   factories.push({name:kind==="variants"?`variants/${file.fileId}.csv`:`${kind}/${file.fileId}.jsonl`,rows:count,
    chunks:async function*(signal){
     if(kind==="variants")yield encoder.encode("rsid,chrom,pos,ref,alt,genotype\n");let emitted=0;
     for await(const item of prepared(signal)){
      if(kind==="canonical"){yield* bytes(JSON.stringify(item.type==="header"?item.header:item.record)+"\n");if(item.type==="record")emitted++;}
      else if(item.type==="record"&&kind==="observed"&&item.record.event.type==="observed"){yield* bytes(JSON.stringify(item.record)+"\n");emitted++;}
      else if(item.type==="record"&&kind==="variants"&&item.record.event.type==="variant"&&item.record.normalization.status==="normalized"){
       const value=item.record.normalization.record;yield* bytes(`${value.rsid===null?"":`rs${value.rsid}`},${value.chrom},${value.pos},${csv(value.ref)},${csv(value.alt)},${csv(value.genotype)}\n`);emitted++;
      }
     }
     if(emitted!==count)throw unavailable();
    }});
  }
 }
 await reader.check(options.signal);return {files,sources,factories,check:reader.check};
}
