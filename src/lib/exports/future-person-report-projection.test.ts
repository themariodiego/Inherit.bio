import { describe,expect,it } from "vitest";
import { syntheticAbsoluteFinding,syntheticNullFinding } from "@/lib/embryos/synthetic";
import { projectFuturePersonFinding } from "./future-person-report-projection";

describe("historical own claimant report components",()=>{
  it("preserves exact own risk, evidence and population comparison while recording every cohort-component withholding",()=>{
    const source=syntheticAbsoluteFinding("Your claimed record","retired-synthetic-condition",0.071);
    const row=projectFuturePersonFinding(source);
    expect(row.conditionId).toBe("retired-synthetic-condition");expect(row.citationIds).toEqual(source.citation_ids);
    expect(row.finding).toMatchObject({absoluteRisk:0.071,intervalLow:0.071*0.8,intervalHigh:0.071*1.25,
      populationComparison:{comparator:"vs_population_baseline"}});
    expect(JSON.stringify(row.finding)).not.toMatch(/matched_baseline|difference_pp|number_needed_to_select|vs_average_embryo|vs_randomly_selected_embryo|vs_highest_risk_embryo|comparator_numerator/);
    expect(row.withheldComponents).toHaveLength(8);
    expect(source.finding).toHaveProperty("comparators");
  });
  it("retains a genuine historical absence and its recorded reason",()=>{
    const source=syntheticNullFinding("Your claimed record","retired-synthetic-condition","within_family_validation_unavailable","not_covered");
    expect(projectFuturePersonFinding(source)).toMatchObject({finding:null,notCoveredReason:"within_family_validation_unavailable",withheldComponents:[]});
  });
  it.each(["sex","parent_raw_genotype","rank"])("refuses planted %s before a component can leave",field=>{
    const source=syntheticAbsoluteFinding("Your claimed record","synthetic-condition",0.071);
    Object.assign(source.finding!,{[field]:"planted"});expect(()=>projectFuturePersonFinding(source)).toThrow();
  });
});
