import { createHash } from "node:crypto";
import AdmZip from "adm-zip";
import { afterEach,describe,expect,it,vi } from "vitest";
import {generatedProducerMembers,producerArchiveMembers} from "@/lib/export/archive-producers";
import { syntheticQc,syntheticAbsoluteFinding } from "@/lib/embryos/synthetic";
import {claimantArchiveFixture} from "./__fixtures__/claimant-archive";
import { buildClaimantArchive } from "./future-person-archive-worker";

const ID="38000000-0000-4000-8000-000000000001",SUBJECT="38000000-0000-4000-8000-000000000002";
const RECEIPT="a".repeat(64),DATE="2026-09-30T20:00:00.000Z";
afterEach(()=>vi.unstubAllEnvs());

describe("actual claimant member to ZIP64 attempt",()=>{
  it("writes and independently opens every required member, verifying all manifest sizes and hashes",async()=>{
    const f=claimantArchiveFixture(),result=await buildClaimantArchive(f.options),all=Buffer.concat(f.writes),zip=new AdmZip(all);
    expect(result.memberCount).toBe(23);expect(zip.getEntries()).toHaveLength(23);
    expect(generatedProducerMembers(zip.getEntries().map(entry=>entry.entryName),"approved-unbound"))
      .toEqual(producerArchiveMembers("approved-unbound"));
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
    const f=claimantArchiveFixture();f.snapshot.membership.qualityReports=1;f.snapshot.membership.scores=1;
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
  it("preserves mixed genuine classification versions inside the actual archive without retroclassifying legacy records",async()=>{
    const f=claimantArchiveFixture();f.snapshot.membership.qualityReports=1;f.snapshot.membership.scores=2;f.snapshot.membership.figures=2;f.snapshot.membership.reports=2;
    const quality=syntheticQc();f.quality.push(quality);
    const current=syntheticAbsoluteFinding("Embryo 1","recorded-new-condition",0.03);
    const original=syntheticAbsoluteFinding("Embryo 1","retired-original-condition",0.071);
    const {schema_version:_v,figure_basis:_b,...oldBody}=original.finding!;void _v;void _b;
    const legacy={...original,finding:oldBody};
    [legacy,current].forEach((record,index)=>{
      const {embryo_label,...fields}=record;void embryo_label;
      const findingRecord={id:index===0?ID:SUBJECT,...fields,model_id:"genuine-recorded-model",model_version:"original",
        source_binding_fingerprint:RECEIPT,computation_revision:1,computed_at:DATE};f.scores.push(findingRecord);
      f.figures.push({id:`48000000-0000-4000-8000-00000000000${index+1}`,finding_id:findingRecord.id,figure_kind:"absolute_risk",
        payload:structuredClone(record.finding),figure_revision:1,created_at:DATE,findingRecord:structuredClone(findingRecord)});
      f.reports.push({id:`58000000-0000-4000-8000-00000000000${index+1}`,report_kind:"saved-own-finding",report_revision:1,
        source_binding_fingerprint:RECEIPT,artifact:structuredClone(record),created_at:DATE,embryoId:ID});
    });
    await buildClaimantArchive(f.options);const zip=new AdmZip(Buffer.concat(f.writes));
    const json=JSON.parse(zip.readAsText(`subjects/${SUBJECT}/reports.json`)),text=zip.readAsText(`subjects/${SUBJECT}/reports.txt`);
    expect(json.rows).toHaveLength(7);expect(json.rows[0].quality.figure_basis).toEqual(quality.figure_basis);
    const oldRows=[json.rows[1],json.rows[3],json.rows[5].component],newRows=[json.rows[2],json.rows[4],json.rows[6].component];
    for(const row of oldRows){expect(row.classification).toEqual({sourceShape:"legacy-v1",figureBasis:null,classificationDisposition:"unrecorded"});
      expect(row.finding??row.component).toHaveProperty("absoluteRisk",0.071);expect(text).toContain(JSON.stringify(row.classification));}
    for(const row of newRows){expect(row.classification).toEqual({sourceShape:"finding-v2",schemaVersion:2,figureBasis:{version:1,basis:"modelled"}});
      expect(row.finding??row.component).toHaveProperty("absoluteRisk",0.03);expect(text).toContain(JSON.stringify(row.classification));}
    expect(legacy.finding).not.toHaveProperty("schema_version");expect(legacy.finding).not.toHaveProperty("figure_basis");
    for(const member of JSON.parse(zip.readAsText("manifest.json")).members){const body=zip.readFile(member.name)!;
      expect(body.length).toBe(member.sizeBytes);expect(createHash("sha256").update(body).digest("hex")).toBe(member.sha256);}
    expect(f.calls.at(-1)?.p_operation).toBe("bytes-complete");
  });
  it("includes every genuinely attributed own ledger event in both exact members and readable text",async()=>{
    const f=claimantArchiveFixture();f.snapshot.membership.legalAuditEvents=2;
    const events=[{seq:1,occurred_at:DATE,event_code:"claimant.analysis_stopped",route_id:"api.future-person-analysis-stop",outcome_code:"accepted",coded_context:{}},
      {seq:9,occurred_at:DATE,event_code:"claimant.deletion_requested",route_id:"api.future-person-delete",outcome_code:"accepted",coded_context:{}}];
    f.audit.push(...events.map(event=>({id:String(event.seq),event})));await buildClaimantArchive(f.options);
    const zip=new AdmZip(Buffer.concat(f.writes)),text=zip.readAsText(`subjects/${SUBJECT}/reports.txt`);
    for(const path of ["legal-audit.json",`subjects/${SUBJECT}/audit-log.json`]){
      const ledger=JSON.parse(zip.readAsText(path));expect(ledger.events).toEqual(events);
      expect(ledger.schema_version).toBe("legal-audit-v1");expect(ledger.attribution_started_at).toBe(DATE);
      expect(Object.keys(ledger).sort()).toEqual(["attribution_started_at","events","note","schema_version"]);
      expect(Object.keys(ledger.events[0]).sort()).toEqual(["coded_context","event_code","occurred_at","outcome_code","route_id","seq"]);
    }
    for(const event of events)expect(text).toContain(JSON.stringify(event));
    const manifest=JSON.parse(zip.readAsText("manifest.json"));
    for(const name of ["legal-audit.json",`subjects/${SUBJECT}/audit-log.json`,`subjects/${SUBJECT}/reports.txt`])expect(manifest.members.find((row:{name:string})=>row.name===name).rows).toBe(2);
    expect(manifest.members.find((row:{name:string})=>row.name===`subjects/${SUBJECT}/reports.json`).rows).toBe(0);
    for(const member of manifest.members){const body=zip.readFile(member.name)!;expect(body.length).toBe(member.sizeBytes);
      expect(createHash("sha256").update(body).digest("hex")).toBe(member.sha256);}
    expect(JSON.stringify(zip.getEntries().map(entry=>zip.readAsText(entry)))).not.toMatch(/audit_principal_id|previous_hash|row_hash|subject_ciphertext/);
  });
  it("includes only the exact newly attributable approved release tuple in actual ZIP JSON and text",async()=>{
    const f=claimantArchiveFixture();f.snapshot.membership.legalAuditEvents=1;
    const event={seq:2,occurred_at:DATE,event_code:"claim.resolved",route_id:"api.future-person-claim-release",outcome_code:"accepted",coded_context:{outcome:"approved"}};
    f.audit.push({id:"2",event});await buildClaimantArchive(f.options);const zip=new AdmZip(Buffer.concat(f.writes));
    for(const name of ["legal-audit.json",`subjects/${SUBJECT}/audit-log.json`])expect(JSON.parse(zip.readAsText(name)).events).toEqual([event]);
    expect(zip.readAsText(`subjects/${SUBJECT}/reports.txt`)).toContain(JSON.stringify(event));
    const manifest=JSON.parse(zip.readAsText("manifest.json"));for(const member of manifest.members){const bytes=zip.readFile(member.name)!;
      expect(bytes.length).toBe(member.sizeBytes);expect(createHash("sha256").update(bytes).digest("hex")).toBe(member.sha256);}
  });
  it.each(["wrong-route","refused","wrong-code","empty-code","private-context","actor","legacy-attribution"])("refuses %s substituted resolution from every archive member",async kind=>{
    const f=claimantArchiveFixture();f.snapshot.membership.legalAuditEvents=1;
    const event={seq:2,occurred_at:DATE,event_code:"claim.resolved",route_id:"api.future-person-claim-release",outcome_code:"accepted",coded_context:{outcome:"approved"}};
    if(kind==="wrong-route")event.route_id="api.future-person-delete";if(kind==="refused")event.outcome_code="refused";
    if(kind==="wrong-code")event.coded_context.outcome="released";if(kind==="empty-code")Object.assign(event,{coded_context:{}});
    if(kind==="private-context")Object.assign(event.coded_context,{name:"Synthetic Claimant"});if(kind==="actor")Object.assign(event,{audit_principal_id:SUBJECT});
    if(kind==="legacy-attribution")Object.assign(f.snapshot.legalAudit,{attribution:"unrecorded",attributionStartedAt:null});
    f.audit.push({id:"2",event});await expect(buildClaimantArchive(f.options)).rejects.toMatchObject({cleanupRequired:true});
    expect(f.write).not.toHaveBeenCalled();expect(f.calls.some(call=>call.p_operation==="bytes-complete")).toBe(false);
  });
  it("keeps genuine legacy unassigned records empty with a count-free explanation",async()=>{
    const f=claimantArchiveFixture();Object.assign(f.snapshot.legalAudit,{attribution:"unrecorded",attributionStartedAt:null});
    await buildClaimantArchive(f.options);const zip=new AdmZip(Buffer.concat(f.writes));
    const ledger=JSON.parse(zip.readAsText("legal-audit.json"));expect(ledger.events).toEqual([]);expect(ledger.attribution_started_at).toBeNull();
    expect(ledger.note).toContain("do not say who acted");expect(ledger.note).toContain("does not mean that nothing happened");
  });
  it.each(["missing-event","wrong-order","wrong-sequence","actor-field","nested-contact","unknown-event","wrong-route","wrong-outcome","unassigned-event"])("refuses %s ledger material before any ZIP object or byte completion",async kind=>{
    const f=claimantArchiveFixture();f.snapshot.membership.legalAuditEvents=2;
    const first={id:"1",event:{seq:1,occurred_at:DATE,event_code:"claimant.analysis_stopped",route_id:"api.future-person-analysis-stop",outcome_code:"accepted",coded_context:{}}};
    const second=structuredClone(first);second.id="2";second.event.seq=2;f.audit.push(first,second);
    if(kind==="missing-event")f.audit.pop();if(kind==="wrong-order")f.audit.reverse();if(kind==="wrong-sequence")first.event.seq=9;
    if(kind==="actor-field")Object.assign(first.event,{audit_principal_id:SUBJECT});
    if(kind==="nested-contact")Object.assign(first.event.coded_context,{nested:{email:"synthetic@e2e.local"}});
    if(kind==="unknown-event")first.event.event_code="unregistered.action";if(kind==="wrong-route")first.event.route_id="api.future-person-delete";
    if(kind==="wrong-outcome")first.event.outcome_code="purged";
    if(kind==="unassigned-event")Object.assign(f.snapshot.legalAudit,{attribution:"unrecorded",attributionStartedAt:null});
    await expect(buildClaimantArchive(f.options)).rejects.toMatchObject({cleanupRequired:true});expect(f.write).not.toHaveBeenCalled();
    expect(f.calls.some(call=>call.p_operation==="bytes-complete")).toBe(false);
  });
  it("refuses an accessor in a ledger wrapper before invoking it",async()=>{
    const f=claimantArchiveFixture();f.snapshot.membership.legalAuditEvents=1;const getter=vi.fn(()=>({seq:1}));
    const row={id:"1"};Object.defineProperty(row,"event",{enumerable:true,get:getter});f.audit.push(row);
    await expect(buildClaimantArchive(f.options)).rejects.toMatchObject({cleanupRequired:true});expect(getter).not.toHaveBeenCalled();expect(f.write).not.toHaveBeenCalled();
  });
  it.each(["unknown-report","truncated","foreign-field","lost-authority"])("refuses the whole %s attempt before byte completion",async(kind)=>{
    const f=claimantArchiveFixture();if(kind==="unknown-report")f.snapshot.membership.reports=1;
    if(kind==="truncated")f.rows.pop();
    if(kind==="foreign-field")Object.assign(f.rows[0],{parentGenotype:"G/G"});
    if(kind==="lost-authority")f.memberRpc.mockImplementation(async()=>{f.revoke();return {data:f.snapshot,error:null};});
    await expect(buildClaimantArchive(f.options)).rejects.toMatchObject({cleanupRequired:true});
    expect(f.calls.some(call=>call.p_operation==="bytes-complete")).toBe(false);expect(f.write).not.toHaveBeenCalled();
  });
  it("retains every bound historical figure and exact registered report component in both complete members",async()=>{
    const f=claimantArchiveFixture();f.snapshot.membership.scores=1;f.snapshot.membership.figures=4;f.snapshot.membership.reports=3;
    const detail=syntheticAbsoluteFinding("Embryo 3","retired-historical-condition",0.071);
    const {embryo_label,...fields}=detail;void embryo_label;
    const findingRecord={id:SUBJECT,...fields,model_id:"retired-historical-score",model_version:"old",source_binding_fingerprint:RECEIPT,computation_revision:2,computed_at:DATE};
    f.scores.push(findingRecord);const full=detail.finding!;if(full.kind!=="absolute_risk")throw new Error("synthetic absolute finding expected");
    const kinds=["absolute_risk","interval","natural_frequency","within_family"] as const;
    const payloads=[full,{interval_low:full.interval_low,interval_high:full.interval_high},full.natural_frequency,full.within_family];
    kinds.forEach((figure_kind,index)=>f.figures.push({id:`48000000-0000-4000-8000-00000000000${index+1}`,finding_id:SUBJECT,
      figure_kind,payload:structuredClone(payloads[index]),figure_revision:3,created_at:DATE,findingRecord:structuredClone(findingRecord)}));
    const artifacts=[detail,{id:ID,cohort_id:"49000000-0000-4000-8000-000000000001",sample_ordinal:2,display_label:detail.embryo_label,
      status:"stored",qc:syntheticQc({parent_a_concordance:0.97,parent_b_concordance:0.98}),findings:[detail]},syntheticQc()];
    artifacts.forEach((artifact,index)=>f.reports.push({id:`58000000-0000-4000-8000-00000000000${index+1}`,report_kind:`historical-component-${index}`,
      report_revision:4,source_binding_fingerprint:RECEIPT,artifact,created_at:DATE,embryoId:ID}));
    await buildClaimantArchive(f.options);const zip=new AdmZip(Buffer.concat(f.writes));
    const json=JSON.parse(zip.readAsText(`subjects/${SUBJECT}/reports.json`)),text=zip.readAsText(`subjects/${SUBJECT}/reports.txt`);
    expect(json.rows).toHaveLength(8);expect(json.rows.filter((row:{kind:string})=>row.kind==="historical-figure")).toHaveLength(4);
    expect(json.rows.filter((row:{kind:string})=>row.kind==="historical-report")).toHaveLength(3);
    for(const row of json.rows.slice(1)){expect(text).toContain(row.id);expect(row.revision).toBe(row.kind==="historical-figure"?3:4);}
    expect(zip.readAsText(`subjects/${SUBJECT}/reports.json`)).not.toContain("Embryo 3");
    expect(JSON.stringify(json)).not.toContain("49000000-0000-4000-8000-000000000001");
    const ownKeys=(value:unknown):string[]=>value&&typeof value==="object"?
      [...Object.keys(value),...Object.values(value).flatMap(ownKeys)]:[];
    expect(ownKeys(json)).not.toEqual(expect.arrayContaining(["parent_a_concordance","parent_b_concordance","comparator_numerator","matched_baseline"]));
    expect(json.rows[1].withheldComponents).toEqual(json.rows[0].withheldComponents);
    const manifest=JSON.parse(zip.readAsText("manifest.json"));
    expect(manifest.members.find((row:{name:string})=>row.name===`subjects/${SUBJECT}/reports.json`).rows).toBe(8);
    for(const member of manifest.members){const body=zip.readFile(member.name)!;expect(body.length).toBe(member.sizeBytes);expect(createHash("sha256").update(body).digest("hex")).toBe(member.sha256);}
    expect(f.calls.at(-1)?.p_operation).toBe("bytes-complete");
  });
  it.each(["wrong-finding","wrong-payload","wrong-report-subject","unknown-shape"])("refuses %s historical material before any archive bytes",async kind=>{
    const f=claimantArchiveFixture();const detail=syntheticAbsoluteFinding("Embryo 2","historical-condition",0.071);
    const {embryo_label,...fields}=detail;void embryo_label;
    const findingRecord={id:SUBJECT,...fields,model_id:"retired-score",model_version:"old",source_binding_fingerprint:RECEIPT,computation_revision:2,computed_at:DATE};
    if(kind.startsWith("wrong-finding")||kind==="wrong-payload"){
      f.snapshot.membership.figures=1;f.figures.push({id:ID,finding_id:kind==="wrong-finding"?ID:SUBJECT,
        figure_kind:"absolute_risk",payload:kind==="wrong-payload"?{...detail.finding,absolute_risk:0.2}:detail.finding,
        figure_revision:1,created_at:DATE,findingRecord});
    }else{
      f.snapshot.membership.reports=1;f.reports.push({id:SUBJECT,report_kind:"old-stored-report",report_revision:1,
        source_binding_fingerprint:RECEIPT,created_at:DATE,embryoId:ID,artifact:kind==="unknown-shape"?{foreignGenotype:"G/G"}:
          {id:SUBJECT,cohort_id:ID,sample_ordinal:1,display_label:detail.embryo_label,status:"stored",qc:syntheticQc(),findings:[detail]}});
    }
    await expect(buildClaimantArchive(f.options)).rejects.toMatchObject({cleanupRequired:true});expect(f.write).not.toHaveBeenCalled();
    expect(f.calls.some(call=>call.p_operation==="bytes-complete")).toBe(false);
  });
  it("retains cleanup responsibility and cannot acknowledge an object after provider-time revocation",async()=>{
    const f=claimantArchiveFixture();f.write.mockImplementation(async(_a,_s,body)=>{f.writes.push(body.slice());f.revoke();return {objectId:SUBJECT};});
    await expect(buildClaimantArchive(f.options)).rejects.toMatchObject({cleanupRequired:true});
    expect(f.write).toHaveBeenCalledOnce();expect(f.calls.some(call=>call.p_operation==="acknowledge"||call.p_operation==="bytes-complete")).toBe(false);
  });
});
