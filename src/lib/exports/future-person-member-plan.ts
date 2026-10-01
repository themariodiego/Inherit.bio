import "server-only";
import { LEGAL_AUDIT_SCHEMA_VERSION } from "@/lib/export/legal-audit";
import { exportLegalAuditNote } from "@/copy/settings/data-export";
import { CLAIMANT_LEDGER_UNASSIGNED,CLAIMANT_LEDGER_TEXT_HEADING } from "@/copy/future-person-export";
import { claimantAuditMember } from "./claimant-legal-audit";
import { assertHistoricalJson } from "./historical-embryo-dto";
import { z } from "zod";
import { futurePersonExportSnapshot,projectFuturePersonAgreements,renderFuturePersonAgreement } from "./future-person-content";
import { projectFuturePersonFinding } from "./future-person-report-projection";
import { projectQc,type EmbryoQcRow } from "@/lib/embryos/projection";
import { historicalClaimantScore,historicalClaimantFigure,historicalClaimantReport,
  projectHistoricalClaimantFigure,projectHistoricalClaimantReport,projectHistoricalClaimantQc } from "./future-person-historical-members";


const unavailable=()=>new Error("export unavailable");
const variant=z.object({id:z.string().regex(/^[1-9][0-9]*$/u).refine(v=>BigInt(v)<=BigInt("9223372036854775807")),chromosome:z.number().int().min(1).max(22),position:z.number().int().positive().safe(),
  referenceAllele:z.string().nullable(),alternateAllele:z.string().nullable(),genotype:z.string()}).strict();
const score=historicalClaimantScore;
const page=z.object({rows:z.array(z.unknown()).max(500),nextAfterId:z.string().nullable(),count:z.number().int().min(0).max(500)}).strict();
export type FuturePersonMemberOperation="context"|"agreements"|"quality"|"scores"|"figures"|"reports"|"variants"|"legal-audit";
export type FuturePersonMemberFactory={name:string;rows:number;chunks:(signal:AbortSignal)=>AsyncIterable<Uint8Array>};
const encoder=new TextEncoder();const bytes=(value:string)=>encoder.encode(value);
/** Complete historical claimed-subject member factories shared by the
 * independent-rights and durable bound-own-account executors. This projector
 * supplies no authority: each caller must use its exact scoped SQL door and
 * actual current attempt before/after every call and every member read. */
export async function prepareFuturePersonArchiveMembers(options:{authorityReceipt:string;signal:AbortSignal;
 auditMemberSchema?:z.ZodType<{id:string;event:{seq:number;occurred_at:string;event_code:string;route_id:string;outcome_code:string;coded_context:Record<string,never>|{outcome:"approved"}}}>;
 active:()=>void;check:(signal:AbortSignal)=>Promise<unknown>;
 call:(operation:FuturePersonMemberOperation,signal:AbortSignal,after?:string|null)=>Promise<unknown>}){
 const auditMemberSchema=options.auditMemberSchema??claimantAuditMember;
 const call=options.call,check=options.check,active=options.active,signal=options.signal;
  async function* records<T>(operation:"scores"|"figures"|"reports"|"variants"|"legal-audit",schema:z.ZodType<T>,expectedRows:number,signal:AbortSignal){
    let after:string|null=null,total=0;
    for(;;){const parsed=page.safeParse(await call(operation,signal,after));if(!parsed.success)throw unavailable();const data=parsed.data;
      if(data.count!==data.rows.length||data.nextAfterId!==((data.rows.at(-1) as {id:string}|undefined)?.id??null))throw unavailable();
      if(!data.count){if(total!==expectedRows)throw unavailable();return;}
      for(const raw of data.rows){active();assertHistoricalJson(raw);const row=schema.safeParse(raw);if(!row.success)throw unavailable();const identity=(raw as {id:string}).id;
        if(after!==null&&((operation==="variants"||operation==="legal-audit")?BigInt(identity)<=BigInt(after):identity<=after))throw unavailable();after=identity;
        total++;if(total>expectedRows)throw unavailable();yield row.data;}
    }
  }
  async function prepare(){
    active();
    const parsed=futurePersonExportSnapshot.safeParse(await call("context",signal));if(!parsed.success||parsed.data.authority.authorityReceipt!==options.authorityReceipt)throw unavailable();
    const snapshot=parsed.data;
    const agreements=projectFuturePersonAgreements(await call("agreements",signal));if(agreements.length!==snapshot.membership.agreements)throw unavailable();
    const qcRows=await call("quality",signal);if(!Array.isArray(qcRows)||qcRows.length!==snapshot.membership.qualityReports)throw unavailable();
    const qc=qcRows.map(row=>{
      const complete=projectQc({...row,embryo_id:snapshot.source.subjectId} as EmbryoQcRow);
      return projectHistoricalClaimantQc(complete);
    });
    const subjectId=snapshot.source.subjectId,fileId=snapshot.source.fileId,prefix=`subjects/${subjectId}/`;
    const factories:FuturePersonMemberFactory[]=[];
    const fixed=(name:string,value:unknown,rows=0)=>{const content=bytes(typeof value==="string"?value:JSON.stringify(value)+"\n");factories.push({name,rows,chunks:async function*(current){await check(current);yield content;await check(current);}});};
    const empty={schemaVersion:"subject-partitioned-archive-v1",rows:[]};
    fixed("subjects.json",{schemaVersion:"subject-partitioned-archive-v1",rows:[{subjectId,path:prefix}]},1);
    for(const kind of ["consents","attestations","audit-log","legacy-consents","portrait","embryos"]){
      fixed(`${kind}.json`,{schemaVersion:"subject-partitioned-archive-v1",rows:[{subjectId,path:`${prefix}${kind}.json`}]},1);
      const ownRows=kind==="audit-log"?snapshot.membership.legalAuditEvents:kind==="consents"?agreements.length:kind==="attestations"?agreements.flatMap(row=>row.attestations).length:kind==="embryos"?1:0;
      if(kind==="audit-log")continue;
      fixed(`${prefix}${kind}.json`,kind==="consents"?{schemaVersion:"subject-partitioned-archive-v1",rows:agreements}:kind==="attestations"?
        {schemaVersion:"subject-partitioned-archive-v1",rows:agreements.flatMap(row=>row.attestations)}:kind==="embryos"?
        {schemaVersion:"subject-partitioned-archive-v1",rows:[{source:snapshot.source}]}:empty,ownRows);
    }
    const auditNote=snapshot.legalAudit.attributionStartedAt===null?CLAIMANT_LEDGER_UNASSIGNED:exportLegalAuditNote(
      new Date(snapshot.legalAudit.attributionStartedAt).toLocaleDateString("en-GB",{day:"numeric",month:"long",year:"numeric",timeZone:"UTC"}));
    for(const member of ["legal-audit.json",`${prefix}audit-log.json`])factories.push({name:member,rows:snapshot.membership.legalAuditEvents,
      chunks:async function*(current){
        yield bytes(JSON.stringify({schema_version:LEGAL_AUDIT_SCHEMA_VERSION,note:auditNote,
          attribution_started_at:snapshot.legalAudit.attributionStartedAt}).slice(0,-1)+',"events":[');let comma=false;
        for await(const row of records("legal-audit",auditMemberSchema,snapshot.membership.legalAuditEvents,current)){
          yield bytes((comma?",":"")+JSON.stringify(row.event));comma=true;
        }yield bytes("]}\n");
      }});
    fixed(`${prefix}subject.json`,{schemaVersion:"subject-partitioned-archive-v1",subjectId,subjectClass:"embryo",source:snapshot.source},1);
    for(const kind of ["prs","ancestry","chats"])fixed(`${prefix}${kind}.json`,empty);
    const reportRows=snapshot.membership.scores+qc.length+snapshot.membership.figures+snapshot.membership.reports;
    factories.push({name:`${prefix}reports.json`,rows:reportRows,chunks:async function*(current){
      yield bytes('{"schemaVersion":"future-person-historical-report-v1","rows":[');let comma=false;
      for(const quality of qc){yield bytes((comma?",":"")+JSON.stringify({kind:"quality",quality}));comma=true;}
      for await(const row of records("scores",score,snapshot.membership.scores,current)){
        const projected=projectFuturePersonFinding({embryo_label:"Your claimed record",condition_id:row.condition_id,condition_name:row.condition_name,
          finding:row.finding,evidence_label:row.evidence_label,coverage_state:row.coverage_state,citation_ids:row.citation_ids,not_covered_reason:row.not_covered_reason});
        yield bytes((comma?",":"")+JSON.stringify({kind:"finding",id:row.id,revision:row.computation_revision,computedAt:row.computed_at,modelId:row.model_id,modelVersion:row.model_version,sourceBindingFingerprint:row.source_binding_fingerprint,...projected}));comma=true;
      }
      for await(const row of records("figures",historicalClaimantFigure,snapshot.membership.figures,current)){
        yield bytes((comma?",":"")+JSON.stringify({kind:"historical-figure",...projectHistoricalClaimantFigure(row)}));comma=true;
      }
      for await(const row of records("reports",historicalClaimantReport,snapshot.membership.reports,current)){
        yield bytes((comma?",":"")+JSON.stringify({kind:"historical-report",...projectHistoricalClaimantReport(row)}));comma=true;
      }yield bytes("]}\n");}});
    factories.push({name:`${prefix}reports.txt`,rows:reportRows+snapshot.membership.legalAuditEvents,chunks:async function*(current){
      yield bytes("Your claimed record\nQuality reports\n"+JSON.stringify(qc)+"\n\n");
      for await(const row of records("scores",score,snapshot.membership.scores,current)){
        const projected=projectFuturePersonFinding({embryo_label:"Your claimed record",condition_id:row.condition_id,condition_name:row.condition_name,
          finding:row.finding,evidence_label:row.evidence_label,coverage_state:row.coverage_state,citation_ids:row.citation_ids,not_covered_reason:row.not_covered_reason});
        yield bytes(`${row.condition_name}\nRecorded at: ${row.computed_at}\n${JSON.stringify(projected)}\n\n`);
      }
      for await(const row of records("figures",historicalClaimantFigure,snapshot.membership.figures,current))
        yield bytes(`Historical figure\n${JSON.stringify(projectHistoricalClaimantFigure(row))}\n\n`);
      for await(const row of records("reports",historicalClaimantReport,snapshot.membership.reports,current))
        yield bytes(`Historical report\n${JSON.stringify(projectHistoricalClaimantReport(row))}\n\n`);
      yield bytes(CLAIMANT_LEDGER_TEXT_HEADING+"\n"+auditNote+"\n");
      for await(const row of records("legal-audit",auditMemberSchema,snapshot.membership.legalAuditEvents,current))
        yield bytes(JSON.stringify(row.event)+"\n");
      yield bytes(agreements.map(renderFuturePersonAgreement).join("\n\n"));}});
    const csv=(value:string|null)=>value===null?"":`"${value.replaceAll('"','""')}"`;
    factories.push({name:`variants/${fileId}.csv`,rows:snapshot.membership.variants,chunks:async function*(current){
      yield bytes("chromosome,position,reference_allele,alternate_allele,genotype\n");
      for await(const row of records("variants",variant,snapshot.membership.variants,current))yield bytes(`${row.chromosome},${row.position},${csv(row.referenceAllele)},${csv(row.alternateAllele)},${csv(row.genotype)}\n`);}});
    factories.push({name:`originals/${fileId}/embryo-autosomal-source.jsonl`,rows:snapshot.membership.variants,chunks:async function*(current){
      yield bytes(JSON.stringify({schemaVersion:"sanitized-embryo-calls-v1",source:snapshot.source})+"\n");
      for await(const row of records("variants",variant,snapshot.membership.variants,current))yield bytes(JSON.stringify(row)+"\n");}});
    return {snapshot,factories};
  }
  return prepare();
}
