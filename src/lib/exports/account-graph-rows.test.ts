import {createHash,randomUUID} from "node:crypto";
import {afterEach,describe,expect,it,vi} from "vitest";
import {prepareAccountGraphRows,type AccountGraphRpc} from "./account-graph-rows";
import {projectAccountGraphRow} from "./account-graph-projection";
const date="2026-10-01T00:00:00Z";
function fixture(total=1003){
 const account=randomUUID(),principal=randomUUID(),cohort=randomUUID(),subject=randomUUID(),abort=new AbortController();
 const reference={exportId:randomUUID(),attemptId:randomUUID(),authorityReceipt:"a".repeat(64)};
 const context={version:"account-archive-members-v1" as const,targetKind:"account" as const,targetId:account,authorityReceipt:reference.authorityReceipt,
  deadline:new Date(Date.now()+600000).toISOString(),capturedAt:date,actor:{accountId:account,sessionId:randomUUID()},fileCount:0,
  partitions:[{subjectId:subject,class:"ordinary" as const,fileCount:0,fileIds:[] as string[]}]};
 const source=Array.from({length:total},(_,i)=>projectAccountGraphRow("embryo_participant_sets",{
  cohort_id:cohort,set_kind:"disposition_authorities",principal_id:principal,membership_revision:i+1,set_revision:2,created_at:date,revoked_at:date},account,[principal]));
 // Deliberately use a different physical JSON field order. Membership hashes
 // bind exact raw SQL-projected text, not a newly serialized parsed DTO.
 const rows=source.map(value=>({identity:value.identity,rowText:JSON.stringify(Object.fromEntries(Object.entries(value.row).reverse()))}));
 let digest=createHash("sha256").update("account-graph-source-v1|embryo_participant_sets").digest();
 for(const row of rows)digest=createHash("sha256").update(digest).update(`${row.identity}:${row.rowText}\n`).digest();
 const membership={rows:rows.length,sha256:digest.toString("hex")},check=vi.fn<(signal:AbortSignal)=>Promise<void>>(async()=>{});
 const response=(after:(string|number)[]|null)=>{const offset=after?Number(after[3]):0,selected=rows.slice(offset,offset+500);
  return {version:"account-graph-page-v1",kind:"embryo_participant_sets",authorityReceipt:reference.authorityReceipt,membership:structuredClone(membership),
   rows:structuredClone(selected),nextAfterKey:selected.length===500?JSON.parse(selected.at(-1)!.identity):null};};
 const rpc=vi.fn<AccountGraphRpc>(async(_name,args)=>({data:response(args.p_after_key),error:null}));
 return {options:{kind:"embryo_participant_sets" as const,reference,context,rpc,check,signal:abort.signal},source,rows,membership,response,rpc,check,abort};
}
async function collect<T>(values:AsyncIterable<T>){const rows:T[]=[];for await(const row of values)rows.push(row);return rows;}
afterEach(()=>{vi.useRealTimers();vi.restoreAllMocks();});
describe("actual consumed graph-page protocol prerequisites, with existing nonempty graph refusals closed",()=>{
 it("exhausts1003 real composite-key rows through three numeric keyset pages, independent raw-text hash and current authority",async()=>{
  const f=fixture(),reader=await prepareAccountGraphRows(f.options);await expect(reader.assertComplete(f.abort.signal)).rejects.toThrow();
  const rows=await collect(reader.records(f.abort.signal));expect(rows).toEqual(f.source.map(value=>value.row));expect(rows).toHaveLength(1003);
  expect(rows.map(row=>row.membership_revision)).toEqual(Array.from({length:1003},(_,i)=>i+1));
  await reader.assertComplete(f.abort.signal);
  expect(f.rpc.mock.calls.some(([,args])=>args.p_after_key?.[3]===500)).toBe(true);
  expect(f.rpc.mock.calls.some(([,args])=>args.p_after_key?.[3]===1000)).toBe(true);
  expect(f.rpc.mock.calls.every(([name,args])=>name==="export_archive_account_graph_rows_v1"&&args.p_export_id===f.options.reference.exportId
   &&args.p_attempt_id===f.options.reference.attemptId&&args.p_authority_receipt===f.options.reference.authorityReceipt
   &&Object.keys(args).sort().join(",")==="p_after_key,p_attempt_id,p_authority_receipt,p_export_id,p_kind")).toBe(true);
  expect(JSON.stringify(rows)).not.toContain(JSON.parse(f.rows[0].identity)[2]);expect(f.check).toHaveBeenCalled();
 });
 it("proves exact true empty-source EOF without declaring unsupported graph or scientific completion",async()=>{
  const f=fixture(0),reader=await prepareAccountGraphRows(f.options);expect(await collect(reader.records(f.abort.signal))).toEqual([]);
  await reader.assertComplete(f.abort.signal);expect(Object.keys(reader).sort()).toEqual(["assertComplete","check","kind","membership","records"]);
 });
 it.each(["receipt","actor","target","unknown-kind"])("refuses %s before any source RPC",async mode=>{
  const f=fixture(1);if(mode==="receipt")f.options.reference.authorityReceipt="b".repeat(64);
  if(mode==="actor")f.options.context.actor.accountId=randomUUID();if(mode==="target")f.options.context.targetId=randomUUID();
  if(mode==="unknown-kind")f.options.kind="unknown" as never;
  await expect(prepareAccountGraphRows(f.options)).rejects.toThrow();expect(f.rpc).not.toHaveBeenCalled();
 });
 it.each(["error","foreign-receipt","foreign-kind","unknown-field","over500","bad-next","omitted-next"])("refuses actual %s page transport",async mode=>{
  const f=fixture(1003),original=f.rpc.getMockImplementation()!;
  f.rpc.mockImplementation(async(...args)=>{const r=await original(...args),v=r.data as ReturnType<typeof f.response>;
   if(mode==="error")return {data:null,error:{code:"42501"}};if(mode==="foreign-receipt")v.authorityReceipt="b".repeat(64);
   if(mode==="foreign-kind")v.kind="family_pairs";if(mode==="unknown-field")Object.assign(v,{accountId:randomUUID()});
   if(mode==="over500")v.rows.push(v.rows[0]);if(mode==="bad-next")v.nextAfterKey[3]=499;if(mode==="omitted-next")v.nextAfterKey=null;
   return {data:v,error:null};});
  await expect((async()=>{const r=await prepareAccountGraphRows(f.options);await collect(r.records(f.abort.signal));})()).rejects.toThrow();
 });
 it.each(["truncated","same-count-changed","extra-row","private-field","wrong-key","reordered","duplicate"])("refuses %s content without accepting a partial source",async mode=>{
  const f=fixture(503),reader=await prepareAccountGraphRows(f.options);
  if(mode==="truncated")f.rows.pop();if(mode==="same-count-changed"){const row=JSON.parse(f.rows[0].rowText);row.set_revision=3;f.rows[0].rowText=JSON.stringify(row);}
  if(mode==="extra-row")f.rows.push(f.rows.at(-1)!);if(mode==="private-field"){const row=JSON.parse(f.rows[0].rowText);row.principal_id=randomUUID();f.rows[0].rowText=JSON.stringify(row);}
  if(mode==="wrong-key"){const key=JSON.parse(f.rows[0].identity);key[3]=99;f.rows[0].identity=JSON.stringify(key);}
  if(mode==="reordered")[f.rows[0],f.rows[1]]=[f.rows[1],f.rows[0]];if(mode==="duplicate")f.rows[1]=f.rows[0];
  await expect(collect(reader.records(f.abort.signal))).rejects.toThrow();await expect(reader.assertComplete(f.abort.signal)).rejects.toThrow();
 });
 it("refuses a stale membership receipt and current-authority revocation during or after complete EOF",async()=>{
  const f=fixture(1),reader=await prepareAccountGraphRows(f.options);f.membership.sha256="b".repeat(64);
  await expect(collect(reader.records(f.abort.signal))).rejects.toThrow();
  const g=fixture(1),current=await prepareAccountGraphRows(g.options);await collect(current.records(g.abort.signal));
  g.check.mockRejectedValue(new Error("authority revoked"));await expect(current.assertComplete(g.abort.signal)).rejects.toThrow("authority revoked");
 });
 it("retains cancellation and does not mark an abandoned buffered iterator complete",async()=>{
  const f=fixture(503),reader=await prepareAccountGraphRows(f.options),iterator=reader.records(f.abort.signal)[Symbol.asyncIterator]();
  expect((await iterator.next()).done).toBe(false);f.abort.abort();await expect(iterator.next()).rejects.toThrow();
  const g=fixture(1),r=await prepareAccountGraphRows(g.options),it=r.records(g.abort.signal)[Symbol.asyncIterator]();await it.next();await it.return(undefined);
  await expect(r.assertComplete(g.abort.signal)).rejects.toThrow();
 });
 it.each(["rpc","authority"])("keeps the existing30-second %s bound even if a callback ignores cancellation",async mode=>{
  const f=fixture(0);vi.useFakeTimers();if(mode==="rpc")f.rpc.mockImplementation(()=>new Promise(()=>{}));
  else f.check.mockImplementation(()=>new Promise(()=>{}));
  const pending=prepareAccountGraphRows(f.options),refused=expect(pending).rejects.toThrow();await vi.advanceTimersByTimeAsync(30001);
  await refused;expect(vi.getTimerCount()).toBe(0);
 });
 it("refuses an already expired original job before any source or authority operation",async()=>{
  const f=fixture(0);f.options.context.deadline=new Date(Date.now()-1).toISOString();await expect(prepareAccountGraphRows(f.options)).rejects.toThrow();
  expect(f.rpc).not.toHaveBeenCalled();expect(f.check).not.toHaveBeenCalled();
 });
});
