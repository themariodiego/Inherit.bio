import "server-only";
import {z} from "zod";
import {publishedPreparedSourceSchema,publishedPreparedMemberSchema,publishedPreparedRootSchema} from "@/lib/genome/prepared-source/published-source-reader";
import {assertPreparedMetadataBounds,validateCanonicalMaterializationReceipt} from "@/lib/genome/prepared-source/canonical-manifest";
import {validateCanonicalRsidMaterialization} from "@/lib/genome/prepared-source/verify-rsid-materialization";
import {preparedArtifactObjectIdentity,type PreparedStoredArtifact} from "@/lib/genome/prepared-source/artifact-identity";
import {createPreparedArtifactFetch} from "@/lib/genome/prepared-source/storage-artifact-fetch";
import {readVerifiedPreparedArtifact} from "@/lib/genome/prepared-source/verified-artifact-reader";
import {streamPreparedExportRecords} from "@/lib/genome/prepared-source/export-reader";
import type {prepareAccountCompleteReader} from "./account-complete-reader";
import type {RequesterStatementRuntime} from "./requester-statement-runtime";

type Reader=Awaited<ReturnType<typeof prepareAccountCompleteReader>>;
type PreparedReader=Pick<Reader,"check"|"preparedMember">&{context:Pick<Reader["context"],"deadline">};
type Source=z.infer<typeof publishedPreparedSourceSchema>;
const unavailable=()=>new Error("account_complete_prepared_unavailable");
const equal=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);

/** Reuse the published preparation's exact integrity contract. Every artifact
 * is authorized through the complete requesting-account raw tuple, rather than
 * an own-subject RPC or the uploader's session. The provider is configured
 * internally; stored identities cannot introduce a URL or grant permission. */
export async function* streamAccountCompletePreparedRecords(options:{reader:PreparedReader;source:Source;signal:AbortSignal;
 runtime:RequesterStatementRuntime;readArtifact?:ReturnType<typeof createPreparedArtifactFetch>}){
 const {reader,runtime}=options;
 assertPreparedMetadataBounds(options.source,16_384);const source=publishedPreparedSourceSchema.parse(options.source);
 const stop=new AbortController(),signal=AbortSignal.any([options.signal,stop.signal]);
 const remaining=Math.min(300_000,Date.parse(reader.context.deadline)-Date.now());
 if(remaining<=0||signal.aborted)throw unavailable();const timer=setTimeout(()=>stop.abort(),remaining);timer.unref();
 const active=()=>{if(signal.aborted||Date.now()>=Date.parse(reader.context.deadline))throw unavailable();};
 const transport=options.readArtifact??createPreparedArtifactFetch(undefined,runtime);
 const operation=async(current:AbortSignal)=>{active();await reader.check(current);active();};
 async function check(artifact:PreparedStoredArtifact,current:AbortSignal){
  await operation(current);
  const raw=await reader.preparedMember(source.fileId,source.manifestId,artifact,current);
  assertPreparedMetadataBounds(raw,16_384);const checked=publishedPreparedMemberSchema.parse(raw);
  if(checked.manifestId!==source.manifestId||checked.fileId!==source.fileId
   ||checked.membershipSha256!==source.membershipSha256||!equal(checked.member,artifact))throw unavailable();
  await operation(current);
 }
 const readArtifact=async(artifact:PreparedStoredArtifact,current:AbortSignal)=>{
  active();const selected=await runtime.track("complete-prepared-acquire",()=>transport(artifact,AbortSignal.any([signal,current])));
  return (async function*(){
   const iterator=selected[Symbol.asyncIterator]();
   try{for(;;){const next=await runtime.track("complete-prepared-next",()=>iterator.next());
    if(next.done)return;const bytes=runtime.own(next.value);try{active();yield bytes;}finally{runtime.clear(bytes);}
   }}finally{if(iterator.return)await runtime.wait(runtime.cleanup("complete-prepared-close",()=>iterator.return!()),Date.parse(reader.context.deadline));}
  })();
 };
 async function json(artifact:PreparedStoredArtifact,maxBytes:number){
  if(artifact.receipt.byteCount>maxBytes)throw unavailable();
  const bytes=runtime.own(await runtime.track("complete-prepared-json",()=>readVerifiedPreparedArtifact(artifact,{readArtifact,check,signal})));
  try{active();const value:unknown=JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(bytes));assertPreparedMetadataBounds(value,maxBytes);return value;}
  finally{runtime.clear(bytes);}
 }
 try{
  await operation(signal);
  if(source.root.receipt.byteCount>16_384)throw unavailable();
  const root=publishedPreparedRootSchema.parse(await json(source.root,16_384)),binding=root.binding.source;
  if(!equal(root.summary,source.summary)||binding.fileId!==source.fileId||binding.subjectId!==source.subjectId
   ||binding.sourceRevision!==source.sourceRevision||binding.rawSha256!==source.rawSha256||binding.decodedSha256!==source.decodedSha256
   ||binding.sourceBuild!==source.summary.sourceBuild||binding.parserRevision!==source.summary.parserRevision)throw unavailable();
  const roots=[root.canonical,root.rsid,source.root];
  if(!roots.every(a=>a.receipt.jobId===source.root.receipt.jobId&&a.receipt.attemptId===source.root.receipt.attemptId)
   ||!roots.every((a,i)=>a.receipt.sequence===root.canonical.receipt.sequence+i))throw unavailable();
  for(const get of [(a:PreparedStoredArtifact)=>a.receipt.artifactId,(a:PreparedStoredArtifact)=>preparedArtifactObjectIdentity(a),
   (a:PreparedStoredArtifact)=>a.receipt.objectKey])if(new Set(roots.map(get)).size!==3)throw unavailable();
  await check(root.rsid,signal);
  const expected={binding:root.binding,jobId:source.root.receipt.jobId,attemptId:source.root.receipt.attemptId};
  const canonical=validateCanonicalMaterializationReceipt(await json(root.canonical,4_000_000),expected),s=source.summary,c=canonical.counts;
  if(canonical.nextArtifactSequence>root.canonical.receipt.sequence||source.memberCount<canonical.artifactCount+3
   ||c.sourceVariantCount!==s.sourceVariantCount||c.sourceObservedCount!==s.sourceObservedCount||c.sourceReferenceCount!==s.sourceReferenceCount
   ||c.normalizedVariantCount!==s.variantCount||c.normalizedObservedCount!==s.observedCallCount||c.usableObservedCount!==s.usableObservedCount
   ||canonical.canonicalSummary.attempted!==s.attempted||canonical.canonicalSummary.unmapped!==s.unmapped)throw unavailable();
  const rawRsid=await json(root.rsid,4_000_000);
  const start=z.object({firstArtifactSequence:z.number().int().nonnegative().max(4095)}).parse(rawRsid).firstArtifactSequence;
  const rsid=validateCanonicalRsidMaterialization(rawRsid,{...expected,firstArtifactSequence:start,
   canonicalBlockCount:canonical.blockCount,canonicalRecordCount:canonical.recordCount});
  if(start<canonical.nextArtifactSequence||rsid.nextArtifactSequence!==root.canonical.receipt.sequence
   ||rsid.pointerCount!==source.summary.rsidPointerCount||source.memberCount!==canonical.artifactCount+rsid.artifactCount+3)throw unavailable();
  yield {type:"header" as const,header:{type:"prepared-export-source",version:"account-complete-prepared-export-v1",
   manifestId:source.manifestId,preparedAt:source.preparedAt,binding:canonical.binding,summary:source.summary,
   recordCount:canonical.recordCount,artifactMembershipSha256:source.membershipSha256}};
  let records=0,variants=0,observations=0;
  for await(const page of streamPreparedExportRecords(canonical,expected,{signal,readArtifact,
   check:async(_binding,artifact,current)=>artifact?check(artifact,current):operation(current)})){
   for(const record of page){active();records++;if(!Number.isSafeInteger(records))throw unavailable();
    if(record.event.type==="variant"&&record.normalization.status==="normalized")variants++;
    if(record.event.type==="observed")observations++;yield {type:"record" as const,record};
   }
  }
  if(records!==canonical.recordCount||variants!==s.variantCount||observations!==s.sourceObservedCount)throw unavailable();
  await operation(signal);
 }catch{throw unavailable();}
 finally{clearTimeout(timer);stop.abort();}
}
