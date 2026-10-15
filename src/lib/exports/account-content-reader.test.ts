import {createHash,randomUUID} from "node:crypto";
import {describe,expect,it,vi} from "vitest";
import {createAccountContentReader,type AccountContentRpc} from "./account-content-reader";
import type {AccountMemberRpc,accountArchiveContextSchema} from "./bound-account-archive-worker";
import type {OwnExportSnapshot} from "./own-subject-content";
import type {z} from "zod";
function fixture(count=1){
 const actor={accountId:randomUUID(),sessionId:randomUUID()},subjectId=randomUUID(),boundSubject=randomUUID(),boundFile=randomUUID();
 const reference={exportId:randomUUID(),attemptId:randomUUID(),authorityReceipt:"a".repeat(64)},deadline=new Date(Date.now()+600000).toISOString();
 const files:OwnExportSnapshot[]=Array.from({length:count},()=>({file:{id:randomUUID(),subject_id:subjectId,original_name:"Synthetic source",
  file_type:"vcf",tier:1 as const,size_bytes:3,sha256:createHash("sha256").update("ABC").digest("hex"),source_sha256:createHash("sha256").update("ABC").digest("hex"),
  status:"stored",build:"GRCh38",created_at:"2026-10-01T00:00:00.000Z",variant_count:1,bucket_path:randomUUID(),storage_object_id:randomUUID(),upload_revision:1},
  binding:{...actor,accountRevision:1,authSessionRevision:1,sessionRevision:1,subjectBindingRevision:1,lifecycleRevision:1,
   accountBindingId:randomUUID(),accountBindingRevision:1,subjectPrincipalId:randomUUID(),subjectPrincipalRevision:1,
   accountPrincipalId:randomUUID(),accountPrincipalRevision:1,normalizedAt:"2026-10-01T00:00:00.000Z"},normalized:true})).sort((a,b)=>a.file.id.localeCompare(b.file.id));
 const context:z.infer<typeof accountArchiveContextSchema>={version:"account-archive-members-v1",targetKind:"account",targetId:actor.accountId,
  authorityReceipt:reference.authorityReceipt,deadline,capturedAt:"2026-10-01T00:00:00.000Z",actor,fileCount:count+1,
  partitions:[{subjectId,class:"ordinary",fileCount:count,fileIds:files.map(f=>f.file.id)},
   {subjectId:boundSubject,class:"claimed-bound",fileCount:1,fileIds:[boundFile]}]};
 const memberRpc=vi.fn<AccountMemberRpc>(async(_name,args)=>({data:args.p_operation==="context"?structuredClone(context):
  structuredClone(files.filter(file=>file.file.id>(args.p_after_id??"")).slice(0,100)),error:null}));
 const contentRpc=vi.fn<AccountContentRpc>(async(_name,args)=>({data:args.p_operation==="check"?structuredClone(args.p_payload.snapshot):
  args.p_operation==="variants"&&args.p_payload.offset===0?[{rsid:1,chrom:1,pos:1000,ref:"A",alt:"G",genotype:"A/G"}]:[],error:null}));
 const check=vi.fn(async()=>{}),abort=new AbortController();
 const options={reference,deadline,memberRpc,contentRpc,signal:abort.signal,check};
 return {options,context,files,actor,reference,memberRpc,contentRpc,check,abort};
}
describe("consumed-account complete ordinary source composition",()=>{
 it("enumerates all ordinary files across100-row pages and retains bound files for their separate reader",async()=>{
  const f=fixture(207),reader=await createAccountContentReader(f.options);
  expect(reader.files).toEqual(f.files);expect(reader.context).toEqual(f.context);
  expect(f.memberRpc.mock.calls.filter(([,a])=>a.p_operation==="ordinary-files").map(([,a])=>a.p_after_id))
   .toEqual([null,f.files[99].file.id,f.files[199].file.id,f.files[206].file.id]);
  const rows=[];for await(const page of reader.own.variants(reader.files[0]))rows.push(...page);
  expect(rows).toEqual([{rsid:1,chrom:1,pos:1000,ref:"A",alt:"G",genotype:"A/G"}]);
  expect(f.contentRpc.mock.calls.map(([name,a])=>({name,...a}))).toEqual([0,1].map(offset=>({
   name:"export_archive_account_content_v1",p_operation:"variants",p_export_id:f.reference.exportId,p_attempt_id:f.reference.attemptId,
   p_authority_receipt:f.reference.authorityReceipt,p_payload:{fileId:f.files[0].file.id,snapshot:f.files[0],offset}})));
  for(const [,args] of f.contentRpc.mock.calls)expect(JSON.stringify(args)).not.toContain('"p_account_id"');
  expect(f.check).toHaveBeenCalled();
 });
 it("accepts a genuinely empty ordinary partition without fabricating a source",async()=>{
  const f=fixture(0),reader=await createAccountContentReader(f.options);expect(reader.files).toEqual([]);
  expect(f.contentRpc).not.toHaveBeenCalled();
 });
 it.each(["missing-file","extra-file","duplicate","wrong-subject","foreign-account","foreign-session","stale-receipt","changed-deadline"])(
 "refuses %s before a content page is read",async kind=>{
  const f=fixture(2),original=f.memberRpc.getMockImplementation()!;
  if(kind==="missing-file")f.files.pop();
  if(kind==="wrong-subject")f.files[0].file.subject_id=randomUUID();
  if(kind==="foreign-account")f.files[0].binding.accountId=randomUUID();if(kind==="foreign-session")f.files[0].binding.sessionId=randomUUID();
  if(kind==="stale-receipt")f.context.authorityReceipt="b".repeat(64);
  if(kind==="changed-deadline")f.context.deadline=new Date(Date.now()+100000).toISOString();
  f.memberRpc.mockImplementation(async(...args)=>{const reply=await original(...args);
   if(args[1].p_operation==="ordinary-files"&&args[1].p_after_id===null){const data=reply.data as OwnExportSnapshot[];
    if(kind==="extra-file")data.push({...structuredClone(data[0]),file:{...data[0].file,id:randomUUID()}});
    if(kind==="duplicate")data[1]=structuredClone(data[0]);
   }return reply;
  });
  await expect(createAccountContentReader(f.options)).rejects.toThrow();expect(f.contentRpc).not.toHaveBeenCalled();
 });
 it("refuses a current graph change immediately after a genuine content response",async()=>{
  const f=fixture(),reader=await createAccountContentReader(f.options),original=f.contentRpc.getMockImplementation()!;
  f.contentRpc.mockImplementation(async(...args)=>{const reply=await original(...args);f.context.actor.sessionId=randomUUID();return reply;});
  await expect(reader.own.variants(reader.files[0]).next()).rejects.toThrow();
 });
 it("never admits an unenumerated or altered snapshot as an ordinary source",async()=>{
  const f=fixture(),reader=await createAccountContentReader(f.options);
  const bound={...f.files[0],file:{...f.files[0].file,id:f.context.partitions[1].fileIds[0],subject_id:f.context.partitions[1].subjectId}};
  await expect(reader.own.variants(bound).next()).rejects.toThrow();
  await expect(reader.own.variants({...f.files[0],file:{...f.files[0].file,sha256:"b".repeat(64)}}).next()).rejects.toThrow();
  expect(f.contentRpc).not.toHaveBeenCalled();
 });
 it("refuses cancellation before exhaustive file discovery or any subsequent content read",async()=>{
  const f=fixture();f.abort.abort();await expect(createAccountContentReader(f.options)).rejects.toThrow();
  expect(f.memberRpc).not.toHaveBeenCalled();expect(f.contentRpc).not.toHaveBeenCalled();
  const live=fixture(),reader=await createAccountContentReader(live.options);live.abort.abort();
  await expect(reader.own.variants(reader.files[0]).next()).rejects.toThrow();expect(live.contentRpc).not.toHaveBeenCalled();
 });
 it("refuses an expired real attempt before requesting its current members",async()=>{
  const f=fixture();f.options.deadline=new Date(Date.now()-1000).toISOString();
  await expect(createAccountContentReader(f.options)).rejects.toThrow();expect(f.memberRpc).not.toHaveBeenCalled();
 });
 it("requires the actual completed content page and propagates source/purpose refusal",async()=>{
  const f=fixture(),reader=await createAccountContentReader(f.options);f.contentRpc.mockResolvedValue({data:null,error:{code:"42501"}});
  await expect(reader.own.reports(reader.files[0])).rejects.toThrow();
 });
 it("refuses a revoked durable authority before any subsequent page or prepared-source read",async()=>{
  const f=fixture(),reader=await createAccountContentReader(f.options);f.check.mockRejectedValue(new Error("revoked"));
  await expect(reader.own.variants(reader.files[0]).next()).rejects.toThrow();expect(f.contentRpc).not.toHaveBeenCalled();
 });
});
