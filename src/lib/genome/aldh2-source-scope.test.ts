import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import templates from "../../../data/templates/addiction.json";
import claims from "../../../data/claims.json";
import citations from "../../../data/citations.json";
import { ReportInterpretation, ReportSummary } from "../../components/reports/report-summary";
import { ClaimSources } from "../../components/claims/sources";
import { registeredReportInterpretation, reportSourceIds } from "../claims/presentation";
import { validateClaimRegistry } from "../claims/registry";
import { resolveTemplate, type ReportTemplate } from "./reports";
import { isGatedTemplate } from "./taxonomy";

const slug = "alcohol-dependence-aldh2-rs671";
const template = templates.find((item) => item.slug === slug)! as ReportTemplate;
const variant = template.variants[0];
const scopedClaims = claims.filter((claim) => claim.claim_id.startsWith(`report.${slug}.`));
const sourceIds = ["pmid:19320537", "pmid:39075523", "pmid:12419833", "pmid:2024727"];
const scopedSources = citations.filter((source) => sourceIds.includes(source.id));

describe("bounded ALDH2 source correction", () => {
  it("preserves observed calls, no-calls and the report's evidence/access contract", () => {
    expect(template).toMatchObject({ category: "addiction", evidence: "emerging", pgs_id: null });
    expect(isGatedTemplate(template)).toBe(false);
    expect(template.variants).toHaveLength(1);
    expect(variant).toMatchObject({ rsid: 671, chrom: 12, pos38: 111803962, ref: "G", alt: "A" });
    expect(Object.keys(variant.interpretations).sort()).toEqual(["AA", "AG", "GG"]);
    for (const genotype of ["GG", "AG", "AA"]) {
      const report = resolveTemplate(template, (rsid) => rsid === 671 ? genotype.split("").join("/") : undefined);
      expect(report.covered).toBe(true);
      expect(report.variants[0].outcome).toEqual({ status: "genotyped", genotype, strandFlipped: false,
        interpretation: variant.interpretations[genotype] });
    }
    expect(resolveTemplate(template, () => "--").variants[0].outcome).toEqual({ status: "no-call" });
    expect(resolveTemplate(template, () => undefined).covered).toBe(false);
  });

  it("removes safe-intake reassurance and unsupported AA cancer ranking", () => {
    expect(template.title).toBe("Alcohol by-product breakdown · ALDH2");
    expect(template.summary).toContain("cannot predict your drinking habits");
    expect(variant.interpretations.GG).toContain("position alone cannot tell");
    expect(variant.interpretations.AG).toContain("Japanese men");
    expect(variant.interpretations.AG).toContain("study’s light-drinking group");
    expect(variant.interpretations.AG).toContain("does not give your personal risk or establish a safe amount");
    expect(variant.interpretations.AA).toContain("two AA liver samples");
    expect(variant.interpretations.AA).toContain("after alcohol than in GG");
    expect(variant.interpretations.AA).toContain("does not establish that AA carries more cancer risk than AG");
    expect(JSON.stringify(template)).not.toMatch(/little or no|highest.*cancer|no genetic flushing|cleared normally|two working copies/i);
  });

  it("registers the four exact statements with actual source scopes and dates", () => {
    expect(scopedClaims.map((claim) => claim.claim_id).sort()).toEqual([
      `report.${slug}.interpretation.rs671.aa`, `report.${slug}.interpretation.rs671.ag`,
      `report.${slug}.interpretation.rs671.gg`, `report.${slug}.summary`,
    ]);
    expect(scopedSources.map((source) => source.id)).toEqual(sourceIds);
    expect(template.citations.map((source) => source.accessedOn)).toEqual(Array(4).fill("2026-09-23"));
    const expectedEdges = {
      summary: ["pmid:19320537", "pmid:39075523"],
      gg: ["pmid:39075523"], ag: ["pmid:12419833", "pmid:39075523"], aa: ["pmid:2024727"],
    };
    for (const [suffix, expected] of Object.entries(expectedEdges)) {
      const id = `report.${slug}.${suffix === "summary" ? suffix : `interpretation.rs671.${suffix}`}`;
      const claim = scopedClaims.find((item) => item.claim_id === id)!;
      expect(claim.text_verbatim).toBe(suffix === "summary" ? template.summary : variant.interpretations[suffix.toUpperCase()]);
      expect(claim.evidence.map((edge) => edge.citation)).toEqual(expected);
      expect(claim.reviewed_on).toBe("2026-09-23");
    }
    expect(scopedSources.find((source) => source.id === "pmid:19320537")!.claim).toContain("review synthesis, not a primary cohort");
    for (const id of ["pmid:12419833", "pmid:2024727"]) {
      expect(scopedSources.find((source) => source.id === id)!.claim).toContain("author abstract only");
    }
    const result = validateClaimRegistry({ claims: scopedClaims, citations: scopedSources, commitDate: "2026-09-23",
      corpus: scopedClaims.flatMap((claim) => claim.surfaces.map((surface) =>
        ({ claimId: claim.claim_id, text: claim.text_verbatim, surface }))),
      refusalClaimIds: [], societyPositionClaimIds: [], archiveExists: () => false });
    expect(result.issues).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it.each(["GG", "AG", "AA"])("renders the %s explanation with its exact numbered source links", (genotype) => {
    const ids = reportSourceIds(template);
    expect(ids).toEqual(sourceIds);
    const claim = registeredReportInterpretation(slug, 671, genotype, variant.interpretations[genotype])!;
    const html = renderToStaticMarkup(h("main", null,
      h(ReportSummary, { slug, text: template.summary, sourceIds: ids }),
      h(ReportInterpretation, { slug, rsid: 671, genotype, text: variant.interpretations[genotype], sourceIds: ids }),
      h(ClaimSources, { sourceIds: ids })));
    expect(html).toContain(`data-claim-id="${claim.claim_id}"`);
    for (const edge of claim.evidence) {
      expect(html).toContain(`href="#claim-source-${edge.citation}"`);
      expect(html).toContain(`href="${edge.doi_or_url}"`);
      expect(html.split(`id="claim-source-${edge.citation}"`)).toHaveLength(2);
    }
    expect(html).not.toContain('data-claim-registration="unregistered"');
    expect(html).not.toMatch(/data-figure-kind="(?:percentile|relative)"/);
  });

  it("never lends reviewed AG references to changed prose, another genotype or position", () => {
    const text = variant.interpretations.AG;
    expect(registeredReportInterpretation(slug, 671, "GA", text)?.text_verbatim).toBe(text);
    for (const [rsid, genotype, prose] of [[671, "AA", text], [672, "AG", text],
      [671, "AG", `${text} Little drinking is safe.`]] as const) {
      expect(registeredReportInterpretation(slug, rsid, genotype, prose)).toBeUndefined();
      const html = renderToStaticMarkup(h(ReportInterpretation, { slug, rsid, genotype, text: prose, sourceIds: [] }));
      expect(html).toContain('data-claim-registration="unregistered"');
      expect(html).not.toContain("<sup");
    }
  });
});
