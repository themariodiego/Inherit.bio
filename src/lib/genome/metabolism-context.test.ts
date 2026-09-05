import { describe, expect, it } from "vitest";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import gut from "../../../data/templates/gastrointestinal.json";
import lifestyle from "../../../data/templates/lifestyle-wellness.json";
import { CitationItem } from "../../components/reports/report-evidence";
import { readStudyContext, seedCitations } from "./study-context";
import type { ReportTemplate } from "./reports";
import { isGatedTemplate } from "./taxonomy";
import { readabilitySentences, wordCount } from "../../../scripts/readability";

const alcohol = gut.find((item) => item.slug === "alcohol-flush-aldh2-rs671")! as ReportTemplate;
const caffeine = lifestyle.find((item) => item.slug === "caffeine-metabolism-cyp1a2-rs762551")! as ReportTemplate;

describe("bounded metabolism report corrections", () => {
  it.each([alcohol, caffeine])("preserves $slug evidence, gate and citation data through seeding and display", (report) => {
    expect(report.evidence).toBe("emerging");
    expect(report.pgs_id).toBeNull();
    expect(isGatedTemplate(report)).toBe(false);
    const stored = JSON.parse(JSON.stringify(seedCitations(report.citations)));
    expect(stored).toEqual(report.citations);
    for (const citation of report.citations) {
      const context = readStudyContext(citation)!;
      expect(context).not.toBeNull();
      const html = renderToStaticMarkup(h(CitationItem, { citation }));
      expect(html).toContain(`PMID ${citation.pmid}`);
      expect(html).toContain('dateTime="2026-09-05"');
      expect(html).not.toMatch(/<h2|data-figure|percentile/);
      for (const entry of Object.values(context)) {
        if (!entry) continue;
        expect(html).toContain(entry.text);
        expect(html).toContain(entry.locator);
        for (const sentence of readabilitySentences(entry.text)) expect(wordCount(sentence)).toBeLessThanOrEqual(32);
      }
    }
  });

  it("keeps the two alcohol studies distinct and unknown abstract demographics unknown", () => {
    const recent = alcohol.citations.find((source) => source.pmid === "39075523")!;
    const early = alcohol.citations.find((source) => source.pmid === "2024727")!;
    expect(readStudyContext(recent)?.population?.text).toContain("People with AA were excluded");
    expect(readStudyContext(early)?.population).toBeNull();
    expect(renderToStaticMarkup(h(CitationItem, { citation: early }))).toContain("Not recorded in this study summary.");
    expect(alcohol.variants[0].interpretations.GG).toContain("does not show the common Lys504 change");
    expect(alcohol.variants[0].interpretations.AA).toContain("two AA samples");
    expect(JSON.stringify(alcohol)).not.toMatch(/fully active|typical rate|do not show this excess|drink rarely|19320537/);
  });

  it("replaces the caffeine speed ladder, sleep and intake claims with the measured comparison", () => {
    expect(caffeine.variants[0]).toMatchObject({ chrom: 15, pos38: 74749576, ref: "C", alt: "A" });
    expect(caffeine.variants[0].interpretations.AA).toContain("AA smokers had higher enzyme activity than AC smokers");
    expect(caffeine.variants[0].interpretations.AC).toContain("not your measured caffeine breakdown rate");
    expect(caffeine.variants[0].interpretations.CC).toContain("did not establish a three-way order");
    expect(caffeine.citations[0].studyContext?.comparison?.text).toContain("Nonsmokers showed no clear genotype differences");
    expect(JSON.stringify(caffeine)).not.toMatch(/fast metabolizer|slower caffeine clearance|sleep problems|heart.attack|16522833/);
  });
});
