import {createHash,randomUUID} from "node:crypto";
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

// The one-record export also carries the record's family group conversation
// turns (20261023110000, owner decision of 23 October 2026): the server's
// projection pages them under a membership bound into the job's receipt.
async function subjectFixture(turnCount=30){
 const actor={accountId:randomUUID(),sessionId:randomUUID()},self=randomUUID(),abort=new AbortController();
 const reference={exportId:randomUUID(),attemptId:randomUUID(),authorityReceipt:"b".repeat(64)};
 const context={version:"account-archive-members-v1" as const,targetKind:"subject" as const,targetId:self,
  authorityReceipt:reference.authorityReceipt,deadline:new Date(Date.now()+600000).toISOString(),capturedAt:date,actor,fileCount:0,
  partitions:[{subjectId:self,class:"ordinary" as const,fileCount:0,fileIds:[]}]};
 const own={id:randomUUID(),subject_id:self,scope_kind:"self",created_at:date,message_count:2};
 const ownMessages=[0,1].map(i=>({id:randomUUID(),role:i?"assistant":"user",content:`Own turn ${i}`,citations:[],embryoFindings:[],createdAt:date}));
 const chats=[randomUUID(),randomUUID()].sort();
 const turns=Array.from({length:turnCount},(_,i)=>{const chat=chats[i<20?0:1],ordinal=Math.floor((i<20?i:i-20)/2)+1,role=i%2?"assistant":"user";
  return {key:[chat,ordinal,i%2] as [string,number,number],row:{chat_id:chat,chat_created_at:date,id:randomUUID(),role,content:`Family turn ${i}`,
   citations:role==="assistant"?[{label:"Shared by a relative"},{id:"pmid:12345678",label:"Synthetic study",href:"https://pubmed.ncbi.nlm.nih.gov/12345678/"}]:[],
   created_at:date} as Record<string,unknown>};});
 const membership=()=>{let digest=createHash("sha256").update("account-family-turns-v1").digest();
  for(const t of turns)digest=createHash("sha256").update(digest).update(`${JSON.stringify(t.key)}:${JSON.stringify(t.row)}\n`).digest();
  return {version:"account-family-turns-v1",rows:turns.length,membershipSha256:digest.toString("hex")};};
 let captured=membership();
 const memberRpc=vi.fn<AccountMemberRpc>(async(_name,args)=>({data:args.p_operation==="context"?structuredClone(context):[],error:null}));
 const contentRpc=vi.fn<AccountContentRpc>(async(_name,args)=>{
  if(args.p_operation==="chats")return {data:{chats:[structuredClone(own)],nextAfterChatId:null},error:null};
  if(args.p_operation==="chat-messages")return {data:{messages:structuredClone(ownMessages),nextAfterOrdinal:null},error:null};
  if(args.p_operation!=="family-turns")throw new Error("unexpected operation");
  const after=args.p_payload.afterKey as [string,number,number]|null,cmp=(a:[string,number,number],b:[string,number,number])=>a[0]!==b[0]?(a[0]<b[0]?-1:1):a[1]!==b[1]?a[1]-b[1]:a[2]-b[2];
  const rows=turns.filter(t=>after===null||cmp(t.key,after)>0).slice(0,25);
  return {data:{version:"account-family-turns-page-v1",membership:structuredClone(captured),
   rows:rows.map(t=>({identity:JSON.stringify(t.key),rowText:JSON.stringify(t.row)})),nextAfterKey:rows.length===25?rows.at(-1)!.key:null},error:null};
 });
 const check=vi.fn<(signal:AbortSignal)=>Promise<void>>(async()=>{});
 const reader=await createAccountContentReader({reference,deadline:context.deadline,memberRpc,contentRpc,signal:abort.signal,check});
 return {options:{reader,signal:abort.signal,check},turns,chats,own,ownMessages,contentRpc,self,abort,
  recapture:()=>{captured=membership();},setMembership:(value:typeof captured)=>{captured=value;}};
}
describe("a one-record export's family group conversations",()=>{
 it("files every current turn of each conversation in the record's chats.json, after its own chats, with the written fields only",async()=>{
  const f=await subjectFixture(),prepared=await prepareAccountChatMembers(f.options);
  expect(prepared.factories.map(x=>x.name)).toEqual([`subjects/${f.self}/chats.json`]);expect(prepared.factories[0].rows).toBe(3);
  const actual=await read(prepared.factories[0],f.abort.signal);
  expect(actual.rows).toHaveLength(3);
  expect(actual.rows[0]).toEqual({...f.own,messages:f.ownMessages,message_count:undefined});
  for(const [i,chat] of f.chats.entries()){
   const expected=f.turns.filter(t=>t.row.chat_id===chat).map(t=>({id:t.row.id,role:t.row.role,content:t.row.content,citations:t.row.citations,createdAt:date}));
   expect(actual.rows[i+1]).toEqual({id:chat,subject_id:null,scope_kind:"family",created_at:date,messages:expected});
  }
  const text=JSON.stringify(actual);for(const forbidden of ["turn_ordinal","chat_created_at","retrieved",f.options.reader.context.actor.accountId])expect(text).not.toContain(forbidden);
  // Thirty rows are two pages of 25, read once to capture and once to write.
  expect(f.contentRpc.mock.calls.filter(([,a])=>a.p_operation==="family-turns").map(([,a])=>a.p_payload.afterKey===null)).toEqual([true,false,true,false]);
 });
 it("never asks for family turns in a whole-account export",async()=>{
  const f=await fixture(2);await prepareAccountChatMembers(f.options);
  expect(f.contentRpc.mock.calls.some(([,a])=>a.p_operation==="family-turns")).toBe(false);
 });
 it("proves an empty selection without inventing a conversation",async()=>{
  const f=await subjectFixture(0),prepared=await prepareAccountChatMembers(f.options);
  expect(prepared.factories[0].rows).toBe(1);expect((await read(prepared.factories[0])).rows).toHaveLength(1);
 });
 it.each(["changed-turn","missing-turn","extra-turn","withheld-field","record-citation","role-key","membership-change"])("refuses %s",async fault=>{
  const f=await subjectFixture(4);
  if(fault==="membership-change"){const prepared=await prepareAccountChatMembers(f.options);f.turns.pop();f.recapture();
   await expect(read(prepared.factories[0])).rejects.toThrow();return;}
  if(fault==="changed-turn")f.turns[1].row.content="Changed answer";
  if(fault==="missing-turn")f.turns.pop();
  if(fault==="extra-turn")f.turns.push({key:[f.chats[0],9,0],row:{...f.turns[0].row,id:randomUUID()}});
  if(fault==="withheld-field")Object.assign(f.turns[0].row,{turn_ordinal:1});
  if(fault==="record-citation")(f.turns[1].row.citations as Record<string,unknown>[])[0]={label:"Shared",id:`person:s-${randomUUID()}`};
  if(fault==="role-key")f.turns[0].key[2]=1;
  if(fault!=="changed-turn"&&fault!=="missing-turn"&&fault!=="extra-turn"){f.recapture();}
  await expect(prepareAccountChatMembers(f.options)).rejects.toThrow();
 });
});
