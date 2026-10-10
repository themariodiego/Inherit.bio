import {createHash,randomUUID} from "node:crypto";
import {gzipSync} from "node:zlib";
import AdmZip from "adm-zip";
import {afterEach,describe,expect,it,vi} from "vitest";
import type {z} from "zod";
import {prepareAccountOriginalSource,type AccountOriginalRpc} from "./account-original-source";
import type {accountArchiveContextSchema} from "./bound-account-archive-worker";
import type {OwnExportSnapshot} from "./own-subject-content";
import {createZip64Archive,type Zip64Member} from "./archive-zip64";
const hash=(value:Uint8Array)=>createHash("sha256").update(value).digest("hex"),date="2026-10-01T00:00:00.000Z";
function fixture(compressed=false,prepared=false,length=2_097_159){
 const decoded=Buffer.alloc(length,37),raw=compressed?gzipSync(decoded):decoded,actor={accountId:randomUUID(),sessionId:randomUUID()};
 const reference={exportId:randomUUID(),attemptId:randomUUID(),authorityReceipt:"a".repeat(64)},subjectId=randomUUID(),fileId=randomUUID(),manifestId=randomUUID();
 const snapshot:OwnExportSnapshot={file:{id:fileId,subject_id:subjectId,original_name:"Genome file",file_type:"vcf",tier:1,
  size_bytes:raw.length,sha256:hash(raw),source_sha256:hash(decoded),status:"stored",build:"GRCh38",created_at:date,
  variant_count:1,bucket_path:randomUUID(),storage_object_id:randomUUID(),upload_revision:2},
  binding:{...actor,accountRevision:1,authSessionRevision:1,sessionRevision:1,subjectBindingRevision:1,lifecycleRevision:1,
   accountBindingId:randomUUID(),accountBindingRevision:1,subjectPrincipalId:randomUUID(),subjectPrincipalRevision:1,
   accountPrincipalId:randomUUID(),accountPrincipalRevision:1,normalizedAt:date},normalized:true,
  ...(prepared?{preparedSource:{version:"own-prepared-report-source-v1",backend:"prepared-object-v1",manifestId,
   membershipSha256:"b".repeat(64),rootArtifactId:randomUUID(),rootSha256:"c".repeat(64)}}:{})};
 const context:z.infer<typeof accountArchiveContextSchema>={version:"account-archive-members-v1",targetKind:"account",targetId:actor.accountId,
  authorityReceipt:reference.authorityReceipt,deadline:new Date(Date.now()+600_000).toISOString(),capturedAt:date,actor,
  fileCount:1,partitions:[{subjectId,class:"ordinary",fileCount:1,fileIds:[fileId]}]};
 const source={version:prepared?"prepared-original-download-v1":"account-original-download-v1",fileId,
  sourceRevision:2,rawSha256:snapshot.file.sha256,bucket:"genomes",objectId:snapshot.file.storage_object_id,objectKey:snapshot.file.bucket_path,
  storageVersion:String(randomUUID()),sizeBytes:raw.length,expiresAt:new Date(Date.now()+240_000).toISOString(),...(prepared?{manifestId}:{})};
 const receipt={version:"account-archive-original-v1",...reference,fileId,actor,decodedSha256:snapshot.file.source_sha256,
  state:{version:"own-original-download-state-v1",fileId,prepared,retired:false,expiresAt:null as string|null},source:source as typeof source|null};
 const rpc=vi.fn<AccountOriginalRpc>(async()=>({data:structuredClone(receipt),error:null})),abort=new AbortController(),check=vi.fn(async()=>{});
 const readRange=vi.fn(async(_source:unknown,start:number,end:number)=>new Response(Uint8Array.from(raw.subarray(start,end+1)),{
  status:206,headers:{"content-range":`bytes ${start}-${end}/${raw.length}`,"content-length":String(end-start+1)}}));
 return {options:{reference,context,snapshot,rpc,signal:abort.signal,check,readRange},reference,context,snapshot,receipt,source,rpc,abort,check,readRange,raw,decoded};
}
async function collect(stream:ReadableStream<Uint8Array>){const chunks:Uint8Array[]=[],reader=stream.getReader();
 try{for(;;){const next=await reader.read();if(next.done)return Buffer.concat(chunks);chunks.push(next.value);}}
 finally{await reader.cancel().catch(()=>{});reader.releaseLock();}}
async function archive(member:Zip64Member,receipt:string){const rows:Uint8Array[]=[];return collect(createZip64Archive({
 members:(async function*(){yield member;})(),expectedMemberCount:1,expectedPayloadBytes:member.sizeBytes,
 modifiedAt:Date.UTC(2026,9,1),deadline:Date.now()+30_000,signal:new AbortController().signal,authorityReceipt:receipt,
 checkAuthority:async()=>receipt,spool:{append:async row=>{rows.push(row.slice());},replay:()=>new ReadableStream({start(c){for(const row of rows)c.enqueue(row);c.close();}}),dispose:async()=>{}}}));}
function expectExactBuffer(actual:unknown,expected:Buffer){
 expect(actual).not.toBeNull();expect(Buffer.isBuffer(actual)).toBe(true);
 const bytes=actual as Buffer;expect(bytes.byteLength).toBe(expected.byteLength);
 expect(Buffer.prototype.equals.call(bytes,expected)).toBe(true);
}
afterEach(()=>{vi.useRealTimers();vi.restoreAllMocks();});
describe("actual consumed ordinary original member",()=>{
 it.each([false,true])("proves raw and decoded EOF then writes/open verifies the exact original ZIP64 bytes (gzip=%s)",async compressed=>{
  const f=fixture(compressed),result=await prepareAccountOriginalSource(f.options);
  expect(result.member).not.toBeNull();expect(result.provenance).toMatchObject({fileId:f.snapshot.file.id,
   subjectId:f.snapshot.file.subject_id,originalRetired:false,byteIdenticalToUpload:true,rawSha256:hash(f.raw),decodedSha256:hash(f.decoded),sizeBytes:f.raw.length});
  const preparedCalls=f.readRange.mock.calls.length,zip=new AdmZip(await archive(result.member!,f.reference.authorityReceipt));
  expect(zip.getEntries().map(row=>row.entryName)).toEqual([`originals/${f.snapshot.file.id}/original.vcf${compressed?".gz":""}`]);
  expectExactBuffer(zip.readFile(result.member!.name),f.raw);expect(hash(zip.readFile(result.member!.name)!)).toBe(f.source.rawSha256);
  expect(f.readRange).toHaveBeenCalledTimes(preparedCalls*2);
  for(const [,args] of f.rpc.mock.calls)expect(Object.keys(args).sort()).toEqual([
   "p_attempt_id","p_authority_receipt","p_expected","p_export_id","p_file_id","p_operation"]);
  expect(JSON.stringify(result.provenance)).not.toMatch(/sessionId|accountId|objectKey|objectId|storageVersion|bucket|manifestId/);
  expect(f.receipt.source).not.toHaveProperty("manifestId");
 });
 it("refuses a different first or last byte, truncation, extra bytes and a foreign byte container at the exact full-byte assertion",()=>{
  const expected=Buffer.alloc(2_097_159,37),first=Buffer.from(expected),last=Buffer.from(expected);
  first[0]^=1;last[last.length-1]^=1;
  for(const changed of [first,last,expected.subarray(0,-1),Buffer.concat([expected,Buffer.of(37)]),
   Uint8Array.from(expected),null])expect(()=>expectExactBuffer(changed,expected)).toThrow();
  expectExactBuffer(Buffer.from(expected),expected);
 });
 it("uses the real prepared manifest identity without substituting one for a legacy source",async()=>{
  const f=fixture(true,true,4096),result=await prepareAccountOriginalSource(f.options);
  expect(result.member).not.toBeNull();expect(f.receipt.source).toHaveProperty("manifestId",f.snapshot.preparedSource!.manifestId);
  expect(await collect(await result.member!.open(f.abort.signal))).toEqual(f.raw);
 });
 it.each(["foreign-export","foreign-attempt","stale-receipt","foreign-account","foreign-session","foreign-file","foreign-state",
  "foreign-object","changed-key","changed-size","changed-revision","changed-raw-sha","changed-decoded-sha","open","unproved-version","non-v4-version","invented-prepared"])(
  "refuses %s before any original provider read",async failure=>{
   const f=fixture(false,false,16);
   if(failure==="foreign-export")f.receipt.exportId=randomUUID();if(failure==="foreign-attempt")f.receipt.attemptId=randomUUID();
   if(failure==="stale-receipt")f.receipt.authorityReceipt="b".repeat(64);
   if(failure==="foreign-account")f.receipt.actor.accountId=randomUUID();if(failure==="foreign-session")f.receipt.actor.sessionId=randomUUID();
   if(failure==="foreign-file")f.receipt.fileId=randomUUID();if(failure==="foreign-state")f.receipt.state.fileId=randomUUID();
   if(failure==="foreign-object")f.source.objectId=randomUUID();if(failure==="changed-key")f.source.objectKey=randomUUID();
   if(failure==="changed-size")f.source.sizeBytes++;if(failure==="changed-revision")f.source.sourceRevision++;
   if(failure==="changed-raw-sha")f.source.rawSha256="f".repeat(64);if(failure==="changed-decoded-sha")f.receipt.decodedSha256="f".repeat(64);
   if(failure==="open")Object.assign(f.receipt,{jwt:"forbidden"});if(failure==="unproved-version")f.source.storageVersion="invalid";
   if(failure==="non-v4-version")f.source.storageVersion="77900000-0000-1000-8000-000000000021";
   if(failure==="invented-prepared")Object.assign(f.source,{version:"prepared-original-download-v1",manifestId:randomUUID()});
   await expect(prepareAccountOriginalSource(f.options)).rejects.toThrow();expect(f.readRange).not.toHaveBeenCalled();
  });
 it.each(["unselected-file","bound-source","foreign-actor"])("refuses %s locally before the service door",async failure=>{
  const f=fixture();if(failure==="unselected-file")f.context.partitions[0].fileIds=[randomUUID()];
  if(failure==="bound-source")f.context.partitions[0].class="claimed-bound";if(failure==="foreign-actor")f.snapshot.binding.accountId=randomUUID();
  await expect(prepareAccountOriginalSource(f.options)).rejects.toThrow();expect(f.rpc).not.toHaveBeenCalled();expect(f.readRange).not.toHaveBeenCalled();
 });
 it("keeps genuine original retirement explicit and never reads or invents original bytes",async()=>{
  const f=fixture(false,true);f.receipt.state.retired=true;f.receipt.state.expiresAt=new Date(Date.now()-1000).toISOString();f.receipt.source=null;
  const result=await prepareAccountOriginalSource(f.options);expect(result.member).toBeNull();expect(result.provenance).toEqual({fileId:f.snapshot.file.id,
   subjectId:f.snapshot.file.subject_id,originalRetired:true,byteIdenticalToUpload:false,
   warning:"The original retention period has ended. Prepared records and saved reports remain included."});
  expect(f.readRange).not.toHaveBeenCalled();await result.check(f.abort.signal);
  f.rpc.mockResolvedValue({data:null,error:{code:"42501"}});await expect(result.check(f.abort.signal)).rejects.toThrow();
 });
 it("does not convert deletion or missing legacy storage into a retirement warning",async()=>{
  const f=fixture();f.receipt.state.retired=true;f.receipt.source=null;
  await expect(prepareAccountOriginalSource(f.options)).rejects.toThrow();expect(f.readRange).not.toHaveBeenCalled();
  const denied=fixture();denied.rpc.mockResolvedValue({data:null,error:{code:"42501"}});
  await expect(prepareAccountOriginalSource(denied.options)).rejects.toThrow();expect(denied.readRange).not.toHaveBeenCalled();
 });
 it.each(["raw-prefix","decoded-identity","missing-EOF"])("requires complete %s proof before returning a member",async failure=>{
  const f=fixture(true,false,1024);
  if(failure==="raw-prefix")f.readRange.mockImplementation(async()=>new Response(Uint8Array.from(f.raw.subarray(1)),{status:206,headers:{"content-range":`bytes 0-${f.raw.length-1}/${f.raw.length}`}}));
  if(failure==="decoded-identity"){f.snapshot.file.source_sha256="e".repeat(64);f.receipt.decodedSha256="e".repeat(64);}
  if(failure==="missing-EOF")f.readRange.mockImplementation(async()=>new Response(new ReadableStream({start(c){c.enqueue(f.raw);queueMicrotask(()=>f.abort.abort());}}),{status:206,headers:{"content-range":`bytes 0-${f.raw.length-1}/${f.raw.length}`}}));
  await expect(prepareAccountOriginalSource(f.options)).rejects.toThrow();
 });
 it("re-reads current bytes at member open and refuses later corruption instead of serving a retained copy",async()=>{
  const f=fixture(false,false,1024),result=await prepareAccountOriginalSource(f.options);
  f.readRange.mockImplementation(async()=>new Response(new Uint8Array(f.raw.length),{status:206,headers:{"content-range":`bytes 0-${f.raw.length-1}/${f.raw.length}`}}));
  await expect(archive(result.member!,f.reference.authorityReceipt)).rejects.toThrow();
 });
 it("refuses authority loss and expiry before member-open I/O",async()=>{
  const f=fixture(false,false,1024),result=await prepareAccountOriginalSource(f.options),before=f.readRange.mock.calls.length;
  f.check.mockRejectedValue(new Error("revoked"));await expect(result.member!.open(f.abort.signal)).rejects.toThrow();expect(f.readRange).toHaveBeenCalledTimes(before);
  const expired=fixture();expired.source.expiresAt=new Date(Date.now()-1).toISOString();
  await expect(prepareAccountOriginalSource(expired.options)).rejects.toThrow();expect(expired.readRange).not.toHaveBeenCalled();
 });
 it("honors a finished preparation scope and independently cancels actual later source ranges",async()=>{
  const f=fixture(),preparation=new AbortController(),result=await prepareAccountOriginalSource({...f.options,preparationSignal:preparation.signal});
  preparation.abort();const reader=(await result.member!.open(f.abort.signal)).getReader();await reader.read();
  const before=f.readRange.mock.calls.length;await reader.cancel();expect(f.readRange).toHaveBeenCalledTimes(before);reader.releaseLock();
  expect(f.abort.signal.aborted).toBe(false);f.abort.abort();await expect(result.member!.open(new AbortController().signal)).rejects.toThrow();
 });
 it("bounds a nonresponding actual descriptor call and leaves no timer after refusal",async()=>{
  vi.useFakeTimers();const f=fixture();f.rpc.mockImplementation(()=>new Promise(()=>{}));
  const refused=expect(prepareAccountOriginalSource(f.options)).rejects.toThrow();await vi.advanceTimersByTimeAsync(30_001);await refused;
  expect(vi.getTimerCount()).toBe(0);expect(f.readRange).not.toHaveBeenCalled();
 });
});


it("includes a namespaced original only through its exact current receipt and complete raw-byte archive",async()=>{
 const f=fixture(false,false,4096),key=`${f.context.actor.accountId}/${f.snapshot.file.subject_id}/${randomUUID()}/original-${randomUUID()}.vcf`;
 f.source.objectKey=key;f.snapshot.file.bucket_path=key;
 const result=await prepareAccountOriginalSource(f.options);
 expect(await collect(await result.member!.open(f.abort.signal))).toEqual(f.raw);
 expect(JSON.stringify(result.provenance)).not.toContain(key);
 f.source.objectKey=key.replace(/\.vcf$/,".txt");
 await expect(result.check(f.abort.signal)).rejects.toThrow();
});
