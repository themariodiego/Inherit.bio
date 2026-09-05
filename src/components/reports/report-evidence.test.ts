import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CitationItem, ReportCallCoverage } from "./report-evidence";
import * as copy from "@/copy/reports/basis";
import { readabilitySentences, wordCount } from "../../../scripts/readability";

describe("report evidence rendering", () => {
  it("links the existing citation and labels its actual source-read date", () => {
    const html = renderToStaticMarkup(h(CitationItem, { citation: { label: "Published guideline", pmid: "12345", accessedOn: "2026-09-04" } }));
    expect(html).toContain('href="https://pubmed.ncbi.nlm.nih.gov/12345/"');
    expect(html).toContain('<time dateTime="2026-09-04">2026-09-04</time>');
    expect(html).toContain(copy.SOURCE_READ_LABEL);
    expect(html).not.toMatch(/last updated|result checked|supporting study/);
  });
  it("does not invent missing dates or links", () => {
    const html = renderToStaticMarkup(h(CitationItem, { citation: { label: "A source" } }));
    expect(html).toContain(copy.SOURCE_READ_UNKNOWN);
    expect(html).not.toContain("<time");
    expect(html).not.toContain("<a");
  });
  it("keeps DOI-only citations linked", () => {
    expect(renderToStaticMarkup(h(CitationItem, { citation: { label: "Paper", doi: "10.1/test" } }))).toContain('href="https://doi.org/10.1/test"');
  });
  it("shows nonzero state counts with no genetic result, score or new top-level section", () => {
    const html = renderToStaticMarkup(h(ReportCallCoverage, { summary: { interpreted: 1, conflicting: 2, "no-call": 0, unrecognized: 0, unavailable: 3 } }));
    expect(html).toContain(copy.REPORT_CALLS_SCOPE);
    expect(html).toContain('data-call-state="conflicting"');
    expect(html).not.toContain('data-call-state="no-call"');
    expect(html).not.toMatch(/<h2|<section|data-figure|A\/A|percentile|<details/);
  });
  it("keeps derived counts inside the server-side result gate", () => {
    const page = readFileSync(new URL("../../app/(app)/genome/[subject]/reports/[slug]/page.tsx", import.meta.url), "utf8");
    const gateStart = page.indexOf("if (showResults) {");
    const gateEnd = page.indexOf("yourResult = (\n      <SensitiveGate", gateStart);
    expect(page.indexOf("summarizeReportCalls(resolved, conflicts)")).toBeGreaterThan(gateStart);
    expect(page.indexOf("summarizeReportCalls(resolved, conflicts)")).toBeLessThan(gateEnd);
    expect(page).toContain("let callSummary: ReportCallSummary | null = null");
    expect(page).toContain("{callSummary ? <ReportCallCoverage summary={callSummary} /> : null}");
    expect(page).not.toContain("supportingStudies(template.citations.length)");
  });
  it("keeps new explanatory copy within the sentence cap and avoids ASCII apostrophes", () => {
    const strings = [
      ...Object.values(copy.REPORT_METHOD_COPY), ...Object.values(copy.REPORT_CALL_LABELS),
      ...Object.values(copy).filter((value) => typeof value === "string"),
      copy.citedSources(1), copy.citedSources(5),
    ];
    for (const text of strings) {
      expect(text).not.toMatch(/[A-Za-z]'[A-Za-z]/);
      for (const sentence of readabilitySentences(text)) expect(wordCount(sentence), sentence).toBeLessThanOrEqual(32);
    }
    expect(copy.citedSources(1)).toBe("1 cited source");
    expect(copy.citedSources(2)).toBe("2 cited sources");
  });
});
