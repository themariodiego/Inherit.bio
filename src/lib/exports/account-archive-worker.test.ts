import {savedPathBFixture,savedPathBReply} from "./__fixtures__/account-path-b";
import {projectAccountGraphRow} from "./account-graph-projection";
import {createHash,randomUUID} from "node:crypto";
import AdmZip from "adm-zip";
import {afterEach,describe,expect,it,vi} from "vitest";
import {ACCOUNT_GRAPH_CLASSES} from "./account-graph-projection";
import type {AccountRoutedGraphRpc} from "./account-routed-graph-rows";
import type {AccountPathBRpc} from "./account-path-b-members";
import {buildAccountArchive} from "./account-archive-worker";
import {ACCOUNT_SUBJECT_MEMBERS} from "./account-archive-plan";
import {accountPartitionFixture} from "./__fixtures__/account-partitions";
import {claimantArchiveFixture} from "./__fixtures__/claimant-archive";
import {ORDINARY_SUBJECT_AUDIT_NOTE,type AccountAuditRpc} from "./account-audit-members";
import type {AccountMemberRpc,AccountBoundSourceRpc} from "./bound-account-archive-worker";
import type {AccountContentRpc} from "./account-content-reader";
import type {AccountOriginalRpc} from "./account-original-source";
import type {OwnPreparedExportHeader} from "@/lib/genome/prepared-source/export-source";
import type {CanonicalRecord} from "@/lib/genome/prepared-source/canonical-schema";
import type {OwnExportSnapshot} from "./own-subject-content";
import {boundSourceFixture} from "../../../scripts/unit-fixtures/bound-source";
const preparedExport=vi.hoisted(()=>vi.fn());
vi.mock("../genome/prepared-source/export-source",()=>({exportOwnPreparedRecords:preparedExport}));
const date="2026-10-01T00:00:00.000Z",hash=(value:string|Uint8Array)=>createHash("sha256").update(value).digest("hex");
async function fixture(bound=false,prepared=false){
 const raw=bound?await boundSourceFixture():null,historical=claimantArchiveFixture();
 if(raw)historical.options.job.exportId=raw.reference.exportId;
 const actor=raw?{accountId:raw.manifest.actor.accountId,sessionId:raw.manifest.actor.sessionId}:{accountId:randomUUID(),sessionId:randomUUID()};
 const f=await accountPartitionFixture(2,{actor,reference:{exportId:historical.options.job.exportId,attemptId:randomUUID(),authorityReceipt:historical.options.job.authorityReceipt}});
 historical.options.job.deadline=f.context.deadline;
 const file:OwnExportSnapshot={file:{id:randomUUID(),subject_id:f.self,original_name:"Synthetic source",file_type:"vcf",tier:1,size_bytes:3,
  sha256:hash("ABC"),source_sha256:hash("ABC"),status:"stored",build:"GRCh38",created_at:date,variant_count:2,
  bucket_path:randomUUID(),storage_object_id:randomUUID(),upload_revision:1},binding:{...actor,accountRevision:1,authSessionRevision:1,sessionRevision:1,
   subjectBindingRevision:1,lifecycleRevision:1,accountBindingId:randomUUID(),accountBindingRevision:1,subjectPrincipalId:randomUUID(),
   subjectPrincipalRevision:1,accountPrincipalId:randomUUID(),accountPrincipalRevision:1,normalizedAt:date},normalized:true};
 if(prepared){file.file.variant_count=1;file.preparedSource={version:"own-prepared-report-source-v1",backend:"prepared-object-v1",manifestId:randomUUID(),
  membershipSha256:"b".repeat(64),rootArtifactId:randomUUID(),rootSha256:"c".repeat(64)};}
 const variant=(line:number):CanonicalRecord=>({type:"canonical-record",version:"prepared-canonical-v1",
  event:{type:"variant",line,record:{rsid:1,chrom:1,pos:1000,ref:"A",alt:"G",genotype:"A/G"}},
  normalization:{status:"normalized",record:{rsid:1,chrom:1,pos:1000,ref:"A",alt:"G",genotype:"A/G"}}});
 const canonical:CanonicalRecord[]=[variant(1),{...variant(2),normalization:{status:"duplicate",firstSourceLine:1}},
  {type:"canonical-record",version:"prepared-canonical-v1",event:{type:"reference",line:3,call:{chrom:1,pos:1001,ref:"A",genotype:"A/A"}},normalization:{status:"source_reference"}},
  {...variant(4),normalization:{status:"unmapped"}},{...variant(5),normalization:{status:"unsupported_alleles"}},
  {type:"canonical-record",version:"prepared-canonical-v1",event:{type:"observed",line:6,call:{line:6,rsid:null,chrom:1,pos:1002,
   ref:"A",alt:"G",genotype:"--",sourceGt:null,filter:null,sampleFilter:null,genotypeQuality:null,depth:null,quality:"unknown",usable:false}},normalization:{status:"unmapped"}}];
 const header:OwnPreparedExportHeader={type:"prepared-export-source",version:"own-prepared-export-v1",manifestId:file.preparedSource?.manifestId??randomUUID(),preparedAt:date,
  binding:{version:"prepared-canonical-v1",source:{fileId:file.file.id,subjectId:f.self,sourceRevision:1,rawSha256:file.file.sha256,
   decodedSha256:file.file.source_sha256,sourceBuild:"GRCh38",parserRevision:"vcf-source-v1"},targetBuild:"GRCh38",liftoverSha256:null},
  summary:{version:"own-prepared-summary-v1",sourceBuild:"GRCh38",parserRevision:"vcf-source-v1",canonicalRevision:"prepared-canonical-v1",
   sourceVariantCount:4,sourceObservedCount:1,sourceReferenceCount:1,variantCount:1,observedCallCount:0,usableObservedCount:0,attempted:5,unmapped:2,rsidPointerCount:1}};
 preparedExport.mockImplementation(async(_actor:unknown,_selection:unknown,options:{signal:AbortSignal;checkOperation:(signal:AbortSignal)=>Promise<void>},
  consume:(records:CanonicalRecord[],signal:AbortSignal,header:OwnPreparedExportHeader)=>Promise<void>)=>{
   for(const row of canonical){await options.checkOperation(options.signal);await consume([structuredClone(row)],options.signal,structuredClone(header));}
   return {recordCount:canonical.length,variantCount:1};
 });
 f.context.fileCount=1;f.context.partitions[0].fileCount=1;f.context.partitions[0].fileIds=[file.file.id];
 const original={version:prepared?"prepared-original-download-v1":"account-original-download-v1",fileId:file.file.id,sourceRevision:1,rawSha256:hash("ABC"),bucket:"genomes",
  objectId:file.file.storage_object_id,objectKey:file.file.bucket_path,storageVersion:randomUUID(),sizeBytes:3,expiresAt:f.context.deadline,...(prepared?{manifestId:file.preparedSource!.manifestId}:{})};
 const originalState={version:"own-original-download-state-v1",fileId:file.file.id,prepared,retired:false,expiresAt:null as string|null};
 if(raw){
  Object.assign(historical.snapshot.authority,{subjectId:raw.manifest.subjectId,principalId:raw.manifest.claimantPrincipalId});
  Object.assign(historical.snapshot.source,{fileId:raw.manifest.fileId,subjectId:raw.manifest.subjectId,
   sourceSha256:raw.manifest.sourceSha256,membershipSha256:raw.manifest.membershipSha256});
  f.context.partitions.push({subjectId:raw.manifest.subjectId,class:"claimed-bound",fileCount:1,fileIds:[raw.manifest.fileId]});f.context.fileCount++;
  f.classContext.boundSnapshots.push(historical.snapshot as never);
  for(const entry of f.classContext.classes){const n=entry.kind==="embryos"?1:entry.kind==="embryo_variants"?2:0;
   if(n){entry.rows=n;entry.partitions=[{subjectId:raw.manifest.subjectId,rows:n}];}}
  const row={...f.historyRows.subjects[0],id:raw.manifest.subjectId,subject_class:"embryo",upload_class:"embryo"};f.historyRows.subjects.push(row);
  f.historySource.subjects.push({id:raw.manifest.subjectId,rowText:JSON.stringify(row)});f.historySource.subjects.sort((a,b)=>a.id.localeCompare(b.id));
  const entry=f.historyContext.classes.find(e=>e.kind==="subjects")!;entry.rows=3;let digest=createHash("sha256").update("account-history-members-v1|subjects").digest();
  for(const row of f.historySource.subjects)digest=createHash("sha256").update(digest).update(`${row.id}:${row.rowText}\n`).digest();entry.membershipSha256=digest.toString("hex");
 }
 const memberRpc=vi.fn<AccountMemberRpc>(async(_name,args,signal)=>{
  const started=historical.calls.find(call=>call.p_operation==="begin")!;expect(started).toBeDefined();expect(args.p_attempt_id).toBe(started.p_attempt_id);
  if(raw){raw.reference.attemptId=args.p_attempt_id;raw.reply.attemptId=args.p_attempt_id;}
  if(args.p_operation==="context")return {data:structuredClone(f.context),error:null};
  if(args.p_operation==="ordinary-files")return {data:args.p_after_id===null?[structuredClone(file)]:[],error:null};
  expect(args.p_subject_id).toBe(raw!.manifest.subjectId);
  return historical.memberRpc("future_person_export_members_v1",{...args,p_operation:args.p_operation==="bound-context"?"context":args.p_operation as
   Parameters<typeof historical.memberRpc>[1]["p_operation"]},signal);
 });
 const report={purpose:"reports.monogenic",completed_at:date,report:{slug:"saved-condition",covered:true,conflictingRsids:[],
  variants:[{rsid:1,outcome:{status:"genotyped",genotype:"A/G",interpretation:"Original saved finding",strandFlipped:false}}]}};
 const contentRpc=vi.fn<AccountContentRpc>(async(_name,args)=>({data:args.p_operation==="chats"?{chats:[],nextAfterChatId:null}:
  args.p_operation==="check"?structuredClone(file):args.p_operation==="variants"&&args.p_payload.offset===0?
   [{rsid:1,chrom:1,pos:1000,ref:"A",alt:"G",genotype:"A/G"},{rsid:2,chrom:7,pos:2000,ref:"C",alt:"T",genotype:"C/T"}]:
  args.p_operation==="reports"&&args.p_payload.offset===0?[structuredClone(report)]:[],error:null}));
 const metadataRpc=f.metadataRpc.getMockImplementation()!;
 f.metadataRpc.mockImplementation(async(...args)=>{const result=await metadataRpc(...args),data=result.data as {rows:Record<string,unknown>[]};if(args[1].p_operation==="context")data.rows[0].fileCount=1;
  if(args[1].p_operation==="legacy-counts"&&args[1].p_after_id===null)data.rows=[{fileId:file.file.id,subjectId:f.self,revision:1,variantCount:prepared?0:2,observedCallCount:0}];
  return result;});
 const event={seq:7,occurred_at:date,event_code:"purpose.granted",route_id:"api.consents",outcome_code:"accepted",coded_context:{purpose:"ancestry",revision:1}};
 const auditRpc=vi.fn<AccountAuditRpc>(async(_name,args)=>({error:null,data:args.p_operation==="context"?
  {version:"account-archive-audit-v1",authorityReceipt:f.reference.authorityReceipt,attributionStartedAt:date,eventCount:1}:
  args.p_operation==="ordinary-subject"?{schema_version:"legal-audit-v1",attribution:"unrecorded",attribution_started_at:null,note:ORDINARY_SUBJECT_AUDIT_NOTE,events:[]}:
  {events:[event],nextAfterSeq:null}}));
 const originalRpc=vi.fn<AccountOriginalRpc>(async(_name,args)=>({data:{version:"account-archive-original-v1",exportId:args.p_export_id,
  attemptId:args.p_attempt_id,authorityReceipt:args.p_authority_receipt,fileId:file.file.id,decodedSha256:hash("ABC"),actor,
  state:structuredClone(originalState),source:originalState.retired?null:structuredClone(original)},error:null}));
 const readOriginalRange=vi.fn<NonNullable<Parameters<typeof buildAccountArchive>[0]["readOriginalRange"]>>(async(_source,start,end)=>new Response(new TextEncoder().encode("ABC").slice(start,end+1),{status:206,headers:{"content-range":`bytes ${start}-${end}/3`,"content-length":String(end-start+1)}}));
 const boundSourceRpc=vi.fn<AccountBoundSourceRpc>(async(_name,args,signal)=>{if(!raw)throw new Error("no bound partition");
  const {p_subject_id,...sourceArgs}=args;expect(p_subject_id).toBe(raw.manifest.subjectId);return raw.rpc("export_archive_bound_source_v1",sourceArgs,signal);});
 for(const entry of f.classContext.classes){
  if((ACCOUNT_GRAPH_CLASSES as readonly string[]).includes(entry.kind)){
   entry.mode="graph";entry.membershipSha256=hash(`account-graph-routed-v2|${entry.kind}`);
  }else if(entry.kind==="path_b_report_bindings")entry.mode="path-b-results";
  else if(entry.kind==="other_adult_held_uploads")entry.mode="excluded";
 }
 const graphRpc=vi.fn<AccountRoutedGraphRpc>(async(_name,args)=>({data:{version:"account-graph-page-v2",kind:args.p_kind,
  authorityReceipt:f.reference.authorityReceipt,membership:{rows:0,sha256:hash(`account-graph-routed-v2|${args.p_kind}`)},rows:[],nextAfterKey:null},error:null}));
 const pathBRpc=vi.fn<AccountPathBRpc>(async(_name,args)=>({data:{version:"account-path-b-results-v1",authorityReceipt:f.reference.authorityReceipt,
  snapshot:{subjectId:args.p_subject_id,records:[],rows:0,sha256:hash("account-class-members-v1|path_b_report_bindings"),excludedHeldUploads:0}},error:null}));
 const options={job:historical.options.job,workerRpc:historical.options.workerRpc,memberRpc,contentRpc,metadataRpc:f.metadataRpc,
  inventoryRpc:f.inventoryRpc,classRpc:f.classRpc,auditRpc,originalRpc,boundSourceRpc,graphRpc,pathBRpc,readOriginalRange,write:historical.options.write,signal:f.abort.signal};
 return {...f,options,historical,file,original,memberRpc,contentRpc,auditRpc,originalRpc,readOriginalRange,boundSourceRpc,report,event,raw,canonical,header,originalState,graphRpc,pathBRpc};
}
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllEnvs();vi.unstubAllGlobals();vi.useRealTimers();});
describe("complete consumed-account unpublished archive executor",()=>{
 it("consumes seven routed inventories and saved own-subject Path B science into the complete ZIP without held originals or counterpart history",async()=>{
  const f=await fixture(),saved=savedPathBFixture(f.adult,"reports.polygenic");
  const projection=projectAccountGraphRow("family_pairs",{id:randomUUID(),subject_a_id:f.self,subject_b_id:f.foreign,
   subject_low_id:[f.self,f.foreign].sort()[0],subject_high_id:[f.self,f.foreign].sort()[1],pair_revision:2,status:"current",created_at:date},f.context.actor.accountId,[]);
  const row={identity:projection.identity,subjectId:f.self,scope:"requester-account-history",rowText:JSON.stringify(projection.row)},
   root=createHash("sha256").update("account-graph-routed-v2|family_pairs").digest(),digest=createHash("sha256").update(root)
    .update(`${row.identity}:${row.subjectId}:${row.scope}:${row.rowText}\n`).digest("hex");
  Object.assign(f.classContext.classes.find(e=>e.kind==="family_pairs")!,{rows:1,membershipSha256:digest,partitions:[{subjectId:f.self,rows:1}]});
  Object.assign(f.classContext.classes.find(e=>e.kind==="path_b_report_bindings")!,{rows:1,membershipSha256:saved.snapshot.sha256,partitions:[{subjectId:f.adult,rows:1}]});
  f.classContext.classes.find(e=>e.kind==="other_adult_held_uploads")!.rows=1;
  const original=f.graphRpc.getMockImplementation()!;f.graphRpc.mockImplementation(async(...args)=>args[1].p_kind==="family_pairs"?
   {data:{version:"account-graph-page-v2",kind:"family_pairs",authorityReceipt:f.reference.authorityReceipt,membership:{rows:1,sha256:digest},rows:[row],nextAfterKey:null},error:null}:original(...args));
  f.pathBRpc.mockImplementation(async(_name,args)=>structuredClone(savedPathBReply(args.p_subject_id,f.reference.authorityReceipt,args.p_subject_id===f.adult?saved:undefined)));
  const result=await buildAccountArchive(f.options),zip=new AdmZip(Buffer.concat(f.historical.writes)),manifest=JSON.parse(zip.readAsText("manifest.json"));
  expect(result.summary.state).toBe("bytes-complete");expect(new Set(f.graphRpc.mock.calls.map(([,a])=>a.p_kind))).toEqual(new Set(ACCOUNT_GRAPH_CLASSES));
  for(const part of f.context.partitions)for(const name of ACCOUNT_SUBJECT_MEMBERS)expect(zip.getEntry(`subjects/${part.subjectId}/${name}`)).not.toBeNull();
  for(const d of manifest.members){const bytes=zip.readFile(d.name)!;expect(bytes.length).toBe(d.sizeBytes);expect(hash(bytes)).toBe(d.sha256);}
  expect(JSON.parse(zip.readAsText(`subjects/${f.self}/portrait.json`)).sections.find((s:{kind:string})=>s.kind==="graph-metadata").content.rows).toEqual([{kind:"family_pairs",scope:"requester-account-history",row:projection.row}]);
  const reports=JSON.parse(zip.readAsText(`subjects/${f.adult}/reports.json`));expect(reports.sections.find((s:{kind:string})=>s.kind==="path-b-results").content.rows[0].reports).toEqual(saved.value.reports);
  const publishedPgs=JSON.parse(zip.readAsText(`subjects/${f.adult}/prs.json`)).sections.find((s:{kind:string})=>s.kind==="path-b-results").content.rows[0];
  expect(publishedPgs.prsCoverage).toEqual(saved.value.prsCoverage);expect(publishedPgs.prsCount).toBe(saved.value.prsCount);
  expect(publishedPgs.disposition).toBe("coverage-only-no-personal-score-published");
  expect(JSON.stringify(publishedPgs)).not.toMatch(/raw_score|percentile|calibrated_risk/u);
  expect(zip.readAsText(`subjects/${f.adult}/reports.txt`)).toContain("Original saved finding");
  expect(manifest.resultSources).toEqual([{fileId:saved.value.fileId,subjectId:f.adult,purpose:saved.value.purpose,bindingRevision:1,
   projection:"saved-path-b-results-v1",rawSourceDisposition:"held-original-out-of-scope",...saved.value.source}]);
  expect(manifest.files).toHaveLength(1);expect(manifest.files[0].fileId).toBe(f.file.file.id);
  expect(zip.getEntries().some(e=>e.entryName.includes(saved.value.fileId)&&e.entryName.startsWith("originals/"))).toBe(false);
  expect(JSON.parse(zip.readAsText("legal-audit.json")).events).toEqual([f.event]);
  expect(zip.readAsText(`subjects/${f.self}/portrait.json`)).not.toContain(f.foreign);
  expect(JSON.stringify(reports.sections.find((s:{kind:string})=>s.kind==="path-b-results"))).not.toContain(f.foreign);
  expect(Buffer.concat(f.historical.writes).includes(Buffer.from(saved.record.id))).toBe(false);
  expect(f.historical.calls.some(c=>String(c.p_operation)==="ready")).toBe(false);
 });

 it.each([false,true])("generates every actual member with retained and ordinary partitions (bound%s)",async bound=>{
  const f=await fixture(bound),result=await buildAccountArchive(f.options),zip=new AdmZip(Buffer.concat(f.historical.writes));
  const manifest=JSON.parse(zip.readAsText("manifest.json"));expect(result.summary.state).toBe("bytes-complete");
  expect(new Set(zip.getEntries().map(e=>e.entryName))).toEqual(new Set(["manifest.json",...manifest.members.map((m:{name:string})=>m.name)]));
  for(const part of f.context.partitions)for(const name of ACCOUNT_SUBJECT_MEMBERS)expect(zip.getEntry(`subjects/${part.subjectId}/${name}`)).not.toBeNull();
  for(const descriptor of manifest.members){const bytes=zip.readFile(descriptor.name)!;expect(bytes.byteLength).toBe(descriptor.sizeBytes);expect(hash(bytes)).toBe(descriptor.sha256);}
  expect(JSON.parse(zip.readAsText("legal-audit.json")).events).toEqual([f.event]);
  expect(zip.readAsText(`subjects/${f.self}/reports.json`)).toContain("Original saved finding");
  expect(zip.readAsText(`subjects/${f.self}/reports.txt`)).toContain("Original saved finding");
  expect(zip.readAsText(`variants/${f.file.file.id}.csv`).trim().split("\n")).toHaveLength(3);
  expect(zip.readFile(`originals/${f.file.file.id}/original.vcf`)!.equals(Buffer.from("ABC"))).toBe(true);
  if(f.raw){for(const part of manifest.files.find((file:{subjectId:string})=>file.subjectId===f.raw!.manifest.subjectId).currentParts)
   expect(zip.readFile(part.name)!.equals(Buffer.from(f.raw.bytes[part.sequence]))).toBe(true);
   const current=zip.readAsText(`subjects/${f.raw.manifest.subjectId}/consents.json`);expect(current).toContain("Historical synthetic signer");
   expect(current).toContain("retained-custody");expect(zip.readAsText(`subjects/${f.raw.manifest.subjectId}/reports.txt`)).toContain("Historical synthetic signer");}
  expect(f.historical.calls.at(-1)?.p_operation).toBe("bytes-complete");expect(f.historical.calls.some(c=>String(c.p_operation)==="ready")).toBe(false);
  const archive=Buffer.concat(f.historical.writes);expect(archive.includes(Buffer.from(f.context.actor.sessionId))).toBe(false);
  expect(archive.includes(Buffer.from(f.file.file.bucket_path))).toBe(false);
 });
 it("assembles the complete prepared source with every disposition, original and saved report without recomputation",async()=>{
  const f=await fixture(true,true),result=await buildAccountArchive(f.options),zip=new AdmZip(Buffer.concat(f.historical.writes));
  expect(result.summary.state).toBe("bytes-complete");
  expect(zip.readAsText(`canonical/${f.file.file.id}.jsonl`).trim().split("\n").map(line=>JSON.parse(line))).toEqual([f.header,...f.canonical]);
  expect(zip.readAsText(`variants/${f.file.file.id}.csv`).trim().split("\n")).toEqual(["rsid,chrom,pos,ref,alt,genotype",'rs1,1,1000,"A","G","A/G"']);
  expect(JSON.parse(zip.readAsText(`observed/${f.file.file.id}.jsonl`).trim())).toEqual(f.canonical[5]);
  expect(zip.readFile(`originals/${f.file.file.id}/original.vcf`)!.equals(Buffer.from("ABC"))).toBe(true);
  expect(f.contentRpc.mock.calls.some(([,a])=>["variants","observed"].includes(a.p_operation))).toBe(false);
  for(const part of f.context.partitions)for(const name of ACCOUNT_SUBJECT_MEMBERS)expect(zip.getEntry(`subjects/${part.subjectId}/${name}`)).not.toBeNull();
  expect(zip.readAsText(`subjects/${f.self}/reports.txt`)).toContain("Original saved finding");
 });
 it("preserves genuine prepared original retirement while retaining every prepared record and report",async()=>{
  const f=await fixture(false,true);f.originalState.retired=true;f.originalState.expiresAt=new Date(Date.now()-1).toISOString();
  await buildAccountArchive(f.options);const zip=new AdmZip(Buffer.concat(f.historical.writes)),manifest=JSON.parse(zip.readAsText("manifest.json"));
  expect(f.readOriginalRange).not.toHaveBeenCalled();expect(zip.getEntry(`originals/${f.file.file.id}/original.vcf`)).toBeNull();
  expect(manifest.files).toContainEqual(expect.objectContaining({fileId:f.file.file.id,originalRetired:true,byte_identical_to_upload:false}));
  expect(zip.readAsText(`canonical/${f.file.file.id}.jsonl`).trim().split("\n").map(line=>JSON.parse(line))).toEqual([f.header,...f.canonical]);
  expect(zip.readAsText(`subjects/${f.self}/reports.txt`)).toContain("Original saved finding");
 });
 it("refuses a partial prepared producer before any archive reservation or output",async()=>{
  const f=await fixture(false,true),emit=preparedExport.getMockImplementation()!;
  preparedExport.mockImplementation(async(...args)=>({...await emit(...args),recordCount:7}));
  await expect(buildAccountArchive(f.options)).rejects.toThrow();expect(f.historical.write).not.toHaveBeenCalled();
  expect(f.historical.calls.some(c=>c.p_operation==="reserve"||c.p_operation==="bytes-complete")).toBe(false);
 });
 it("holds the uncertain write for cleanup and never records complete bytes after a writer failure",async()=>{
  const f=await fixture();f.historical.write.mockRejectedValue(new Error("unknown write outcome"));
  await expect(buildAccountArchive(f.options)).rejects.toMatchObject({cleanupRequired:true});
  expect(f.historical.calls.some(c=>c.p_operation==="reserve")).toBe(true);
  expect(f.historical.calls.some(c=>c.p_operation==="bytes-complete")).toBe(false);
 });
 it("rechecks current durable authority after the actual write and denies later completion",async()=>{
  const f=await fixture(),write=f.historical.write.getMockImplementation()!;
  f.historical.write.mockImplementation(async(...args)=>{const result=await write(...args);f.historical.revoke();return result;});
  await expect(buildAccountArchive(f.options)).rejects.toMatchObject({cleanupRequired:true});
  expect(f.historical.calls.some(c=>c.p_operation==="acknowledge"||c.p_operation==="bytes-complete")).toBe(false);
 });
 it("refuses cancellation before begin or any source/write operation",async()=>{
  const f=await fixture();f.abort.abort();await expect(buildAccountArchive(f.options)).rejects.toThrow();
  expect(f.historical.calls).toEqual([]);expect(f.memberRpc).not.toHaveBeenCalled();expect(f.historical.write).not.toHaveBeenCalled();
 });
 it.each(["unsupported-class","missing-source","wrong-original","truncated-original","revoked"])("keeps %s as whole refusal with no archive reservations",async fault=>{
  const f=await fixture();if(fault==="unsupported-class")f.classContext.classes.find(e=>e.kind==="family_pairs")!.rows=1;
  if(fault==="missing-source")f.context.partitions[0].fileIds=[randomUUID()];
  if(fault==="wrong-original")f.original.objectId=randomUUID();if(fault==="truncated-original")f.readOriginalRange.mockResolvedValue(new Response(new Uint8Array([1]),{status:206,headers:{"content-range":"bytes 0-2/3","content-length":"3"}}));
  if(fault==="revoked")f.historical.revoke();
  await expect(buildAccountArchive(f.options)).rejects.toThrow();expect(f.historical.write).not.toHaveBeenCalled();
  expect(f.historical.calls.some(c=>c.p_operation==="reserve"||c.p_operation==="bytes-complete")).toBe(false);
 });
 it.each(["ancestry_regions","appeal_intakes","correction_requests","embryo_basis_bindings","embryo_cohorts",
  "embryo_disposition_confirmations","embryo_disposition_proposals","embryo_donor_attributions","embryo_participant_sets",
  "family_pairs","portrait_results","other_adult_held_uploads","path_b_report_bindings"])(
  "keeps the entire account refused when the unproved %s class is nonempty",async kind=>{
   const f=await fixture();f.classContext.classes.find(c=>c.kind===kind)!.rows=1;
   await expect(buildAccountArchive(f.options)).rejects.toThrow();expect(f.historical.write).not.toHaveBeenCalled();
   expect(f.historical.calls.some(c=>c.p_operation==="reserve"||c.p_operation==="bytes-complete")).toBe(false);
 });
 it.each(["actor","subject","file"])("denies a foreign bound %s before any byte reservation",async key=>{
  const f=await fixture(true);if(key==="actor")f.raw!.manifest.actor.accountId=randomUUID();
  if(key==="subject")f.raw!.manifest.subjectId=randomUUID();if(key==="file")f.raw!.manifest.fileId=randomUUID();
  await expect(buildAccountArchive(f.options)).rejects.toThrow();expect(f.historical.write).not.toHaveBeenCalled();
  expect(f.historical.calls.some(c=>c.p_operation==="reserve"||c.p_operation==="bytes-complete")).toBe(false);
 });
 it("refuses changed saved output at fresh member open without byte completion",async()=>{
  const f=await fixture(),original=f.contentRpc.getMockImplementation()!;let reads=0;
  f.contentRpc.mockImplementation(async(...args)=>{if(args[1].p_operation==="reports"&&++reads===3)f.report.report.variants[0].outcome.interpretation="Different saved finding";
   return original(...args);});
  await expect(buildAccountArchive(f.options)).rejects.toThrow();expect(f.historical.calls.some(c=>c.p_operation==="bytes-complete")).toBe(false);
 });
});
