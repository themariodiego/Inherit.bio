import {randomUUID} from "node:crypto";
import {describe,expect,it,vi} from "vitest";
import {prepareAccountArchiveMetadata,type AccountMetadataRpc} from "./account-member-metadata";
import type {z} from "zod";
import type {accountArchiveContextSchema} from "./bound-account-archive-worker";
import type {OwnExportSnapshot} from "./own-subject-content";
function fixture(fileCount=108,grantCount=1103){
 const actor={accountId:randomUUID(),sessionId:randomUUID()},subjectId=randomUUID(),boundSubject=randomUUID();
 const reference={exportId:randomUUID(),attemptId:randomUUID(),authorityReceipt:"a".repeat(64)};
 const deadline=new Date(Date.now()+600000).toISOString(),date="2026-10-01T00:00:00.000Z";
 const files:OwnExportSnapshot[]=Array.from({length:fileCount},()=>({file:{id:randomUUID(),subject_id:subjectId,
  original_name:"Synthetic source",file_type:"vcf",tier:1 as const,size_bytes:1,sha256:"b".repeat(64),source_sha256:"c".repeat(64),
  status:"stored",build:"GRCh38",created_at:date,variant_count:1,bucket_path:randomUUID(),storage_object_id:randomUUID(),upload_revision:1},
  binding:{...actor,accountRevision:1,authSessionRevision:1,sessionRevision:1,subjectBindingRevision:1,lifecycleRevision:1,
   accountBindingId:randomUUID(),accountBindingRevision:1,subjectPrincipalId:randomUUID(),subjectPrincipalRevision:1,
   accountPrincipalId:randomUUID(),accountPrincipalRevision:1,normalizedAt:date},normalized:true})).sort((a,b)=>a.file.id.localeCompare(b.file.id));
 const context:z.infer<typeof accountArchiveContextSchema>={version:"account-archive-members-v1",targetKind:"account",targetId:actor.accountId,
  authorityReceipt:reference.authorityReceipt,deadline,capturedAt:date,actor,fileCount:fileCount+1,
  partitions:[{subjectId,class:"ordinary",fileCount,fileIds:files.map(f=>f.file.id)},
   {subjectId:boundSubject,class:"claimed-bound",fileCount:1,fileIds:[randomUUID()]}]};
 const counts={profileCount:1,purposeGrantCount:grantCount,fileCount};
 const profiles=[{id:actor.accountId,date_of_birth:"1990-01-01",jurisdiction_code:"GB",jurisdiction_subdivision:null,
  jurisdiction_revision:1,jurisdiction_declared_at:date,jurisdiction_attestation_version:1,jurisdiction_attestation_sha256:"d".repeat(64)}];
 const grants=Array.from({length:grantCount},(_,i)=>({grant_id:randomUUID(),grant_revision:1,target_kind:"subject",target_id:i%2?subjectId:boundSubject,
  purpose:"reports.polygenic",artifact_key:"consent.own-polygenic",artifact_version:2,artifact_body_sha256:"e".repeat(64),signature_id:randomUUID(),
  signer_principal_id:randomUUID(),data_subject_principal_id:randomUUID(),subject_binding_revision:1,jurisdiction_code:"GB",jurisdiction_revision:1,
  granted_at:date,expires_at:null,revoked_at:null,revocation_reason:null})).sort((a,b)=>a.grant_id.localeCompare(b.grant_id));
 const clocks=files.map(file=>({fileId:file.file.id,subjectId:file.file.subject_id,revision:3,variantCount:1,observedCallCount:2}));
 const rpc=vi.fn<AccountMetadataRpc>(async(_name,args)=>({error:null,data:{version:"account-archive-metadata-v1",operation:args.p_operation,
  rows:structuredClone(args.p_operation==="context"?[counts]:args.p_operation==="profile"?profiles:
   args.p_operation==="purpose-grants"?grants.filter(g=>g.grant_id>(args.p_after_id??"")).slice(0,500):
   clocks.filter(f=>f.fileId>(args.p_after_id??"")).slice(0,100))}}));
 const check=vi.fn(async()=>{}),abort=new AbortController();
 return {options:{reference,context,files,rpc,signal:abort.signal,check},context,files,profiles,grants,clocks,counts,rpc,check,abort};
}
describe("complete consumed-account member metadata",()=>{
 it("reads all 1103 own grants and 108 file clocks with exact counts and closed pages",async()=>{
  const f=fixture(),result=await prepareAccountArchiveMetadata(f.options);
  expect(result.profiles).toEqual(f.profiles);expect(result.purposeGrants).toEqual(f.grants);expect(result.fileCounts).toEqual(f.clocks);
  expect(f.rpc.mock.calls.filter(([,a])=>a.p_operation==="purpose-grants").map(([,a])=>a.p_after_id))
   .toEqual([null,f.grants[499].grant_id,f.grants[999].grant_id,f.grants[1102].grant_id]);
  expect(f.rpc.mock.calls.filter(([,a])=>a.p_operation==="legacy-counts").map(([,a])=>a.p_after_id))
   .toEqual([null,f.clocks[99].fileId,f.clocks[107].fileId]);
  for(const [,args] of f.rpc.mock.calls)expect(Object.keys(args).sort()).toEqual(["p_after_id","p_attempt_id","p_authority_receipt","p_export_id","p_operation"]);
  expect(f.check).toHaveBeenCalled();
 });
 it("accepts genuinely empty ordinary file/grant sets while preserving a separately authorized bound partition",async()=>{
  const f=fixture(0,0),result=await prepareAccountArchiveMetadata(f.options);
  expect(result.purposeGrants).toEqual([]);expect(result.fileCounts).toEqual([]);expect(result.profiles).toEqual(f.profiles);
 });
 it.each(["missing-grant","duplicate-grant","foreign-grant","missing-file","foreign-file","wrong-subject","zero-clock","unsafe-clock","variant-count",
  "profile-leak","foreign-profile","context-omission","extra-context","stale-count"])("refuses %s",async kind=>{
  const f=fixture(2,3),base=f.rpc.getMockImplementation()!;
  if(kind==="missing-grant")f.grants.pop();if(kind==="duplicate-grant")f.grants[1]=structuredClone(f.grants[0]);
  if(kind==="foreign-grant")f.grants[0].target_id=randomUUID();if(kind==="missing-file")f.clocks.pop();
  if(kind==="foreign-file")f.clocks[0].fileId=randomUUID();if(kind==="wrong-subject")f.clocks[0].subjectId=randomUUID();
  if(kind==="zero-clock")f.clocks[0].revision=0;if(kind==="unsafe-clock")f.clocks[0].revision=Number.MAX_SAFE_INTEGER+1;
  if(kind==="variant-count")f.clocks[0].variantCount=2;if(kind==="foreign-profile")f.profiles[0].id=randomUUID();
  if(kind==="profile-leak")Object.assign(f.profiles[0],{email:"foreign@example.e2e.local"});
  if(kind==="stale-count")f.counts.purposeGrantCount++;
  f.rpc.mockImplementation(async(...args)=>{const result=await base(...args);const data=result.data as {rows:unknown[]};
   if(args[1].p_operation==="context"){
    if(kind==="context-omission")data.rows=[];if(kind==="extra-context")data.rows.push(structuredClone(data.rows[0]));
   }return result;});
  await expect(prepareAccountArchiveMetadata(f.options)).rejects.toThrow();
 });
 it("refuses orphaned legacy calls when the actual file is unnormalized",async()=>{
  const f=fixture(1,0);f.files[0].normalized=false;
  await expect(prepareAccountArchiveMetadata(f.options)).rejects.toThrow();
 });
 it("cannot adopt a changed current count while paging",async()=>{
  const f=fixture(),base=f.rpc.getMockImplementation()!;
  f.rpc.mockImplementation(async(...args)=>{const response=await base(...args);
   if(args[1].p_operation==="purpose-grants")f.counts.purposeGrantCount++;return response;});
  await expect(prepareAccountArchiveMetadata(f.options)).rejects.toThrow();
 });
 it("refuses revoked real durable authority before reading any next page",async()=>{
  const f=fixture(),base=f.rpc.getMockImplementation()!;
  f.rpc.mockImplementation(async(...args)=>{const response=await base(...args);if(args[1].p_operation==="profile")f.check.mockRejectedValue(new Error("revoked"));return response;});
  await expect(prepareAccountArchiveMetadata(f.options)).rejects.toThrow("revoked");
  expect(f.rpc.mock.calls.some(([,a])=>a.p_operation==="purpose-grants")).toBe(false);
 });
 it("still rechecks actual current count authority after preparation, and refuses abort",async()=>{
  const f=fixture(1,0),result=await prepareAccountArchiveMetadata(f.options);f.counts.purposeGrantCount++;
  await expect(result.check(f.abort.signal)).rejects.toThrow();
  f.abort.abort();await expect(result.check(f.abort.signal)).rejects.toThrow();
 });
 it("refuses an expired actual request before issuing a metadata RPC",async()=>{
  const f=fixture(1,0);f.context.deadline=new Date(Date.now()-1).toISOString();
  await expect(prepareAccountArchiveMetadata(f.options)).rejects.toThrow();
  expect(f.rpc).not.toHaveBeenCalled();
 });
 it("bounds an unresponsive metadata transport and aborts its real supplied signal",async()=>{
  vi.useFakeTimers();
  try{
   const f=fixture(1,0),seen:AbortSignal[]=[];
   f.rpc.mockImplementation(async(_name,_args,signal)=>{seen.push(signal);return await new Promise(()=>{});});
   const result=expect(prepareAccountArchiveMetadata(f.options)).rejects.toThrow("account_archive_metadata_unavailable");
   await vi.advanceTimersByTimeAsync(30_000);await result;
   expect(seen).toHaveLength(1);expect(seen[0].aborted).toBe(true);
  }finally{vi.useRealTimers();}
 });
 it("propagates caller cancellation during a genuine outstanding transport",async()=>{
  const f=fixture(1,0),seen:AbortSignal[]=[];
  f.rpc.mockImplementation(async(_name,_args,signal)=>{seen.push(signal);f.abort.abort();return await new Promise(()=>{});});
  await expect(prepareAccountArchiveMetadata(f.options)).rejects.toThrow("account_archive_metadata_unavailable");
  expect(seen).toHaveLength(1);expect(seen[0].aborted).toBe(true);
 });
});
