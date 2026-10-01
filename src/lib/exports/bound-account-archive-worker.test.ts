import {createHash,randomUUID} from "node:crypto";
import AdmZip from "adm-zip";
import {afterEach,describe,expect,it,vi} from "vitest";
import type {z} from "zod";
import {claimantArchiveFixture} from "./__fixtures__/claimant-archive";
import {boundSourceFixture} from "./__fixtures__/bound-source";
import {buildBoundAccountArchive,accountArchiveContextSchema,type AccountMemberRpc,type AccountBoundSourceRpc} from "./bound-account-archive-worker";
import {claimantAuditMember} from "./claimant-legal-audit";
import {boundClaimantAuditMember} from "./bound-claimant-legal-audit";
afterEach(()=>{vi.unstubAllEnvs();vi.unstubAllGlobals();vi.restoreAllMocks();});
async function fixture(){
 const encoder=new TextEncoder(),header="##fileformat=VCFv4.2\n#CHROM\tPOS\tID\tREF\tALT\tQUAL\tFILTER\tINFO\tFORMAT\tSAMPLE\n";
 const raw=await boundSourceFixture([encoder.encode(header+"1\t1000\t.\tA\tG\t.\tPASS\t.\tGT\t0/1\n"),
  encoder.encode(header+"7\t2000\t.\tC\tT\t.\tPASS\t.\tGT\t0/1\n")]),historical=claimantArchiveFixture();
 historical.options.job.exportId=raw.reference.exportId;
 Object.assign(historical.snapshot.authority,{subjectId:raw.manifest.subjectId,principalId:raw.manifest.claimantPrincipalId});
 Object.assign(historical.snapshot.source,{fileId:raw.manifest.fileId,subjectId:raw.manifest.subjectId,
  sourceSha256:raw.manifest.sourceSha256,membershipSha256:raw.manifest.membershipSha256});
 historical.rows.forEach(row=>row.genotype="0/1");historical.snapshot.membership.legalAuditEvents=1;
 const event={seq:1,occurred_at:"2026-10-01T00:00:00.000Z",event_code:"claimant.account_bound",
  route_id:"api.future-person-claimant-bind",outcome_code:"accepted",coded_context:{}};
 historical.audit.push({id:"1",event});
 const context:z.infer<typeof accountArchiveContextSchema>={version:"account-archive-members-v1",targetKind:"subject",targetId:raw.manifest.subjectId,
  authorityReceipt:historical.options.job.authorityReceipt,deadline:historical.options.job.deadline,capturedAt:"2026-10-01T00:00:00.000Z",
  actor:{accountId:raw.manifest.actor.accountId,sessionId:raw.manifest.actor.sessionId},fileCount:1,
  partitions:[{subjectId:raw.manifest.subjectId,class:"claimed-bound",fileCount:1,fileIds:[raw.manifest.fileId]}]};
 const memberRpc=vi.fn<AccountMemberRpc>(async(name,args,signal)=>{
  expect(name).toBe("export_archive_account_members_v1");expect(args.p_export_id).toBe(historical.options.job.exportId);
  expect(args.p_authority_receipt).toBe(historical.options.job.authorityReceipt);
  expect(args.p_attempt_id).toBe(historical.calls.find(call=>call.p_operation==="begin")!.p_attempt_id);
  raw.reference.attemptId=args.p_attempt_id;raw.reply.attemptId=args.p_attempt_id;
  if(args.p_operation==="context"){expect(args.p_subject_id).toBeNull();return {data:structuredClone(context),error:null};}
  expect(args.p_subject_id).toBe(context.targetId);
  return historical.memberRpc("future_person_export_members_v1",{p_operation:args.p_operation==="bound-context"?"context":args.p_operation as
   Parameters<typeof historical.memberRpc>[1]["p_operation"],p_export_id:args.p_export_id,p_attempt_id:args.p_attempt_id,
   p_authority_receipt:args.p_authority_receipt,p_after_id:args.p_after_id},signal);
 });
 const sourceRpc=vi.fn<AccountBoundSourceRpc>(async(name,args,signal)=>{
  expect(name).toBe("export_archive_account_bound_source_v1");expect(args.p_subject_id).toBe(context.targetId);
  const {p_subject_id,...sourceArgs}=args;void p_subject_id;return raw.rpc("export_archive_bound_source_v1",sourceArgs,signal);
 });
 const options={...historical.options,memberRpc,sourceRpc};return {options,raw,historical,context,event,memberRpc,sourceRpc};
}
describe("complete real bound-account subject archive",()=>{
 it("independently opens every historical member and every actual moved canonical part with exact manifest hashes",async()=>{
  const f=await fixture(),result=await buildBoundAccountArchive(f.options),all=Buffer.concat(f.historical.writes),zip=new AdmZip(all);
  expect(result.memberCount).toBe(25);expect(zip.getEntries()).toHaveLength(25);
  const manifest=JSON.parse(zip.readAsText("manifest.json"));expect(manifest.members).toHaveLength(24);
  expect(new Set(manifest.members.map((row:{name:string})=>row.name))).toEqual(new Set(zip.getEntries().filter(row=>row.entryName!=="manifest.json").map(row=>row.entryName)));
  for(const member of manifest.members){const bytes=zip.readFile(member.name)!;expect(bytes.length).toBe(member.sizeBytes);
   expect(createHash("sha256").update(bytes).digest("hex")).toBe(member.sha256);}
  expect(manifest.files[0].byte_identical_to_upload).toBe(false);
  expect(manifest.currentSource).toMatchObject({subjectId:f.context.targetId,fileId:f.raw.manifest.fileId,partCount:2,byteIdenticalToUpload:false});
  for(const [index,part] of manifest.currentSource.parts.entries())expect(zip.readFile(part.name)).toEqual(Buffer.from(f.raw.bytes[index]));
  const prefix=`subjects/${f.context.targetId}/`;
  expect(JSON.parse(zip.readAsText(prefix+"audit-log.json")).events).toEqual([f.event]);
  expect(zip.readAsText(prefix+"reports.txt")).toContain("claimant.account_bound");
  expect(zip.readAsText(prefix+"reports.txt")).toContain("Historical synthetic signer");
  for(const target of f.raw.manifest.parts.map(row=>row.target))for(const forbidden of [target.oldKey,target.newKey,target.oldVersion])expect(all.includes(Buffer.from(forbidden))).toBe(false);
  expect(all.includes(Buffer.from(f.context.actor.sessionId))).toBe(false);
  expect(f.historical.calls.at(-1)?.p_operation).toBe("bytes-complete");
  expect(f.historical.calls.some(call=>String(call.p_operation)==="ready")).toBe(false);
 });
 it("keeps the independent-rights event contract closed while accepting only the exact bound tuple",()=>{
  const value={id:"1",event:{seq:1,occurred_at:"2026-10-01T00:00:00.000Z",event_code:"claimant.account_bound",
   route_id:"api.future-person-claimant-bind",outcome_code:"accepted",coded_context:{}}};
  expect(claimantAuditMember.safeParse(value).success).toBe(false);expect(boundClaimantAuditMember.safeParse(value).success).toBe(true);
  for(const change of [{route_id:"api.future-person-delete"},{outcome_code:"purged"},{coded_context:{contact:"forbidden@e2e.local"}}]){
   expect(boundClaimantAuditMember.safeParse({...value,event:{...value.event,...change}}).success).toBe(false);
  }
 });
 it.each(["whole-account","extra-partition","foreign-file","foreign-subject","duplicate-file","stale-receipt","wrong-deadline","open-context"])("refuses %s before any provider write",async kind=>{
  const f=await fixture();if(kind==="whole-account"){f.context.targetKind="account";f.context.targetId=f.context.actor.accountId;}
  if(kind==="extra-partition"){f.context.partitions.push({subjectId:randomUUID(),class:"ordinary",fileCount:0,fileIds:[]});}
  if(kind==="foreign-file")f.context.partitions[0].fileIds[0]=randomUUID();
  if(kind==="foreign-subject")f.context.partitions[0].subjectId=randomUUID();
  if(kind==="duplicate-file")f.context.partitions[0].fileIds.push(f.context.partitions[0].fileIds[0]);
  if(kind==="stale-receipt")f.context.authorityReceipt="b".repeat(64);
  if(kind==="wrong-deadline")f.context.deadline=new Date(Date.now()+60000).toISOString();
  if(kind==="open-context")Object.assign(f.context,{jwt:"forbidden"});
  await expect(buildBoundAccountArchive(f.options)).rejects.toThrow();expect(f.historical.write).not.toHaveBeenCalled();
  expect(f.historical.calls.some(call=>call.p_operation==="bytes-complete")).toBe(false);
 });
 it.each(["foreign-account","foreign-session","missing-part","truncated","missing-audit"])("refuses %s physical/scientific material before any provider write",async kind=>{
  const f=await fixture();if(kind==="foreign-account")f.context.actor.accountId=randomUUID();
  if(kind==="foreign-session")f.context.actor.sessionId=randomUUID();
  if(kind==="missing-part")f.raw.manifest.parts.pop();
  if(kind==="truncated")f.raw.gateway.values.get(f.raw.manifest.parts[1].target.newKey)!.bytes=new Uint8Array([1]);
  if(kind==="missing-audit")f.historical.audit.length=0;
  await expect(buildBoundAccountArchive(f.options)).rejects.toThrow();expect(f.historical.write).not.toHaveBeenCalled();
  expect(f.historical.calls.some(call=>call.p_operation==="bytes-complete")).toBe(false);
 });
 it("rechecks actual durable context after member reads and retains uncertain attempt cleanup",async()=>{
  const f=await fixture();const original=f.memberRpc.getMockImplementation()!;let contexts=0;
  f.memberRpc.mockImplementation(async(...args)=>{const reply=await original(...args);
   if(args[1].p_operation==="context"&&++contexts===4)f.context.actor.sessionId=randomUUID();return reply;});
  await expect(buildBoundAccountArchive(f.options)).rejects.toThrow();expect(f.historical.write).not.toHaveBeenCalled();
  expect(f.historical.calls.some(call=>call.p_operation==="begin")).toBe(true);
  expect(f.historical.calls.some(call=>call.p_operation==="bytes-complete")).toBe(false);
 });
});
