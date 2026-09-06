import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import templates from "../../../data/templates/environmental-sensitivity.json";
import { CitationItem } from "../../components/reports/report-evidence";
import { resolveTemplate, type ReportTemplate } from "./reports";
import { readStudyContext, seedCitations, studyContextFindings } from "./study-context";
import { isGatedTemplate } from "./taxonomy";

// Editorial regressions, not independent scientific approval. The evidence and
// unresolved study limits are in batch-04/slc45a2-correction.md.
const template = (templates as ReportTemplate[]).find((t) => t.slug === "skin-uv-sensitivity-slc45a2")!;
const variant = template.variants[0];
const escaped = (text: string) => renderToStaticMarkup(h("span", null, text)).slice(6, -7);

describe("SLC45A2 source-bound correction", () => {
  it("preserves the existing locus, report identity, evidence and access rules", () => {
    expect(template.category).toBe("environmental-sensitivity");
    expect(template.evidence).toBe("emerging");
    expect(template.pgs_id).toBeNull();
    expect(isGatedTemplate(template)).toBe(false);
    expect(template.variants).toHaveLength(1);
    expect(variant).toMatchObject({ rsid: 16891982, gene: "SLC45A2", chrom: 5, pos38: 33951588, ref: "C", alt: "G" });
    expect(Object.keys(variant.interpretations).sort()).toEqual(["CC", "CG", "GG"]);
    expect(new Set(Object.values(variant.interpretations)).size).toBe(3);
  });

  it.each(["CC", "CG", "GG"])("resolves the corrected %s interpretation only from the observed call", (genotype) => {
    const result = resolveTemplate(template, (rsid) => rsid === 16891982 ? genotype.split("").join("/") : undefined);
    expect(result.covered).toBe(true);
    expect(result.variants[0].outcome).toMatchObject({ status: "genotyped", genotype, interpretation: variant.interpretations[genotype] });
  });

  it("does not turn missing calls into a reference genotype", () => {
    expect(resolveTemplate(template, () => undefined).covered).toBe(false);
    expect(resolveTemplate(template, () => "--").variants[0].outcome).toEqual({ status: "no-call" });
  });

  it("pins the corrected forward-letter direction without a heterozygote midpoint or ancestry inference", () => {
    expect(template.summary).toContain("C codes for Leu374, the darker-skin-associated form");
    expect(template.summary).toContain("G codes for Phe374, the lighter-skin-associated form");
    expect(variant.interpretations.CC).toContain("C, coding for Leu374, the form linked to darker skin");
    expect(variant.interpretations.GG).toContain("G, coding for Phe374, the form linked to lighter skin");
    expect(variant.interpretations.CG).toContain("One C (Leu374) and one G (Phe374) copy");
    expect(variant.interpretations.CG).toContain("does not place your skin color halfway");
    expect(variant.interpretations.CG).toContain("does not establish your ancestry or sun tolerance");
    expect(variant.interpretations.CC).toContain("does not establish greater sun tolerance");
    expect(variant.interpretations.GG).toContain("does not measure your skin color, sun sensitivity or safe time");
    expect(JSON.stringify(template)).not.toMatch(/almost universal|predominant form|common European form|intermediate constitutive|reflects mixed ancestry/);
  });

  it("keeps the human association separate from the cell experiment and its scope", () => {
    expect(template.citations.map((citation) => citation.pmid)).toEqual(["29974532", "18483556", "32966160"]);
    const spanish = readStudyContext(template.citations[0])!;
    expect(spanish.population?.text).toContain("456 people from Spain");
    expect(spanish.limitation?.text).toContain("does not give a C-versus-G contrast");
    const han = readStudyContext(template.citations[1])!;
    expect(han.population?.text).toContain("This site's analysis used skin-cancer study controls");
    expect(han.comparison?.text).toContain("three other sites in the same gene");
    const cell = readStudyContext(template.citations[2])!;
    expect(cell.population?.text).toContain("mouse pigment cells given human SLC45A2 protein forms");
    expect(cell.comparison?.text).toBe("Phe374 made less pigment and broke down faster than Leu374.");
    expect(cell.limitation?.text).toContain("does not establish a halfway effect");
  });

  it("preserves and visibly renders every dated source context through seed serialization", () => {
    const stored = JSON.parse(JSON.stringify(seedCitations(template.citations)));
    expect(stored).toEqual(template.citations);
    for (const citation of stored as ReportTemplate["citations"]) {
      expect(studyContextFindings(citation)).toEqual([]);
      expect(citation.accessedOn).toBe("2026-09-06");
      const context = readStudyContext(citation)!;
      expect(context).not.toBeNull();
      const html = renderToStaticMarkup(h(CitationItem, { citation }));
      expect(html).toContain(`href="https://pubmed.ncbi.nlm.nih.gov/${citation.pmid}/"`);
      expect(html).toContain('dateTime="2026-09-06"');
      expect(html).toContain('data-slot="study-context"');
      for (const entry of Object.values(context)) {
        expect(entry).not.toBeNull();
        expect(html).toContain(escaped(entry!.text));
        expect(html).toContain(escaped(entry!.locator));
      }
      expect(html).not.toMatch(/<details|\shidden[=> ]|data-figure-kind|<h2/);
    }
  });
});
