import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { StarterReports } from "./starter-reports";
import { STARTER } from "@/copy/overview";
import type { ReportTemplate } from "@/lib/genome/reports";

function report(slug: string, layer: "estimate" | "variant_call"): ReportTemplate {
  return { slug, title: slug, category: "basic-traits", summary: "", evidence: "emerging",
    layer, estimate_kind: layer === "estimate" ? "single_locus" : null,
    variants: [], citations: [], pgs_id: null };
}

describe("classified starter rendering", () => {
  it.each([1, 4, 5])("retains exact prescribed wording for %i homogeneous reports", (size) => {
    const html = renderToStaticMarkup(h(StarterReports, {
      reports: Array.from({ length: size }, (_, index) => report(`report-${index}`, "estimate")),
    }));
    expect(html).toContain(size === 5 ? STARTER.five : STARTER.some(size));
    expect(html.match(/data-slot="count"/g)).toHaveLength(1);
    expect(html).toContain(`data-metric-value="${size}"`);
    expect(html).toContain('data-figure-class="estimate"');
    expect(html).toContain('href="#overview-estimate-definition"');
    expect(html.match(/href="\/genome\/me\/reports\//g)).toHaveLength(size);
    expect(html).not.toMatch(/<h[1-6]/);
  });

  it("keeps all five selected links, but no mixed five-report headline", () => {
    const reports = [report("one", "estimate"), report("two", "variant_call"),
      report("three", "estimate"), report("four", "variant_call"), report("five", "estimate")];
    const html = renderToStaticMarkup(h(StarterReports, { reports }));
    expect(html).not.toContain(STARTER.five);
    expect(html).toContain(STARTER.some(3));
    expect(html).toContain(STARTER.some(2));
    expect(html.match(/data-slot="count"/g)).toHaveLength(2);
    expect(html.match(/<section/g)).toHaveLength(2);
    expect(html).toContain('data-figure-class="estimate" data-metric-value="3"');
    expect(html).toContain('data-figure-class="variant-call" data-metric-value="2"');
    for (const item of reports) expect(html).toContain(`href="/genome/me/reports/${item.slug}"`);
    expect(html).toContain('href="#overview-variant-call-definition"');
    expect(html).not.toMatch(/<h[1-6]/);
  });

  it("preserves the no-covered-starter state without a fabricated zero count", () => {
    const html = renderToStaticMarkup(h(StarterReports, { reports: [] }));
    expect(html).toContain(STARTER.none);
    expect(html).not.toContain('data-slot="count"');
  });
});
