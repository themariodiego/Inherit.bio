import { describe, expect, it, vi } from "vitest";
import { syntheticAbsoluteFinding, syntheticQc } from "@/lib/embryos/synthetic";
import { projectHistoricalClaimantFigure, projectHistoricalClaimantQc, projectHistoricalClaimantReport } from "./future-person-historical-members";

const id="68000000-0000-4000-8000-000000000001", other="68000000-0000-4000-8000-000000000002", hash="a".repeat(64), date="2026-09-30T20:00:00.000Z";
function figure(kind="absolute_risk") {
  const record=syntheticAbsoluteFinding("Embryo 1","retired-condition",0.071), {embryo_label,...fields}=record;void embryo_label;
  if(record.finding?.kind!=="absolute_risk")throw new Error("synthetic finding expected");const finding=record.finding;
  const payload=kind==="interval"?{interval_low:finding.interval_low,interval_high:finding.interval_high}:kind==="natural_frequency"?finding.natural_frequency:
    kind==="within_family"?finding.within_family:finding;
  return {id, finding_id:other,figure_kind:kind,payload:structuredClone(payload),figure_revision:3,created_at:date,
    findingRecord:{id:other,...fields,model_id:"retired-model",model_version:"original",source_binding_fingerprint:hash,computation_revision:2,computed_at:date}};
}
function report(artifact:unknown=syntheticAbsoluteFinding("Embryo 1","retired-condition",0.071)) {
  return {id,report_kind:"recorded-old-report",report_revision:3,source_binding_fingerprint:hash,artifact,created_at:date,embryoId:other};
}
describe("closed historical report and figure evidence",()=>{
  it.each(["absolute_risk","interval","natural_frequency","within_family"])("retains exact stored %s figures with their bound finding revision",kind=>{
    const source=figure(kind), result=projectHistoricalClaimantFigure(source);
    expect(result).toMatchObject({id,findingId:other,figureKind:kind,revision:3,findingRevision:2,modelId:"retired-model",modelVersion:"original",sourceBindingFingerprint:hash});
    if(kind==="absolute_risk")expect(result.component).toMatchObject({absoluteRisk:0.071});
    if(kind==="interval")expect(result.component).toEqual({intervalLow:0.071*0.8,intervalHigh:0.071*1.25});
    if(kind==="natural_frequency"){expect(result.component).toEqual({subjectNumerator:5,denominator:100,fallbackCopyId:null});
      expect(result.withheldComponents).toEqual(["natural_frequency.comparator_numerator"]);}
    expect(source.findingRecord.finding).toHaveProperty("matched_baseline");
  });
  it.each(["wrong-finding","wrong-number","unknown-key","missing-field","unsupported-kind"])("refuses %s instead of recreating missing historical figure evidence",kind=>{
    const row=figure();
    if(kind==="wrong-finding")row.finding_id=id;
    if(kind==="wrong-number")Object.assign(row.payload!,{absolute_risk:0.5});
    if(kind==="unknown-key")Object.assign(row.payload!,{parentGenotype:"G/G"});
    if(kind==="missing-field")delete (row.payload as Record<string,unknown>).within_family;
    if(kind==="unsupported-kind")row.figure_kind="unrecorded";
    expect(()=>projectHistoricalClaimantFigure(row)).toThrow();
  });
  it("recognizes a full historical finding by its registered shape and preserves its recorded report kind",()=>{
    const result=projectHistoricalClaimantReport(report());
    expect(result).toMatchObject({id,recordedKind:"recorded-old-report",recordedShape:"EmbryoFinding",revision:3,component:{conditionId:"retired-condition",finding:{absoluteRisk:0.071}}});
    expect(result.component).not.toHaveProperty("embryo_label");
  });
  it("binds a full historical detail to the exact embryo and strips its cohort/labels/parent fields",()=>{
    const artifact={id:other,cohort_id:id,sample_ordinal:0,display_label:"Embryo 1",status:"stored",qc:syntheticQc({parent_a_concordance:0.97}),findings:[syntheticAbsoluteFinding("Embryo 1","retired-condition",0.071)]};
    const result=projectHistoricalClaimantReport(report(artifact));expect(result.recordedShape).toBe("rscEmbryoDetail");
    expect(result.component).not.toHaveProperty("cohort_id");expect(JSON.stringify(result.component)).not.toContain(id);
    expect(result.component).toHaveProperty("quality.parentConcordanceDisposition","outside-claimed-subject");
    expect(()=>projectHistoricalClaimantReport(report({...artifact,id}))).toThrow("export unavailable");
    expect(()=>projectHistoricalClaimantReport(report({...artifact,findings:[syntheticAbsoluteFinding("Embryo 2","other-record",0.05)]}))).toThrow("export unavailable");
  });
  it("preserves own quality and records both withheld parent concordances",()=>{
    const result=projectHistoricalClaimantQc(syntheticQc({parent_a_concordance:0.97,parent_b_concordance:0.98}));
    expect(result).toMatchObject({sites_expected:1000,sites_called:990,call_rate:0.99,parentConcordanceDisposition:"outside-claimed-subject"});
    expect(result).not.toHaveProperty("parent_a_concordance");expect(result).not.toHaveProperty("parent_b_concordance");
    expect(projectHistoricalClaimantReport(report(syntheticQc())).recordedShape).toBe("qc");
  });
  it.each(["sex","parent_genotype","rank","contactAddress","documentBytes"])("refuses planted %s at every historical report depth",field=>{
    const artifact=syntheticAbsoluteFinding("Embryo 1","retired-condition",0.071);Object.assign(artifact.finding!,{[field]:"synthetic-private-material"});
    expect(()=>projectHistoricalClaimantReport(report(artifact))).toThrow();
  });
  it("refuses an accessor before invoking it, and refuses cyclic/hidden/symbolic candidate fields",()=>{
    const getter=vi.fn(()=>"synthetic-private-material"), row=report();Object.defineProperty(row,"artifact",{enumerable:true,get:getter});
    expect(()=>projectHistoricalClaimantReport(row)).toThrow("export unavailable");expect(getter).not.toHaveBeenCalled();
    const cycle:Record<string,unknown>={};cycle.self=cycle;expect(()=>projectHistoricalClaimantReport(report(cycle))).toThrow("export unavailable");
    const hidden=report();Object.defineProperty(hidden,"hidden",{value:true});expect(()=>projectHistoricalClaimantReport(hidden)).toThrow("export unavailable");
    expect(()=>projectHistoricalClaimantReport({...report(),[Symbol("extra")]:true})).toThrow("export unavailable");
  });
  it("refuses an unknown artifact shape without silently omitting its row",()=>{
    expect(()=>projectHistoricalClaimantReport(report({uninterpreted_result:"synthetic"}))).toThrow("export unavailable");
  });
});
