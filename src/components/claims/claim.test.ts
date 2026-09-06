import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createHash } from "node:crypto";
import { chromium, type Browser } from "@playwright/test";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import claims from "../../../data/claims.json";
import mental from "../../../data/templates/mental-health.json";
import addiction from "../../../data/templates/addiction.json";
import environmental from "../../../data/templates/environmental-sensitivity.json";
import { Claim } from "./claim";
import { ClaimSources } from "./sources";
import { ReportSummary, ReportSummarySources } from "../reports/report-summary";
import { CitationItem } from "../reports/report-evidence";
import SciencePage from "../../app/(marketing)/science/page";
import { annotateReportSources, claimSourceIds, legacySourceId, presentationCitations, registeredReportSummary, reportSummarySourceIds } from "../../lib/claims/presentation";
import { collectDomSurface } from "../../lib/claims/collect-dom";

const summaries = claims.filter((claim) => claim.claim_id.endsWith(".summary"));
const templates = [...mental, ...addiction, ...environmental].filter((template) =>
  summaries.some((claim) => claim.claim_id === `report.${template.slug}.summary`));
let browser: Browser;
beforeAll(async () => { browser = await chromium.launch({ headless: true }); });
afterAll(async () => { await browser?.close(); });

function renderedReport(template: typeof templates[number]) {
  const existingIds = template.citations.map(legacySourceId);
  const sourceIds = reportSummarySourceIds(template.slug, template.summary, existingIds);
  return renderToStaticMarkup(h("main", null,
    h(ReportSummary, { slug: template.slug, text: template.summary, sourceIds }),
    h("ul", null, annotateReportSources(sourceIds, template.citations).map(({ citation, anchor }, index) => h("li", {
      key: index, id: anchor,
    }, h(CitationItem, { citation, reportClaim: { slug: template.slug, sourceIds } })))),
    h(ReportSummarySources, { sourceIds, existingIds }),
    h("a", { href: "/science#sources" }, "About these sources"),
  ));
}

describe("canonical claim display connected to real report components", () => {
  it("requires a real primary citation belonging to this exact claim", () => {
    const claim = summaries[0];
    const sourceIds = claimSourceIds([claim.claim_id]);
    expect(() => renderToStaticMarkup(h(Claim, { id: claim.claim_id, citationId: "pmid:99999999", sourceIds }))).toThrow("Primary citation");
    expect(() => renderToStaticMarkup(h(Claim, { id: "missing", citationId: sourceIds[0], sourceIds }))).toThrow("Unknown canonical claim");
    expect(() => renderToStaticMarkup(h(Claim, { id: claim.claim_id, citationId: sourceIds[0], sourceIds: [] }))).toThrow("page source list");
    expect(() => renderToStaticMarkup(h(Claim, { id: claim.claim_id, citationId: sourceIds[0], sourceIds: [...sourceIds, sourceIds[0]] }))).toThrow("page source list");
    expect(() => renderToStaticMarkup(h(Claim, { id: claim.claim_id, citationId: sourceIds[0], sourceIds: [...sourceIds, "missing"] }))).toThrow("Unknown canonical source");
  });

  it.each(templates)("collects $slug verbatim and resolves every source link in actual Chromium DOM", async (template) => {
    const page = await browser.newPage();
    await page.route("**/*", (route) => route.abort());
    try {
      const html = renderedReport(template);
      await page.setContent(html);
      const observation = await page.evaluate(collectDomSurface, {
        surface: `/genome/[subject]/reports/${template.slug}#state=complete`, channel: "seeded-authenticated" as const,
        contentCommitSha: "a".repeat(40), payloadSha256: createHash("sha256").update(html).digest("hex"),
      });
      const canonical = registeredReportSummary(template.slug, template.summary)!;
      const expected = claims.filter((claim) => claim.claim_id.startsWith(`report.${template.slug}.`));
      expect(observation.claims).toHaveLength(expected.length);
      const summary = observation.claims.find((claim) => claim.claimId === canonical.claim_id)!;
      expect(summary).toMatchObject({ claimId: canonical.claim_id, text: template.summary,
        provenance: `citation:${canonical.evidence[0].citation}` });
      expect([...summary.citationIds].sort()).toEqual(claimSourceIds([canonical.claim_id]).sort());
      for (const claim of expected) {
        const observed = observation.claims.find((entry) => entry.claimId === claim.claim_id)!;
        expect(observed.text).toBe(claim.text_verbatim);
        expect([...observed.citationIds].sort()).toEqual(claimSourceIds([claim.claim_id]).sort());
      }
      expect(observation.claimRegions.map((region) => region.regionId)).toEqual(["report-summary"]);
      const targets = await page.locator("[data-claim-id] sup a").evaluateAll((links) => links.map((link) => {
        const href = link.getAttribute("href")!;
        const target = document.getElementById(href.slice(1));
        return { count: [...document.querySelectorAll("[id]")].filter((element) => element.id === href.slice(1)).length,
          sourceHref: target?.querySelector("a[href]")?.getAttribute("href") };
      }));
      expect(targets.every((target) => target.count === 1)).toBe(true);
      for (const source of canonical.evidence) expect(targets.some((target) => target.sourceHref === source.doi_or_url)).toBe(true);
      for (const citation of template.citations) {
        await expect(page.locator(`a[href="https://pubmed.ncbi.nlm.nih.gov/${citation.pmid}/"]`).count()).resolves.toBe(1);
      }
    } finally { await page.close(); }
  });

  it("does not attribute changed hosted prose or an unregistered report to a reviewed source", () => {
    const template = templates[0];
    for (const [slug, text] of [[template.slug, template.summary + " Changed."], ["unknown-report", "Unregistered report text."]]) {
      expect(registeredReportSummary(slug, text)).toBeUndefined();
      expect(reportSummarySourceIds(slug, text, [])).toEqual([]);
      const html = renderToStaticMarkup(h(ReportSummary, { slug, text, sourceIds: [] }));
      expect(html).toContain('data-claim-registration="unregistered"');
      expect(html).toContain('data-claim-region="report-summary"');
      expect(html).not.toContain("data-claim-id");
      expect(html).not.toContain("<sup");
    }
  });

  it("assigns each source anchor only once across visible and overflow legacy entries", () => {
    const template = templates[0];
    const entries = [template.citations[0], template.citations[0], template.citations[0], ...template.citations];
    const sourceIds = reportSummarySourceIds(template.slug, template.summary, entries.map(legacySourceId));
    const annotated = annotateReportSources(sourceIds, entries);
    const rendered = [...annotated.slice(0, 3), ...annotated.slice(3)];
    const anchors = rendered.flatMap((entry) => entry.anchor ? [entry.anchor] : []);
    expect(new Set(anchors).size).toBe(anchors.length);
    expect(rendered).toHaveLength(entries.length);
    expect(rendered.filter((entry) => entry.citation.pmid === entries[0].pmid && entry.anchor)).toHaveLength(1);
    for (const entry of rendered.filter((entry) => entry.number)) {
      expect(entry.number).toBe(sourceIds.indexOf(legacySourceId(entry.citation)) + 1);
    }
  });

  it("publishes a real science source anchor, dates and all canonical records without claiming complete coverage", async () => {
    const page = await browser.newPage();
    await page.route("**/*", (route) => route.abort());
    try {
      await page.setContent(renderToStaticMarkup(h(SciencePage)));
      expect(await page.locator("#sources [data-source-id]").count()).toBe(presentationCitations.length);
      expect(await page.locator("#sources").textContent()).toContain("not a complete review");
      for (const source of presentationCitations) {
        expect(await page.locator(`#sources a[href="${source.url}"]`).count()).toBe(1);
      }
      expect(await page.locator('#sources time[datetime="2026-09-06"]').count()).toBe(presentationCitations.length);
    } finally { await page.close(); }
  });

  it("rejects duplicate source anchors and invalid list numbering", () => {
    const id = presentationCitations[0].id;
    expect(() => renderToStaticMarkup(h(ClaimSources, { sourceIds: [id, id] }))).toThrow("Duplicate");
    expect(() => renderToStaticMarkup(h(ClaimSources, { sourceIds: [id], start: 0 }))).toThrow("Invalid");
  });
});
