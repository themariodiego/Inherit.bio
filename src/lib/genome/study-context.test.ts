import { describe, expect, it } from "vitest";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import basic from "../../../data/templates/basic-traits.json";
import gut from "../../../data/templates/gastrointestinal.json";
import { readStudyContext, seedCitations, STUDY_CONTEXT_FIELDS, studyContextFindings } from "./study-context";
import { CitationItem } from "../../components/reports/report-evidence";
import { isGatedTemplate } from "./taxonomy";
import type { Citation, ReportTemplate } from "./reports";
import { templateProseFields } from "../../../scripts/validate-templates";
import { readabilitySentences, wordCount } from "../../../scripts/readability";

const pilot = ([...basic, ...gut] as ReportTemplate[]).filter((template) => template.citations.some((citation) => "studyContext" in citation));
const citation = pilot[0].citations[0] as Citation;

describe("source-bound study context", () => {
  it("seeds exactly three ungated pilot reports without changing their evidence or score type", () => {
    expect(pilot.map((template) => template.slug).sort()).toEqual([
      "bitter-taste-tas2r38", "earwax-type-abcc11", "lactase-persistence-lct-rs4988235",
    ]);
    for (const template of pilot) {
      expect(isGatedTemplate(template)).toBe(false);
      expect(template.evidence).toBe("emerging");
      expect(template.pgs_id).toBeNull();
      const stored = JSON.parse(JSON.stringify(seedCitations(template.citations)));
      expect(stored).toEqual(template.citations);
      expect(readStudyContext(stored[0])).toEqual(template.citations[0].studyContext);
    }
  });

  it("renders study facts, their paper locations, source identifiers and actual read dates", () => {
    for (const template of pilot) {
      const source = template.citations[0] as Citation;
      const html = renderToStaticMarkup(h(CitationItem, { citation: source }));
      expect(html).toContain('data-slot="study-context"');
      expect(html).toContain(`PMID ${source.pmid}`);
      expect(html).toContain('dateTime="2026-09-05"');
      expect(html).toContain("not a personal result");
      for (const entry of Object.values(readStudyContext(source)!)) {
        expect(html).toContain(entry!.text);
        expect(html).toContain(entry!.locator);
      }
      expect(html).not.toMatch(/<h2|data-figure|percentile/);
    }
  });

  it("keeps partial knowledge explicitly unknown rather than generating a population or limitation", () => {
    const partial = { ...citation, studyContext: { ...citation.studyContext!, population: null, limitation: null } };
    expect(studyContextFindings(partial)).toEqual([]);
    const html = renderToStaticMarkup(h(CitationItem, { citation: partial }));
    expect(html.match(/Not recorded in this study summary\./g)).toHaveLength(2);
    expect(html).not.toContain(citation.studyContext!.population!.text);
  });

  it.each([
    { accessedOn: undefined }, { accessedOn: "2026-02-30" }, { pmid: "x" },
    { studyContext: null }, { studyContext: [] },
    { studyContext: { ...citation.studyContext, measured: undefined } },
    { studyContext: { ...citation.studyContext, measured: { text: "claim" } } },
    { studyContext: { ...citation.studyContext, population: { text: 12, locator: "Abstract" } } },
  ])("withholds invalid context and refuses to seed it: %j", (change) => {
    const invalid = { ...citation, ...change };
    expect(studyContextFindings(invalid).length).toBeGreaterThan(0);
    expect(readStudyContext(invalid)).toBeNull();
    expect(() => seedCitations([invalid])).toThrow();
    expect(renderToStaticMarkup(h(CitationItem, { citation: invalid as Citation }))).not.toContain('data-slot="study-context"');
  });

  it("leaves legacy citations unchanged and does not inherit context from a nearby citation", () => {
    const legacy = { label: "Older citation", pmid: "15723792" };
    expect(seedCitations([legacy])).toEqual([legacy]);
    expect(readStudyContext(legacy)).toBeNull();
    expect(renderToStaticMarkup(h(CitationItem, { citation: legacy }))).not.toContain('data-slot="study-context"');
  });

  it("includes new prose in template safety checks and keeps sentences within the cap", () => {
    for (const template of pilot) {
      const context = readStudyContext(template.citations[0])!;
      for (const field of STUDY_CONTEXT_FIELDS) {
        const text = context[field]!.text;
        expect(templateProseFields(template)).toContain(text);
        for (const sentence of readabilitySentences(text)) expect(wordCount(sentence), sentence).toBeLessThanOrEqual(32);
      }
    }
  });

  it("does not reverse the primary-paper residue association or infer full taste patterns", () => {
    const taste = pilot.find((template) => template.slug === "bitter-taste-tas2r38")!;
    const position = taste.variants.find((variant) => variant.rsid === 1726866)!;
    expect({ chrom: position.chrom, pos: position.pos38, ref: position.ref, alt: position.alt })
      .toEqual({ chrom: 7, pos: 141972905, ref: "G", alt: "A" });
    expect(position.interpretations.GG).toContain("Ala262");
    expect(position.interpretations.GG).toContain("greater PTC taste sensitivity");
    expect(position.interpretations.AA).toContain("Val262");
    expect(position.interpretations.AA).toContain("lower PTC taste sensitivity");
    expect(position.interpretations.AG).toContain("does not show the full patterns");
    expect(taste.summary).not.toContain("70%");
  });
});
