import { vcfQcFigureBasis } from "@/lib/embryos/qc-basis";
import { describe, expect, it } from "vitest";
import type { RscEmbryoComparison } from "@/lib/embryos/policy";
import { STANDING_STATEMENT } from "@/copy/embryos/compare";
import { buildCohortContext, cohortAuthoritySchema, cohortCitations, cohortSystemMessage, CohortContextError,
  COHORT_SYSTEM_PROMPT, type CohortAuthority } from "./cohort-chat-content";

const cohortId = "c0000000-0000-4000-8000-000000000001";
const ids = ["e0000000-0000-4000-8000-000000000001", "e0000000-0000-4000-8000-000000000002", "e0000000-0000-4000-8000-000000000003"];
const qc = (callRate: number, verdict: "pass" | "marginal" | "fail") => ({
  figure_basis: vcfQcFigureBasis({ autosomal_het_rate: 0.4, mean_depth: 12.5 }),
  source_facts: { coordinate_conversion: "not-needed", source_origin: "external-unverified", source_imputation: "not-recorded", call_observation: "not-recorded" },
  sites_expected: 10, sites_called: Math.round(callRate * 10), call_rate: callRate, autosomal_het_rate: 0.4, mean_depth: 12.5,
  parent_a_concordance: null, parent_b_concordance: null, allelic_dropout_estimate: null, allelic_dropout_interval_low: null,
  allelic_dropout_interval_high: null, allelic_dropout_method: null, amplification_method: null, source_laboratory: null,
  source_assay: null, imputation_performed: false, imputation_panel: null, contamination_estimate: null,
  qc_verdict: verdict, qc_reasons: verdict === "pass" ? [] : ["embryo_call_rate"], computed_at: "2026-09-28T10:00:00.000Z" });
const comparison = {
  cohort_id: cohortId,
  context_counts: { embryos_analysed: 3, quality_check_passed: 2, not_measurable: 1 },
  // Out of ordinal order on purpose: the context puts them in order.
  embryos: [
    { id: ids[2], sample_ordinal: 2, display_label: "Embryo 3", status: "qc_marginal", qc: qc(0.9, "marginal") },
    { id: ids[0], sample_ordinal: 0, display_label: "Embryo 1", status: "qc_pass", qc: qc(1, "pass") },
    { id: ids[1], sample_ordinal: 1, display_label: "Embryo 2", status: "qc_fail", qc: qc(0.7, "fail") },
  ],
  result_rows: [],
  trade_offs: { statement_copy_id: "trade-offs.none", conflicts: [] },
  standing_statement: STANDING_STATEMENT,
} as unknown as RscEmbryoComparison;
const authority: CohortAuthority = cohortAuthoritySchema.parse({ cohortId, role: "required_upload_principal", publicationRevision: 1,
  basisCase: "true_two_parent", basisRevision: 1, participantSetRevision: 1, cohortRevision: 1, donorAttributionRevision: 1,
  donorClassification: "donor-neutral",
  grants: [{ principalId: "a0000000-0000-4000-8000-000000000001", grantId: "b0000000-0000-4000-8000-000000000001", grantRevision: 1 }],
  embryos: ids.map((embryoId, index) => ({ embryoId, subjectId: `d0000000-0000-4000-8000-00000000000${index + 1}`, lifecycleRevision: 1 })) });

describe("the cohort scope's closed context", () => {
  it("is exactly copilotCohortContext: every named embryo in ordinal order, its QC, and no finding while none is registered", () => {
    const context = buildCohortContext(comparison, authority);
    expect(Object.keys(context).sort()).toEqual(["authorized_parent_carrier_reports", "cohort_id", "embryos", "findings", "standing_statement"]);
    expect(context.embryos.map(embryo => embryo.display_label)).toEqual(["Embryo 1", "Embryo 2", "Embryo 3"]);
    expect(Object.keys(context.embryos[0]).sort()).toEqual(
      ["cohort_id", "display_label", "findings", "id", "qc", "sample_ordinal", "sanitized_variant_file_ids", "status"]);
    expect(context.embryos.every(embryo => embryo.cohort_id === cohortId && embryo.findings.length === 0
      && embryo.sanitized_variant_file_ids.length === 0)).toBe(true);
    expect(context.findings).toEqual([]);
    expect(context.authorized_parent_carrier_reports).toEqual([]);
    expect(context.standing_statement).toBe(STANDING_STATEMENT);
  });

  it("carries no genotype, source row, file name, lab identifier, sex, rank or score", () => {
    const json = JSON.stringify(buildCohortContext(comparison, authority));
    expect(json).not.toMatch(/genotype|variant_rows|original_filename|sample_column|lab_identifier|"sex"|karyotype|chrX|chrY|rank|score/i);
  });

  it("refuses a context the authority does not name exactly", () => {
    expect(() => buildCohortContext(comparison, { ...authority, embryos: authority.embryos.slice(0, 2) }))
      .not.toThrow();
    expect(() => buildCohortContext(comparison, { ...authority, embryos: [...authority.embryos,
      { embryoId: "e0000000-0000-4000-8000-0000000000ff", subjectId: "d0000000-0000-4000-8000-0000000000ff", lifecycleRevision: 1 }] }))
      .toThrow(CohortContextError);
    expect(() => buildCohortContext({ ...comparison, cohort_id: "c0000000-0000-4000-8000-0000000000ff" }, authority))
      .toThrow(CohortContextError);
  });

  it("reads only the embryos the authority names", () => {
    const context = buildCohortContext(comparison, { ...authority, embryos: authority.embryos.slice(0, 1) });
    expect(context.embryos.map(embryo => embryo.id)).toEqual([ids[0]]);
  });

  it("fails closed when any sex, karyotype, genotype or score field reaches it", () => {
    for (const key of ["sex", "inferred_sex", "karyotype", "genotype", "polygenic_score", "rank"]) {
      const tainted = { ...comparison, embryos: comparison.embryos.map(embryo => ({ ...embryo, qc: { ...embryo.qc, [key]: "x" } })) };
      expect(() => buildCohortContext(tainted as RscEmbryoComparison, authority), key).toThrow(/forbidden key/);
    }
  });

  it("holds the authority to its closed shape", () => {
    expect(cohortAuthoritySchema.safeParse({ ...authority, donorClassification: "donor-specific" }).success).toBe(false);
    expect(cohortAuthoritySchema.safeParse({ ...authority, extra: 1 }).success).toBe(false);
    expect(cohortAuthoritySchema.safeParse({ ...authority, grants: [] }).success).toBe(false);
  });
});

describe("the cohort scope's per-answer provenance", () => {
  const context = buildCohortContext(comparison, authority);
  it("cites the comparison first, then exactly the embryos the answer names, in ordinal order", () => {
    expect(cohortCitations(context, "Embryo 3 was marginal and Embryo 1 passed.")).toEqual([
      { id: `cohort:${cohortId}`, label: "Compare embryos", href: `/embryos/compare?cohort=${cohortId}` },
      { id: `embryo:${ids[0]}`, label: "Embryo 1", href: `/embryos/${ids[0]}` },
      { id: `embryo:${ids[2]}`, label: "Embryo 3", href: `/embryos/${ids[2]}` },
    ]);
  });
  it("does not read Embryo 10 as Embryo 1", () => {
    expect(cohortCitations(context, "Embryo 10 is not in this group.").map(citation => citation.id)).toEqual([`cohort:${cohortId}`]);
  });
});

describe("the cohort scope's system message", () => {
  it("states ADR 0034's rules before the context", () => {
    const message = cohortSystemMessage(buildCohortContext(comparison, authority));
    expect(message.startsWith(COHORT_SYSTEM_PROMPT)).toBe(true);
    expect(COHORT_SYSTEM_PROMPT).toMatch(/Never rank, order, choose or recommend embryos/);
    expect(COHORT_SYSTEM_PROMPT).toMatch(/Never state, guess or discuss an embryo's sex/);
    expect(COHORT_SYSTEM_PROMPT).toMatch(/research only/);
    expect(message).toContain('"display_label":"Embryo 2"');
  });
});
