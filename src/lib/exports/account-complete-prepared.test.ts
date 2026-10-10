import {createHash} from "node:crypto";
import {describe,expect,it,vi} from "vitest";
import {publicationFixture} from "../genome/prepared-source/prepare-genome-publication.fixtures";
import {prepareGenomePublication} from "../genome/prepared-source/prepare-genome-publication";
import {jobId,attemptId,row} from "../genome/prepared-source/materialize-canonical.fixtures";
import {publishedPreparedSourceSchema} from "../genome/prepared-source/published-source-reader";
import {createRequesterStatementRuntime} from "./requester-statement-runtime";
import {streamAccountCompletePreparedRecords} from "./account-complete-prepared";
import type {PreparedStoredArtifact} from "../genome/prepared-source/artifact-identity";

// Real parser/sort/container/index/publication code with invented local bytes.
// These controls prove no provider configuration, native authority or delivery.
async function fixture(){
 const f=await publicationFixture([row(1),row(1),row(2,"0/0"),row(3,"./.")],"GRCh38",3);
 const publication=await prepareGenomePublication({canonical:f.canonical,rsid:f.root,
  expected:{binding:f.binding,jobId,attemptId,firstRsidArtifactSequence:f.root.firstArtifactSequence}},
  {...f,check:async()=>{}});
 const source=publishedPreparedSourceSchema.parse({version:"own-prepared-source-v1",backend:"prepared-object-v1",
  manifestId:"88888888-8888-4888-8888-888888888888",fileId:f.binding.source.fileId,subjectId:f.binding.source.subjectId,
  sourceRevision:f.binding.source.sourceRevision,rawSha256:f.binding.source.rawSha256,decodedSha256:f.binding.source.decodedSha256,
  preparedAt:"2026-09-08T19:00:00Z",root:publication.rootArtifact,summary:publication.payload.summary,
  memberCount:publication.members.length,membershipSha256:"d".repeat(64)});
 const order:string[]=[],runtime=createRequesterStatementRuntime(),signal=new AbortController().signal;
 const reader={context:{deadline:new Date(Date.now()+60_000).toISOString()},
  check:vi.fn(async(current:AbortSignal)=>{expect(current.aborted).toBe(false);order.push("current");}),
  preparedMember:vi.fn(async(fileId:string,manifestId:string,expected:PreparedStoredArtifact,current:AbortSignal)=>{
   expect(current.aborted).toBe(false);expect(fileId).toBe(source.fileId);expect(manifestId).toBe(source.manifestId);
   const member=publication.members.find(m=>m.receipt.artifactId===expected.receipt.artifactId);
   if(!member)throw new Error("synthetic membership refusal");expect(expected).toEqual(member);
   order.push(`member:${member.receipt.artifactId}`);
   return {version:"own-prepared-member-v1",manifestId,fileId,membershipSha256:source.membershipSha256,member};
  })};
 const readArtifact=vi.fn(async(artifact:PreparedStoredArtifact,current:AbortSignal)=>{
  expect(current.aborted).toBe(false);order.push(`bytes:${artifact.receipt.artifactId}`);
  const stored=f.objects.get(artifact.receipt.objectKey);if(!stored)throw new Error("synthetic missing object");
  // A provider read owns fresh byte buffers. Runtime disposition must not
  // modify the immutable fixture objects used by later independent reads.
  return (async function*(){yield Uint8Array.from(stored.subarray(0,3));yield Uint8Array.from(stored.subarray(3));})();
 });
 const read=async()=>{const result=[];for await(const item of streamAccountCompletePreparedRecords({reader,source,signal,runtime,readArtifact}))result.push(item);return result;};
 const settle=async()=>{await runtime.settle(Date.now()+5_000);runtime.assertSettled();};
 return {...f,publication,source,reader,runtime,signal,readArtifact,order,read,settle};
}

describe("complete recipient-authorized prepared source (pure controls)",()=>{
 it("streams the genuine complete canonical publication and excludes all scratch members",async()=>{
  const f=await fixture();try{
   const items=await f.read(),records=items.flatMap(item=>item.type==="record"?[item.record]:[]);
   expect(records).toEqual(f.records);expect(items[0]).toMatchObject({type:"header",header:{
    version:"account-complete-prepared-export-v1",manifestId:f.source.manifestId,recordCount:f.records.length,
    artifactMembershipSha256:f.source.membershipSha256}});
   for(let i=0;i<f.order.length;i++)if(f.order[i].startsWith("bytes:")){
    const id=f.order[i].slice(6);expect(f.order.slice(0,i)).toContain(`member:${id}`);
    expect(f.order.slice(i+1)).toContain(`member:${id}`);
   }
   for(const scratch of f.scratch)expect(f.order).not.toContain(`bytes:${scratch.receipt.artifactId}`);
   expect(f.order[0]).toBe("current");expect(f.order.at(-1)).toBe("current");
  }finally{await f.settle();}
 });
 it.each(["source","summary","count","membership","member","bytes","current"])("refuses changed %s without a shortened fallback",async fault=>{
  const f=await fixture();
  if(fault==="source")f.source.rawSha256="f".repeat(64);
  if(fault==="summary")f.source.summary.rsidPointerCount--;
  if(fault==="count")f.source.memberCount++;
  if(fault==="membership")f.reader.preparedMember.mockImplementation(async()=>({version:"own-prepared-member-v1",
   manifestId:f.source.manifestId,fileId:f.source.fileId,membershipSha256:"e".repeat(64),member:f.publication.rootArtifact}));
  if(fault==="member")f.reader.preparedMember.mockImplementation(async()=>({version:"own-prepared-member-v1",
   manifestId:f.source.manifestId,fileId:f.source.fileId,membershipSha256:f.source.membershipSha256,
   member:{...f.publication.rootArtifact,storageObjectId:"99999999-9999-4999-8999-999999999999"}}));
  if(fault==="bytes")f.objects.get(f.source.root.receipt.objectKey)![0]^=1;
  if(fault==="current")f.reader.check.mockRejectedValue(new Error("synthetic current authority refusal"));
  try{await expect(f.read()).rejects.toThrow("account_complete_prepared_unavailable");}
  finally{await f.settle();}
  if(fault==="membership"||fault==="member"||fault==="current")expect(f.readArtifact).not.toHaveBeenCalled();
 });
 it("rejects a root source substitution even when its actual byte count and digest are correct",async()=>{
  const f=await fixture(),artifact=f.source.root,root=JSON.parse(Buffer.from(f.objects.get(artifact.receipt.objectKey)!).toString());
  root.binding.source.sourceRevision++;const bytes=Buffer.from(JSON.stringify(root));
  f.objects.set(artifact.receipt.objectKey,bytes);artifact.receipt.byteCount=bytes.length;
  artifact.receipt.sha256=createHash("sha256").update(bytes).digest("hex");
  f.publication.rootArtifact.receipt.byteCount=artifact.receipt.byteCount;
  f.publication.rootArtifact.receipt.sha256=artifact.receipt.sha256;
  try{await expect(f.read()).rejects.toThrow("account_complete_prepared_unavailable");}
  finally{await f.settle();}
 });
 it("requires the complete current authority after the last emitted record",async()=>{
  const f=await fixture();let records=0;
  try{await expect((async()=>{for await(const item of streamAccountCompletePreparedRecords({...f,readArtifact:f.readArtifact})){
   if(item.type==="record"&&++records===f.records.length)f.reader.check.mockRejectedValue(new Error("synthetic revocation"));
  }})()).rejects.toThrow("account_complete_prepared_unavailable");expect(records).toBe(f.records.length);}
  finally{await f.settle();}
 });
 it("refuses cancellation before any artifact or authority acquisition",async()=>{
  const f=await fixture(),controller=new AbortController();controller.abort();
  try{await expect((async()=>{for await(const item of streamAccountCompletePreparedRecords({...f,signal:controller.signal}))void item;})())
   .rejects.toThrow("account_complete_prepared_unavailable");expect(f.readArtifact).not.toHaveBeenCalled();expect(f.reader.check).not.toHaveBeenCalled();}
  finally{await f.settle();}
 });
});
