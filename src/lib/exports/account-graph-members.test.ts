import {createHash,randomUUID} from "node:crypto";
import {describe,expect,it,vi} from "vitest";
import {ACCOUNT_GRAPH_CLASSES,projectAccountGraphRow} from "./account-graph-projection";
import {prepareAccountGraphMembers} from "./account-graph-members";
import type {AccountRoutedGraphRpc} from "./account-routed-graph-rows";
const date="2026-10-01T00:00:00Z";
function fixture(){
 const account=randomUUID(),principal=randomUUID(),counterparty=randomUUID(),subject=randomUUID(),foreignSubject=randomUUID(),cohort=randomUUID(),proposal=randomUUID(),
  abort=new AbortController(),reference={exportId:randomUUID(),attemptId:randomUUID(),authorityReceipt:"a".repeat(64)},
  context={version:"account-archive-members-v1" as const,targetKind:"account" as const,targetId:account,authorityReceipt:reference.authorityReceipt,
   capturedAt:date,deadline:new Date(Date.now()+600000).toISOString(),actor:{accountId:account,sessionId:randomUUID()},fileCount:0,
   partitions:[{subjectId:subject,class:"ordinary" as const,fileCount:0,fileIds:[] as string[]}]},check=vi.fn<(signal:AbortSignal)=>Promise<void>>(async()=>{}),
  physical={embryo_cohorts:{id:cohort,draft_id:randomUUID(),owner_account_id:account,upload_class:"embryo_own",basis_case:"true_two_parent",basis_revision:1,
   participant_set_revision:1,donor_attribution_revision:1,recipient_set_revision:1,key_revision:1,lifecycle_revision:1,ingest_revision:1,publication_revision:null,
   status:"upload_pending",embryo_count:2,retention_expires_at:"2026-11-01T00:00:00Z",created_at:date,uploaded_at:null,qc_failed_at:null},
   embryo_basis_bindings:{cohort_id:cohort,basis_case:"true_two_parent",basis_revision:1,participant_set_revision:1,case_artifact_signature_id:null,
    reviewed_evidence_id:null,legal_review_id:null,artifact_matrix_fingerprint:"f".repeat(64),created_at:date},
   embryo_participant_sets:{cohort_id:cohort,set_kind:"disposition_authorities",principal_id:counterparty,set_revision:1,membership_revision:1,created_at:date,revoked_at:date},
   embryo_donor_attributions:{id:randomUUID(),cohort_id:cohort,donor_slot:"parent_a",donor_principal_id:counterparty,signature_id:null,classification:"identified_pending",attribution_revision:1,created_at:date,revoked_at:null},
   embryo_disposition_proposals:{id:proposal,embryo_id:randomUUID(),proposer_principal_id:principal,disposition:"stored",basis_revision:1,authority_set_revision:1,
    status:"expired",expires_at:"2026-10-02T00:00:00Z",created_at:date,confirmed_at:null},
   embryo_disposition_confirmations:{proposal_id:proposal,confirmer_principal_id:counterparty,authority_revision:1,confirmed_at:date},
   family_pairs:{id:randomUUID(),subject_a_id:subject,subject_b_id:foreignSubject,subject_low_id:[subject,foreignSubject].sort()[0],
    subject_high_id:[subject,foreignSubject].sort()[1],pair_revision:1,status:"current",created_at:date}};
 const projected=Object.fromEntries(ACCOUNT_GRAPH_CLASSES.map(kind=>[kind,projectAccountGraphRow(kind,physical[kind],account,[principal])])),
  replies=Object.fromEntries(ACCOUNT_GRAPH_CLASSES.map(kind=>{const source=projected[kind],row={identity:source.identity,subjectId:subject,scope:"requester-account-history",rowText:JSON.stringify(source.row)},
   root=createHash("sha256").update(`account-graph-routed-v2|${kind}`).digest(),sha256=createHash("sha256").update(root).update(`${row.identity}:${row.subjectId}:${row.scope}:${row.rowText}\n`).digest("hex");
   return [kind,{version:"account-graph-page-v2",kind,authorityReceipt:reference.authorityReceipt,membership:{rows:1,sha256},rows:[row],nextAfterKey:null}];})),
  rpc=vi.fn<AccountRoutedGraphRpc>(async(_name,args)=>({data:structuredClone(replies[args.p_kind]),error:null}));
 return {options:{context,reference,rpc,signal:abort.signal,check},projected,replies,rpc,check,subject,principal,counterparty,foreignSubject,abort};
}
async function bytes(source:AsyncIterable<Uint8Array>){const chunks=[];for await(const chunk of source)chunks.push(Buffer.from(chunk));return Buffer.concat(chunks).toString();}
describe("all seven consumed graph factory protocols, with mocked service transport",()=>{
 it("retains every exact safe projection once with requester-relative scope and no counterpart identity or source permission",async()=>{
  const f=fixture(),prepared=await prepareAccountGraphMembers(f.options);expect(prepared.receipts).toEqual(ACCOUNT_GRAPH_CLASSES.map(kind=>({kind,rows:1,
   membershipSha256:f.replies[kind].membership.sha256,partitions:[{subjectId:f.subject,rows:1}]})));
  expect(prepared.factories.map(m=>m.name)).toEqual([`subjects/${f.subject}/portrait.json`,`subjects/${f.subject}/embryos.json`]);
  for(const member of prepared.factories){const content=JSON.parse(await bytes(member.chunks(f.abort.signal))),kinds=member.name.endsWith("portrait.json")?["family_pairs"]:ACCOUNT_GRAPH_CLASSES.filter(k=>k!=="family_pairs");
   expect(content.rows).toEqual(kinds.map(kind=>({kind,scope:"requester-account-history",row:f.projected[kind].row})));expect(content.rows).toHaveLength(member.rows);
   const text=JSON.stringify(content);for(const forbidden of [f.principal,f.counterparty,f.foreignSubject,f.options.context.actor.sessionId])expect(text).not.toContain(forbidden);
  }
  expect(new Set(f.rpc.mock.calls.map(([,args])=>args.p_kind))).toEqual(new Set(ACCOUNT_GRAPH_CLASSES));await prepared.check(f.abort.signal);
 });
 it("refuses a same-count routed source change before a member admits any source content",async()=>{
  const f=fixture(),prepared=await prepareAccountGraphMembers(f.options),pair=f.replies.family_pairs;
  pair.rows[0].rowText=JSON.stringify({...f.projected.family_pairs.row,pair_revision:2});
  await expect(bytes(prepared.factories[0].chunks(f.abort.signal))).rejects.toThrow();
 });
 it("requires all seven source classes before returning any member",async()=>{
  const f=fixture();f.rpc.mockImplementation(async(_name,args)=>args.p_kind==="embryo_disposition_confirmations"?{data:null,error:{code:"42501"}}:{data:structuredClone(f.replies[args.p_kind]),error:null});
  await expect(prepareAccountGraphMembers(f.options)).rejects.toThrow();
 });
});
