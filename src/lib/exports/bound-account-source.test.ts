import {createHash,randomUUID} from "node:crypto";
import AdmZip from "adm-zip";
import {afterEach,describe,expect,it,vi} from "vitest";
import {createEmbryoFixtureSigner,createEmbryoFragmentGateway,EMBRYO_FIXTURE_ORIGIN,
 EMBRYO_FIXTURE_BUCKET,EMBRYO_FIXTURE_SUPABASE_URL} from "../../../scripts/ci-browser/embryo-fragment-fixture";
import {copyRelocation,disposeRelocation,type RelocationTarget} from "@/lib/future-person/relocation-transport";
import {prepareBoundAccountArchiveSource,type BoundArchiveSourceRpc} from "./bound-account-source";
import {createZip64Archive,type Zip64Member} from "./archive-zip64";
const sha=(v:Uint8Array)=>createHash("sha256").update(v).digest("hex"),signal=()=>new AbortController().signal;
afterEach(()=>{vi.unstubAllEnvs();vi.unstubAllGlobals();vi.restoreAllMocks();});
async function fixture(){
 const signer=createEmbryoFixtureSigner(),gateway=createEmbryoFragmentGateway(signer.publicJwk);
 vi.stubEnv("INHERIT_TEST_JURISDICTION","1");vi.stubEnv("INHERIT_UPLOAD_SIGNING_JWK",JSON.stringify(signer.privateJwk));
 vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL",EMBRYO_FIXTURE_SUPABASE_URL);
 vi.stubEnv("INHERIT_EMBRYO_R2_ORIGIN",EMBRYO_FIXTURE_ORIGIN);vi.stubEnv("INHERIT_EMBRYO_R2_BUCKET",EMBRYO_FIXTURE_BUCKET);
 const fetch=vi.fn(async(input:RequestInfo|URL,init?:RequestInit)=>gateway.fetch(input instanceof Request?input:new Request(input,init)));
 vi.stubGlobal("fetch",fetch);const accountId=randomUUID(),sessionId=randomUUID(),subjectId=randomUUID(),bindingId=randomUUID();
 const expiresAt=new Date(Date.now()+25000).toISOString(),bytes=[new TextEncoder().encode("# exact synthetic part1\n"),new TextEncoder().encode("1\t12\tA\tG\n")];
 const parts=[];
 for(const [sequence,data] of bytes.entries()){
  const oldKey=`embryo/${randomUUID()}`,stored=(await gateway.binding.put(oldKey,data,{sha256:sha(data)}))!,attemptId=randomUUID();
  const target:RelocationTarget={bindingId,relocationId:randomUUID(),attemptId,accountId,bucket:EMBRYO_FIXTURE_BUCKET,
   oldKey,oldVersion:stored.version,oldEtag:stored.etag,newKey:`claimant/${accountId}/${attemptId}`,
   byteCount:data.length,sha256:sha(data),expiresAt};
  const identity=await copyRelocation(target,signal());await disposeRelocation(target,"old",signal(),identity);
  parts.push({sequence,partId:randomUUID(),target,identity});
 }
 const manifest={version:"bound-future-person-canonical-source-v1",purpose:"approved-future-person-export-v1",
  actor:{accountId,sessionId,accountAuthSessionRevision:1,sessionRevision:1},bindingId,claimId:randomUUID(),claimantPrincipalId:randomUUID(),
  claimantRevision:1,releaseRevision:1,principalRevision:1,subjectId,subjectBindingRevision:1,subjectLifecycleRevision:1,
  fileId:randomUUID(),sourceSha256:sha(bytes[0]),membershipSha256:sha(bytes[1]),publicationRevision:1,
  byteCount:bytes.reduce((sum,p)=>sum+p.length,0),partCount:2,expiresAt,parts};
 const reference={exportId:randomUUID(),attemptId:randomUUID(),authorityReceipt:"a".repeat(64)};
 const reply={version:"bound-account-archive-source-v1",...reference,source:manifest};
 const rpc=vi.fn<BoundArchiveSourceRpc>(async(name,args)=>{
  expect(name).toBe("export_archive_bound_source_v1");expect(args).toMatchObject({p_export_id:reference.exportId,
   p_attempt_id:reference.attemptId,p_authority_receipt:reference.authorityReceipt});
  if(args.p_operation==="check")expect(args.p_expected).toEqual(manifest);
  return {data:structuredClone(reply),error:null};
 });fetch.mockClear();return {gateway,reference,reply,manifest,bytes,fetch,rpc};
}
async function collect(source:ReadableStream<Uint8Array>){const chunks=[];const r=source.getReader();
 try{for(;;){const next=await r.read();if(next.done)return Buffer.concat(chunks);chunks.push(Buffer.from(next.value));}}finally{r.releaseLock();}}
async function archive(f:Awaited<ReturnType<typeof fixture>>,members:Zip64Member[]){
 const records:Uint8Array[]=[];return collect(createZip64Archive({members:(async function*(){yield* members;})(),
  expectedMemberCount:members.length,expectedPayloadBytes:members.reduce((sum,m)=>sum+m.sizeBytes,0),
  modifiedAt:Date.UTC(2026,9,1),deadline:Date.now()+20000,signal:signal(),authorityReceipt:f.reference.authorityReceipt,
  checkAuthority:async()=>f.reference.authorityReceipt,spool:{append:async r=>{records.push(r.slice());},
   replay:()=>new ReadableStream({start(c){for(const r of records)c.enqueue(r);c.close();}}),dispose:async()=>{}}}));
}
describe("durable bound own-source member with actual gateway and generated ZIP64",()=>{
 it("opens every complete exact moved part in a real archive without JWT/provider descriptors or parent bytes",async()=>{
  const f=await fixture(),result=await prepareBoundAccountArchiveSource(f.reference,f.rpc,signal());
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
  const f=await fixture();if(kind==="foreign-export")f.reply.exportId=randomUUID();if(kind==="foreign-attempt")f.reply.attemptId=randomUUID();
  if(kind==="stale-receipt")f.reply.authorityReceipt="b".repeat(64);if(kind==="open")Object.assign(f.reply,{jwt:"forbidden"});
  if(kind==="partial")f.manifest.parts.pop();await expect(prepareBoundAccountArchiveSource(f.reference,f.rpc,signal())).rejects.toThrow();expect(f.fetch).not.toHaveBeenCalled();
 });
 it.each([1,2,3,4,5])("never returns a partial member set when current authority is revoked at read checkpoint %s",async position=>{
  const f=await fixture();let n=0;f.rpc.mockImplementation(async(_name,args)=>({data:f.reply,
   error:args.p_operation==="check"&&++n===position?{code:"42501"}:null}));
  await expect(prepareBoundAccountArchiveSource(f.reference,f.rpc,signal())).rejects.toThrow();
 });
 it("requires full provider EOF and matching hashes before returning any member",async()=>{
  const f=await fixture();f.gateway.values.get(f.manifest.parts[1].target.newKey)!.bytes=new Uint8Array([1]);
  await expect(prepareBoundAccountArchiveSource(f.reference,f.rpc,signal())).rejects.toThrow();expect(f.fetch).toHaveBeenCalledTimes(2);
 });
 it("refuses an expired proof and a revoked source while writing the generated ZIP",async()=>{
  const f=await fixture(),result=await prepareBoundAccountArchiveSource(f.reference,f.rpc,signal());
  f.rpc.mockResolvedValue({data:null,error:{code:"42501"}});await expect(archive(f,result.members)).rejects.toThrow();
  const expired=await fixture();expired.manifest.expiresAt=new Date(Date.now()-1).toISOString();
  expired.manifest.parts.forEach(p=>p.target.expiresAt=expired.manifest.expiresAt);
  await expect(prepareBoundAccountArchiveSource(expired.reference,expired.rpc,signal())).rejects.toThrow();expect(expired.fetch).not.toHaveBeenCalled();
 });
 it("keeps the TEST-LOCAL gate closed and has no callable human-token fallback",async()=>{
  const f=await fixture();vi.stubEnv("INHERIT_TEST_JURISDICTION","0");
  await expect(prepareBoundAccountArchiveSource(f.reference,f.rpc,signal())).rejects.toThrow();expect(f.rpc).not.toHaveBeenCalled();
 });
});
