import {createHash,randomUUID} from "node:crypto";
import AdmZip from "adm-zip";
import {afterEach,describe,expect,it,vi} from "vitest";
import {prepareAccountArchivePlan,ACCOUNT_SUBJECT_MEMBERS,type AccountArchiveFile,type AccountArchiveSourceMember} from "./account-archive-plan";
import {prepareAccountPartitionMembers} from "./account-partition-members";
import {accountPartitionFixture} from "./__fixtures__/account-partitions";
import {prepareAccountArchiveAuditMembers,ORDINARY_SUBJECT_AUDIT_NOTE,type AccountAuditRpc} from "./account-audit-members";
import {createZip64Archive,createZip64FileSpool} from "./archive-zip64";
import type {FuturePersonMemberFactory} from "./future-person-member-plan";
import {prepareBoundAccountArchiveSource} from "./bound-account-source";
import {boundSourceFixture} from "../../../scripts/unit-fixtures/bound-source";
import routeRegister from "../../../docs/route-register.json";
const encoder=new TextEncoder();
function fixed(name:string,value:unknown,rows=0):FuturePersonMemberFactory{
 const bytes=encoder.encode(typeof value==="string"?value:JSON.stringify(value)+"\n");
 return {name,rows,chunks:async function*(signal){if(signal.aborted)throw new Error("aborted");yield bytes;}};
}
async function fixture(selected?:Parameters<typeof accountPartitionFixture>[1]){
 const f=await accountPartitionFixture(11,selected),metadata=await prepareAccountPartitionMembers(f.options);
 await f.options.classes.acceptBoundMembership([],f.abort.signal);await f.options.classes.assertComplete(f.abort.signal);
 const auditEvents=[{seq:7,occurred_at:"2026-10-01T00:00:00.000Z",event_code:"purpose.granted",route_id:"api.consents",
  outcome_code:"accepted",coded_context:{purpose:"ancestry",revision:1}}];
 const auditRpc=vi.fn<AccountAuditRpc>(async(_name,args)=>({error:null,data:args.p_operation==="context"?
  {version:"account-archive-audit-v1",authorityReceipt:f.reference.authorityReceipt,attributionStartedAt:"2026-10-01T00:00:00.000Z",eventCount:1}:
  args.p_operation==="ordinary-subject"?{schema_version:"legal-audit-v1",attribution:"unrecorded",attribution_started_at:null,note:ORDINARY_SUBJECT_AUDIT_NOTE,events:[]}:
   {events:auditEvents,nextAfterSeq:null}}));
 const audit=await prepareAccountArchiveAuditMembers({...f.options,reference:f.reference,rpc:auditRpc});
 const factories=[...metadata.factories,...audit];
 // Explicit unit producer seams for the remaining scientific/chat members:
 // they establish layout/byte fencing, never source absence or DB authority.
 for(const p of f.context.partitions){
  for(const name of ["prs.json","ancestry.json","chats.json"])factories.push(fixed(`subjects/${p.subjectId}/${name}`,{schemaVersion:"subject-partitioned-archive-v1",rows:[]}));
  const reports=metadata.factories.find(member=>member.name===`subjects/${p.subjectId}/reports.json`)!;
  factories.push({name:`subjects/${p.subjectId}/reports.txt`,rows:reports.rows,chunks:async function*(signal){
   yield encoder.encode("Your saved report history\n");yield* reports.chunks(signal);
  }});
 }
 const options={context:f.context,factories,files:[] as AccountArchiveFile[],sources:[] as AccountArchiveSourceMember[],signal:f.abort.signal,check:f.check};
 return {...f,metadata,auditEvents,auditRpc,options};
}
async function read(stream:ReadableStream<Uint8Array>){return Buffer.from(await new Response(stream).arrayBuffer());}
afterEach(()=>{vi.restoreAllMocks();vi.useRealTimers();vi.unstubAllEnvs();vi.unstubAllGlobals();});
describe("complete subject layout and actual ZIP byte fence",()=>{
 it("requires the entire independently registered A.11 subject member set",()=>{
  const registered=routeRegister.exportLayouts["subject-partitioned-archive-v1"].requiredArtifacts
   .filter(name=>name.startsWith("subjects/{subject_id}/")).map(name=>name.slice("subjects/{subject_id}/".length));
  expect(new Set(ACCOUNT_SUBJECT_MEMBERS)).toEqual(new Set(registered));
  expect(ACCOUNT_SUBJECT_MEMBERS).toHaveLength(registered.length);
 });
 it("opens every generated artifact with exact independent counts, size and SHA and never emits a sensitive root result row",async()=>{
  const f=await fixture(),plan=await prepareAccountArchivePlan(f.options),spool=await createZip64FileSpool();
  try{
   const bytes=await read(createZip64Archive({members:(async function*(){yield* plan.members;})(),expectedMemberCount:plan.members.length,
    expectedPayloadBytes:plan.payloadBytes,modifiedAt:Date.parse(f.context.capturedAt),deadline:Date.parse(f.context.deadline),signal:f.abort.signal,
    authorityReceipt:f.reference.authorityReceipt,checkAuthority:async signal=>{await f.check(signal);return f.reference.authorityReceipt;},spool}));
   const zip=new AdmZip(bytes),manifest=JSON.parse(zip.readAsText("manifest.json"));
   expect(zip.getEntries()).toHaveLength(33);expect(plan.members).toHaveLength(33);expect(manifest.members).toHaveLength(32);
   expect(new Set(zip.getEntries().map(entry=>entry.entryName))).toEqual(new Set([
    "manifest.json","subjects.json","consents.json","legacy-consents.json","attestations.json","audit-log.json","legal-audit.json","portrait.json","embryos.json",
    ...f.context.partitions.flatMap(p=>ACCOUNT_SUBJECT_MEMBERS.map(name=>`subjects/${p.subjectId}/${name}`)),
   ]));
   expect(new Set(manifest.members.map((m:{name:string})=>m.name))).toEqual(new Set(zip.getEntries().filter(e=>e.entryName!=="manifest.json").map(e=>e.entryName)));
   for(const descriptor of manifest.members){
    const actual=zip.readFile(descriptor.name)!;expect(actual.byteLength).toBe(descriptor.sizeBytes);
    expect(createHash("sha256").update(actual).digest("hex")).toBe(descriptor.sha256);
    if(descriptor.name.startsWith("subjects/")&&descriptor.name.endsWith(".json")){
     const value=JSON.parse(actual.toString());if(Array.isArray(value.rows))expect(value.rows).toHaveLength(descriptor.rows);
     expect(descriptor.subjectId).toBe(descriptor.name.split("/")[1]);expect(descriptor.fileId).toBeNull();
    }
   }
   for(const name of ["subjects","consents","legacy-consents","attestations","audit-log","portrait","embryos"]){
    const index=JSON.parse(zip.readAsText(`${name}.json`));expect(index.rows).toEqual(f.context.partitions.map(p=>({subjectId:p.subjectId,
     path:name==="subjects"?`subjects/${p.subjectId}/`:`subjects/${p.subjectId}/${name}.json`})));expect(index.rows.every((row:object)=>Object.keys(row).sort().join(",")==="path,subjectId")).toBe(true);
   }
   expect(JSON.parse(zip.readAsText("legal-audit.json")).events).toEqual(f.auditEvents);
   for(const p of f.context.partitions){const subjectAudit=JSON.parse(zip.readAsText(`subjects/${p.subjectId}/audit-log.json`));
    expect(subjectAudit.events).toEqual([]);expect(subjectAudit.attribution).toBe("unrecorded");expect(subjectAudit).not.toHaveProperty("eventCount");}
   const legacy=JSON.parse(zip.readAsText(`subjects/${f.self}/legacy-consents.json`));expect(legacy.rows).toHaveLength(11);
   expect(bytes.includes(Buffer.from(f.context.actor.sessionId))).toBe(false);expect(bytes.includes(Buffer.from("credentialFingerprint"))).toBe(false);
  }finally{await spool.dispose();}
 });
 it.each(["missing-subject-member","missing-actor-ledger","duplicate-member","foreign-directory","nested-path","sensitive-root","unsafe-row-count","unknown-raw-file"])(
  "refuses %s before reading any member",async failure=>{
   const f=await fixture();
   if(failure==="missing-subject-member")f.options.factories.pop();if(failure==="missing-actor-ledger")f.options.factories=f.options.factories.filter(row=>row.name!=="legal-audit.json");
   if(failure==="duplicate-member")f.options.factories.push(f.options.factories[0]);
   if(failure==="foreign-directory")f.options.factories.push(fixed(`subjects/${randomUUID()}/subject.json`,{}));
   if(failure==="nested-path")f.options.factories.push(fixed(`subjects/${f.self}/../subject.json`,{}));
   if(failure==="sensitive-root")f.options.factories.push(fixed("reports.json",{reports:["forbidden"]}));
   if(failure==="unsafe-row-count")f.options.factories[0].rows=Number.MAX_SAFE_INTEGER+1;
   if(failure==="unknown-raw-file")f.options.factories.push(fixed(`variants/${randomUUID()}.csv`,"forbidden"));
   const read=vi.fn(async function*(){yield encoder.encode("forbidden");});f.options.factories[0].chunks=read;
   await expect(prepareAccountArchivePlan(f.options)).rejects.toThrow();expect(read).not.toHaveBeenCalled();
  });
 it("rereads exact member bytes and refuses a same-length source change at actual EOF",async()=>{
  const f=await fixture(),original=f.options.factories[0],plan=await prepareAccountArchivePlan(f.options);
  const generated=await read(await plan.members.find(m=>m.name===original.name)!.open(f.abort.signal));
  const changed=Buffer.from(generated);changed[changed.length-2]^=1;original.chunks=async function*(){yield changed;};
  await expect(read(await plan.members.find(m=>m.name===original.name)!.open(f.abort.signal))).rejects.toThrow();
 });
 it("requires every current selected file, complete original membership and full raw EOF identity",async()=>{
  const f=await fixture(),fileId=randomUUID(),raw=Buffer.from("Synthetic complete source\n");
  f.context.fileCount=1;f.context.partitions[0].fileCount=1;f.context.partitions[0].fileIds=[fileId];
  f.options.files=[{fileId,subjectId:f.self,projection:"own-upload",byte_identical_to_upload:true,originalRetired:false,
   sourceSha256:createHash("sha256").update(raw).digest("hex"),decodedSha256:createHash("sha256").update(raw).digest("hex")}];
  const open=vi.fn(async(signal:AbortSignal)=>new ReadableStream<Uint8Array>({start(c){if(signal.aborted)throw new Error("expired");c.enqueue(raw);c.close();}}));
  const member={name:`originals/${fileId}/original.vcf`,sizeBytes:raw.byteLength,open};
  f.options.sources=[{fileId,subjectId:f.self,member}];
  const plan=await prepareAccountArchivePlan(f.options),source=plan.members.find(m=>m.name===member.name)!;
  const actual=await read(await source.open(f.abort.signal));expect(Buffer.prototype.equals.call(actual,raw)).toBe(true);
  expect(open).toHaveBeenCalledTimes(2);expect(plan.descriptors.find(m=>m.name===member.name)).toMatchObject({fileId,subjectId:f.self,
   sizeBytes:raw.byteLength,sha256:f.options.files[0].sourceSha256});
  open.mockImplementation(async()=>new ReadableStream({start(c){c.enqueue(raw.subarray(0,raw.length-1));c.close();}}));
  await expect(read(await source.open(f.abort.signal))).rejects.toThrow();
 });
 it.each(["missing-file","foreign-subject","duplicate-file","missing-original","false-retired","provider-path"])("refuses %s without replacing a required source with a placeholder",async failure=>{
  const f=await fixture(),fileId=randomUUID();f.context.fileCount=1;f.context.partitions[0].fileCount=1;f.context.partitions[0].fileIds=[fileId];
  const file:AccountArchiveFile={fileId,subjectId:f.self,projection:"own-upload",byte_identical_to_upload:true,originalRetired:false,sourceSha256:"a".repeat(64)};
  f.options.files=[file];
  if(failure==="missing-file")f.options.files=[];if(failure==="foreign-subject")file.subjectId=randomUUID();
  if(failure==="duplicate-file")f.options.files.push(file);if(failure==="false-retired")file.originalRetired=true;
  const open=vi.fn(async()=>new ReadableStream<Uint8Array>({start(c){c.enqueue(new Uint8Array([1]));c.close();}}));
  if(failure!=="missing-original")f.options.sources=[{fileId,subjectId:f.self,member:{name:`originals/${fileId}/original.vcf`,sizeBytes:1,open}}];
  if(failure==="provider-path")f.options.sources[0].member.name=`originals/${fileId}/../private-object`;
  await expect(prepareAccountArchivePlan(f.options)).rejects.toThrow();expect(open).not.toHaveBeenCalled();
 });
 it("preserves an explicitly proved prepared-source retirement warning without pretending a missing legacy object expired",async()=>{
  const f=await fixture(),fileId=randomUUID();f.context.fileCount=1;f.context.partitions[0].fileCount=1;f.context.partitions[0].fileIds=[fileId];
  f.options.files=[{fileId,subjectId:f.self,projection:"own-upload",byte_identical_to_upload:false,originalRetired:true,sourceSha256:"a".repeat(64)}];
  f.options.factories.push(fixed(`canonical/${fileId}.jsonl`,JSON.stringify({type:"prepared-source",version:"synthetic-proof-seam"})+"\n",1));
  const plan=await prepareAccountArchivePlan(f.options);expect(plan.members.some(m=>m.name.startsWith("originals/"))).toBe(false);
  const manifest=JSON.parse((await read(await plan.members.find(m=>m.name==="manifest.json")!.open(f.abort.signal))).toString());
  expect(manifest.files).toEqual(f.options.files);
 });
 it("consumes every actual copied current R2 part with its distinct audience, complete EOF and exact immutable part membership",async()=>{
  const raw=await boundSourceFixture(),source=await prepareBoundAccountArchiveSource(raw.reference,raw.rpc,new AbortController().signal);
  const f=await fixture({actor:{accountId:raw.manifest.actor.accountId,sessionId:raw.manifest.actor.sessionId},reference:raw.reference}),subjectId=raw.manifest.subjectId,fileId=raw.manifest.fileId;
  f.context.partitions.push({subjectId,class:"claimed-bound",fileCount:1,fileIds:[fileId]});f.context.fileCount=1;
  for(const name of ACCOUNT_SUBJECT_MEMBERS)f.options.factories.push(fixed(`subjects/${subjectId}/${name}`,name.endsWith(".txt")?"Synthetic retained report\n":{schemaVersion:"subject-partitioned-archive-v1",rows:[]}));
  f.options.factories.push(fixed(`variants/${fileId}.csv`,"chromosome,position,genotype\n1,12,A/G\n",1),
   fixed(`originals/${fileId}/embryo-autosomal-source.jsonl`,JSON.stringify({schemaVersion:"sanitized-embryo-calls-v1",sourceSha256:raw.manifest.sourceSha256})+"\n",1));
  f.options.files=[{fileId,subjectId,projection:"sanitized-embryo",byte_identical_to_upload:false,originalRetired:false,
   sourceSha256:raw.manifest.sourceSha256,membershipSha256:raw.manifest.membershipSha256,publicationRevision:raw.manifest.publicationRevision,
   currentParts:source.provenance.parts}];f.options.sources=source.members.map(member=>({fileId,subjectId,member}));
  const plan=await prepareAccountArchivePlan(f.options);
  for(const [index,part] of source.provenance.parts.entries()){
   const bytes=await read(await plan.members.find(member=>member.name===part.name)!.open(f.abort.signal));
   expect(Buffer.prototype.equals.call(bytes,Buffer.from(raw.bytes[index]))).toBe(true);
   expect(createHash("sha256").update(bytes).digest("hex")).toBe(part.sha256);
  }
  const manifest=await read(await plan.members.find(member=>member.name==="manifest.json")!.open(f.abort.signal));
  for(const part of raw.manifest.parts)for(const value of [part.target.oldKey,part.target.newKey,part.target.oldVersion,part.identity.providerVersion])
   expect(manifest.includes(Buffer.from(value))).toBe(false);
  expect(manifest.includes(Buffer.from(raw.manifest.actor.sessionId))).toBe(false);
  f.options.sources.pop();await expect(prepareAccountArchivePlan(f.options)).rejects.toThrow();
 });
 it("refuses an incomplete or changed immutable physical part descriptor before a source read",async()=>{
  const f=await fixture(),fileId=randomUUID(),partId=randomUUID();f.context.fileCount=1;
  f.context.partitions[0].class="claimed-bound";f.context.partitions[0].fileCount=1;f.context.partitions[0].fileIds=[fileId];
  f.options.factories.push(fixed(`variants/${fileId}.csv`,"header\n"),fixed(`originals/${fileId}/embryo-autosomal-source.jsonl`,"{}\n"));
  f.options.files=[{fileId,subjectId:f.self,projection:"sanitized-embryo",byte_identical_to_upload:false,originalRetired:false,
   sourceSha256:"a".repeat(64),membershipSha256:"b".repeat(64),publicationRevision:1,
   currentParts:[{name:`originals/${fileId}/canonical-part-0000.vcf`,sequence:0,partId,sizeBytes:5,sha256:"c".repeat(64)}]}];
  const open=vi.fn(async()=>new ReadableStream<Uint8Array>({start(c){c.enqueue(encoder.encode("wrong"));c.close();}}));
  f.options.sources=[{fileId,subjectId:f.self,member:{name:`originals/${fileId}/canonical-part-0000.vcf`,sizeBytes:5,open}}];
  await expect(prepareAccountArchivePlan(f.options)).rejects.toThrow();expect(open).toHaveBeenCalledOnce();
  open.mockClear();f.options.sources[0].member.sizeBytes=4;
  await expect(prepareAccountArchivePlan(f.options)).rejects.toThrow();expect(open).not.toHaveBeenCalled();
 });
 it("bounds each real authority/read operation at30seconds and leaves no timer when a callback ignores cancellation",async()=>{
  const f=await fixture();vi.useFakeTimers();f.check.mockImplementation(()=>new Promise<void>(()=>{}));
  const pending=prepareAccountArchivePlan(f.options),refused=expect(pending).rejects.toThrow();
  await vi.advanceTimersByTimeAsync(30001);await refused;expect(vi.getTimerCount()).toBe(0);
 });
 it("refuses actual current authority loss before buffered metadata or source can be reopened",async()=>{
  const f=await fixture(),plan=await prepareAccountArchivePlan(f.options);f.check.mockRejectedValue(new Error("revoked"));
  await expect(read(await plan.members[0].open(f.abort.signal))).rejects.toThrow();
 });
});
