import { describe,expect,it } from "vitest";
import { syntheticAbsoluteFinding,syntheticCarrierFinding,syntheticQc } from "@/lib/embryos/synthetic";
import { validateEmbryoDto } from "@/lib/embryos/policy";
import { vcfQcFigureBasis } from "@/lib/embryos/qc-basis";
import { readHistoricalDetail,readHistoricalFinding,readHistoricalQc } from "./historical-embryo-dto";
import { projectFuturePersonFinding } from "./future-person-report-projection";
import { projectHistoricalClaimantFigure,projectHistoricalClaimantQc } from "./future-person-historical-members";

function oldFinding(){
  const current=syntheticAbsoluteFinding("Embryo 1","historical-retired-condition",0.071);
  const {schema_version:_v,figure_basis:_b,...original}=current.finding!;void _v;void _b;
  return {...current,finding:original};
}
function oldQc(){const {figure_basis:_b,...original}=syntheticQc();void _b;return original;}
describe("genuine historical classification versions",()=>{
  it("exports strict legacy figures with explicit unrecorded classification while the current RSC gate still refuses them",()=>{
    const source=oldFinding();expect(validateEmbryoDto("EmbryoFinding",source).ok).toBe(false);
    expect(readHistoricalFinding(source)).toBe(source);
    const result=projectFuturePersonFinding(source);expect(result.classification).toEqual({sourceShape:"legacy-v1",figureBasis:null,classificationDisposition:"unrecorded"});
    expect(result.finding).toHaveProperty("absoluteRisk",0.071);expect(JSON.stringify(result.classification)).not.toContain('"basis"');
    expect(source.finding).not.toHaveProperty("schema_version");expect(source.finding).not.toHaveProperty("figure_basis");
  });
  it("preserves an actual version2 saved risk basis, rather than recreating it from the result number",()=>{
    const source=syntheticAbsoluteFinding("Embryo 1","current-recorded-condition",0.071),result=projectFuturePersonFinding(source);
    expect(result.classification).toEqual({sourceShape:"finding-v2",schemaVersion:2,figureBasis:{version:1,basis:"modelled"}});
    expect(result.classification.figureBasis).toEqual(source.finding!.figure_basis);
    expect(result.classification.figureBasis).not.toBe(source.finding!.figure_basis);
  });
  it("retains recorded observed carrier classification without inventing a risk",()=>{
    const source=syntheticCarrierFinding("Embryo 1","old-observed-condition","carrier"),result=projectFuturePersonFinding(source);
    expect(result.classification).toEqual({sourceShape:"finding-v2",schemaVersion:2,figureBasis:{version:1,basis:"observed"}});
    expect(result.finding).not.toHaveProperty("absoluteRisk");
  });
  it.each(["wrong-basis","missing-basis","unknown-version","partial-version","extra-basis-field"])("never falls back on malformed versioned %s",kind=>{
    const source=syntheticAbsoluteFinding("Embryo 1","current-recorded-condition",0.071);
    const body=source.finding as unknown as Record<string,unknown>;
    if(kind==="wrong-basis")body.figure_basis={version:1,basis:"observed"};
    if(kind==="missing-basis")delete body.figure_basis;
    if(kind==="unknown-version")body.schema_version=3;
    if(kind==="partial-version")delete body.schema_version;
    if(kind==="extra-basis-field")body.figure_basis={version:1,basis:"modelled",inferred:true};
    expect(()=>readHistoricalFinding(source)).toThrow();
  });
  it.each(["sex","rank","parent_raw_genotype","hiddenContact"])("keeps the old strict refusal for legacy %s",field=>{
    const source=oldFinding();Object.assign(source.finding,{[field]:"synthetic-private"});expect(()=>readHistoricalFinding(source)).toThrow();
  });
  it("preserves both genuine legacy absent QC and actual current nullable receipts",()=>{
    const old=oldQc();expect(readHistoricalQc(old)).toBe(old);expect(projectHistoricalClaimantQc(old)).toHaveProperty("classificationDisposition","unrecorded");
    expect(projectHistoricalClaimantQc(old)).not.toHaveProperty("figure_basis");
    const current=syntheticQc({figure_basis:null});expect(projectHistoricalClaimantQc(current)).toHaveProperty("figure_basis",null);
    expect(projectHistoricalClaimantQc(current)).toHaveProperty("classificationDisposition","unrecorded");
  });
  it("copies the actual called-VCF producer receipt unchanged and refuses field disagreement",()=>{
    const source=syntheticQc();source.figure_basis=vcfQcFigureBasis(source);
    const result=projectHistoricalClaimantQc(source);expect(result).toHaveProperty("figure_basis");
    if(!("figure_basis" in result))throw new Error("actual receipt expected");expect(result.figure_basis).toEqual(source.figure_basis);
    expect(result.figure_basis).not.toBe(source.figure_basis);expect(result.classificationDisposition).toBe("recorded");
    expect(()=>readHistoricalQc({...source,mean_depth:10})).toThrow();
    expect(()=>readHistoricalQc({...source,figure_basis:{...source.figure_basis,coverage:{version:1,basis:"modelled"}}})).toThrow();
  });
  it("supports mixed genuine old/new children without classifying or mutating any old record",()=>{
    const old=oldFinding(),modern=syntheticAbsoluteFinding("Embryo 1","recorded-new-condition",0.03);
    const detail={id:"78000000-0000-4000-8000-000000000001",cohort_id:"78000000-0000-4000-8000-000000000002",sample_ordinal:0,display_label:"Embryo 1",status:"stored",qc:oldQc(),findings:[old,modern]};
    const before=structuredClone(detail);expect(readHistoricalDetail(detail)).toBe(detail);expect(detail).toEqual(before);
    expect(projectFuturePersonFinding(detail.findings[0]).classification.figureBasis).toBeNull();
    expect(projectFuturePersonFinding(detail.findings[1]).classification.figureBasis).toEqual({version:1,basis:"modelled"});
    expect(()=>readHistoricalDetail({...detail,parentGenotype:"G/G"})).toThrow();
  });
  it("requires genuine original figure payload and finding to agree across the same saved version",()=>{
    const original=oldFinding(),modern=syntheticAbsoluteFinding("Embryo 1","historical-retired-condition",0.071);
    const {embryo_label,...fields}=original;void embryo_label;
    const source={id:"88000000-0000-4000-8000-000000000001",finding_id:"88000000-0000-4000-8000-000000000002",figure_kind:"absolute_risk",
      payload:original.finding,figure_revision:1,created_at:"2026-09-30T20:00:00.000Z",findingRecord:{id:"88000000-0000-4000-8000-000000000002",...fields,
        model_id:"recorded-historical-model",model_version:"original",source_binding_fingerprint:"a".repeat(64),computation_revision:1,computed_at:"2026-09-30T20:00:00.000Z"}};
    expect(projectHistoricalClaimantFigure(source).classification.figureBasis).toBeNull();
    expect(()=>projectHistoricalClaimantFigure({...source,payload:modern.finding})).toThrow("export unavailable");
  });
});
