import {createHash,randomUUID} from "node:crypto";
import {afterEach,describe,expect,it,vi} from "vitest";
import {prepareAccountScientificMembers} from "./account-scientific-members";
import {createAccountContentReader,type AccountContentRpc} from "./account-content-reader";
import {prepareAccountArchiveMetadata,type AccountMetadataRpc} from "./account-member-metadata";
import type {accountArchiveContextSchema,AccountMemberRpc} from "./bound-account-archive-worker";
import type {OwnExportSnapshot} from "./own-subject-content";
import type {OwnPreparedExportHeader} from "@/lib/genome/prepared-source/export-source";
import type {CanonicalRecord} from "@/lib/genome/prepared-source/canonical-schema";
import type {z} from "zod";
const preparedExport=vi.hoisted(()=>vi.fn());
vi.mock("../genome/prepared-source/export-source",()=>({exportOwnPreparedRecords:preparedExport}));
const hash=(value:string)=>createHash("sha256").update(value).digest("hex"),date="2026-10-01T00:00:00.000Z";
async function fixture(prepared=false){
 const actor={accountId:randomUUID(),sessionId:randomUUID()},subjectId=randomUUID(),emptySubject=randomUUID(),abort=new AbortController();
 const reference={exportId:randomUUID(),attemptId:randomUUID(),authorityReceipt:"a".repeat(64)},deadline=new Date(Date.now()+600000).toISOString();
 const file:OwnExportSnapshot={file:{id:randomUUID(),subject_id:subjectId,original_name:"Source file",file_type:"vcf",tier:1,size_bytes:3,
  sha256:hash("ABC"),source_sha256:hash("ABC"),status:"stored",build:"GRCh37",created_at:date,variant_count:prepared?1:1207,
  bucket_path:randomUUID(),storage_object_id:randomUUID(),upload_revision:1},binding:{...actor,accountRevision:1,authSessionRevision:1,
  sessionRevision:1,subjectBindingRevision:1,lifecycleRevision:1,accountBindingId:randomUUID(),accountBindingRevision:1,
  subjectPrincipalId:randomUUID(),subjectPrincipalRevision:1,accountPrincipalId:randomUUID(),accountPrincipalRevision:1,normalizedAt:date},normalized:true,
  ...(prepared?{preparedSource:{version:"own-prepared-report-source-v1" as const,backend:"prepared-object-v1" as const,manifestId:randomUUID(),
   membershipSha256:"b".repeat(64),rootArtifactId:randomUUID(),rootSha256:"c".repeat(64)}}:{})};
 const context:z.infer<typeof accountArchiveContextSchema>={version:"account-archive-members-v1",targetKind:"account",targetId:actor.accountId,
  authorityReceipt:reference.authorityReceipt,deadline,capturedAt:date,actor,fileCount:1,partitions:[
   {subjectId,class:"ordinary",fileCount:1,fileIds:[file.file.id]},{subjectId:emptySubject,class:"ordinary",fileCount:0,fileIds:[]}]};
 const variants=Array.from({length:1207},(_,i)=>({rsid:i+1,chrom:1,pos:i+1000,ref:"A",alt:"G",genotype:"A/G"}));
 const observed=variants.slice(0,2).map((row,i)=>({...row,source_line:i+1,source_sha256:file.file.source_sha256,source_build:"GRCh37",
  source_chrom:1,source_pos:row.pos,source_ref:"A",source_alt:"G",source_gt:"0/1",quality_state:"pass",usable:true}));
 const report={purpose:"reports.monogenic",completed_at:date,report:{slug:"recorded-condition",covered:true,conflictingRsids:[],
  variants:[{rsid:1,outcome:{status:"genotyped",genotype:"A/G",interpretation:"Stored finding",strandFlipped:false}}]}};
 const memberRpc=vi.fn<AccountMemberRpc>(async(_name,args)=>({data:args.p_operation==="context"?structuredClone(context):
  args.p_after_id===null?[structuredClone(file)]:[],error:null}));
 const contentRpc=vi.fn<AccountContentRpc>(async(_name,args)=>({data:args.p_operation==="check"?structuredClone(file):
  args.p_operation==="variants"?variants.slice(Number(args.p_payload.offset),Number(args.p_payload.offset)+500):
  args.p_operation==="observed"?observed.slice(Number(args.p_payload.offset),Number(args.p_payload.offset)+1):
  args.p_operation==="reports"&&args.p_payload.offset===0?[structuredClone(report)]:[],error:null}));
 const check=vi.fn<(signal:AbortSignal)=>Promise<void>>(async()=>{});
 const reader=await createAccountContentReader({reference,deadline,memberRpc,contentRpc,signal:abort.signal,check});
 const metadataRpc=vi.fn<AccountMetadataRpc>(async(_name,args)=>({data:{version:"account-archive-metadata-v1",operation:args.p_operation,
  rows:args.p_operation==="context"?[{profileCount:1,purposeGrantCount:0,fileCount:1}]:args.p_operation==="profile"?[
   {id:actor.accountId,date_of_birth:null,jurisdiction_code:null,jurisdiction_subdivision:null,jurisdiction_revision:1,
    jurisdiction_declared_at:null,jurisdiction_attestation_version:null,jurisdiction_attestation_sha256:null}]:
   args.p_operation==="legacy-counts"&&args.p_after_id===null?[{fileId:file.file.id,subjectId,revision:1,
    variantCount:prepared?0:1207,observedCallCount:prepared?0:2}]:[]},error:null}));
 const metadata=await prepareAccountArchiveMetadata({reference,context,files:[file],rpc:metadataRpc,signal:abort.signal,check});
 const variant=(line:number):CanonicalRecord=>({type:"canonical-record",version:"prepared-canonical-v1",
  event:{type:"variant",line,record:{rsid:1,chrom:1,pos:1000,ref:"A",alt:"G",genotype:"A/G"}},
  normalization:{status:"normalized",record:{rsid:1,chrom:1,pos:1000,ref:"A",alt:"G",genotype:"A/G"}}});
 const records:CanonicalRecord[]=[variant(1),{...variant(2),normalization:{status:"duplicate",firstSourceLine:1}},
  {type:"canonical-record",version:"prepared-canonical-v1",event:{type:"reference",line:3,call:{chrom:1,pos:1001,ref:"A",genotype:"A/A"}},normalization:{status:"source_reference"}},
  {...variant(4),normalization:{status:"unmapped"}},{...variant(5),normalization:{status:"unsupported_alleles"}},
  {type:"canonical-record",version:"prepared-canonical-v1",event:{type:"observed",line:6,call:{line:6,rsid:null,chrom:1,pos:1002,
   ref:"A",alt:"G",genotype:"--",sourceGt:null,filter:null,sampleFilter:null,genotypeQuality:null,depth:null,quality:"unknown",usable:false}},
   normalization:{status:"unmapped"}}];
 const header:OwnPreparedExportHeader={type:"prepared-export-source",version:"own-prepared-export-v1",manifestId:file.preparedSource?.manifestId??randomUUID(),preparedAt:date,
  binding:{version:"prepared-canonical-v1",source:{fileId:file.file.id,subjectId,sourceRevision:1,rawSha256:file.file.sha256,
   decodedSha256:file.file.source_sha256,sourceBuild:"GRCh37",parserRevision:"vcf-source-v1"},targetBuild:"GRCh38",liftoverSha256:"d".repeat(64)},
  summary:{version:"own-prepared-summary-v1",sourceBuild:"GRCh37",parserRevision:"vcf-source-v1",canonicalRevision:"prepared-canonical-v1",
   sourceVariantCount:4,sourceObservedCount:1,sourceReferenceCount:1,variantCount:1,observedCallCount:0,usableObservedCount:0,
   attempted:5,unmapped:2,rsidPointerCount:1}};
 const emitPrepared=async(_actor:unknown,_selection:unknown,options:{signal:AbortSignal;checkOperation:(signal:AbortSignal)=>Promise<void>},
  consume:(page:CanonicalRecord[],signal:AbortSignal,header:OwnPreparedExportHeader)=>Promise<void>)=>{
   for(const record of records){await options.checkOperation(options.signal);await consume([structuredClone(record)],options.signal,structuredClone(header));}
   return {recordCount:records.length,variantCount:1};
  };
 preparedExport.mockImplementation(emitPrepared);
 return {options:{reader,metadata,signal:abort.signal,check},reader,metadata,file,context,subjectId,emptySubject,abort,check,
  contentRpc,memberRpc,variants,observed,report,records,header,emitPrepared};
}
async function content(factory:{chunks:(signal:AbortSignal)=>AsyncIterable<Uint8Array>},signal=new AbortController().signal){
 const chunks:Uint8Array[]=[];for await(const chunk of factory.chunks(signal))chunks.push(chunk);return Buffer.concat(chunks).toString();
}
afterEach(()=>vi.useRealTimers());
describe("consumed ordinary scientific archive factories",()=>{
 it("exhausts short real content pages and includes stored reports, literal observations and source-empty partitions",async()=>{
  const f=await fixture(),prepared=await prepareAccountScientificMembers(f.options);
  const byName=new Map(prepared.factories.map(factory=>[factory.name,factory]));
  expect(JSON.parse(await content(byName.get(`subjects/${f.subjectId}/reports.json`)!)).rows[0]).toMatchObject({
   file_id:f.file.file.id,report_count:1,reports:[{variants:[{interpretation:"Stored finding"}]}]});
  const printed=await content(byName.get(`subjects/${f.subjectId}/reports.txt`)!);expect(printed).toContain("Stored finding");
  expect(printed).toContain(`SHA-256: ${f.file.file.sha256}`);
  const csv=await content(byName.get(`variants/${f.file.file.id}.csv`)!);
  expect(csv.trim().split("\n")).toHaveLength(1208);expect(csv).toContain('rs1207,1,2206,"A","G","A/G"');
  const observed=(await content(byName.get(`observed/${f.file.file.id}.jsonl`)!)).trim().split("\n").map(line=>JSON.parse(line));
  expect(observed).toEqual(f.observed);expect(byName.get(`observed/${f.file.file.id}.jsonl`)!.rows).toBe(2);
  for(const kind of ["reports","prs","ancestry"])expect(JSON.parse(await content(byName.get(`subjects/${f.emptySubject}/${kind}.json`)!)).rows).toEqual([]);
  expect(f.contentRpc.mock.calls.filter(([,a])=>a.p_operation==="variants").map(([,a])=>a.p_payload.offset)).toEqual([0,500,1000,1207]);
 });
 it("preserves every prepared disposition and the exact source-bound header",async()=>{
  const f=await fixture(true),prepared=await prepareAccountScientificMembers(f.options);
  const byName=new Map(prepared.factories.map(factory=>[factory.name,factory]));
  const actual=(await content(byName.get(`canonical/${f.file.file.id}.jsonl`)!)).trim().split("\n").map(line=>JSON.parse(line));
  expect(actual).toEqual([f.header,...f.records]);expect(byName.get(`canonical/${f.file.file.id}.jsonl`)!.rows).toBe(6);
  expect((await content(byName.get(`variants/${f.file.file.id}.csv`)!)).trim().split("\n")).toEqual([
   "rsid,chrom,pos,ref,alt,genotype",'rs1,1,1000,"A","G","A/G"']);
  expect(JSON.parse((await content(byName.get(`observed/${f.file.file.id}.jsonl`)!)).trim())).toEqual(f.records[5]);
  expect(f.contentRpc.mock.calls.some(([,a])=>["variants","observed"].includes(a.p_operation))).toBe(false);
 });
 it("splits a codec-valid long allele into bounded output bytes without losing any record byte",async()=>{
  const f=await fixture(true),long="G".repeat(1_950_000);f.records[0].event={type:"variant",line:1,record:{rsid:1,chrom:1,pos:1000,ref:"A",alt:long,genotype:`A/${long}`}};
  f.records[0].normalization={status:"unsupported_alleles"};f.file.file.variant_count=0;
  // Preserve a real normalized variant and its unchanged expected count.
  f.records[4]={...structuredClone(f.records[1]),event:{type:"variant",line:5,record:{rsid:1,chrom:1,pos:1000,ref:"A",alt:"G",genotype:"A/G"}},
   normalization:{status:"normalized",record:{rsid:1,chrom:1,pos:1000,ref:"A",alt:"G",genotype:"A/G"}}};f.file.file.variant_count=1;
  const prepared=await prepareAccountScientificMembers(f.options),factory=prepared.factories.find(v=>v.name.startsWith("canonical/"))!;
  const bytes:Uint8Array[]=[];for await(const item of factory.chunks(f.abort.signal)){expect(item.byteLength).toBeLessThanOrEqual(1_048_576);bytes.push(item);}
  expect(JSON.parse(Buffer.concat(bytes).toString().trim().split("\n")[1])).toEqual(f.records[0]);
 });
 it.each(["missing-variant","extra-observation"])("refuses %s at complete EOF",async change=>{
  const f=await fixture(),prepared=await prepareAccountScientificMembers(f.options);
  if(change==="missing-variant")f.variants.pop();else f.observed.push({...f.observed[0],source_line:3});
  const factory=prepared.factories.find(v=>v.name.startsWith(change==="missing-variant"?"variants/":"observed/"))!;
  await expect(content(factory)).rejects.toThrow();
 });
 it("refuses a changed stored report instead of recalculating or releasing its replacement",async()=>{
  const f=await fixture(),prepared=await prepareAccountScientificMembers(f.options);
  f.report.report.variants[0].outcome.interpretation="Different saved result";
  await expect(content(prepared.factories.find(v=>v.name===`subjects/${f.subjectId}/reports.json`)!)).rejects.toThrow();
 });
 it.each(["file","header","count"])("refuses changed prepared %s proof",async change=>{
  const f=await fixture(true),prepared=await prepareAccountScientificMembers(f.options);
  if(change==="file")f.header.binding.source.fileId=randomUUID();
  if(change==="header")f.header.summary.parserRevision="different-parser";
  if(change==="count")preparedExport.mockImplementation(async(...args)=>({...await f.emitPrepared(...args as Parameters<typeof f.emitPrepared>),recordCount:7}));
  await expect(content(prepared.factories.find(v=>v.name.startsWith("canonical/"))!)).rejects.toThrow();
 });
 it("rejects actual producer failure after a partial prepared callback",async()=>{
  const f=await fixture(true);preparedExport.mockImplementation(async(...args)=>{await f.emitPrepared(...args as Parameters<typeof f.emitPrepared>);throw new Error("provider read failed");});
  await expect(prepareAccountScientificMembers(f.options)).rejects.toThrow("provider read failed");
 });
 it.each(["cancelled","revoked"])("refuses %s before any subsequent source content",async reason=>{
  const f=await fixture(),prepared=await prepareAccountScientificMembers(f.options),before=f.contentRpc.mock.calls.length;
  if(reason==="cancelled")f.abort.abort();else f.check.mockRejectedValue(new Error("revoked"));
  await expect(content(prepared.factories[0],f.abort.signal)).rejects.toThrow();expect(f.contentRpc.mock.calls.length).toBe(before);
 });
 it("retains the original 30-second bound when a current authority callback ignores cancellation",async()=>{
  vi.useFakeTimers();const f=await fixture();f.check.mockImplementation(()=>new Promise<void>(()=>{}));
  const running=prepareAccountScientificMembers(f.options),refused=expect(running).rejects.toThrow();
  await vi.advanceTimersByTimeAsync(30_001);await refused;
 });
});
