import {createHash,randomUUID} from "node:crypto";
import {afterEach,describe,expect,it,vi} from "vitest";
import {ACCOUNT_CLASS_KINDS,accountClassRowSchemas,prepareAccountClassInventory,type AccountClassKind,type AccountClassRpc,type AccountProjectedClass} from "./account-class-inventory";
import type {z} from "zod";
import {claimantArchiveFixture} from "./__fixtures__/claimant-archive";
import type {accountArchiveContextSchema} from "./bound-account-archive-worker";
import {exportMemberPlan} from "@/lib/export/member-plan";
const date="2026-10-01T00:00:00.000Z",science=["embryo_figures","embryo_qc","embryo_scores","embryo_variants","embryos","report_artifacts"];
function fixture(total=1103){
 const accountId=randomUUID(),sessionId=randomUUID(),subjectId:string=randomUUID(),reference={exportId:randomUUID(),attemptId:randomUUID(),authorityReceipt:"a".repeat(64)};
 const context:z.infer<typeof accountArchiveContextSchema>={version:"account-archive-members-v1",targetKind:"account",targetId:accountId,
  authorityReceipt:reference.authorityReceipt,deadline:new Date(Date.now()+600000).toISOString(),capturedAt:date,actor:{accountId,sessionId},
  fileCount:0,partitions:[{subjectId,class:"ordinary",fileCount:0,fileIds:[]}]};
 const prototypes:Record<AccountProjectedClass,Record<string,unknown>>={
  attestation_contradictions:{contradiction_code:"source_refused",lifecycle_revision:2,recorded_at:date,resolved_at:null},
  directional_grants:{grant_revision:3,relationship_or_pair_revision:2,direction:"self",status:"current",created_at:date,ended_at:null},
  family_sharing_pauses:{paused_by_requester:false,ended_by_requester:null,paused_at:date,ended_at:null,end_reason:null},
  family_sharing_stops:{stopped_by_requester:true,ended_at:date},
  future_person_claim_objections:{claim_id:randomUUID(),objection_revision:2,reason_code:"documentary_review",status:"overruled",submitted_at:date,decided_at:date},
  future_person_claimant_principals:{claim_id:randomUUID(),claimant_revision:2,status:"current",created_at:date},
  future_person_claims:{claim_method:"record_key",claim_revision:2,claimant_revision:2,status:"approved",submitted_at:date,decided_at:date},
  subject_control_refusal_authorities:{authority_revision:2,status:"revoked",created_at:date},
  subject_relationships:{relationship_kind:"self",relationship_revision:2,status:"current",created_at:date,ended_at:null},
  suppressions:{condition_id:"synthetic-condition",reason_code:"source_corrected",suppression_revision:2,active_from:date,ended_at:null},
 };
 const rows=Object.fromEntries((Object.keys(prototypes) as AccountProjectedClass[]).map(kind=>[kind,
  Array.from({length:kind==="suppressions"?total:1},()=>{const id=randomUUID();return {id,subjectId:kind.startsWith("family_")?null:subjectId,
   rowText:JSON.stringify({...prototypes[kind],[kind==="directional_grants"?"grant_id":"id"]:id})};}).sort((a,b)=>a.id.localeCompare(b.id))
 ])) as Record<AccountProjectedClass,{id:string;subjectId:string|null;rowText:string}[]>;
 const classes=ACCOUNT_CLASS_KINDS.map(kind=>{
  const selected=rows[kind as AccountProjectedClass]??[];let digest=createHash("sha256").update(`account-class-members-v1|${kind}`).digest();
  for(const row of selected)digest=createHash("sha256").update(digest).update(`${row.id}:${row.subjectId??""}:${row.rowText}\n`).digest();
  return {kind,mode:kind in prototypes?"metadata":science.includes(kind)?"claimed-bound":"unsupported",rows:selected.length,
   membershipSha256:digest.toString("hex"),partitions:selected.some(row=>row.subjectId!==null)?[{subjectId,rows:selected.filter(row=>row.subjectId!==null).length}]:[]};
 });
 const snapshot={version:"account-class-inventory-v1",authorityReceipt:reference.authorityReceipt,classes,boundSnapshots:[] as unknown[]};
 const rpc=vi.fn<AccountClassRpc>(async(_name,args)=>{
  if(args.p_operation==="context")return {data:structuredClone(snapshot),error:null};
  const selected=rows[args.p_kind as AccountProjectedClass].filter(row=>row.id>(args.p_after_id??"")).slice(0,500);
  return {data:{version:"account-class-page-v1",kind:args.p_kind,rows:structuredClone(selected),nextAfterId:selected.length===500?selected.at(-1)!.id:null},error:null};
 });
 const abort=new AbortController(),check=vi.fn(async()=>{});
 return {options:{reference,context,rpc,signal:abort.signal,check},reference,context,rows,snapshot,rpc,abort,check,subjectId};
}
async function collect<T>(rows:AsyncIterable<T>){const out:T[]=[];for await(const row of rows)out.push(row);return out;}
function boundFixture(){
 const f=fixture(1),snapshot=claimantArchiveFixture().snapshot;
 snapshot.authority.authorityReceipt=f.reference.authorityReceipt;
 Object.assign(snapshot.membership,{qualityReports:1,scores:2,figures:3,reports:4});
 f.context.fileCount=1;f.context.partitions.push({subjectId:snapshot.source.subjectId,class:"claimed-bound",fileCount:1,fileIds:[snapshot.source.fileId]});
 f.snapshot.boundSnapshots=[structuredClone(snapshot)];
 const counts={embryo_figures:3,embryo_qc:1,embryo_scores:2,embryo_variants:2,embryos:1,report_artifacts:4};
 for(const e of f.snapshot.classes)if(e.kind in counts){e.rows=counts[e.kind as keyof typeof counts];e.partitions=[{subjectId:snapshot.source.subjectId,rows:e.rows}];}
 return {...f,bound:snapshot};
}
afterEach(()=>{vi.useRealTimers();vi.restoreAllMocks();vi.unstubAllEnvs();});
describe("consumed complete class membership",()=>{
 it("classifies every original public deferred class plus the exact two held Path B classes",()=>{
  const deferred=Object.entries(exportMemberPlan.tables).filter(([key,row])=>key.startsWith("public.")&&row.disposition==="deferred").map(([key])=>key.slice(7));
  expect(new Set(ACCOUNT_CLASS_KINDS)).toEqual(new Set([...deferred,"other_adult_held_uploads","path_b_report_bindings"]));
  expect(ACCOUNT_CLASS_KINDS).toHaveLength(29);
 });
 it("reads every actual named metadata row across three real consumer pages and requires all classes before completion",async()=>{
  const f=fixture(),reader=await prepareAccountClassInventory(f.options);await expect(reader.assertComplete(f.abort.signal)).rejects.toThrow();
  for(const kind of Object.keys(accountClassRowSchemas) as AccountProjectedClass[]){
   const rows=await collect(reader.records(kind,f.abort.signal));
   expect(rows).toEqual(f.rows[kind].map(row=>({subjectId:row.subjectId,row:JSON.parse(row.rowText)})));
  }
  await reader.acceptBoundMembership([],f.abort.signal);await expect(reader.assertComplete(f.abort.signal)).resolves.toBeUndefined();
  expect(f.rpc.mock.calls.filter(([,args])=>args.p_kind==="suppressions").map(([,args])=>args.p_after_id))
   .toEqual([null,f.rows.suppressions[499].id,f.rows.suppressions[999].id]);
  for(const [,args] of f.rpc.mock.calls)expect(Object.keys(args).sort()).toEqual([
   "p_after_id","p_attempt_id","p_authority_receipt","p_export_id","p_kind","p_operation"]);
  expect(JSON.stringify(f.rows)).not.toMatch(/account_low_id|account_high_id|identity_id|intake_session_id|objector_principal_id|reviewed_evidence_id|claimant_account_id/);
 });
 it.each(["missing-class","duplicate-class","unknown-class","foreign-receipt","wrong-mode","unproved-nonempty","foreign-partition"])(
  "refuses %s before a metadata page",async failure=>{
   const f=fixture(1),e=f.snapshot.classes[0];
   if(failure==="missing-class")f.snapshot.classes.pop();if(failure==="duplicate-class")f.snapshot.classes[1]=e;
   if(failure==="unknown-class")e.kind="unknown" as AccountClassKind;if(failure==="foreign-receipt")f.snapshot.authorityReceipt="b".repeat(64);
   if(failure==="wrong-mode")e.mode="metadata";if(failure==="unproved-nonempty")e.rows=1;
   if(failure==="foreign-partition")e.partitions=[{subjectId:randomUUID(),rows:0}];
   await expect(prepareAccountClassInventory(f.options)).rejects.toThrow();expect(f.rpc.mock.calls.every(([,args])=>args.p_operation==="context")).toBe(true);
  });
 it.each(["missing-final-row","duplicate","same-count-changed","foreign-subject","wrong-id","internal-field","wrong-cursor","wrong-class","wrong-distribution"])(
  "refuses %s without proving a complete class",async failure=>{
   const f=fixture(1103),reader=await prepareAccountClassInventory(f.options),rows=f.rows.suppressions;
   if(failure==="missing-final-row")rows.pop();if(failure==="duplicate")rows[1]=rows[0];
   if(failure==="same-count-changed")rows[0].rowText=JSON.stringify({...JSON.parse(rows[0].rowText),reason_code:"changed"});
   if(failure==="foreign-subject")rows[0].subjectId=randomUUID();if(failure==="wrong-id")rows[0].rowText=JSON.stringify({...JSON.parse(rows[0].rowText),id:randomUUID()});
   if(failure==="internal-field")rows[0].rowText=JSON.stringify({...JSON.parse(rows[0].rowText),reviewed_evidence_id:randomUUID()});
   if(failure==="wrong-distribution"){rows[0].subjectId=null;const digest=rows.reduce((d,row)=>createHash("sha256").update(d).update(`${row.id}:${row.subjectId??""}:${row.rowText}\n`).digest(),
    createHash("sha256").update("account-class-members-v1|suppressions").digest());
    // Same captured row/hash, but independent partition count remains wrong.
    const e=f.snapshot.classes.find(e=>e.kind==="suppressions")!;e.membershipSha256=digest.toString("hex");
    const changed=await prepareAccountClassInventory(f.options);await expect(collect(changed.records("suppressions",f.abort.signal))).rejects.toThrow();return;
   }
   if(failure==="wrong-cursor"||failure==="wrong-class"){
    const original=f.rpc.getMockImplementation()!;f.rpc.mockImplementation(async(name,args,signal)=>{
     const answer=await original(name,args,signal);if(args.p_operation==="metadata")Object.assign(answer.data as object,
      failure==="wrong-cursor"?{nextAfterId:null}:{kind:"subject_relationships"});return answer;
    });
   }
   await expect(collect(reader.records("suppressions",f.abort.signal))).rejects.toThrow();await expect(reader.assertComplete(f.abort.signal)).rejects.toThrow();
  });
 it("refuses changed authority after a complete page without accepting its EOF",async()=>{
  const f=fixture(1),reader=await prepareAccountClassInventory(f.options);
  const original=f.rpc.getMockImplementation()!;f.rpc.mockImplementation(async(name,args,signal)=>{
   const value=await original(name,args,signal);if(args.p_operation==="metadata")f.snapshot.authorityReceipt="b".repeat(64);return value;
  });
  await expect(collect(reader.records("suppressions",f.abort.signal))).rejects.toThrow();await expect(reader.assertComplete(f.abort.signal)).rejects.toThrow();
 });
 it("matches all six nonzero bound scientific class counts against the exact complete current source snapshot",async()=>{
  const f=boundFixture(),reader=await prepareAccountClassInventory(f.options);
  await reader.acceptBoundMembership([structuredClone(f.bound)],f.abort.signal);
  await expect(reader.assertComplete(f.abort.signal)).rejects.toThrow();
  for(const kind of Object.keys(accountClassRowSchemas) as AccountProjectedClass[])await collect(reader.records(kind,f.abort.signal));
  await expect(reader.assertComplete(f.abort.signal)).resolves.toBeUndefined();
  expect(reader.inventory.classes.filter(e=>e.mode==="claimed-bound").map(e=>[e.kind,e.rows]))
   .toEqual([["embryo_figures",3],["embryo_qc",1],["embryo_scores",2],["embryo_variants",2],["embryos",1],["report_artifacts",4]]);
 });
 it.each(["missing","duplicate","foreign-file","changed-source","changed-publication","changed-origin","stale-revision","same-total-wrong-partition"])(
  "refuses %s bound membership without accepting scientific classes",async failure=>{
   const f=boundFixture(),reader=await prepareAccountClassInventory(f.options),bound=structuredClone(f.bound);
   const values=[bound];if(failure==="missing")values.pop();if(failure==="duplicate")values.push(bound);
   if(failure==="foreign-file")bound.source.fileId=randomUUID();if(failure==="changed-source")bound.source.sourceSha256="b".repeat(64);
   if(failure==="changed-publication")bound.source.publicationRevision++;
   if(failure==="changed-origin")bound.authority.originBinding="b".repeat(64);
   if(failure==="stale-revision")bound.authority.bindingRevision++;
   if(failure==="same-total-wrong-partition"){const e=f.snapshot.classes.find(e=>e.kind==="embryo_scores")!;e.partitions[0].subjectId=f.subjectId;}
   await expect(reader.acceptBoundMembership(values,f.abort.signal)).rejects.toThrow();
   await expect(reader.assertComplete(f.abort.signal)).rejects.toThrow();
  });
 it("rechecks authority after every class is read before admitting whole-request completion",async()=>{
  const f=fixture(1),reader=await prepareAccountClassInventory(f.options);
  for(const kind of Object.keys(accountClassRowSchemas) as AccountProjectedClass[])await collect(reader.records(kind,f.abort.signal));
  await reader.acceptBoundMembership([],f.abort.signal);f.snapshot.authorityReceipt="b".repeat(64);
  await expect(reader.assertComplete(f.abort.signal)).rejects.toThrow();
 });
 it("bounds the real durable authority callback before any class RPC and refuses ignored cancellation",async()=>{
  vi.useFakeTimers();const f=fixture(1);f.check.mockImplementation(()=>new Promise<void>(()=>{}));
  const pending=prepareAccountClassInventory(f.options),refused=expect(pending).rejects.toThrow();
  await vi.advanceTimersByTimeAsync(30001);await refused;expect(f.rpc).not.toHaveBeenCalled();expect(vi.getTimerCount()).toBe(0);
 });
 it("refuses an already expired bound snapshot before reading metadata",async()=>{
  const f=boundFixture();(f.snapshot.boundSnapshots[0] as typeof f.bound).authority.expiresAt=date;
  await expect(prepareAccountClassInventory(f.options)).rejects.toThrow();
  expect(f.rpc.mock.calls.every(([,args])=>args.p_operation==="context")).toBe(true);
 });
 it("retains the original30 second source operation limit and clears cancellation ownership",async()=>{
  vi.useFakeTimers();const f=fixture(1);f.rpc.mockImplementation(()=>new Promise<{data:unknown;error:unknown}>(()=>{}));
  const pending=prepareAccountClassInventory(f.options),refused=expect(pending).rejects.toThrow();
  await vi.advanceTimersByTimeAsync(30001);await refused;expect(vi.getTimerCount()).toBe(0);
 });
});
