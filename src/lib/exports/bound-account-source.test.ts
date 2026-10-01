import {createHash,randomUUID} from "node:crypto";
import AdmZip from "adm-zip";
import {afterEach,describe,expect,it,vi} from "vitest";
import {prepareBoundAccountArchiveSource} from "./bound-account-source";
import {boundSourceFixture} from "./__fixtures__/bound-source";
import {createZip64Archive,type Zip64Member} from "./archive-zip64";
const sha=(v:Uint8Array)=>createHash("sha256").update(v).digest("hex"),signal=()=>new AbortController().signal;
afterEach(()=>{vi.unstubAllEnvs();vi.unstubAllGlobals();vi.restoreAllMocks();});

async function collect(source:ReadableStream<Uint8Array>){const chunks=[];const r=source.getReader();
 try{for(;;){const next=await r.read();if(next.done)return Buffer.concat(chunks);chunks.push(Buffer.from(next.value));}}finally{r.releaseLock();}}
async function archive(f:Awaited<ReturnType<typeof boundSourceFixture>>,members:Zip64Member[]){
 const records:Uint8Array[]=[];return collect(createZip64Archive({members:(async function*(){yield* members;})(),
  expectedMemberCount:members.length,expectedPayloadBytes:members.reduce((sum,m)=>sum+m.sizeBytes,0),
  modifiedAt:Date.UTC(2026,9,1),deadline:Date.now()+20000,signal:signal(),authorityReceipt:f.reference.authorityReceipt,
  checkAuthority:async()=>f.reference.authorityReceipt,spool:{append:async r=>{records.push(r.slice());},
   replay:()=>new ReadableStream({start(c){for(const r of records)c.enqueue(r);c.close();}}),dispose:async()=>{}}}));
}
describe("durable bound own-source member with actual gateway and generated ZIP64",()=>{
 it("opens every complete exact moved part in a real archive without JWT/provider descriptors or parent bytes",async()=>{
  const f=await boundSourceFixture(),result=await prepareBoundAccountArchiveSource(f.reference,f.rpc,signal());
  expect(f.fetch).toHaveBeenCalledTimes(2);const zip=new AdmZip(await archive(f,result.members));
  expect(zip.getEntries().map(e=>e.entryName)).toEqual(result.provenance.parts.map(p=>p.name));
  for(const [i,p] of result.provenance.parts.entries()){
   const stored=zip.readFile(p.name)!;expect(stored).toEqual(Buffer.from(f.bytes[i]));expect(stored.length).toBe(p.sizeBytes);expect(sha(stored)).toBe(p.sha256);
  }
  expect(result.provenance).toMatchObject({projection:"sanitized-autosomal-canonical-parts",byteIdenticalToUpload:false,subjectId:f.manifest.subjectId,fileId:f.manifest.fileId,partCount:2});
  const json=JSON.stringify(result.provenance);expect(json).not.toContain(f.manifest.actor.sessionId);
  for(const p of f.manifest.parts){expect(json).not.toContain(p.target.oldKey);expect(json).not.toContain(p.target.newKey);expect(json).not.toContain(p.identity.providerVersion);}
  expect(f.rpc.mock.calls.every(([,args])=>!("jwt" in args)&&!("accountId" in args)&&!("sessionId" in args))).toBe(true);
 });
 it.each(["foreign-export","foreign-attempt","stale-receipt","open","partial"])("refuses %s before source transport",async kind=>{
  const f=await boundSourceFixture();if(kind==="foreign-export")f.reply.exportId=randomUUID();if(kind==="foreign-attempt")f.reply.attemptId=randomUUID();
  if(kind==="stale-receipt")f.reply.authorityReceipt="b".repeat(64);if(kind==="open")Object.assign(f.reply,{jwt:"forbidden"});
  if(kind==="partial")f.manifest.parts.pop();await expect(prepareBoundAccountArchiveSource(f.reference,f.rpc,signal())).rejects.toThrow();expect(f.fetch).not.toHaveBeenCalled();
 });
 it.each([1,2,3,4,5])("never returns a partial member set when current authority is revoked at read checkpoint %s",async position=>{
  const f=await boundSourceFixture();let n=0;f.rpc.mockImplementation(async(_name,args)=>({data:f.reply,
   error:args.p_operation==="check"&&++n===position?{code:"42501"}:null}));
  await expect(prepareBoundAccountArchiveSource(f.reference,f.rpc,signal())).rejects.toThrow();
 });
 it("requires full provider EOF and matching hashes before returning any member",async()=>{
  const f=await boundSourceFixture();f.gateway.values.get(f.manifest.parts[1].target.newKey)!.bytes=new Uint8Array([1]);
  await expect(prepareBoundAccountArchiveSource(f.reference,f.rpc,signal())).rejects.toThrow();expect(f.fetch).toHaveBeenCalledTimes(2);
 });
 it("refuses an expired proof and a revoked source while writing the generated ZIP",async()=>{
  const f=await boundSourceFixture(),result=await prepareBoundAccountArchiveSource(f.reference,f.rpc,signal());
  f.rpc.mockResolvedValue({data:null,error:{code:"42501"}});await expect(archive(f,result.members)).rejects.toThrow();
  const expired=await boundSourceFixture();expired.manifest.expiresAt=new Date(Date.now()-1).toISOString();
  expired.manifest.parts.forEach(p=>p.target.expiresAt=expired.manifest.expiresAt);
  await expect(prepareBoundAccountArchiveSource(expired.reference,expired.rpc,signal())).rejects.toThrow();expect(expired.fetch).not.toHaveBeenCalled();
 });
 it("keeps the TEST-LOCAL gate closed and has no callable human-token fallback",async()=>{
  const f=await boundSourceFixture();vi.stubEnv("INHERIT_TEST_JURISDICTION","0");
  await expect(prepareBoundAccountArchiveSource(f.reference,f.rpc,signal())).rejects.toThrow();expect(f.rpc).not.toHaveBeenCalled();
 });
 it("completes source preparation independently while preserving actual later archive cancellation",async()=>{
  const f=await boundSourceFixture(),lifetime=new AbortController(),preparation=new AbortController();
  const source=await prepareBoundAccountArchiveSource(f.reference,f.rpc,lifetime.signal,preparation.signal);
  preparation.abort();
  const zip=new AdmZip(await archive(f,source.members));
  expect(zip.getEntries()).toHaveLength(2);
  expect(zip.readFile(source.members[0].name)).toEqual(Buffer.from(f.bytes[0]));
  lifetime.abort();
  await expect(archive(f,source.members)).rejects.toThrow();
 });
 it("refuses cancellation during preparation without returning descriptors",async()=>{
  const f=await boundSourceFixture(),preparation=new AbortController(),implementation=f.rpc.getMockImplementation()!;
  f.rpc.mockImplementation(async(...args)=>{const reply=await implementation(...args);preparation.abort();return reply;});
  await expect(prepareBoundAccountArchiveSource(f.reference,f.rpc,signal(),preparation.signal)).rejects.toThrow();
  expect(f.fetch).not.toHaveBeenCalled();
 });
});
