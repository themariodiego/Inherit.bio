import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import mental from "../../../data/templates/mental-health.json";
import addiction from "../../../data/templates/addiction.json";
import { CitationItem } from "../../components/reports/report-evidence";
import { resolveTemplate, type ReportTemplate } from "./reports";
import { readStudyContext, seedCitations, studyContextFindings } from "./study-context";
import { isGatedTemplate } from "./taxonomy";
import { jargonTermList, titleFindings } from "./template-prose";
import jargon from "../../../data/jargon.json";

// These tests pin reviewed editorial distinctions and the real renderer. They
// are not a substitute for independent primary-source verification, recorded in
// docs/sources/reviews/batch-02/independent-correction-review.md.
const slugs = ["stress-anxiety-comt-rs4680", "mood-stress-resilience-bdnf-rs6265", "problem-substance-use-faah-rs324420"];
const reports = ([...mental, ...addiction] as ReportTemplate[]).filter((t) => slugs.includes(t.slug));
const report = (slug: string) => reports.find((t) => t.slug === slug)!;
const plainHtml = (text: string) => renderToStaticMarkup(h("span", null, text)).slice(6, -7);

describe("behavior report source corrections", () => {
  it("preserves every report, observed genotype and evidence tier without a new reveal gate", () => {
    expect(reports.map((t) => t.slug).sort()).toEqual([...slugs].sort());
    const bindings = [
      { slug: slugs[0], rsid: 4680, chrom: 22, pos38: 19963748, ref: "G", alt: "A", keys: ["AA", "AG", "GG"], evidence: "emerging", gated: true },
      { slug: slugs[1], rsid: 6265, chrom: 11, pos38: 27658369, ref: "C", alt: "T", keys: ["CC", "CT", "TT"], evidence: "preliminary", gated: true },
      { slug: slugs[2], rsid: 324420, chrom: 1, pos38: 46405089, ref: "C", alt: "A", keys: ["AA", "AC", "CC"], evidence: "preliminary", gated: false },
    ];
    for (const binding of bindings) {
      const t = report(binding.slug);
      expect(t.evidence).toBe(binding.evidence);
      expect(t.pgs_id).toBeNull();
      // Preserve existing category gates; these content edits add no new gate.
      expect(isGatedTemplate(t)).toBe(binding.gated);
      expect(t.variants).toHaveLength(1);
      const v = t.variants[0];
      expect(v).toMatchObject({ rsid: binding.rsid, chrom: binding.chrom, pos38: binding.pos38, ref: binding.ref, alt: binding.alt });
      expect(Object.keys(v.interpretations).sort()).toEqual(binding.keys);
      expect(new Set(Object.values(v.interpretations)).size).toBe(3);
      for (const key of binding.keys) {
        // Synthetic calls only; exercise the same resolver as result pages.
        const resolved = resolveTemplate(t, (rsid) => rsid === binding.rsid ? key.split("").join("/") : undefined);
        expect(resolved.covered).toBe(true);
        expect(resolved.variants[0].outcome).toMatchObject({ status: "genotyped", genotype: key, interpretation: v.interpretations[key] });
      }
      expect(resolveTemplate(t, () => undefined).covered).toBe(false);
      expect(resolveTemplate(t, () => "--").variants[0].outcome).toEqual({ status: "no-call" });
    }
  });

  it("retains the older BDNF finding alongside direct later counterevidence, not an invented dose ranking", () => {
    const t = report(slugs[1]);
    expect(t.citations.map((c) => c.pmid)).toEqual(["12553913", "24433458", "30845820"]);
    expect(t.summary).toContain("did not confirm");
    expect(t.variants[0].interpretations.CT).toContain("one or two Met copies together");
    expect(t.variants[0].interpretations.TT).toContain("did not establish that TT has a stronger effect than CT");
    const cell = readStudyContext(t.citations[0])!;
    expect(cell.measured?.text).toContain("separately in lab-grown nerve cells");
    expect(cell.limitation?.text).toContain("did not measure protein release");
    const later = readStudyContext(t.citations[2])!;
    expect(later.comparison?.text).toContain("did not pass");
  });

  it("keeps COMT enzyme forms distinct from personality or acute-stress scores", () => {
    const t = report(slugs[0]);
    expect(t.citations.map((c) => c.pmid)).toEqual(["11381111", "15956988"]);
    expect(t.variants[0].interpretations.GG).toContain("higher-activity form");
    expect(t.variants[0].interpretations.AA).toContain("lower-activity form");
    expect(t.variants[0].interpretations.AG).toContain("does not place your anxiety halfway");
    expect(readStudyContext(t.citations[1])?.population?.text).toContain("497 college students");
    expect(readStudyContext(t.citations[1])?.comparison?.text).toContain("not just this one site");
  });

  it("does not infer FAAH heterozygote signaling or behavior from the protein assay", () => {
    const t = report(slugs[2]);
    expect(t.citations.map((c) => c.pmid)).toEqual(["12060782"]);
    expect(t.variants[0].interpretations.AC).toContain("not more common");
    expect(t.variants[0].interpretations.AC).toContain("not be treated as half");
    expect(t.summary).toContain("lab test");
    expect(JSON.stringify(t)).not.toMatch(/raises (?:baseline )?anandamide|later work links A|AA greatly lowers FAAH stability/i);
  });

  it("survives seed serialization and renders every reviewed source, date and scope visibly", () => {
    for (const t of reports) {
      expect(titleFindings(t.title, jargonTermList(jargon))).toEqual([]);
      expect(t.title).toMatch(/[.!?]$/);
      const stored = JSON.parse(JSON.stringify(seedCitations(t.citations)));
      expect(stored).toEqual(t.citations);
      for (const citation of t.citations) {
        expect(studyContextFindings(citation)).toEqual([]);
        expect(citation.accessedOn).toBe("2026-09-06");
        const context = readStudyContext(citation);
        expect(context).not.toBeNull();
        const html = renderToStaticMarkup(h(CitationItem, { citation }));
        expect(html).toContain(`href="https://pubmed.ncbi.nlm.nih.gov/${citation.pmid}/"`);
        expect(html).toContain('dateTime="2026-09-06"');
        expect(html).toContain('data-slot="study-context"');
        for (const entry of Object.values(context!)) {
          if (!entry) continue;
          expect(html).toContain(plainHtml(entry.text));
          expect(html).toContain(plainHtml(entry.locator));
        }
        expect(html).not.toMatch(/<details|\shidden[=> ]|data-figure-kind|<h2/);
      }
    }
  });
});
