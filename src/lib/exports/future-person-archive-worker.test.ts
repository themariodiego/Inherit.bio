import { createHash,randomBytes } from "node:crypto";
import AdmZip from "adm-zip";
import { afterEach,describe,expect,it,vi } from "vitest";
import { encryptSecret } from "@/lib/crypto";
import { syntheticQc,syntheticAbsoluteFinding } from "@/lib/embryos/synthetic";
import type { ArchiveWorkerRpc } from "./archive-persistence";
import { buildClaimantArchive,type ClaimantMemberRpc } from "./future-person-archive-worker";

const ID="38000000-0000-4000-8000-000000000001",SUBJECT="38000000-0000-4000-8000-000000000002";
const RECEIPT="a".repeat(64),PRINCIPAL="b".repeat(64),DATE="2026-09-30T20:00:00.000Z";
afterEach(()=>vi.unstubAllEnvs());
function fixture(){
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
      variantCount:2,publishedAt:DATE},membership:{variants:2,qualityReports:0,scores:0,figures:0,reports:0,agreements:2}};
  const rows=[{id:"9007199254740992",chromosome:1,position:1000,referenceAllele:"A",alternateAllele:"G",genotype:"A/G"},
    {id:"9007199254740993",chromosome:7,position:2000,referenceAllele:"C",alternateAllele:"T",genotype:"C/T"}];
  const quality:unknown[]=[],scores:unknown[]=[];
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
    const page=args.p_after_id===null?(args.p_operation==="scores"?scores:rows):[];
    return {data:args.p_operation==="context"?structuredClone(snapshot):args.p_operation==="agreements"?agreements:
      args.p_operation==="quality"?quality:
      {rows:page,count:page.length,nextAfterId:(page.at(-1) as {id:string}|undefined)?.id??null},error:null};
  });
  const write=vi.fn(async(_attempt:unknown,_segment:unknown,body:Uint8Array)=>{writes.push(body.slice());return {objectId:SUBJECT};});
  const options={job,workerRpc,memberRpc,write,signal:abort.signal};
  return {options,snapshot,rows,agreements,quality,scores,calls,writes,memberRpc,write,abort,revoke:()=>{revoked=true;}};
}
describe("actual claimant member to ZIP64 attempt",()=>{
  it("writes and independently opens every required member, verifying all manifest sizes and hashes",async()=>{
    const f=fixture(),result=await buildClaimantArchive(f.options),all=Buffer.concat(f.writes),zip=new AdmZip(all);
    expect(result.memberCount).toBe(23);expect(zip.getEntries()).toHaveLength(23);
    expect(result.summary).toMatchObject({state:"bytes-complete",sizeBytes:all.length,sha256:createHash("sha256").update(all).digest("hex")});
    const manifest=JSON.parse(zip.readAsText("manifest.json"));expect(manifest.subjectPartitions).toEqual([SUBJECT]);expect(manifest.members).toHaveLength(22);
    for(const member of manifest.members){const value=zip.readFile(member.name)!;expect(value).not.toBeNull();
      expect(value.length).toBe(member.sizeBytes);expect(createHash("sha256").update(value).digest("hex")).toBe(member.sha256);}
    expect(zip.readAsText(`variants/${ID}.csv`)).toBe('chromosome,position,reference_allele,alternate_allele,genotype\n1,1000,"A","G","A/G"\n7,2000,"C","T","C/T"\n');
    const scientific=zip.readAsText(`originals/${ID}/embryo-autosomal-source.jsonl`).trim().split("\n").map(row=>JSON.parse(row));
    expect(scientific.slice(1)).toEqual(f.rows);expect(scientific[0].source.sourceSha256).toBe(RECEIPT);
    const text=zip.readAsText(`subjects/${SUBJECT}/reports.txt`);expect(text).toContain("Signed by: Historical synthetic signer");expect(text).toContain(f.agreements[0].bodyMarkdown);
    const consent=zip.readAsText(`subjects/${SUBJECT}/consents.json`);expect(consent).not.toContain("signingNameCiphertext");
    expect(all.includes(Buffer.from(f.agreements[0].signingNameCiphertext))).toBe(false);
    expect(f.calls.at(-1)?.p_operation).toBe("bytes-complete");expect(f.calls.some(call=>String(call.p_operation)==="ready")).toBe(false);
  });
  it("retains historical own reports outside the current catalog and explicitly withholds every parent/cohort component",async()=>{
    const f=fixture();f.snapshot.membership.qualityReports=1;f.snapshot.membership.scores=1;
    f.quality.push(syntheticQc({parent_a_concordance:0.97,parent_b_concordance:0.98}));
    const finding=syntheticAbsoluteFinding("Your claimed record","retired-synthetic-condition",0.071);
    const {embryo_label,...fields}=finding;void embryo_label;
    f.scores.push({id:SUBJECT,...fields,model_id:"historical-score",model_version:"original",source_binding_fingerprint:RECEIPT,
      computation_revision:2,computed_at:DATE});
    await buildClaimantArchive(f.options);const zip=new AdmZip(Buffer.concat(f.writes));
    const reports=JSON.parse(zip.readAsText(`subjects/${SUBJECT}/reports.json`));expect(reports.rows).toHaveLength(2);
    expect(reports.rows[0].quality.parentConcordanceDisposition).toBe("outside-claimed-subject");
    expect(reports.rows[0].quality).not.toHaveProperty("parent_a_concordance");expect(reports.rows[0].quality).not.toHaveProperty("parent_b_concordance");
    expect(reports.rows[1]).toMatchObject({conditionId:"retired-synthetic-condition",modelId:"historical-score",modelVersion:"original",
      finding:{absoluteRisk:0.071},withholdingReason:"outside-claimed-subject"});
    expect(reports.rows[1].withheldComponents).toHaveLength(8);expect(reports.rows[1].finding).not.toHaveProperty("matched_baseline");
  });
  it.each(["unknown-report","truncated","foreign-field","lost-authority"])("refuses the whole %s attempt before byte completion",async(kind)=>{
    const f=fixture();if(kind==="unknown-report")f.snapshot.membership.reports=1;
    if(kind==="truncated")f.rows.pop();
    if(kind==="foreign-field")Object.assign(f.rows[0],{parentGenotype:"G/G"});
    if(kind==="lost-authority")f.memberRpc.mockImplementation(async()=>{f.revoke();return {data:f.snapshot,error:null};});
    await expect(buildClaimantArchive(f.options)).rejects.toMatchObject({cleanupRequired:true});
    expect(f.calls.some(call=>call.p_operation==="bytes-complete")).toBe(false);expect(f.write).not.toHaveBeenCalled();
  });
  it("retains cleanup responsibility and cannot acknowledge an object after provider-time revocation",async()=>{
    const f=fixture();f.write.mockImplementation(async(_a,_s,body)=>{f.writes.push(body.slice());f.revoke();return {objectId:SUBJECT};});
    await expect(buildClaimantArchive(f.options)).rejects.toMatchObject({cleanupRequired:true});
    expect(f.write).toHaveBeenCalledOnce();expect(f.calls.some(call=>call.p_operation==="acknowledge"||call.p_operation==="bytes-complete")).toBe(false);
  });
});
