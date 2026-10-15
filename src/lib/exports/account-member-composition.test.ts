import {randomUUID} from "node:crypto";
import {describe,expect,it} from "vitest";
import {composeAccountMemberFactories,bufferAccountMemberFactories} from "./account-member-composition";
import type {FuturePersonMemberFactory} from "./future-person-member-plan";
function factory(name:string,value:unknown,rows:number):FuturePersonMemberFactory{
 const bytes=new TextEncoder().encode(JSON.stringify(value)+"\n");return {name,rows,chunks:async function*(signal){if(signal.aborted)throw new Error("aborted");yield bytes;}};
}
async function read(f:FuturePersonMemberFactory){const result=[];for await(const chunk of f.chunks(new AbortController().signal))result.push(chunk);return JSON.parse(Buffer.concat(result).toString());}
describe("preserve every subject producer document once",()=>{
 it("keeps complete scientific and account history content as distinct named sections",async()=>{
  const name=`subjects/${randomUUID()}/reports.json`,metadata={rows:[{kind:"suppressions",row:{reason_code:"source_refused"}}]},science={rows:[{reports:[{outcome:"Stored finding"}]}]};
  const [combined]=composeAccountMemberFactories([{kind:"account-metadata",factories:[factory(name,metadata,1)]},
   {kind:"ordinary-science",factories:[factory(name,science,1)]}]);
  expect(combined.rows).toBe(2);expect(await read(combined)).toEqual({schemaVersion:"subject-partitioned-archive-v1",sections:[
   {kind:"account-metadata",content:metadata},{kind:"ordinary-science",content:science}]});
 });
 it("preserves actual signed custody records alongside current own-account metadata without changing their content",async()=>{
  const name=`subjects/${randomUUID()}/consents.json`,signed={rows:[{bodyMarkdown:"Original signed wording",signingName:"Actual decoded synthetic name"}]},current={rows:[{kind:"purpose-grants"}]};
  const [combined]=composeAccountMemberFactories([{kind:"account-metadata",factories:[factory(name,current,1)]},
   {kind:"retained-custody",factories:[factory(name,signed,1)]}]);
  expect((await read(combined)).sections.map((s:{content:unknown})=>s.content)).toEqual([current,signed]);
 });
 it.each(["global-ledger","source","text","same-origin","duplicate-origin"])("refuses %s collision rather than silently overwriting",fault=>{
  const prefix=`subjects/${randomUUID()}/`,name=fault==="global-ledger"?"legal-audit.json":fault==="source"?`variants/${randomUUID()}.csv`:
   fault==="text"?prefix+"reports.txt":prefix+"consents.json",one=factory(name,{},1);
  expect(()=>composeAccountMemberFactories(fault==="duplicate-origin"?[{kind:"account-metadata",factories:[one,one]}]:
   [{kind:"account-metadata",factories:[one]},{kind:fault==="same-origin"?"account-metadata":"retained-custody",factories:[one]}])).toThrow();
 });
 it("never supplies a missing member or an empty substitute",()=>{
  const factoryName=`subjects/${randomUUID()}/subject.json`,original=factory(factoryName,{rows:[]},0);
  expect(composeAccountMemberFactories([{kind:"account-metadata",factories:[original]}])).toEqual([original]);
  expect(composeAccountMemberFactories([])).toEqual([]);
 });
});

describe("bounded exact member-fragment buffering",()=>{
 it("preserves every byte and row count across long and tiny fragments under backpressure",async()=>{
  const blocks=[Buffer.alloc(70_001,37),Buffer.from("Original saved result"),Buffer.alloc(80_013,44)];let reads=0,closed=false;
  const source:FuturePersonMemberFactory={name:`subjects/${randomUUID()}/reports.json`,rows:7,chunks:async function*(){
   try{for(const block of blocks){reads++;yield block;}}finally{closed=true;}}};
  const [buffered]=bufferAccountMemberFactories([source]),iterator=buffered.chunks(new AbortController().signal)[Symbol.asyncIterator]();
  const first=await iterator.next();expect(first.done).toBe(false);expect(first.value).toHaveLength(32_768);expect(reads).toBe(1);
  const actual=[first.value!];for(;;){const next=await iterator.next();if(next.done)break;expect(next.value.length).toBeLessThanOrEqual(32_768);actual.push(next.value);}
  expect(Buffer.concat(actual).equals(Buffer.concat(blocks))).toBe(true);expect(buffered.rows).toBe(7);expect(reads).toBe(3);expect(closed).toBe(true);
 });
 it.each([new Uint8Array(),new Uint8Array(4_000_001),"foreign"])("refuses an invalid original producer fragment",async bytes=>{
  const source:FuturePersonMemberFactory={name:"synthetic",rows:0,chunks:async function*(){yield bytes as Uint8Array;}};
  const [buffered]=bufferAccountMemberFactories([source]);await expect(read(buffered)).rejects.toThrow();
 });
 it("refuses a previously cancelled caller before pulling any source fragment",async()=>{
  const abort=new AbortController();abort.abort();let reads=0;
  const source:FuturePersonMemberFactory={name:"synthetic",rows:0,chunks:async function*(){reads++;yield new Uint8Array(1);}};
  const [buffered]=bufferAccountMemberFactories([source]);
  await expect(buffered.chunks(abort.signal)[Symbol.asyncIterator]().next()).rejects.toThrow();expect(reads).toBe(0);
 });
 it("cancels a partially emitted owned block without pulling later source fragments",async()=>{
  const abort=new AbortController();let reads=0,closed=false;
  const source:FuturePersonMemberFactory={name:"synthetic",rows:0,chunks:async function*(){try{
   reads++;yield new Uint8Array(70_001);reads++;yield new Uint8Array(1);
  }finally{closed=true;}}};
  const [buffered]=bufferAccountMemberFactories([source]),iterator=buffered.chunks(abort.signal)[Symbol.asyncIterator]();
  await iterator.next();abort.abort();await expect(iterator.next()).rejects.toThrow();expect(reads).toBe(1);expect(closed).toBe(true);
 });
});
