import {createHash,randomUUID} from "node:crypto";
import {describe,expect,it,vi} from "vitest";
import {ACCOUNT_HISTORY_KINDS,prepareAccountHistoryInventory,type AccountHistoryKind,type AccountInventoryRpc} from "./account-history-inventory";
import type {z} from "zod";
import type {accountArchiveContextSchema} from "./bound-account-archive-worker";
import {exportedTable} from "@/lib/export/member-plan";
import {accountHistoryRowSchemas} from "./account-history-inventory";
const date="2026-10-01T00:00:00.000Z";
function fixture(total=1103){
 const accountId=randomUUID(),sessionId=randomUUID(),subjectId=randomUUID();
 const reference={exportId:randomUUID(),attemptId:randomUUID(),authorityReceipt:"a".repeat(64)};
 const context:z.infer<typeof accountArchiveContextSchema>={version:"account-archive-members-v1",targetKind:"account",targetId:accountId,
  authorityReceipt:reference.authorityReceipt,deadline:new Date(Date.now()+600000).toISOString(),capturedAt:date,
  actor:{accountId,sessionId},fileCount:0,partitions:[{subjectId,class:"ordinary",fileCount:0,fileIds:[]}]};
 const rows:Record<AccountHistoryKind,{id:string;rowText:string}[]>={"legacy-consents":[],subjects:[],demographics:[],
  principals:[],bindings:[],"account-consents":[],signatures:[],attestations:[],"recipient-grants":[]};
 rows["legacy-consents"]=Array.from({length:total},()=>{const id=randomUUID();return {id,rowText:JSON.stringify({id,
  provider_key:"synthetic-model",data_classes:["reports"],granted_at:date,revoked_at:null},null,1)};}).sort((a,b)=>a.id.localeCompare(b.id));
 rows.subjects=[{id:subjectId,rowText:JSON.stringify({id:subjectId,subject_class:"self",upload_class:"adult",display_label:"Your own record",
  lifecycle:"active",subject_binding_revision:1,lifecycle_revision:1,created_at:date,updated_at:date,portrait_acknowledged_at:null,independent_login_at:null})}];
 const classes=ACCOUNT_HISTORY_KINDS.map(kind=>{let digest=createHash("sha256").update(`account-history-members-v1|${kind}`).digest();
  for(const row of rows[kind])digest=createHash("sha256").update(digest).update(`${row.id}:${row.rowText}\n`).digest();
  return {kind,rows:rows[kind].length,membershipSha256:digest.toString("hex")};});
 const snapshot={version:"account-history-inventory-v1",authorityReceipt:reference.authorityReceipt,classes};
 const rpc=vi.fn<AccountInventoryRpc>(async(_name,args)=>{if(args.p_operation==="context")return {data:structuredClone(snapshot),error:null};
  const selected=rows[args.p_kind!].filter(row=>row.id>(args.p_after_id??"")).slice(0,500);
  return {data:{version:"account-history-page-v1",kind:args.p_kind,rows:structuredClone(selected),nextAfterId:selected.length===500?selected.at(-1)!.id:null},error:null};});
 const abort=new AbortController(),check=vi.fn(async()=>{});
 return {options:{reference,context,rpc,signal:abort.signal,check},reference,context,rows,snapshot,rpc,abort,check};
}
async function all<T>(records:AsyncIterable<T>){const rows:T[]=[];for await(const row of records)rows.push(row);return rows;}
describe("complete consumed history class inventory",()=>{
 it("projects only the explicitly registered columns for every supported own history class",()=>{
  const tables={"legacy-consents":"public.consent_grants",subjects:"public.subjects",demographics:"public.subject_demographics",
   principals:"public.subject_principals",bindings:"public.subject_account_bindings","account-consents":"public.subject_consents",
   signatures:"public.consent_signatures",attestations:"public.attestations","recipient-grants":"public.provider_recipient_grants"} as const;
  for(const kind of ACCOUNT_HISTORY_KINDS){const entry=exportedTable(tables[kind])!;
   expect(entry).toBeDefined();for(const key of Object.keys(accountHistoryRowSchemas[kind].shape)){
    expect(entry.columns).toContain(key);expect(entry.withheld).not.toContain(key);
   }
  }
 });
 it("streams all 1103 source rows, verifies exact canonical-text membership and advances real keyset pages",async()=>{
  const f=fixture(),reader=await prepareAccountHistoryInventory(f.options),rows=await all(reader.records("legacy-consents",f.abort.signal));
  expect(rows).toEqual(f.rows["legacy-consents"].map(row=>JSON.parse(row.rowText)));
  expect(f.rpc.mock.calls.filter(([,a])=>a.p_operation==="history").map(([,a])=>a.p_after_id))
   .toEqual([null,f.rows["legacy-consents"][499].id,f.rows["legacy-consents"][999].id]);
  for(const [,args] of f.rpc.mock.calls)expect(Object.keys(args).sort()).toEqual([
   "p_after_id","p_attempt_id","p_authority_receipt","p_export_id","p_kind","p_operation"]);
 });
 it("accepts a genuinely empty class only with its exact independent empty membership receipt",async()=>{
  const f=fixture(0),reader=await prepareAccountHistoryInventory(f.options);
  expect(await all(reader.records("legacy-consents",f.abort.signal))).toEqual([]);
  expect(await all(reader.records("subjects",f.abort.signal))).toHaveLength(1);
 });
 it.each(["omission","duplicate","foreign","same-count-content","canonical-byte-change","wrong-kind","wrong-cursor","extra-page-field",
  "internal-row-field","source-id-mismatch","foreign-subject"])("refuses %s without treating partial rows as a complete member",async kind=>{
  const f=fixture(3),reader=await prepareAccountHistoryInventory(f.options),base=f.rpc.getMockImplementation()!;
  if(kind==="omission")f.rows["legacy-consents"].pop();
  if(kind==="duplicate")f.rows["legacy-consents"][1]=structuredClone(f.rows["legacy-consents"][0]);
  if(kind==="foreign"){const row=f.rows["legacy-consents"][0];row.id=randomUUID();const body=JSON.parse(row.rowText);body.id=row.id;row.rowText=JSON.stringify(body);}
  if(kind==="same-count-content"){const row=f.rows["legacy-consents"][0],body=JSON.parse(row.rowText);body.data_classes=["different-source"];row.rowText=JSON.stringify(body);}
  if(kind==="canonical-byte-change")f.rows["legacy-consents"][0].rowText=JSON.stringify(JSON.parse(f.rows["legacy-consents"][0].rowText));
  if(kind==="internal-row-field"){const row=f.rows["legacy-consents"][0],body=JSON.parse(row.rowText);body.credentialFingerprint="b".repeat(64);row.rowText=JSON.stringify(body);}
  if(kind==="source-id-mismatch"){const row=f.rows["legacy-consents"][0],body=JSON.parse(row.rowText);body.id=randomUUID();row.rowText=JSON.stringify(body);}
  if(kind==="foreign-subject"){const row=f.rows.subjects[0],body=JSON.parse(row.rowText);row.id=randomUUID();body.id=row.id;row.rowText=JSON.stringify(body);}
  f.rpc.mockImplementation(async(...args)=>{const reply=await base(...args);if(args[1].p_operation==="history"){
   const data=reply.data as {kind:string;nextAfterId:string|null};
   if(kind==="wrong-kind")data.kind="bindings";if(kind==="wrong-cursor")data.nextAfterId=randomUUID();
   if(kind==="extra-page-field")Object.assign(data,{accountId:randomUUID()});
  }return reply;});
  await expect(all(reader.records(kind==="foreign-subject"?"subjects":"legacy-consents",f.abort.signal))).rejects.toThrow();
 });
 it.each(["missing-class","duplicate-class","wrong-receipt","unsafe-count","extra-context"])("refuses %s before any history page",async kind=>{
  const f=fixture(0);if(kind==="missing-class")f.snapshot.classes.pop();
  if(kind==="duplicate-class")f.snapshot.classes[1]=structuredClone(f.snapshot.classes[0]);
  if(kind==="wrong-receipt")f.snapshot.authorityReceipt="c".repeat(64);
  if(kind==="unsafe-count")f.snapshot.classes[0].rows=Number.MAX_SAFE_INTEGER+1;
  if(kind==="extra-context")Object.assign(f.snapshot,{sessionId:randomUUID()});
  await expect(prepareAccountHistoryInventory(f.options)).rejects.toThrow();
  expect(f.rpc.mock.calls.some(([,a])=>a.p_operation==="history")).toBe(false);
 });
 it("refuses changed inventory and actual durable authority between pages and after preparation",async()=>{
  const f=fixture(),reader=await prepareAccountHistoryInventory(f.options),base=f.rpc.getMockImplementation()!;
  f.rpc.mockImplementation(async(...args)=>{const reply=await base(...args);if(args[1].p_operation==="history"){
   f.snapshot.classes[0].rows++;f.check.mockRejectedValue(new Error("current authority revoked"));}return reply;});
  await expect(all(reader.records("legacy-consents",f.abort.signal))).rejects.toThrow("current authority revoked");
  expect(f.rpc.mock.calls.filter(([,a])=>a.p_operation==="history")).toHaveLength(1);
 });
 it("refuses an altered source inventory at EOF even if its current count matches",async()=>{
  const f=fixture(1),reader=await prepareAccountHistoryInventory(f.options);
  f.snapshot.classes[0].membershipSha256="f".repeat(64);
  await expect(all(reader.records("legacy-consents",f.abort.signal))).rejects.toThrow();
 });
 it("keeps the real nullable historical signature fields instead of inventing a purpose or revision",async()=>{
  const f=fixture(0),id=randomUUID();f.rows.signatures=[{id,rowText:JSON.stringify({id,artifact_key:"terms",artifact_version:1,
   artifact_body_sha256:"d".repeat(64),signer_principal_id:randomUUID(),target_kind:"account",target_id:f.context.actor.accountId,
   purpose:null,statement_keys:[],jurisdiction_code:"GB",jurisdiction_revision:1,subject_binding_revision:null,signed_at:date})}];
  let digest=createHash("sha256").update("account-history-members-v1|signatures").digest();
  digest=createHash("sha256").update(digest).update(`${id}:${f.rows.signatures[0].rowText}\n`).digest();
  Object.assign(f.snapshot.classes.find(row=>row.kind==="signatures")!,{rows:1,membershipSha256:digest.toString("hex")});
  const reader=await prepareAccountHistoryInventory(f.options),rows=await all(reader.records("signatures",f.abort.signal));
  expect(rows).toMatchObject([{purpose:null,subject_binding_revision:null}]);
 });
 it.each(["credentialFingerprint","runtimeAttestationFingerprint","apiKey","key_last4"])("rejects nested recipient %s rather than publishing internal authority",async field=>{
  const f=fixture(0),id=randomUUID(),body={id,signature_id:randomUUID(),subject_id:f.context.partitions[0].subjectId,cohort_id:null,
   consent_type:"cloud_model",scope:["copilot"],provider_key:"synthetic-model",grant_revision:1,granted_at:date,expires_at:null,
   revoked_at:null,revocation_reason:null,copilot_recipient:{providerLabel:"Synthetic",origin:"https://model.e2e.local",revision:1,
    providerClass:"cloud",baseUrl:"https://model.e2e.local/v1",provider:"openai_compatible",model:"synthetic",[field]:"secret"}};
  f.rows["account-consents"]=[{id,rowText:JSON.stringify(body)}];
  let digest=createHash("sha256").update("account-history-members-v1|account-consents").digest();
  digest=createHash("sha256").update(digest).update(`${id}:${f.rows["account-consents"][0].rowText}\n`).digest();
  Object.assign(f.snapshot.classes.find(row=>row.kind==="account-consents")!,{rows:1,membershipSha256:digest.toString("hex")});
  const reader=await prepareAccountHistoryInventory(f.options);
  await expect(all(reader.records("account-consents",f.abort.signal))).rejects.toThrow();
 });
 it("preserves the complete recorded recipient destination without inventing or retaining private fingerprints",async()=>{
  const f=fixture(0),id=randomUUID(),copilot_recipient={providerLabel:"Synthetic",origin:"https://model.e2e.local",revision:3,
   providerClass:"cloud",baseUrl:"https://model.e2e.local/v1",provider:"openai_compatible",model:"original-recorded-model"};
  const body={id,signature_id:randomUUID(),subject_id:f.context.partitions[0].subjectId,cohort_id:null,
   consent_type:"cloud_model",scope:["copilot"],provider_key:"synthetic-model",grant_revision:1,granted_at:date,expires_at:null,
   revoked_at:null,revocation_reason:null,copilot_recipient};f.rows["account-consents"]=[{id,rowText:JSON.stringify(body)}];
  let digest=createHash("sha256").update("account-history-members-v1|account-consents").digest();
  digest=createHash("sha256").update(digest).update(`${id}:${f.rows["account-consents"][0].rowText}\n`).digest();
  Object.assign(f.snapshot.classes.find(row=>row.kind==="account-consents")!,{rows:1,membershipSha256:digest.toString("hex")});
  const reader=await prepareAccountHistoryInventory(f.options),rows=await all(reader.records("account-consents",f.abort.signal));
  expect(rows).toEqual([body]);expect(rows[0].copilot_recipient).toEqual(copilot_recipient);
  expect(Object.keys(rows[0].copilot_recipient!).sort()).toEqual(["baseUrl","model","origin","provider","providerClass","providerLabel","revision"]);
 });
 it("refuses cancellation or expiry before reading a buffered class",async()=>{
  const f=fixture(1),reader=await prepareAccountHistoryInventory(f.options);f.abort.abort();
  await expect(all(reader.records("legacy-consents",f.abort.signal))).rejects.toThrow();
  expect(f.rpc.mock.calls.some(([,a])=>a.p_operation==="history")).toBe(false);
  const expired=fixture(0);expired.context.deadline=new Date(Date.now()-1).toISOString();
  await expect(prepareAccountHistoryInventory(expired.options)).rejects.toThrow();expect(expired.rpc).not.toHaveBeenCalled();
 });
 it("stops on cancellation between rows of an already returned source page",async()=>{
  const f=fixture(3),reader=await prepareAccountHistoryInventory(f.options);
  const rows=reader.records("legacy-consents",f.abort.signal);
  expect((await rows.next()).done).toBe(false);f.abort.abort();
  await expect(rows.next()).rejects.toThrow("account_archive_inventory_unavailable");
  expect(f.rpc.mock.calls.filter(([,a])=>a.p_operation==="history")).toHaveLength(1);
 });
});
