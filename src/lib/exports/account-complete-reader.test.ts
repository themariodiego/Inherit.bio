import {createHash,randomUUID} from "node:crypto";
import {gzipSync} from "node:zlib";
import {afterEach,describe,expect,it,vi} from "vitest";
import {ACCOUNT_CLASS_KINDS,accountClassRowSchemas} from "./account-class-inventory";
import {ACCOUNT_HISTORY_KINDS} from "./account-history-inventory";
import {ACCOUNT_SUBJECT_MEMBERS} from "./account-subject-member-names";
import {prepareAccountCompleteMembers} from "./account-complete-members";
import {accountCompleteContextSchema,type AccountCompleteContext} from "./account-complete-context";
import {prepareAccountCompleteReader,type AccountCompleteRpc} from "./account-complete-reader";
import {createRequesterStatementRuntime} from "./requester-statement-runtime";
import {prepareAccountCompleteFiles} from "./account-complete-files";

// Observe a real native decoder data event before the production consumer;
// never replace its bytes, callback, error, EOF, close, or gzip implementation.
const decoderObservation=vi.hoisted(()=>({onData:undefined as ((bytes:Buffer)=>void)|undefined}));
vi.mock("node:zlib",async importOriginal=>{
 const actual=await importOriginal<typeof import("node:zlib")>();
 return {...actual,createGunzip:(...args:Parameters<typeof actual.createGunzip>)=>{
  const decoder=actual.createGunzip(...args);
  decoder.prependListener("data",(bytes:Buffer)=>decoderObservation.onData?.(bytes));
  return decoder;
 }};
});
afterEach(()=>{decoderObservation.onData=undefined;});

const sha=(value:string|Uint8Array)=>createHash("sha256").update(value).digest("hex");
function fixture(large=false){
 const accountId=randomUUID(),sessionId=randomUUID(),subjectId=randomUUID(),foreign=randomUUID(),id=randomUUID();
 const reference={exportId:randomUUID(),attemptId:randomUUID(),authorityReceipt:"a".repeat(64)};
 const deadline=new Date(Date.now()+600_000).toISOString(),key:[string,string]=[subjectId,id];
 const text=JSON.stringify({id,region_id:"invented-unit-control",detail:large?"Å\\\"".repeat(900_001):"own saved source"});
 const raw=Buffer.from(text),seed=Buffer.from(sha("account-complete-routed-v1|ancestry_regions"),"hex");
 const routed=sha(Buffer.concat([seed,Buffer.from(`${id}:${subjectId}:${text}\n`)]));
 const legacy={version:"account-archive-members-v1" as const,targetKind:"account" as const,targetId:accountId,
  authorityReceipt:reference.authorityReceipt,deadline,capturedAt:new Date().toISOString(),actor:{accountId,sessionId},fileCount:0,
  partitions:[{subjectId,class:"ordinary" as const,fileCount:0,fileIds:[]}]};
 const science=["embryo_figures","embryo_qc","embryo_scores","embryo_variants","embryos","report_artifacts"];
 const oldClasses=ACCOUNT_CLASS_KINDS.map(kind=>({kind,mode:kind in accountClassRowSchemas?"metadata" as const:
  science.includes(kind)?"claimed-bound" as const:"unsupported" as const,rows:0,membershipSha256:sha(`account-class-members-v1|${kind}`),partitions:[]}));
 const classes=oldClasses.map(old=>{
  const extra={rows:old.kind==="ancestry_regions"?1:0,membershipSha256:old.kind==="ancestry_regions"?routed:sha(`account-complete-routed-v1|${old.kind}`),
   partitions:old.kind==="ancestry_regions"?[{subjectId,rows:1}]:[]};
  return {kind:old.kind,rows:extra.rows,membershipSha256:sha(`account-complete-class-v1|${old.kind}\n0:${old.membershipSha256}\n${extra.rows}:${extra.membershipSha256}\n`),
   partitions:extra.partitions,legacy:{rows:0,membershipSha256:old.membershipSha256,partitions:[]},routed:extra};
 });
 const context:AccountCompleteContext={...legacy,version:"account-complete-members-v1",partitions:[...legacy.partitions,
  {subjectId:foreign,class:"consent-covered",fileCount:0,fileIds:[]}],legacyCapture:{context:legacy,
   classes:{version:"account-class-inventory-v1",authorityReceipt:reference.authorityReceipt,classes:oldClasses,boundSnapshots:[]},
   inventory:{version:"account-history-inventory-v1",authorityReceipt:reference.authorityReceipt,
    classes:ACCOUNT_HISTORY_KINDS.map(kind=>({kind,rows:0,membershipSha256:sha(`account-history-members-v1|${kind}`)}))}},
  completeReceipt:{version:"account-complete-capture-receipt-v1",captureSha256:"b".repeat(64),subjectCount:2,fileCount:0,classes,files:[],
   members:ACCOUNT_SUBJECT_MEMBERS.map(member=>({subjectId:foreign,member,sourceRows:member==="reports.json"||member==="reports.txt"?5:0,
    rows:0,membershipSha256:sha(`account-complete-member-v1|${foreign}|${member}`),status:"excluded" as const,reason:"export-recipient-consent-required" as const,authoritySha256:"d".repeat(64)})),
   history:ACCOUNT_HISTORY_KINDS.map(kind=>{
    const old=sha(`account-history-members-v1|${kind}`),routed=sha(`account-complete-history-routed-v1|${kind}`);
    return {kind,rows:0,membershipSha256:sha(`account-complete-history-v1|${kind}\n0:${old}\n0:${routed}\n`),
     legacy:{rows:0,membershipSha256:old},routed:{rows:0,membershipSha256:routed,partitions:[]}};
   })},
  dispositions:[subjectId,foreign].flatMap(subject=>ACCOUNT_CLASS_KINDS.map(kind=>({subjectId:subject,kind,
   sourceRows:subject===subjectId&&kind==="ancestry_regions"?1:subject===foreign&&kind==="embryo_variants"?73:0,
   exportRows:subject===subjectId&&kind==="ancestry_regions"?1:0,status:subject===subjectId?"permitted" as const:"excluded" as const,
   reason:subject===subjectId?"own-subject" as const:kind==="embryo_variants"?"separate-raw-export-authority-required" as const:"outside-consent-scope" as const,
   authoritySha256:"c".repeat(64)})))};
 const row={identity:id,key,subjectId,scope:"subject" as const,...(large?{rowText:null,rowSource:{byteCount:raw.length,sha256:sha(raw)}}:
  {rowText:text,rowSource:null})};
 const rpc=vi.fn<AccountCompleteRpc>(async(_name,args)=>{
  if(args.p_operation==="context")return {data:structuredClone(context),error:null};
  if(args.p_operation==="rows")return {data:{version:"account-complete-page-v1",kind:args.p_kind,
   rows:args.p_kind==="ancestry_regions"&&args.p_after_key===null?[structuredClone(row)]:[],nextAfterKey:null},error:null};
  if(args.p_operation==="member-rows"||args.p_operation==="history-rows")return {data:{version:"account-complete-page-v1",kind:args.p_kind,
   rows:[],nextAfterKey:null},error:null};
  if(args.p_operation==="row-bytes"){
   const selector=args.p_after_key as {key:[string,string];offset:number},bytes=raw.subarray(selector.offset,selector.offset+786_432);
   return {data:{version:"account-complete-row-bytes-v1",kind:args.p_kind,key,byteOffset:selector.offset,totalBytes:raw.length,
    sha256:sha(raw),base64:bytes.toString("base64"),eof:selector.offset+bytes.length===raw.length},error:null};
  }
  throw new Error("unexpected-unit-operation");
 });
 const runtime=createRequesterStatementRuntime(),signal=new AbortController().signal;
 return {context,rpc,row,raw,key,subjectId,foreign,runtime,signal,deadline,
  options:{reference,rpc,signal,deadline,check:async()=>{},runtime}};
}
async function collect(reader:Awaited<ReturnType<typeof prepareAccountCompleteReader>>,signal:AbortSignal){
 const collected:Buffer[]=[];for await(const row of reader.records("ancestry_regions",signal)){
  for await(const part of row.bytes(signal))collected.push(Buffer.from(part));
 }return Buffer.concat(collected);
}
function foreignFile(f:ReturnType<typeof fixture>,gzip=false,corrupt=false){
 const fileId=randomUUID(),objectId=randomUUID(),objectKey=randomUUID(),storageVersion=randomUUID();
 const decoded=Buffer.from("##fileformat=VCFv4.2\n#CHROM\tPOS\tID\tREF\tALT\tQUAL\tFILTER\tINFO\tFORMAT\tSAMPLE\n1\t123\trs456\tA\tG\t.\tPASS\t.\tGT\t0/1\n");
 const original=gzip?gzipSync(decoded):decoded;
 if(corrupt)original[original.length-8]^=1;
 const variant={alt:"G",pos:123,ref:"A",rsid:456,chrom:1,genotype:"0/1"};
 const observed={source_line:3,source_sha256:sha(decoded),source_build:"GRCh38",source_chrom:1,source_pos:123,
  source_ref:"A",source_alt:"G",source_gt:"0/1",rsid:456,chrom:1,pos:123,ref:"A",alt:"G",genotype:"0/1",quality_state:"pass",usable:true};
 const text={variants:JSON.stringify(variant),observed:JSON.stringify(observed)},identity="1:123:source-line:3";
 const chain=(kind:"variants"|"observed")=>sha(Buffer.concat([Buffer.from(sha(`account-complete-file-v1|${fileId}|${kind}`),"hex"),
  Buffer.from(`${identity}:${f.foreign}:${text[kind]}\n`)]));
 const file={fileId,subjectId:f.foreign,originalName:"Genome file",fileType:"vcf",sourceRevision:1,sizeBytes:original.length,
  rawSha256:sha(original),decodedSha256:sha(decoded),rawAuthoritySha256:"7".repeat(64),originalRetired:false,
  content:{backend:"database-v1" as const,receipts:[{kind:"variants" as const,rows:1,membershipSha256:chain("variants")},
   {kind:"observed" as const,rows:1,membershipSha256:chain("observed")},
   {kind:"canonical" as const,rows:0,membershipSha256:sha(`account-complete-file-v1|${fileId}|canonical`)}]}};
 Object.assign(f.context.partitions.find(p=>p.subjectId===f.foreign)!,{fileCount:1,fileIds:[fileId]});
 f.context.fileCount=1;f.context.completeReceipt.fileCount=1;f.context.completeReceipt.files=[file];
 const descriptor={version:"account-complete-original-v1",...f.options.reference,fileId,subjectId:f.foreign,rawAuthoritySha256:file.rawAuthoritySha256,
  decodedSha256:file.decodedSha256,state:{version:"own-original-download-state-v1",fileId,prepared:false,retired:false,expiresAt:f.deadline},
  source:{version:"account-original-download-v1",fileId,sourceRevision:1,rawSha256:file.rawSha256,bucket:"genomes",objectId,objectKey,
   storageVersion,sizeBytes:original.length,expiresAt:f.deadline},actor:f.context.actor};
 const base=f.rpc.getMockImplementation()!;let originalReads=0;
 f.rpc.mockImplementation(async(...args)=>{
  const request=args[1];
  if(request.p_operation==="original"){
   expect(request).toEqual({p_operation:"original",p_export_id:f.options.reference.exportId,p_attempt_id:f.options.reference.attemptId,
    p_authority_receipt:f.options.reference.authorityReceipt,p_kind:null,p_after_key:{fileId,expected:originalReads++===0?null:descriptor}});
   return {data:structuredClone(descriptor),error:null};
  }
  if(request.p_operation==="file-rows"){
   const selector=request.p_after_key as {fileId:string;afterKey:unknown};expect(selector).toEqual({fileId,afterKey:null});
   const value=text[request.p_kind as keyof typeof text];return {data:{version:"account-complete-page-v1",kind:request.p_kind,
    rows:value?[{identity,key:[fileId,identity],subjectId:f.foreign,scope:"subject",rowText:value,rowSource:null}]:[],nextAfterKey:null},error:null};
  }return base(...args);
 });
 const readRange=vi.fn(async(_source:unknown,start:number,end:number)=>new Response(original.subarray(start,end+1),{status:206,
  headers:{"content-range":`bytes ${start}-${end}/${original.length}`,"content-length":String(end-start+1)}}));
 return {file,descriptor,original,decoded,text,readRange};
}
describe("complete account scope and full native supplemental bytes",()=>{
 it("retains actual excluded raw source counts and independently verifies own routed complete membership",async()=>{
  const f=fixture(),reader=await prepareAccountCompleteReader(f.options);
  expect(await collect(reader,f.signal)).toEqual(f.raw);
  expect(reader.context.dispositions.find(d=>d.subjectId===f.foreign&&d.kind==="embryo_variants"))
   .toMatchObject({sourceRows:73,exportRows:0,status:"excluded",reason:"separate-raw-export-authority-required"});
  expect(reader.context.legacyCapture.context.partitions).toHaveLength(1);await f.runtime.settle(Date.parse(f.deadline));f.runtime.assertSettled();
 });
 it("streams a supported scientific row larger than four MB through bounded exact byte pages, UTF8 and final SHA",async()=>{
  const f=fixture(true);expect(f.raw.length).toBeGreaterThan(4_000_000);
  expect((await collect(await prepareAccountCompleteReader(f.options),f.signal)).equals(f.raw)).toBe(true);
  const pages=f.rpc.mock.calls.filter(([,args])=>args.p_operation==="row-bytes");
  expect(pages.length).toBe(Math.ceil(f.raw.length/786_432));
  expect(pages.map(([,args])=>(args.p_after_key as {offset:number}).offset)).toEqual(pages.map((_,i)=>i*786_432));
  await f.runtime.settle(Date.parse(f.deadline));f.runtime.assertSettled();
 });
 it.each(["missing-disposition","duplicate-disposition","foreign-partition","legacy-foreign","raw-as-analysis","hash","missing-class","changed-source"])("refuses %s without returning a complete source",async fault=>{
  const f=fixture();
  if(fault==="missing-disposition")f.context.dispositions.pop();
  if(fault==="duplicate-disposition")f.context.dispositions[1]=f.context.dispositions[0];
  if(fault==="foreign-partition")f.context.completeReceipt.classes[0].routed.partitions[0].subjectId=randomUUID();
  if(fault==="legacy-foreign")f.context.legacyCapture.context.partitions.push({subjectId:f.foreign,class:"ordinary",fileCount:0,fileIds:[]});
  if(fault==="raw-as-analysis")Object.assign(f.context.dispositions.find(d=>d.subjectId===f.foreign&&d.kind==="embryo_variants")!,{status:"permitted",reason:"signed-report-export"});
  if(fault==="hash")f.context.completeReceipt.classes[0].membershipSha256="f".repeat(64);
  if(fault==="missing-class")f.context.completeReceipt.classes.pop();
  if(fault==="changed-source")f.row.rowText="{}";
  await expect((async()=>collect(await prepareAccountCompleteReader(f.options),f.signal))()).rejects.toThrow();
 });
 it.each(["wrong-offset","wrong-hash","wrong-eof","truncated","noncanonical-base64"])("refuses %s in a large source without complete membership",async fault=>{
  const f=fixture(true),base=f.rpc.getMockImplementation()!;
  f.rpc.mockImplementation(async(...args)=>{
   const response=await base(...args);if(args[1].p_operation!=="row-bytes")return response;
   const value=response.data as {byteOffset:number;sha256:string;eof:boolean;base64:string};
   if(fault==="wrong-offset")value.byteOffset++;
   if(fault==="wrong-hash")value.sha256="0".repeat(64);
   if(fault==="wrong-eof")value.eof=true;
   if(fault==="truncated")value.base64=Buffer.from([1]).toString("base64");
   if(fault==="noncanonical-base64")value.base64=` ${value.base64}`;return response;
  });
  await expect(collect(await prepareAccountCompleteReader(f.options),f.signal)).rejects.toThrow();
 });
 it("refuses source drift after a row was streamed and a consumer that does not finish its bytes",async()=>{
  const f=fixture(),reader=await prepareAccountCompleteReader(f.options),source=reader.records("ancestry_regions",f.signal);
  const first=await source.next();expect(first.done).toBe(false);
  await expect(source.next()).rejects.toThrow();
  const g=fixture(),current=await prepareAccountCompleteReader(g.options),rows=current.records("ancestry_regions",g.signal);
  const item=(await rows.next()).value!;g.context.completeReceipt.captureSha256="d".repeat(64);
  await expect((async()=>{for await(const _ of item.bytes(g.signal))void _;})()).rejects.toThrow();
 });
 it("emits all twelve added subject files with actual exclusions, plus all nine history and 29 class receipts",async()=>{
  const f=fixture(),reader=await prepareAccountCompleteReader(f.options),members=prepareAccountCompleteMembers(reader);
  expect(members.factories.filter(m=>m.name.startsWith(`subjects/${f.foreign}/`)).map(m=>m.name.split("/").at(-1))).toEqual([...ACCOUNT_SUBJECT_MEMBERS]);
  expect(members.factories.filter(m=>m.name.startsWith("complete/history/"))).toHaveLength(9);
  expect(members.factories.filter(m=>m.name.startsWith("complete/classes/"))).toHaveLength(29);
  for(const name of ["reports.json","reports.txt"]){
   const factory=members.factories.find(m=>m.name===`subjects/${f.foreign}/${name}`)!,parts:Buffer[]=[];
   for await(const bytes of factory.chunks(f.signal))parts.push(Buffer.from(bytes));const text=Buffer.concat(parts).toString("utf8");
   expect(factory.rows).toBe(0);
   if(name.endsWith(".json"))expect(JSON.parse(text)).toMatchObject({scope:{sourceRows:5,rows:0,status:"excluded",reason:"export-recipient-consent-required"},rows:[]});
   else expect(text).toContain("Source records: 5\nExported records: 0\nThe stored report has no current signed export authorization for this recipient.");
  }
  expect(f.rpc.mock.calls.filter(([,a])=>a.p_operation==="member-rows").every(([,a])=>JSON.stringify(a.p_after_key)===JSON.stringify({subjectId:f.foreign,afterKey:null}))).toBe(true);
 });
 it("independently verifies permitted added-member and requester-history bytes instead of fabricating legacy subset rows",async()=>{
  const f=fixture(),id=randomUUID(),key:[string,string]=[f.foreign,id],text=JSON.stringify({kind:"requester-metadata",value:"genuine named native unit projection"});
  const chain=(seed:string)=>sha(Buffer.concat([Buffer.from(sha(seed),"hex"),Buffer.from(`${id}:${f.foreign}:${text}\n`)]));
  const member=f.context.completeReceipt.members.find(m=>m.member==="subject.json")!;
  Object.assign(member,{sourceRows:1,rows:1,status:"permitted",reason:"requester-metadata",membershipSha256:chain(`account-complete-member-v1|${f.foreign}|subject.json`)});
  const history=f.context.completeReceipt.history.find(h=>h.kind==="subjects")!;
  history.routed={rows:1,membershipSha256:chain("account-complete-history-routed-v1|subjects"),partitions:[{subjectId:f.foreign,rows:1}]};
  history.rows=1;history.membershipSha256=sha(`account-complete-history-v1|subjects\n0:${history.legacy.membershipSha256}\n1:${history.routed.membershipSha256}\n`);
  const base=f.rpc.getMockImplementation()!;
  f.rpc.mockImplementation(async(...args)=>{
   const request=args[1];
   if(request.p_operation==="member-rows"&&request.p_kind==="subject.json"||request.p_operation==="history-rows"&&request.p_kind==="subjects"){
    if(request.p_operation==="member-rows")expect(request.p_after_key).toEqual({subjectId:f.foreign,afterKey:null});
    return {data:{version:"account-complete-page-v1",kind:request.p_kind,rows:[{identity:id,key,subjectId:f.foreign,scope:"subject",rowText:text,rowSource:null}],nextAfterKey:null},error:null};
   }return base(...args);
  });
  const reader=await prepareAccountCompleteReader(f.options);
  for(const records of [reader.memberRecords(f.foreign,"subject.json",f.signal),reader.historyRecords("subjects",f.signal)]){
   const parts:Buffer[]=[];for await(const row of records)for await(const bytes of row.bytes(f.signal))parts.push(Buffer.from(bytes));
   expect(Buffer.concat(parts).toString("utf8")).toBe(text);
  }
  expect(reader.context.legacyCapture.context.partitions.map(p=>p.subjectId)).toEqual([f.subjectId]);
  expect(reader.context.legacyCapture.inventory.classes.find(h=>h.kind==="subjects")?.rows).toBe(0);
 });
 it.each(["missing-member","duplicate-member","ordinary-member","lost-history","changed-history","excluded-content"])("refuses %s without a fabricated compatibility member",async fault=>{
  const f=fixture();
  if(fault==="missing-member")f.context.completeReceipt.members.pop();
  if(fault==="duplicate-member")f.context.completeReceipt.members[1]=f.context.completeReceipt.members[0];
  if(fault==="ordinary-member")f.context.completeReceipt.members[0].subjectId=f.subjectId;
  if(fault==="lost-history")f.context.completeReceipt.history.pop();
  if(fault==="changed-history")f.context.completeReceipt.history[0].routed.membershipSha256="f".repeat(64);
  if(fault==="excluded-content")f.context.completeReceipt.members[0].rows=1;
  await expect(prepareAccountCompleteReader(f.options)).rejects.toThrow();
 });
 it("retains a nonempty held-object source census without counting or emitting its payload as an export row",async()=>{
  const f=fixture(),kind="other_adult_held_uploads",old=f.context.legacyCapture.classes.classes.find(c=>c.kind===kind)!,current=f.context.completeReceipt.classes.find(c=>c.kind===kind)!;
  Object.assign(old,{mode:"excluded",rows:17,membershipSha256:sha("synthetic-exact-withheld-source-census")});
  current.legacy={rows:17,membershipSha256:old.membershipSha256,partitions:[]};
  current.membershipSha256=sha(`account-complete-class-v1|${kind}\n17:${old.membershipSha256}\n0:${current.routed.membershipSha256}\n`);
  f.context.dispositions.push({subjectId:null,kind,sourceRows:17,exportRows:0,status:"excluded",reason:"outside-consent-scope",authoritySha256:"e".repeat(64)});
  const parsed=accountCompleteContextSchema.parse(f.context);expect(parsed.completeReceipt.classes.find(c=>c.kind===kind)?.rows).toBe(0);
  const reader=await prepareAccountCompleteReader(f.options);expect(await reader.records(kind,f.signal).next()).toEqual({done:true,value:undefined});
  current.rows=17;await expect(prepareAccountCompleteReader(f.options)).rejects.toThrow();
 });
 it("produces real separately-authorized foreign original, six-field CSV and full observed JSONL without an own-subject session",async()=>{
  const f=fixture(),raw=foreignFile(f),reader=await prepareAccountCompleteReader(f.options);
  const result=await prepareAccountCompleteFiles({reader,reference:f.options.reference,signal:f.signal,runtime:f.runtime,readRange:raw.readRange});
  expect(result.files).toEqual([{fileId:raw.file.fileId,subjectId:f.foreign,projection:"consent-covered-upload",
   rawAuthoritySha256:raw.file.rawAuthoritySha256,byte_identical_to_upload:true,originalRetired:false,
   sourceSha256:raw.file.rawSha256,decodedSha256:raw.file.decodedSha256,contentBackend:"database-v1",
   variantColumns:["alt","pos","ref","rsid","chrom","genotype"]}]);
  const outputs=new Map<string,string>();
  for(const factory of result.factories){const parts:Buffer[]=[];for await(const part of factory.chunks(f.signal))parts.push(Buffer.from(part));
   outputs.set(factory.name,Buffer.concat(parts).toString("utf8"));}
  expect(outputs.get(`variants/${raw.file.fileId}.csv`)).toBe('alt,pos,ref,rsid,chrom,genotype\n"G",123,"A",rs456,1,"0/1"\n');
  expect(outputs.get(`observed/${raw.file.fileId}.jsonl`)).toBe(raw.text.observed+"\n");
  expect(JSON.parse(outputs.get(`canonical/${raw.file.fileId}.jsonl`)!)).toEqual({type:"canonical-materialization-disposition",backend:"database-v1",
   fileId:raw.file.fileId,rows:0,reason:"canonical-materialization-is-prepared-only"});
  const opened=await result.sources[0].member.open(f.signal),parts:Buffer[]=[];
  for await(const bytes of opened as unknown as AsyncIterable<Uint8Array>)parts.push(Buffer.from(bytes));
  expect(Buffer.concat(parts)).toEqual(raw.original);
  expect(f.rpc.mock.calls.every(([name,args])=>name==="export_archive_account_complete_v1"&&!("p_account_id" in args)&&!("p_session_id" in args))).toBe(true);
  expect(f.context.legacyCapture.context.fileCount).toBe(0);
  await f.runtime.settle(Date.parse(f.deadline));f.runtime.assertSettled();
 });
 it("retains gzip input until its decoder write settles, verifies decoded EOF, then emits the identical separately-authorized raw original",async()=>{
  const f=fixture(),raw=foreignFile(f,true),reader=await prepareAccountCompleteReader(f.options);
  expect(raw.file.rawSha256).not.toBe(raw.file.decodedSha256);
  const result=await prepareAccountCompleteFiles({reader,reference:f.options.reference,signal:f.signal,runtime:f.runtime,readRange:raw.readRange});
  expect(result.files).toEqual([{fileId:raw.file.fileId,subjectId:f.foreign,projection:"consent-covered-upload",
   rawAuthoritySha256:raw.file.rawAuthoritySha256,byte_identical_to_upload:true,originalRetired:false,
   sourceSha256:sha(raw.original),decodedSha256:sha(raw.decoded),contentBackend:"database-v1",
   variantColumns:["alt","pos","ref","rsid","chrom","genotype"]}]);
  expect(result.sources).toHaveLength(1);expect(result.sources[0].member.name).toBe(`originals/${raw.file.fileId}/original.vcf.gz`);
  const opened=await result.sources[0].member.open(f.signal),parts:Buffer[]=[];
  for await(const bytes of opened as unknown as AsyncIterable<Uint8Array>)parts.push(Buffer.from(bytes));
  expect(Buffer.concat(parts).equals(raw.original)).toBe(true);expect(raw.readRange).toHaveBeenCalledTimes(2);
  expect(f.rpc.mock.calls.every(([name,args])=>name==="export_archive_account_complete_v1"&&!("p_account_id" in args)&&!("p_session_id" in args))).toBe(true);
  expect(f.context.legacyCapture.context.fileCount).toBe(0);
  await f.runtime.settle(Date.parse(f.deadline));f.runtime.assertSettled();
 });
 it("owns and clears actual late decoded gzip bytes when cancellation precedes the consumer's active check",async()=>{
  const f=fixture(),raw=foreignFile(f,true),controller=new AbortController();
  const reader=await prepareAccountCompleteReader({...f.options,signal:controller.signal});
  let delivered:Buffer|undefined,deliveredSha:string|undefined,events=0;
  decoderObservation.onData=bytes=>{
   // This is the actual native Gunzip event, before the verifier listener.
   delivered=bytes;deliveredSha=sha(bytes);events++;controller.abort();
  };
  await expect(prepareAccountCompleteFiles({reader,reference:f.options.reference,signal:controller.signal,
   runtime:f.runtime,readRange:raw.readRange})).rejects.toThrow("account_complete_original_unavailable");
  decoderObservation.onData=undefined;
  expect(events).toBe(1);expect(deliveredSha).toBe(raw.file.decodedSha256);
  expect(delivered).toBeInstanceOf(Buffer);expect(delivered!.byteLength).toBe(raw.decoded.byteLength);
  expect(delivered!.every(byte=>byte===0)).toBe(true);expect(raw.readRange).toHaveBeenCalledTimes(1);
  await f.runtime.settle(Date.parse(f.deadline));f.runtime.assertSettled();
 });
 it("refuses raw-hash-valid corrupted gzip at actual decoded EOF and settles owned decoder/input without an original member",async()=>{
  const f=fixture(),raw=foreignFile(f,true,true);
  expect(sha(raw.original)).toBe(raw.file.rawSha256);expect(sha(raw.decoded)).toBe(raw.file.decodedSha256);
  await expect(prepareAccountCompleteFiles({reader:await prepareAccountCompleteReader(f.options),reference:f.options.reference,
   signal:f.signal,runtime:f.runtime,readRange:raw.readRange})).rejects.toThrow("account_complete_original_unavailable");
  expect(raw.readRange).toHaveBeenCalledTimes(1);
  await f.runtime.settle(Date.parse(f.deadline));f.runtime.assertSettled();
 });
 it.each(["missing-file","foreign-subject","duplicate-file","database-canonical","retired-database","original-foreign-actor","original-foreign-raw-authority",
  "original-wrong-revision","original-wrong-decoded","original-wrong-raw","original-wrong-size"])("refuses %s rather than borrowing own-file authority or omitting raw bytes",async fault=>{
  const f=fixture(),raw=foreignFile(f);
  if(fault==="missing-file")f.context.completeReceipt.files=[];
  if(fault==="foreign-subject")raw.file.subjectId=randomUUID();
  if(fault==="duplicate-file")f.context.completeReceipt.files.push(raw.file);
  if(fault==="database-canonical")raw.file.content.receipts.find(r=>r.kind==="canonical")!.rows=1;
  if(fault==="retired-database")raw.file.originalRetired=true;
  if(fault==="original-foreign-actor")raw.descriptor.actor={accountId:randomUUID(),sessionId:randomUUID()};
  if(fault==="original-foreign-raw-authority")raw.descriptor.rawAuthoritySha256="8".repeat(64);
  if(fault==="original-wrong-revision")raw.descriptor.source.sourceRevision++;
  if(fault==="original-wrong-decoded")raw.descriptor.decodedSha256="8".repeat(64);
  if(fault==="original-wrong-raw")raw.descriptor.source.rawSha256="8".repeat(64);
  if(fault==="original-wrong-size")raw.descriptor.source.sizeBytes++;
  await expect((async()=>prepareAccountCompleteFiles({reader:await prepareAccountCompleteReader(f.options),reference:f.options.reference,
   signal:f.signal,runtime:f.runtime,readRange:raw.readRange}))()).rejects.toThrow();
  expect(raw.readRange).not.toHaveBeenCalled();
 });
});
