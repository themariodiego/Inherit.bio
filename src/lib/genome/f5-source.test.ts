import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import templates from "../../../data/templates/heart-cardiovascular.json";
import claims from "../../../data/claims.json";
import citations from "../../../data/citations.json";
import { ReportInterpretation, ReportSummary } from "../../components/reports/report-summary";
import { ClaimSources } from "../../components/claims/sources";
import { reportSourceIds } from "../claims/presentation";
import { resolveVariant, type ReportTemplate } from "./reports";

const report = templates.find(item => item.slug === "factor-v-leiden-rs6025")! as ReportTemplate;
const variant = report.variants[0];
const sourceIds = ["pmid:8164741", "pmid:14996674", "dataset:ncbi-clinvar-rs6025"];

describe("Factor V Leiden position-specific report boundary", () => {
  it("preserves forward allele identity, evidence and missing-call behavior", () => {
    expect(createHash("sha256").update(JSON.stringify(report)).digest("hex"))
      .toBe("32b395f9ffafc611adfbd88d6d5cabd5753aa5c0256170f290cbefcee17d5dd1");
    expect(report.evidence).toBe("emerging");
    expect(report.variants).toHaveLength(1);
    expect(variant).toMatchObject({ rsid: 6025, gene: "F5", chrom: 1, pos38: 169549811, ref: "C", alt: "T" });
    expect(resolveVariant(variant, "C/T")).toMatchObject({ status: "genotyped", genotype: "CT", strandFlipped: false });
    expect(resolveVariant(variant, "A/G")).toMatchObject({ status: "genotyped", genotype: "CT", strandFlipped: true });
    expect(resolveVariant(variant, "C/A").status).toBe("unrecognized");
    expect(resolveVariant(variant, undefined).status).toBe("not-covered");
    expect(resolveVariant(variant, "./.").status).toBe("no-call");
  });

  it("removes whole-gene reassurance and keeps the risk association in its actual population", () => {
    expect(report.summary).toContain("Danish adult study");
    expect(report.summary).toContain("activated protein C");
    expect(variant.interpretations.CC).toContain("does not rule out other causes");
    expect(variant.interpretations.CT).toContain("Danish adult study");
    expect(variant.interpretations.TT).toContain("does not give your personal chance");
    expect([report.summary, ...Object.values(variant.interpretations)].join(" "))
      .not.toMatch(/usual population|lifetime|most never|modest|large shift|most common|3%|5%|European ancestry/iu);
  });

  it("binds four exact statements to mechanism, population evidence and forward identity", () => {
    const selected = claims.filter(claim => claim.claim_id.startsWith(`report.${report.slug}.`));
    const items = [{ key: "summary", text: report.summary }, ...Object.entries(variant.interpretations)
      .map(([genotype, text]) => ({ key: `interpretation.rs6025.${genotype.toLowerCase()}`, text }))];
    expect(selected.map(claim => claim.claim_id).sort()).toEqual(items.map(item => `report.${report.slug}.${item.key}`).sort());
    expect(reportSourceIds(report)).toEqual(sourceIds);
    for (const item of items) {
      const claim = selected.find(held => held.claim_id === `report.${report.slug}.${item.key}`)!;
      expect(claim.text_verbatim).toBe(item.text);
      expect(claim.reviewed_on).toBe("2026-09-23");
      expect(claim.reviewer).toContain("not human signoff");
      expect(claim.evidence.map(edge => edge.citation)).toEqual(item.key === "summary" ? sourceIds : sourceIds.slice(1));
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
    expect(snapshot).toMatchObject({ accession: "VCV000000642.133", rsid: 6025, chrom: 1,
      pos: 169549811, ref: "C", alt: "T", assembly: "GRCh38", url: mapping.url, quote: mapping.quote });
    expect(snapshot.readAt.startsWith(mapping.access_date)).toBe(true);
    expect(report.citations.map(citation => citation.accessedOn)).toEqual(["2026-09-23", "2026-09-23"]);
    const note = readFileSync("docs/sources/reviews/f5-correction-20260923.md", "utf8");
    expect(note).toContain("paper was subscription-only");
    expect(note).toContain("No submitted clinical classification");
    expect(note).toContain("not human\nsignoff or clinical approval");
  });

  it.each(["CC", "CT", "TT"])("renders %s with exact evidence and refuses borrowed attribution", genotype => {
    const outcome = resolveVariant(variant, genotype.split("").join("/"));
    if (outcome.status !== "genotyped") throw new Error("Expected a covered synthetic call");
    const html = renderToStaticMarkup(h("div", null,
      h(ReportSummary, { slug: report.slug, text: report.summary, sourceIds }),
      h(ReportInterpretation, { slug: report.slug, rsid: variant.rsid, ...outcome, text: outcome.interpretation, sourceIds }),
      h(ClaimSources, { sourceIds })));
    expect(html).toContain(`data-claim-id="report.${report.slug}.interpretation.rs6025.${genotype.toLowerCase()}"`);
    for (const id of sourceIds) {
      expect(html).toContain(`href="#claim-source-${id}"`);
      expect(html).toContain(`id="claim-source-${id}"`);
    }
    for (const change of [{ text: "No Factor V Leiden copy was found at this site. CC has the usual population clot risk from this gene. Other genes and situations still matter, such as surgery, little movement, and hormones." }, { rsid: 6026 }, { genotype: "CA" }]) {
      const drift = renderToStaticMarkup(h(ReportInterpretation, { slug: report.slug, rsid: variant.rsid,
        genotype, text: outcome.interpretation, sourceIds, ...change }));
      expect(drift).toContain('data-claim-registration="unregistered"');
      expect(drift).not.toContain("data-claim-id");
      expect(drift).not.toContain('href="#claim-source-');
    }
  });
});
