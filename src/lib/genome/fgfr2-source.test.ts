import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import templates from "../../../data/templates/cancer-risk.json";
import claims from "../../../data/claims.json";
import citations from "../../../data/citations.json";
import { validateClaimRegistry } from "../claims/registry";
import {
  registeredReportInterpretation,
  registeredReportSummary,
  reportSourceIds,
} from "../claims/presentation";
import type { ReportTemplate } from "./reports";

const slug = "breast-cancer-fgfr2-rs2981582";
const template = templates.find((item) => item.slug === slug)! as ReportTemplate;
const variant = template.variants[0];
const sourceId = "pmid:17529967";
const notePath = "docs/sources/reviews/fgfr2-correction-20260923.md";
const selected = claims.filter((claim) => claim.claim_id.startsWith(`report.${slug}.`));
const sources = citations.filter((citation) => citation.id === sourceId);
const route = `/genome/[subject]/reports/${slug}#state=complete`;
const prose = [
  { key: "summary", text: template.summary },
  ...Object.entries(variant.interpretations).map(([genotype, text]) => ({
    key: `interpretation.rs2981582.${genotype.toLowerCase()}`, text,
  })),
];

describe("FGFR2 study scope and canonical binding", () => {
  it("preserves the forward marker and study ordering without a clinical or frequency category", () => {
    expect(template.evidence).toBe("emerging");
    expect(template.variants).toHaveLength(1);
    expect(variant).toMatchObject({ rsid: 2981582, gene: "FGFR2", chrom: 10, pos38: 121592803, ref: "A", alt: "G" });
    expect(Object.keys(variant.interpretations).sort()).toEqual(["AA", "AG", "GG"]);
    expect(template.summary).toContain("women in European and Asian study groups");
    for (const genotype of ["AA", "AG"] as const) {
      expect(variant.interpretations[genotype]).toContain(`${genotype} was associated with higher breast cancer odds than GG`);
      expect(variant.interpretations[genotype]).toContain("cannot tell you your chance");
    }
    expect(variant.interpretations.GG).toContain("GG was the comparison group");
    expect(variant.interpretations.GG).toContain("does not rule out breast cancer or hereditary susceptibility");
    expect(prose.map((item) => item.text).join(" "))
      .not.toMatch(/\b15%|most common genotype|estrogen-receptor-positive|moderate shift|routine screening|clinical genetic testing|matter more/u);
  });

  it("binds all four exact strings to the actual dated source and declared report, export and summary-mail surfaces", () => {
    expect(selected.map((claim) => claim.claim_id).sort()).toEqual(prose.map((item) => `report.${slug}.${item.key}`).sort());
    expect(sources).toHaveLength(1);
    expect(template.citations).toEqual([
      { pmid: "17529967", doi: "10.1038/nature05887", label: "Easton et al., Nature 2007", accessedOn: "2026-09-23" },
    ]);
    const corpus = prose.flatMap((item) => {
      const claimId = `report.${slug}.${item.key}`;
      const surfaces = [route, "export:account-export-v1", ...(item.key === "summary"
        ? ["email:src/emails/research-digest.tsx#fixture=research-digest--public-catalog"] : [])];
      const claim = selected.find((candidate) => candidate.claim_id === claimId)!;
      expect(claim.text_verbatim).toBe(item.text);
      expect(claim.surfaces).toEqual(surfaces);
      expect(claim.reviewed_on).toBe("2026-09-23");
      expect(claim.reviewer).toContain("not human signoff");
      expect(claim.evidence.map((edge) => edge.citation)).toEqual([sourceId]);
      return surfaces.map((surface) => ({ claimId, text: item.text, surface }));
    });
    expect(validateClaimRegistry({ citations: sources, claims: selected, corpus, commitDate: "2026-09-23",
      refusalClaimIds: [], societyPositionClaimIds: [], archiveExists: existsSync })).toMatchObject({ ok: true, issues: [] });
    expect(sources[0].quote.trim().split(/\s+/u)).toHaveLength(11);
    const note = readFileSync(notePath, "utf8");
    expect(note).toContain("Supplementary Table 8 page 14");
    expect(note).toContain("not clinical approval or human signoff");
  });

  it("supplies the source only for the exact corrected report text", () => {
    expect(reportSourceIds(template)).toEqual([sourceId]);
    expect(registeredReportSummary(slug, template.summary)?.claim_id).toBe(`report.${slug}.summary`);
    expect(registeredReportSummary(slug, `${template.summary} Your overall risk is low.`)).toBeUndefined();
    for (const [genotype, text] of Object.entries(variant.interpretations)) {
      expect(registeredReportInterpretation(slug, 2981582, genotype, text)?.evidence[0].citation).toBe(sourceId);
      expect(registeredReportInterpretation(slug, 2981582, genotype, `${text} Screening is unchanged.`)).toBeUndefined();
      expect(registeredReportInterpretation(slug, 2981583, genotype, text)).toBeUndefined();
    }
    expect(registeredReportInterpretation(slug, 2981582, "CT", variant.interpretations.AG)).toBeUndefined();
  });
});
