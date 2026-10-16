import {createHash,randomUUID} from "node:crypto";
import {afterEach,describe,expect,it,vi} from "vitest";
import {prepareAccountPartitionMembers,ACCOUNT_METADATA_MEMBERS} from "./account-partition-members";
import {accountPartitionFixture} from "./__fixtures__/account-partitions";
import type {FuturePersonMemberFactory} from "./future-person-member-plan";
import {ACCOUNT_HISTORY_KINDS} from "./account-history-inventory";
import {accountClassRowSchemas,type AccountProjectedClass} from "./account-class-inventory";
async function read(factory:FuturePersonMemberFactory,signal:AbortSignal){
 const chunks=[];for await(const chunk of factory.chunks(signal))chunks.push(chunk);
 return JSON.parse(Buffer.concat(chunks).toString()) as {schemaVersion:string;rows:{kind:string;scope:string;row:Record<string,unknown>}[]};
}
afterEach(()=>{vi.useRealTimers();vi.restoreAllMocks();});
describe("complete actual metadata subject partition assembly",()=>{
 it("independently matches every nonempty source class, preserves all1103 paged rows and writes each record into exactly one authorized directory",async()=>{
  const f=await accountPartitionFixture(),prepared=await prepareAccountPartitionMembers(f.options);
  expect(prepared.anchorSubjectId).toBe(f.self);
  expect(prepared.factories.map(row=>row.name)).toEqual(f.context.partitions.flatMap(p=>ACCOUNT_METADATA_MEMBERS.map(member=>`subjects/${p.subjectId}/${member}.json`)));
  const all:{subjectId:string;kind:string;scope:string;row:Record<string,unknown>}[]=[];
  for(const factory of prepared.factories){const value=await read(factory,f.abort.signal);
   expect(value.schemaVersion).toBe("subject-partitioned-archive-v1");expect(value.rows).toHaveLength(factory.rows);
   all.push(...value.rows.map(row=>({subjectId:factory.name.split("/")[1],...row})));
  }
  for(const kind of ACCOUNT_HISTORY_KINDS){
   const rows=all.filter(row=>row.kind===kind).map(row=>JSON.stringify(row.row)).sort();
   expect(rows).toEqual(f.historySource[kind].map(row=>JSON.stringify(JSON.parse(row.rowText))).sort());
  }
  for(const kind of Object.keys(accountClassRowSchemas) as AccountProjectedClass[]){
   expect(all.filter(row=>row.kind===kind).map(row=>row.row)).toEqual(f.classRows[kind].map(row=>JSON.parse(row.rowText)));
  }
  expect(all.filter(row=>row.kind==="profile").map(row=>row.row)).toEqual([f.profile]);
  expect(all.filter(row=>row.kind==="purpose-grants").map(row=>row.row)).toEqual([f.purposeGrant]);
  expect(all.filter(row=>row.kind==="legacy-consents")).toHaveLength(1103);
  expect(all.filter(row=>row.kind==="signatures")).toEqual([{subjectId:f.self,kind:"signatures",scope:"requester-account-history",row:f.historyRows.signatures[0]}]);
  expect(all.filter(row=>["legacy-consents","recipient-grants","profile","family_sharing_pauses","family_sharing_stops"].includes(row.kind))
   .every(row=>row.subjectId===f.self&&row.scope==="requester-account-history")).toBe(true);
  expect(all.filter(row=>row.kind==="account-consents")).toEqual([{subjectId:f.adult,kind:"account-consents",scope:"subject",row:f.historyRows["account-consents"][0]}]);
  const serialized=JSON.stringify(all);expect(serialized).not.toContain(f.context.actor.sessionId);
  expect(serialized).not.toMatch(/credentialFingerprint|runtimeAttestationFingerprint|owner_account_id|account_low_id|account_high_id|objector_principal_id/);
  const indexes=f.inventoryRpc.mock.calls.filter(([,args])=>args.p_kind==="legacy-consents").map(([,args])=>args.p_after_id);
  expect(indexes).toContain(f.historySource["legacy-consents"][499].id);expect(indexes).toContain(f.historySource["legacy-consents"][999].id);
  expect(f.check).toHaveBeenCalled();
 });
 it("renders only source-proved empty metadata arrays without inventing a stored result",async()=>{
  const f=await accountPartitionFixture(0),prepared=await prepareAccountPartitionMembers(f.options);
  const factory=prepared.factories.find(row=>row.name===`subjects/${f.self}/legacy-consents.json`)!;
  expect(factory.rows).toBe(0);expect(await read(factory,f.abort.signal)).toEqual({schemaVersion:"subject-partitioned-archive-v1",rows:[]});
  const emptyPortrait=prepared.factories.find(row=>row.name===`subjects/${f.adult}/portrait.json`)!;
  expect(await read(emptyPortrait,f.abort.signal)).toEqual({schemaVersion:"subject-partitioned-archive-v1",rows:[]});
 });
 it.each(["missing-subject","foreign-subject","missing-self","two-self","wrong-target","foreign-account"])("refuses %s before a member can be accepted",async failure=>{
  const f=await accountPartitionFixture(1);
  if(failure==="wrong-target")f.context.targetKind="subject";
  if(failure==="foreign-account")f.context.targetId=randomUUID();
  if(failure==="missing-subject")f.historySource.subjects.pop();
  if(failure==="foreign-subject"){f.historySource.subjects[0].id=randomUUID();const row=JSON.parse(f.historySource.subjects[0].rowText);row.id=f.historySource.subjects[0].id;f.historySource.subjects[0].rowText=JSON.stringify(row);}
  if(failure==="missing-self"||failure==="two-self"){
   for(const item of f.historySource.subjects){const row=JSON.parse(item.rowText);row.subject_class=failure==="two-self"?"self":"other_adult";item.rowText=JSON.stringify(row);}
   let digest=createHash("sha256").update("account-history-members-v1|subjects").digest();
   for(const item of f.historySource.subjects)digest=createHash("sha256").update(digest).update(`${item.id}:${item.rowText}\n`).digest();
   // Simulate a genuine independent captured source containing the ambiguity,
   // rather than letting the underlying receipt mismatch supply the refusal.
   const entry=f.options.history.inventory.classes.find(row=>row.kind==="subjects")!;
   entry.membershipSha256=digest.toString("hex");f.historyContext.classes.find(row=>row.kind==="subjects")!.membershipSha256=entry.membershipSha256;
  }
  await expect(prepareAccountPartitionMembers(f.options)).rejects.toThrow();
 });
 it.each(ACCOUNT_HISTORY_KINDS)("refuses a changed %s source while rereading the member instead of exporting an old buffered projection",async kind=>{
  const f=await accountPartitionFixture(1),prepared=await prepareAccountPartitionMembers(f.options);
  const sources=f.historySource[kind];if(sources.length){const row=JSON.parse(sources[0].rowText);row.changed_internal=true;sources[0].rowText=JSON.stringify(row);}
  else sources.push({id:randomUUID(),rowText:"{}"});
  const target=kind==="legacy-consents"?"legacy-consents":kind==="attestations"?"attestations":
   ["signatures","account-consents","recipient-grants"].includes(kind)?"consents":"subject";
  await expect(read(prepared.factories.find(row=>row.name===`subjects/${f.self}/${target}.json`)!,f.abort.signal)).rejects.toThrow();
 });
 it.each(Object.keys(accountClassRowSchemas) as AccountProjectedClass[])("refuses an altered %s named source before metadata EOF",async kind=>{
  const f=await accountPartitionFixture(1),prepared=await prepareAccountPartitionMembers(f.options);
  const value=f.classRows[kind][0];value.rowText=JSON.stringify({...JSON.parse(value.rowText),identity_document_key:"forbidden"});
  const member=kind==="attestation_contradictions"?"attestations":kind==="directional_grants"?"consents":kind.startsWith("family_")?"portrait":
   kind.startsWith("future_person_")?"embryos":kind==="suppressions"?"reports":"subject";
  await expect(read(prepared.factories.find(row=>row.name===`subjects/${f.self}/${member}.json`)!,f.abort.signal)).rejects.toThrow();
 });
 it("rechecks current authority after all metadata is prepared and before subsequent bytes",async()=>{
  const f=await accountPartitionFixture(1),prepared=await prepareAccountPartitionMembers(f.options);
  f.check.mockRejectedValue(new Error("current session revoked"));
  await expect(read(prepared.factories[0],f.abort.signal)).rejects.toThrow("current session revoked");
 });
 it("propagates cancellation inside an already buffered paged response and prevents completed member output",async()=>{
  const f=await accountPartitionFixture(1103),prepared=await prepareAccountPartitionMembers(f.options);
  const member=prepared.factories.find(row=>row.name===`subjects/${f.self}/legacy-consents.json`)!,iterator=member.chunks(f.abort.signal)[Symbol.asyncIterator]();
  expect((await iterator.next()).done).toBe(false);expect((await iterator.next()).done).toBe(false);f.abort.abort();
  await expect(iterator.next()).rejects.toThrow();
 });
 it("does not convert actual recorded source/refusal errors into a fabricated empty class",async()=>{
  const f=await accountPartitionFixture(1);f.classRpc.mockResolvedValue({data:null,error:{code:"42501"}});
  await expect(prepareAccountPartitionMembers(f.options)).rejects.toThrow();
 });
 it("bounds the durable authority callback at the unchanged30seconds even when it ignores cancellation",async()=>{
  const f=await accountPartitionFixture(1);vi.useFakeTimers();f.check.mockImplementation(()=>new Promise<void>(()=>{}));
  const pending=prepareAccountPartitionMembers(f.options),refused=expect(pending).rejects.toThrow();
  await vi.advanceTimersByTimeAsync(30001);await refused;expect(vi.getTimerCount()).toBe(0);
 });
});
