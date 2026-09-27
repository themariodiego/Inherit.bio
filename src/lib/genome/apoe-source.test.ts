import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import templates from "../../../data/templates/neurodegenerative.json";
import citations from "../../../data/citations.json";
import { ReportInterpretation, ReportSummary } from "../../components/reports/report-summary";
import { ClaimSources } from "../../components/claims/sources";
import { reportSourceIds } from "../claims/presentation";
import { resolveTemplate, resolveVariant, type ReportTemplate } from "./reports";
import { resolveReportCalls, type ReportCall } from "./report-calls";

const report = templates.find((item) => item.slug === "apoe-e4-alzheimers-risk")! as ReportTemplate;
const sourceIds = ["pmid:8346443", "pmid:9343467", "dataset:ncrad-apoe-genotyping"];
const [first, second] = report.variants;
const oldText = "Plainly, this often means ε4/ε4. Two C copies tag two ε4 alleles, and rs7412 is almost always C on those chromosomes. European-ancestry studies link ε4/ε4 to higher odds of late-onset Alzheimer’s disease: a large shift. Some other ancestry groups have lower estimates. Many carriers never develop dementia. This is a risk link, not a certainty.";

function renderCalls(a: string | undefined, b: string | undefined) {
  const result = resolveTemplate(report, (rsid) => rsid === first.rsid ? a : b);
  const html = renderToStaticMarkup(h("div", null, ...result.variants.map(({ variant, outcome }) =>
    outcome.status === "genotyped" ? h(ReportInterpretation, {
      key: variant.rsid, slug: report.slug, rsid: variant.rsid, ...outcome, text: outcome.interpretation, sourceIds,
    }) : h("span", { key: variant.rsid }, outcome.status))));
  return { result, html };
}

describe("APOE separate-marker source boundary", () => {
  it("preserves exact forward allele identities and evidence without introducing a joint caller", () => {
    expect(createHash("sha256").update(JSON.stringify(report)).digest("hex"))
      .toBe("a72d09e5db49151eeb956cb4505091c6d394dd59ba23cad1f6bbe885de3febf7");
    expect(report.evidence).toBe("emerging");
    expect(report.variants).toHaveLength(2);
    expect(first).toMatchObject({ rsid: 429358, gene: "APOE", chrom: 19, pos38: 44908684, ref: "T", alt: "C" });
    expect(second).toMatchObject({ rsid: 7412, gene: "APOE", chrom: 19, pos38: 44908822, ref: "C", alt: "T" });
    for (const variant of report.variants) {
      expect(resolveVariant(variant, "C/T")).toMatchObject({ status: "genotyped", genotype: "CT", strandFlipped: false });
      expect(resolveVariant(variant, "A/G")).toMatchObject({ status: "genotyped", genotype: "CT", strandFlipped: true });
      expect(resolveVariant(variant, "C/A").status).toBe("unrecognized");
    }
    expect(renderCalls(undefined, undefined).result.covered).toBe(false);
  });

  it.each([
    ["C/C", undefined, "genotyped", "not-covered"],
    ["C/C", "--", "genotyped", "no-call"],
    [undefined, "T/T", "not-covered", "genotyped"],
    ["--", "T/T", "no-call", "genotyped"],
    [undefined, "C/C", "not-covered", "genotyped"],
    ["--", "C/C", "no-call", "genotyped"],
    ["C/C", "T/T", "genotyped", "genotyped"],
    ["C/T", "C/T", "genotyped", "genotyped"],
    ["C/C", "C/A", "genotyped", "unrecognized"],
  ])("does not assign a type or personal odds for %s / %s", (a, b, firstStatus, secondStatus) => {
    const { result, html } = renderCalls(a, b);
    expect(result.covered).toBe(true); // Preserve the existing any-covered-marker contract.
    expect(result.variants.map((entry) => entry.outcome.status)).toEqual([firstStatus, secondStatus]);
    expect(html).toContain("This report does not combine it with");
    expect(html).toContain("to assign your APOE type or a personal disease risk");
    expect(html).not.toMatch(/ε|epsilon|higher odds|lower odds|risk estimate|never develop|almost always|\d+%|1 in 200/iu);
    for (const { variant, outcome } of result.variants) {
      if (outcome.status !== "genotyped") continue;
      expect(html).toContain(`data-claim-id="report.${report.slug}.interpretation.rs${variant.rsid}.${outcome.genotype.toLowerCase()}"`);
      expect(outcome.interpretation).toContain(`at rs${variant.rsid}`);
    }
  });

  it("keeps conflicting observations suppressed before separate-marker rendering", () => {
    const call: ReportCall = { file_id: "synthetic", rsid: first.rsid, chrom: first.chrom, pos: first.pos38,
      ref: first.ref, alt: first.alt, genotype: "C/C", usable: true };
    const result = resolveReportCalls([call, { ...call, genotype: "T/T" }], [report]);
    expect([...result.conflicts]).toEqual([first.rsid]);
    expect(result.genotypes.has(first.rsid)).toBe(false);
    const resolved = resolveTemplate(report, (rsid) => result.genotypes.get(rsid));
    expect(resolved.covered).toBe(false);
    expect(resolved.variants.map((entry) => entry.outcome.status)).toEqual(["not-covered", "not-covered"]);
  });

  it("binds actual abstract access and a short joint-marker chart excerpt without adding a template citation type", () => {
    expect(reportSourceIds(report)).toEqual(sourceIds);
    expect(report.citations.map((citation) => citation.pmid)).toEqual(["8346443", "9343467"]);
    expect(report.citations.map((citation) => citation.accessedOn)).toEqual(["2026-09-23", "2026-09-23"]);
    for (const id of sourceIds.slice(0, 2)) {
      const source = citations.find((candidate) => candidate.id === id)!;
      expect(source.claim).toContain("author abstract only");
      expect(source.claim).toContain("inaccessible");
      expect(source.quote.trim().split(/\s+/u).length).toBeLessThanOrEqual(25);
    }
    const chart = citations.find((candidate) => candidate.id === sourceIds[2])!;
    expect(chart.type).toBe("dataset");
    const snapshot = JSON.parse(readFileSync(chart.archived_path!, "utf8"));
    expect(snapshot.url).toBe(chart.url);
    expect(snapshot.readAt.startsWith(chart.access_date)).toBe(true);
    expect(snapshot.quote).toBe(chart.quote);
    expect(snapshot.selectedGenotypeRows).toEqual([
      { apoe: "ε1/ε3", rs429358: "CT", rs7412: "CT" },
      { apoe: "ε2/ε4", rs429358: "CT", rs7412: "CT" },
    ]);
    const html = renderToStaticMarkup(h("div", null,
      h(ReportSummary, { slug: report.slug, text: report.summary, sourceIds }), h(ClaimSources, { sourceIds })));
    expect(html).toContain(`data-claim-id="report.${report.slug}.summary"`);
    for (const id of sourceIds) {
      expect(html).toContain(`href="#claim-source-${id}"`);
      expect(html).toContain(`id="claim-source-${id}"`);
    }
  });

  it("leaves historical captured wording unregistered and refuses changed genotype attribution", () => {
    for (const props of [
      { text: oldText, rsid: first.rsid, genotype: "CC" },
      { text: first.interpretations.CC, rsid: second.rsid, genotype: "CC" },
      { text: first.interpretations.CC, rsid: first.rsid, genotype: "CT" },
    ]) {
      const html = renderToStaticMarkup(h(ReportInterpretation, { slug: report.slug, sourceIds, ...props }));
      expect(html).toContain('data-claim-registration="unregistered"');
      expect(html).not.toContain("data-claim-id");
      expect(html).not.toContain('href="#claim-source-');
    }
    const historical = structuredClone(report);
    historical.summary = "Historical snapshot summary.";
    historical.variants.forEach((variant) => Object.keys(variant.interpretations).forEach((genotype) => {
      variant.interpretations[genotype] = oldText;
    }));
    expect(reportSourceIds(historical)).toEqual([]);
    const note = readFileSync("docs/sources/reviews/apoe-correction-20260923.md", "utf8");
    expect(note).toContain("Historical captured templates retain their original interpretation");
    expect(note).toContain("not clinical approval or human signoff");
  });
});
