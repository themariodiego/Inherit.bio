import {randomUUID} from "node:crypto";
import {afterEach,describe,expect,it,vi} from "vitest";
import {prepareAccountChatMembers} from "./account-chat-members";
import {createAccountContentReader,type AccountContentRpc} from "./account-content-reader";
import type {AccountMemberRpc} from "./bound-account-archive-worker";
const date="2026-10-01T00:00:00.000Z";
async function fixture(total=103){
 const actor={accountId:randomUUID(),sessionId:randomUUID()},self=randomUUID(),other=randomUUID(),abort=new AbortController();
 const reference={exportId:randomUUID(),attemptId:randomUUID(),authorityReceipt:"a".repeat(64)};
 const context={version:"account-archive-members-v1" as const,targetKind:"account" as const,targetId:actor.accountId,
  authorityReceipt:reference.authorityReceipt,deadline:new Date(Date.now()+600000).toISOString(),capturedAt:date,actor,fileCount:0,
  partitions:[self,other].map(subjectId=>({subjectId,class:"ordinary" as const,fileCount:0,fileIds:[]}))};
 const headers=Array.from({length:total},(_,i)=>({id:randomUUID() as string,subject_id:i%2?other:self,scope_kind:"self",created_at:date,message_count:i===0?307:2}))
  .sort((a,b)=>a.id.localeCompare(b.id));
 const messages=new Map(headers.map(row=>[row.id,Array.from({length:row.message_count},(_,i)=>({id:randomUUID(),role:i%2?"assistant":"user",
  content:`Saved synthetic turn${i}`,citations:[{id:"saved-reference",label:"Stored reference",href:"/genome/me/reports/synthetic-report"}],embryoFindings:[],createdAt:date}))]));
 const memberRpc=vi.fn<AccountMemberRpc>(async(_name,args)=>({data:args.p_operation==="context"?structuredClone(context):[],error:null}));
 const contentRpc=vi.fn<AccountContentRpc>(async(_name,args)=>{
  if(args.p_operation==="chats"){
   const rows=headers.filter(h=>h.id>String(args.p_payload.afterChatId??"")).slice(0,100);
   return {data:{chats:structuredClone(rows),nextAfterChatId:rows.length===100?rows.at(-1)!.id:null},error:null};
  }
  const after=Number(args.p_payload.afterOrdinal),rows=messages.get(String(args.p_payload.chatId))!;
  return {data:{messages:structuredClone(rows.slice(after*2,after*2+200)),nextAfterOrdinal:rows.length>after*2+200?after+100:null},error:null};
 });
 const check=vi.fn<(signal:AbortSignal)=>Promise<void>>(async()=>{});
 const reader=await createAccountContentReader({reference,deadline:context.deadline,memberRpc,contentRpc,signal:abort.signal,check});
 return {options:{reader,signal:abort.signal,check},headers,messages,contentRpc,memberRpc,context,abort,check,self,other};
}
async function read(factory:{chunks:(signal:AbortSignal)=>AsyncIterable<Uint8Array>},signal=new AbortController().signal){
 const values=[];for await(const value of factory.chunks(signal)){expect(value.byteLength).toBeLessThanOrEqual(1_048_576);values.push(value);}return JSON.parse(Buffer.concat(values).toString());
}
afterEach(()=>vi.useRealTimers());
describe("actual consumed saved-chat factory",()=>{
 it("exhausts103 headers and a307-message conversation with exact fields in each subject",async()=>{
  const f=await fixture(),prepared=await prepareAccountChatMembers(f.options);let count=0;
  for(const factory of prepared.factories){const actual=await read(factory,f.abort.signal),subject=factory.name.split("/")[1];
   expect(actual.rows).toHaveLength(factory.rows);count+=actual.rows.length;
   for(const row of actual.rows){const original=f.headers.find(h=>h.id===row.id)!;expect(row).toEqual({id:original.id,subject_id:subject,
    scope_kind:"self",created_at:date,messages:f.messages.get(row.id)});}
  }expect(count).toBe(103);
  const longest=f.headers.find(h=>h.message_count===307)!;
  expect(f.contentRpc.mock.calls.filter(([,a])=>a.p_operation==="chat-messages"&&a.p_payload.chatId===longest.id).map(([,a])=>a.p_payload.afterOrdinal))
   .toEqual([0,100,0,100]);
  for(const [,args]of f.contentRpc.mock.calls)expect(JSON.stringify(args)).not.toMatch(/credential|provider|canonical_authority|JWT/u);
 });
 it("rejects a duplicate message ID across distinct pages even when total count is unchanged",async()=>{
  const f=await fixture(1),rows=f.messages.get(f.headers[0].id)!;rows[200].id=rows[0].id;
  await expect(prepareAccountChatMembers(f.options)).rejects.toThrow();
 });
 it("proves actual empty selection without inventing a conversation",async()=>{
  const f=await fixture(0),prepared=await prepareAccountChatMembers(f.options);
  for(const factory of prepared.factories){expect(factory.rows).toBe(0);expect((await read(factory)).rows).toEqual([]);}
  expect(f.contentRpc.mock.calls.every(([,a])=>a.p_operation==="chats")).toBe(true);
 });
 it.each(["changed-message","missing-message","extra-message","private-field","wrong-citation","embryo-finding"])("refuses %s before a complete member",async fault=>{
  const f=await fixture(1),prepared=await prepareAccountChatMembers(f.options),rows=f.messages.get(f.headers[0].id)!;
  if(fault==="changed-message")rows[0].content="Changed saved result";
  if(fault==="missing-message")rows.pop();if(fault==="extra-message")rows.push({...rows[0],id:randomUUID()});
  if(fault==="private-field")Object.assign(rows[0],{canonical_projection:{secret:"withheld"}});
  if(fault==="wrong-citation")rows[0].citations[0].href="/api/provider/private";
  if(fault==="embryo-finding")Object.assign(rows[0],{embryoFindings:[{private:"no"}]});
  await expect(read(prepared.factories[0])).rejects.toThrow();
 });
 it.each(["foreign-subject","private-header","duplicate-header","wrong-cursor"])("refuses %s during source capture",async fault=>{
  const f=await fixture(2);if(fault==="foreign-subject")f.headers[0].subject_id=randomUUID();
  if(fault==="private-header")Object.assign(f.headers[0],{credentialFingerprint:"withheld"});
  if(fault==="duplicate-header")f.headers[1]=structuredClone(f.headers[0]);
  if(fault==="wrong-cursor"){const original=f.contentRpc.getMockImplementation()!;f.contentRpc.mockImplementation(async(...args)=>{
   const result=await original(...args);if(args[1].p_operation==="chats")Object.assign(result.data as Record<string,unknown>,{nextAfterChatId:f.headers[0].id});return result;});}
  await expect(prepareAccountChatMembers(f.options)).rejects.toThrow();
 });
 it("refuses changed header membership and current revocation before subsequent bytes",async()=>{
  const f=await fixture(2),prepared=await prepareAccountChatMembers(f.options);f.headers.pop();await expect(read(prepared.factories[0])).rejects.toThrow();
  const current=await fixture(1),members=await prepareAccountChatMembers(current.options),before=current.contentRpc.mock.calls.length;
  current.check.mockRejectedValue(new Error("revoked"));await expect(read(members.factories[0])).rejects.toThrow();
  expect(current.contentRpc.mock.calls.length).toBe(before);
 });
 it("retains cancellation and the original30-second authority-operation bound",async()=>{
  const f=await fixture(1);f.abort.abort();await expect(prepareAccountChatMembers(f.options)).rejects.toThrow();expect(f.contentRpc).not.toHaveBeenCalled();
  vi.useFakeTimers();const stalled=await fixture(1);stalled.check.mockImplementation(()=>new Promise<void>(()=>{}));
  const refused=expect(prepareAccountChatMembers(stalled.options)).rejects.toThrow();await vi.advanceTimersByTimeAsync(30_001);await refused;
 });
});
