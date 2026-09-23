import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import templates from "../../../data/templates/metabolic-obesity.json";
import claims from "../../../data/claims.json";
import citations from "../../../data/citations.json";
import { ReportInterpretation, ReportSummary } from "../../components/reports/report-summary";
import { ClaimSources } from "../../components/claims/sources";
import { reportSourceIds } from "../claims/presentation";
import { resolveVariant, type ReportTemplate } from "./reports";

const report = templates.find(item => item.slug === "type-2-diabetes-tcf7l2-rs7903146")! as ReportTemplate;
const variant = report.variants[0];
const sourceIds = ["pmid:16415884", "pmid:16855264", "dataset:ncbi-clinvar-rs7903146"];

describe("TCF7L2 study-specific report boundary", () => {
  it("preserves forward allele identity, evidence and missing-call behavior", () => {
    expect(createHash("sha256").update(JSON.stringify(report)).digest("hex"))
      .toBe("3eb577cbddccd3c1ad006d95b9b7d08c50aba22fb43ec5ea512b8e65adc4d3a9");
    expect(report.evidence).toBe("emerging");
    expect(report.variants).toHaveLength(1);
    expect(variant).toMatchObject({ rsid: 7903146, gene: "TCF7L2", chrom: 10, pos38: 112998590, ref: "C", alt: "T" });
    expect(resolveVariant(variant, "C/T")).toMatchObject({ status: "genotyped", genotype: "CT", strandFlipped: false });
    expect(resolveVariant(variant, "A/G")).toMatchObject({ status: "genotyped", genotype: "CT", strandFlipped: true });
    expect(resolveVariant(variant, "C/A").status).toBe("unrecognized");
    expect(resolveVariant(variant, undefined).status).toBe("not-covered");
    expect(resolveVariant(variant, "./.").status).toBe("no-call");
  });

  it("keeps the actual trial population and CT uncertainty distinct from personal lifetime prediction", () => {
    expect(report.summary).toContain("overweight people with high blood sugar");
    expect(report.summary).toContain("over about three years");
    expect(variant.interpretations.CC).toContain("also developed diabetes");
    expect(variant.interpretations.CT).toContain("The trial did not find a higher rate");
    expect(variant.interpretations.CT).toContain("This does not prove there is no effect");
    expect(variant.interpretations.TT).toContain("not your lifetime chance");
    expect([report.summary, ...Object.values(variant.interpretations)].join(" "))
      .not.toMatch(/most TT carriers|do not develop|strongest|largest|40%|8%|10%|European ancestry|dominate|prevented diabetes|mainly through/iu);
  });

  it("binds the four exact statements to the trial rather than the old discovery marker", () => {
    const selected = claims.filter(claim => claim.claim_id.startsWith(`report.${report.slug}.`));
    const items = [{ key: "summary", text: report.summary }, ...Object.entries(variant.interpretations)
      .map(([genotype, text]) => ({ key: `interpretation.rs7903146.${genotype.toLowerCase()}`, text }))];
    expect(selected.map(claim => claim.claim_id).sort()).toEqual(items.map(item => `report.${report.slug}.${item.key}`).sort());
    expect(reportSourceIds(report)).toEqual(sourceIds);
    for (const item of items) {
      const claim = selected.find(held => held.claim_id === `report.${report.slug}.${item.key}`)!;
      expect(claim.text_verbatim).toBe(item.text);
      expect(claim.reviewed_on).toBe("2026-09-23");
      expect(claim.reviewer).toContain("not human signoff");
      expect(claim.evidence.map(edge => edge.citation)).toEqual(item.key === "summary" ? sourceIds.slice(0, 2) : sourceIds.slice(1));
      expect(claim.surfaces).toEqual([`/genome/[subject]/reports/${report.slug}#state=complete`,
        "export:account-export-v1", ...(item.key === "summary"
          ? ["email:src/emails/research-digest.tsx#fixture=research-digest--public-catalog"] : [])]);
      for (const edge of claim.evidence) {
        const citation = citations.find(source => source.id === edge.citation)!;
        expect(edge.accessed_on).toBe(citation.access_date);
        expect(edge.doi_or_url).toBe(citation.url);
      }
    }
    const mapping = citations.find(source => source.id === sourceIds[2])!;
    const snapshot = JSON.parse(readFileSync(mapping.archived_path!, "utf8"));
    expect(snapshot).toMatchObject({ accession: "VCV000007413.7", rsid: 7903146, chrom: 10,
      pos: 112998590, ref: "C", alt: "T", assembly: "GRCh38", url: mapping.url, quote: mapping.quote });
    expect(snapshot.readAt.startsWith(mapping.access_date)).toBe(true);
    expect(report.citations.map(citation => citation.accessedOn)).toEqual(["2026-09-23", "2026-09-23"]);
    const note = readFileSync("docs/sources/reviews/tcf7l2-correction-20260923.md", "utf8");
    expect(note).toContain("The full paper was inaccessible");
    expect(note).toContain("No submitted clinical classification");
    expect(note).toContain("not clinical approval");
  });

  it.each(["CC", "CT", "TT"])("renders %s with exact evidence and refuses borrowed attribution", genotype => {
    const outcome = resolveVariant(variant, genotype.split("").join("/"));
    if (outcome.status !== "genotyped") throw new Error("Expected a covered synthetic call");
    const html = renderToStaticMarkup(h("div", null,
      h(ReportSummary, { slug: report.slug, text: report.summary, sourceIds }),
      h(ReportInterpretation, { slug: report.slug, rsid: variant.rsid, ...outcome, text: outcome.interpretation, sourceIds }),
      h(ClaimSources, { sourceIds })));
    expect(html).toContain(`data-claim-id="report.${report.slug}.interpretation.rs7903146.${genotype.toLowerCase()}"`);
    for (const id of sourceIds) {
      expect(html).toContain(`href="#claim-source-${id}"`);
      expect(html).toContain(`id="claim-source-${id}"`);
    }
    for (const change of [{ text: "Most TT carriers do not develop diabetes." }, { rsid: 7903147 }, { genotype: "CA" }]) {
      const drift = renderToStaticMarkup(h(ReportInterpretation, { slug: report.slug, rsid: variant.rsid,
        genotype, text: outcome.interpretation, sourceIds, ...change }));
      expect(drift).toContain('data-claim-registration="unregistered"');
      expect(drift).not.toContain("data-claim-id");
      expect(drift).not.toContain('href="#claim-source-');
    }
  });
});
