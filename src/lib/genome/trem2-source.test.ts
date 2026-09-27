import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import templates from "../../../data/templates/neurodegenerative.json";
import claims from "../../../data/claims.json";
import citations from "../../../data/citations.json";
import { ReportInterpretation, ReportSummary } from "../../components/reports/report-summary";
import { ClaimSources } from "../../components/claims/sources";
import { reportSourceIds } from "../claims/presentation";
import { resolveVariant, type ReportTemplate } from "./reports";

const report = templates.find((item) => item.slug === "trem2-r47h-alzheimers")! as ReportTemplate;
const variant = report.variants[0];
const sourceIds = ["pmid:23150908", "pmid:23150934"];
const notePath = "docs/sources/reviews/trem2-correction-20260923.md";

describe("TREM2 R47H source-bounded explanations", () => {
  it("preserves the exact forward R47H allele and rejects the same-rsID R47L alternative", () => {
    expect(createHash("sha256").update(JSON.stringify(report)).digest("hex"))
      .toBe("874ec5231708ee4e2d18feaff98c8136d7021245b233daa78e55c7ed36ec9562");
    expect(report.evidence).toBe("emerging");
    expect(report.variants).toHaveLength(1);
    expect(variant).toMatchObject({ rsid: 75932628, gene: "TREM2", chrom: 6, pos38: 41161514, ref: "C", alt: "T" });
    expect(resolveVariant(variant, "C/T")).toMatchObject({ status: "genotyped", genotype: "CT", strandFlipped: false });
    expect(resolveVariant(variant, "A/G")).toMatchObject({ status: "genotyped", genotype: "CT", strandFlipped: true });
    expect(resolveVariant(variant, "C/A").status).toBe("unrecognized");
    expect(resolveVariant(variant, undefined).status).toBe("not-covered");
    expect(resolveVariant(variant, "./.").status).toBe("no-call");
  });

  it("keeps group association separate from lifetime reassurance and assay accuracy", () => {
    expect(report.summary).toContain("higher odds");
    expect(report.summary).toContain("in the groups studied");
    expect(variant.interpretations.CC).toContain("does not assess other TREM2 variants");
    expect(variant.interpretations.CT).toContain("do not provide your personal lifetime chance");
    expect(variant.interpretations.TT).toContain("does not provide a separate risk estimate");
    expect(variant.interpretations.TT).toContain("or verify the accuracy of the original DNA test");
    expect([report.summary, ...Object.values(variant.interpretations)].join(" "))
      .not.toMatch(/most carriers|many carriers|never affected|never develop|likely to be a test error|over 99%|1 in 200|reported only a few|far more|APOE|clinical-quality/iu);
  });

  it("binds all four exact strings and surfaces to the dated, limited primary-source reads", () => {
    const selected = claims.filter((claim) => claim.claim_id.startsWith(`report.${report.slug}.`));
    const items = [{ key: "summary", text: report.summary },
      ...Object.entries(variant.interpretations).map(([genotype, text]) => ({
        key: `interpretation.rs75932628.${genotype.toLowerCase()}`, text,
      }))];
    expect(selected.map((claim) => claim.claim_id).sort()).toEqual(items.map((item) => `report.${report.slug}.${item.key}`).sort());
    expect(reportSourceIds(report)).toEqual(sourceIds);
    for (const item of items) {
      const claim = selected.find((candidate) => candidate.claim_id === `report.${report.slug}.${item.key}`)!;
      expect(claim.text_verbatim).toBe(item.text);
      expect(claim.surfaces).toEqual([`/genome/[subject]/reports/${report.slug}#state=complete`,
        "export:account-export-v1", ...(item.key === "summary"
          ? ["email:src/emails/research-digest.tsx#fixture=research-digest--public-catalog"] : [])]);
      expect(claim.reviewed_on).toBe("2026-09-23");
      expect(claim.reviewer).toContain("not human signoff");
      expect(claim.evidence.map((edge) => edge.citation)).toEqual(sourceIds);
      for (const edge of claim.evidence) {
        const source = citations.find((candidate) => candidate.id === edge.citation)!;
        expect(edge.accessed_on).toBe(source.access_date);
        expect(edge.doi_or_url).toBe(source.url);
        expect(source.claim).toContain("author abstract");
        expect(source.claim).toContain("Full paper and tables were inaccessible");
      }
    }
    expect(report.citations.map((citation) => citation.accessedOn)).toEqual(["2026-09-23", "2026-09-23"]);
    const note = readFileSync(notePath, "utf8");
    expect(note).toContain("C>A/R47L");
    expect(note).toContain("No TT-specific table was read");
    expect(note).toContain("not clinical approval or human signoff");
  });

  it.each(["CC", "CT", "TT"])("renders %s with exact source anchors and refuses borrowed attribution", (genotype) => {
    const outcome = resolveVariant(variant, genotype.split("").join("/"));
    expect(outcome.status).toBe("genotyped");
    if (outcome.status !== "genotyped") throw new Error("Expected a covered synthetic call");
    const html = renderToStaticMarkup(h("div", null,
      h(ReportSummary, { slug: report.slug, text: report.summary, sourceIds }),
      h(ReportInterpretation, { slug: report.slug, rsid: variant.rsid, ...outcome, text: outcome.interpretation, sourceIds }),
      h(ClaimSources, { sourceIds }),
    ));
    expect(html).toContain(`data-claim-id="report.${report.slug}.interpretation.rs75932628.${genotype.toLowerCase()}"`);
    for (const id of sourceIds) {
      expect(html).toContain(`href="#claim-source-${id}"`);
      expect(html).toContain(`id="claim-source-${id}"`);
    }
    for (const change of [{ text: "Most carriers will never be affected." }, { rsid: 75932629 }, { genotype: "CA" }]) {
      const drift = renderToStaticMarkup(h(ReportInterpretation, {
        slug: report.slug, rsid: variant.rsid, genotype, text: outcome.interpretation, sourceIds, ...change,
      }));
      expect(drift).toContain('data-claim-registration="unregistered"');
      expect(drift).not.toContain("data-claim-id");
    }
  });
});
