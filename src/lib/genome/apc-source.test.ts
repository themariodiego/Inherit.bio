import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import templates from "../../../data/templates/cancer-risk.json";
import claims from "../../../data/claims.json";
import snapshot from "../../../docs/sources/dbsnp/rs1801155-2026-09-23.json";
import { ReportInterpretation, ReportSummary } from "../../components/reports/report-summary";
import { ClaimSources } from "../../components/claims/sources";
import { reportSourceIds } from "../claims/presentation";
import { resolveVariant, type ReportTemplate } from "./reports";

const report = templates.find((item) => item.slug === "colorectal-apc-i1307k")! as ReportTemplate;
const variant = report.variants[0];

describe("APC I1307K source-bounded explanations", () => {
  it("preserves the reviewed forward marker and refuses other alleles", () => {
    expect(variant).toMatchObject({ rsid: 1801155, chrom: 5, pos38: 112839514, ref: "T", alt: "A" });
    expect(snapshot.placement.placement_annot.is_aln_opposite_orientation).toBe(false);
    expect(snapshot.placement.alleles.some((item) => item.hgvs === "NC_000005.10:g.112839514T>A")).toBe(true);
    expect(resolveVariant(variant, "T/A")).toMatchObject({ status: "genotyped", genotype: "AT", strandFlipped: false });
    expect(resolveVariant(variant, "C/G").status).toBe("unrecognized");
    expect(resolveVariant(variant, undefined).status).toBe("not-covered");
    expect(resolveVariant(variant, "./.").status).toBe("no-call");
    expect(report.evidence).toBe("emerging");
  });

  it("keeps ancestry limits, underpowered nonconfirmation and two-copy uncertainty", () => {
    expect(report.summary).toContain("Ashkenazi Jewish ancestry");
    expect(report.summary).toContain("Evidence in other populations is less clear");
    expect(variant.interpretations.AT).toContain("cannot assume the same link in every population");
    expect(variant.interpretations.AT).toContain("too small to settle the link");
    expect(variant.interpretations.AA).toContain("whether two copies carry more risk than one");
    expect(variant.interpretations.TT).toContain("does not rule out colorectal cancer or other APC changes");
    expect(JSON.stringify(report)).not.toMatch(/risk at this position is not elevated|Standard screening guidance applies|6-7%/);
    const at = claims.find((claim) => claim.claim_id === `report.${report.slug}.interpretation.rs1801155.at`)!;
    expect(at.evidence.map((edge) => edge.citation)).toEqual([
      "pmid:37076288", "pmid:40866199", "dataset:dbsnp-rs1801155",
    ]);
  });

  it.each(["TT", "AT", "AA"])("renders %s through the resolver with exact claim and source anchors", (genotype) => {
    const outcome = resolveVariant(variant, genotype.split("").join("/"));
    expect(outcome.status).toBe("genotyped");
    if (outcome.status !== "genotyped") throw new Error("Expected a covered synthetic call");
    const sourceIds = reportSourceIds(report);
    const html = renderToStaticMarkup(h("div", null,
      h(ReportSummary, { slug: report.slug, text: report.summary, sourceIds }),
      h(ReportInterpretation, { slug: report.slug, rsid: variant.rsid, ...outcome, text: outcome.interpretation, sourceIds }),
      h(ClaimSources, { sourceIds }),
    ));
    expect(html).toContain(`data-claim-id="report.${report.slug}.interpretation.rs1801155.${genotype.toLowerCase()}"`);
    for (const id of sourceIds) {
      expect(html).toContain(`href="#claim-source-${id}"`);
      expect(html).toContain(`id="claim-source-${id}"`);
    }
    const drift = renderToStaticMarkup(h(ReportInterpretation, {
      slug: report.slug, rsid: variant.rsid, genotype, text: "Unsupported low-risk reassurance.", sourceIds,
    }));
    expect(drift).toContain('data-claim-registration="unregistered"');
    expect(drift).not.toContain("data-claim-id");
  });
});
