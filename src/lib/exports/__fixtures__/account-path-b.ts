import {createHash,randomUUID} from "node:crypto";
import type {AccountPathBRpc} from "../account-path-b-members";
const date="2026-10-01T00:00:00.000Z";
export function savedPathBFixture(subjectId:string,purpose:"reports.monogenic"|"reports.polygenic"="reports.monogenic"){
 const id=randomUUID(),fileId=randomUUID(),variant={rsid:123,gene:"SYNTHETIC",chrom:1,pos38:100000,ref:"A",alt:"G",interpretations:{AG:"Original saved finding"}},
  template={slug:"synthetic-path-b-result",category:"basic-traits",title:"Stored synthetic report",summary:"Original stored summary.",evidence:"emerging",
   variants:[variant],pgs_id:purpose==="reports.polygenic"?"synthetic-score":null,citations:[{pmid:"12345678",label:"Original source"}],
   layer:purpose==="reports.monogenic"?"variant_call":"estimate",estimate_kind:purpose==="reports.monogenic"?null:"polygenic_score"};
 const value={bindingRevision:1,fileId,subjectId,purpose,completedAt:date,source:{sourceRevision:2,rawSha256:"a".repeat(64),decodedSha256:"b".repeat(64),
  normalizedAt:date,normalizationRevision:2,sourcePublicationRevision:3,variantCount:1,build:"GRCh38",computationRevision:`path-b-reports-v1:${"c".repeat(64)}`,catalogSha256:"c".repeat(64)},
  reports:[{slug:template.slug,covered:true,catalogSnapshot:{schemaVersion:1,templateSha256:"d".repeat(64),template},
   variants:[{rsid:123,outcome:{status:"genotyped",genotype:"A/G",interpretation:"Original saved finding",strandFlipped:false}}],conflictingRsids:[]}],
  prs:purpose==="reports.polygenic"?[{pgs_id:"synthetic-score",raw_score:0.9866666666666667,coverage:1,matched:1}]:[]};
 const record={id,subjectId,rowText:JSON.stringify(value)},digest=createHash("sha256").update("account-class-members-v1|path_b_report_bindings").digest(),
  sha256=createHash("sha256").update(digest).update(`${id}:${subjectId}:${record.rowText}\n`).digest("hex");
 return {value,record,snapshot:{subjectId,records:[record],rows:1,sha256,excludedHeldUploads:1}};
}
export function savedPathBReply(subjectId:string,authorityReceipt:string,saved?:ReturnType<typeof savedPathBFixture>){
 return {data:{version:"account-path-b-results-v1",authorityReceipt,snapshot:saved?.snapshot??{subjectId,records:[],rows:0,
  sha256:createHash("sha256").update("account-class-members-v1|path_b_report_bindings").digest("hex"),excludedHeldUploads:0}},error:null} satisfies Awaited<ReturnType<AccountPathBRpc>>;
}
