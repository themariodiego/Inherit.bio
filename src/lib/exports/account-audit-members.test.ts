import {randomUUID} from "node:crypto";
import {describe,expect,it,vi} from "vitest";
import {prepareAccountArchiveAuditMembers,ordinarySubjectAuditSchema,ORDINARY_SUBJECT_AUDIT_NOTE,type AccountAuditRpc} from "./account-audit-members";
import type {accountArchiveContextSchema} from "./bound-account-archive-worker";
import type {z} from "zod";
const date="2026-09-28T16:00:00.000Z",receipt="a".repeat(64);
const event=(seq:number)=>({seq,occurred_at:date,event_code:"purpose.granted",route_id:"api.consents",
 outcome_code:"accepted",coded_context:{purpose:"ancestry",revision:1}});
function fixture(total=1003){
 const actor={accountId:randomUUID(),sessionId:randomUUID()};
 const context:z.infer<typeof accountArchiveContextSchema>={version:"account-archive-members-v1",targetKind:"account",targetId:actor.accountId,
  authorityReceipt:receipt,deadline:new Date(Date.now()+600000).toISOString(),capturedAt:date,actor,fileCount:0,
  partitions:[0,1].map(()=>({subjectId:randomUUID(),class:"ordinary",fileCount:0,fileIds:[]}))};
 const snapshot={version:"account-archive-audit-v1",authorityReceipt:receipt,attributionStartedAt:date,eventCount:total};
 const events=Array.from({length:total},(_,n)=>event(n*2+1)),check=vi.fn(async()=>{});
 const rpc=vi.fn<AccountAuditRpc>(async(name,args)=>{
  expect(name).toBe("export_archive_account_audit_v1");expect(args.p_authority_receipt).toBe(receipt);
  if(args.p_operation==="context")return {data:structuredClone(snapshot),error:null};
  if(args.p_operation==="ordinary-subject"){
   if(!context.partitions.some(part=>part.subjectId===args.p_subject_id&&part.class==="ordinary"))return {data:null,error:{code:"42501"}};
   return {data:{schema_version:"legal-audit-v1",attribution:"unrecorded",attribution_started_at:null,note:ORDINARY_SUBJECT_AUDIT_NOTE,events:[]},error:null};
  }
  const rows=events.filter(row=>row.seq>(args.p_after_seq??0)).slice(0,500);
  return {data:{events:structuredClone(rows),nextAfterSeq:rows.length===500?rows.at(-1)!.seq:null},error:null};
 });
 const options={reference:{exportId:randomUUID(),attemptId:randomUUID(),authorityReceipt:receipt},context,rpc,check,signal:new AbortController().signal};
 return {options,rpc,events,snapshot,context,check};
}
async function read(factory:Awaited<ReturnType<typeof prepareAccountArchiveAuditMembers>>[number],signal=new AbortController().signal){
 const chunks=[];for await(const bytes of factory.chunks(signal))chunks.push(bytes);return JSON.parse(Buffer.concat(chunks).toString());
}
describe("actual account actor ledger and unrecorded ordinary targeting",()=>{
 it("emits all nonempty paged actor events once globally and never copies or invents subject events",async()=>{
  const f=fixture(),members=await prepareAccountArchiveAuditMembers(f.options);
  expect(members.map(row=>row.name)).toEqual([...f.context.partitions.map(row=>`subjects/${row.subjectId}/audit-log.json`),"legal-audit.json"]);
  const global=await read(members.at(-1)!);expect(global.events).toEqual(f.events);expect(new Set(global.events.map((row:{seq:number})=>row.seq)).size).toBe(1003);
  expect(global.attribution_started_at).toBe(date);
  for(const member of members.slice(0,-1)){
   expect(member.rows).toBe(0);const data=await read(member);expect(ordinarySubjectAuditSchema.parse(data)).toEqual({schema_version:"legal-audit-v1",
    attribution:"unrecorded",attribution_started_at:null,note:ORDINARY_SUBJECT_AUDIT_NOTE,events:[]});
   expect(data).not.toHaveProperty("eventCount");expect(data.note).toContain("does not mean that nothing happened");
  }
  expect(members.at(-1)!.rows).toBe(1003);expect(f.rpc.mock.calls.filter(([,args])=>args.p_operation==="events").map(([,args])=>args.p_after_seq)).toEqual([null,999,1999]);
  expect(f.check).toHaveBeenCalled();
 });
 it("preserves an empty actual account slice without claiming no historical action",async()=>{
  const f=fixture(0),members=await prepareAccountArchiveAuditMembers(f.options),global=await read(members.at(-1)!);
  expect(global.events).toEqual([]);expect(global.note).toContain("not because nothing happened");
 });
 it.each(["audit_principal_id","row_hash","previous_hash","subject_id"])("refuses leaked %s rather than dropping it",async field=>{
  const f=fixture(2);Object.assign(f.events[0],{[field]:randomUUID()});const members=await prepareAccountArchiveAuditMembers(f.options);
  await expect(read(members.at(-1)!)).rejects.toThrow();
 });
 it.each(["lost-event","extra-event","duplicate","wrong-cursor","unsafe-seq"])("refuses %s without completing an understated member",async kind=>{
  const f=fixture(1003),members=await prepareAccountArchiveAuditMembers(f.options);
  if(kind==="lost-event")f.events.pop();if(kind==="extra-event")f.events.push(event(9999));
  if(kind==="unsafe-seq")f.events[1].seq=Number.MAX_SAFE_INTEGER+1;
  const actual=f.rpc.getMockImplementation()!;
  if(kind==="duplicate"||kind==="wrong-cursor")f.rpc.mockImplementation(async(...args)=>{
   const reply=await actual(...args);if(args[1].p_operation==="events"){
    const value=reply.data as {events:ReturnType<typeof event>[];nextAfterSeq:number|null};
    if(kind==="duplicate"&&args[1].p_after_seq!==null)value.events[0]=event(1);
    if(kind==="wrong-cursor")value.nextAfterSeq=5;
   }return reply;
  });
  await expect(read(members.at(-1)!)).rejects.toThrow();
 });
 it("refuses the old full-graph receipt when the actual global ledger changes before member EOF",async()=>{
  const f=fixture(2),members=await prepareAccountArchiveAuditMembers(f.options);const actual=f.rpc.getMockImplementation()!;
  f.rpc.mockImplementation(async(...args)=>{const reply=await actual(...args);if(args[1].p_operation==="events")f.snapshot.eventCount++;return reply;});
  await expect(read(members.at(-1)!)).rejects.toThrow();
 });
 it("never treats an issued assigned subject selector as ordinary legacy absence",async()=>{
  const f=fixture(1),members=await prepareAccountArchiveAuditMembers(f.options);
  const actual=f.rpc.getMockImplementation()!;f.rpc.mockImplementation(async(...args)=>args[1].p_operation==="ordinary-subject"?
   {data:{schema_version:"legal-audit-v1",attribution:"assigned",attribution_started_at:date,note:ORDINARY_SUBJECT_AUDIT_NOTE,events:[]},error:null}:actual(...args));
  await expect(read(members[0])).rejects.toThrow();
 });
 it("leaves genuine claimed-bound partitions to their exact assigned reader",async()=>{
  const f=fixture(1);f.context.partitions[1].class="claimed-bound";
  const members=await prepareAccountArchiveAuditMembers(f.options);expect(members).toHaveLength(2);
  expect(f.rpc.mock.calls.filter(([,args])=>args.p_operation==="ordinary-subject").map(([,args])=>args.p_subject_id)).toEqual([f.context.partitions[0].subjectId]);
 });
 it("propagates actual service reader refusal without dropping foreign or service events in application code",async()=>{
  const f=fixture(2);const actual=f.rpc.getMockImplementation()!;
  f.rpc.mockImplementation(async(...args)=>args[1].p_operation==="events"?{data:null,error:{code:"42501"}}:actual(...args));
  const members=await prepareAccountArchiveAuditMembers(f.options);await expect(read(members.at(-1)!)).rejects.toThrow();
 });
 it("refuses authority loss after page read before releasing its content",async()=>{
  const f=fixture(2),members=await prepareAccountArchiveAuditMembers(f.options);let revoked=false;const actual=f.rpc.getMockImplementation()!;
  f.rpc.mockImplementation(async(...args)=>{const reply=await actual(...args);if(args[1].p_operation==="events")revoked=true;return reply;});
  f.check.mockImplementation(async()=>{if(revoked)throw new Error("revoked");});
  await expect(read(members.at(-1)!)).rejects.toThrow();
 });
});
