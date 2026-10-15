import {createHash,randomBytes} from "node:crypto";
import {vi} from "vitest";
import {encryptSecret} from "@/lib/crypto";
import type {ArchiveWorkerRpc} from "../archive-persistence";
import type {ClaimantMemberRpc} from "../future-person-archive-worker";
const ID="38000000-0000-4000-8000-000000000001",SUBJECT="38000000-0000-4000-8000-000000000002";
const RECEIPT="a".repeat(64),PRINCIPAL="b".repeat(64),DATE="2026-09-30T20:00:00.000Z";
export function claimantArchiveFixture(){
  vi.stubEnv("BYOK_ENCRYPTION_KEY",randomBytes(32).toString("base64"));
  const agreements=["consent.upload-embryo","charter.future-person"].map(artifactKey=>{
    const bodyMarkdown=`Synthetic historical signed ${artifactKey}`,sha=createHash("sha256").update(bodyMarkdown).digest("hex");
    return {version:"future-person-agreement-v2",artifactKey,artifactVersion:1,bodySha256:sha,recomputedBodySha256:sha,
      bodyMarkdown,statementKeys:["individual-affirmation"],signedAt:DATE,
      signaturePurpose:artifactKey==="consent.upload-embryo"?"embryo-upload-parent-class":"future-person-charter-acknowledgement",
      recordedRole:artifactKey==="consent.upload-embryo"?"parent":"owner",signingNameCiphertext:encryptSecret("Historical synthetic signer").toString("hex"),
      signaturePrincipalPseudonym:RECEIPT,jurisdictionCode:"GB",jurisdictionRevision:2,
      attestations:[{kind:"genetic_parent",statementKeys:["recorded-parent"],affirmed:true,revision:1,affirmedAt:DATE}],
      review:{kind:"approve-record-key",decidedAt:DATE,outcome:"approved",reviewerPrincipalPseudonym:PRINCIPAL}};
  });
  const snapshot={authority:{principalId:ID,subjectId:SUBJECT,originBinding:RECEIPT,authorityReceipt:RECEIPT,lifecycleRevision:3,
    bindingRevision:4,credentialRevision:5,expiresAt:new Date(Date.now()+600_000).toISOString()},
    source:{fileId:ID,subjectId:SUBJECT,referenceBuild:"GRCh38",sourceSha256:RECEIPT,membershipSha256:RECEIPT,publicationRevision:1,
      variantCount:2,publishedAt:DATE},membership:{variants:2,qualityReports:0,scores:0,figures:0,reports:0,agreements:2,legalAuditEvents:0},legalAudit:{attribution:"assigned",attributionStartedAt:DATE}};
  const rows=[{id:"9007199254740992",chromosome:1,position:1000,referenceAllele:"A",alternateAllele:"G",genotype:"A/G"},
    {id:"9007199254740993",chromosome:7,position:2000,referenceAllele:"C",alternateAllele:"T",genotype:"C/T"}];
  const quality:unknown[]=[],scores:unknown[]=[],figures:unknown[]=[],reports:unknown[]=[],audit:unknown[]=[];
  const job={exportId:ID,principalHash:PRINCIPAL,authorityReceipt:RECEIPT,deadline:new Date(Date.now()+600_000).toISOString()};
  const abort=new AbortController(),calls:Parameters<ArchiveWorkerRpc>[1][]=[],writes:Uint8Array[]=[];
  let revoked=false;
  const workerRpc:ArchiveWorkerRpc=(_name,args)=>{calls.push(args);return {retry:()=>({abortSignal:async()=>{
    if(revoked)return {data:null,error:{code:"42501"}};
    const leaseExpiresAt=new Date(Date.now()+300_000).toISOString();let data:unknown;
    switch(args.p_operation){
      case "preflight":data={authorityReceipt:RECEIPT,principalHash:PRINCIPAL,deadline:job.deadline};break;
      case "begin":data={attemptId:args.p_attempt_id,principalHash:PRINCIPAL,leaseExpiresAt};break;
      case "renew":data={authorityReceipt:RECEIPT,leaseExpiresAt};break;
      case "reserve":case "acknowledge":data={ordinal:args.p_payload!.ordinal,authorityReceipt:RECEIPT};break;
      case "page":data={page:args.p_payload!.page,authorityReceipt:RECEIPT};break;
      case "bytes-complete":data={state:"bytes-complete",authorityReceipt:RECEIPT,sizeBytes:args.p_payload!.sizeBytes,
        segmentCount:args.p_payload!.segmentCount,pageCount:args.p_payload!.pageCount};break;
    }return {data,error:null};}})};};
  const memberRpc=vi.fn<ClaimantMemberRpc>(async(_name,args)=>{
    const page=args.p_after_id===null?(args.p_operation==="scores"?scores:args.p_operation==="figures"?figures:args.p_operation==="reports"?reports:args.p_operation==="legal-audit"?audit:rows):[];
    return {data:args.p_operation==="context"?structuredClone(snapshot):args.p_operation==="agreements"?agreements:
      args.p_operation==="quality"?quality:
      {rows:page,count:page.length,nextAfterId:(page.at(-1) as {id:string}|undefined)?.id??null},error:null};
  });
  const write=vi.fn(async(_attempt:unknown,_segment:unknown,body:Uint8Array)=>{writes.push(body.slice());return {objectId:SUBJECT};});
  const options={job,workerRpc,memberRpc,write,signal:abort.signal};
  return {options,snapshot,rows,agreements,quality,scores,figures,reports,audit,calls,writes,memberRpc,write,abort,revoke:()=>{revoked=true;}};
}
