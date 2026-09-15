import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import manifest from "../../../../data/ref/aims-seven-region-manifest.json";
import { regionalMapShapes } from "@/lib/ancestry/regional-geometry";
import type { RegionalReferenceFacts } from "@/lib/ancestry/regional-regions";
import { REGIONAL_CAVEAT, REGIONAL_EMPTY_NOTE, REGIONAL_RANGE_NOTE, regionalReporting, type RegionalAdmixtureResult } from "@/lib/genome/regional-admixture";
import { RegionalAncestryRegions } from "./regional-ancestry-regions";

const proportions = { AFR: 0.1, AMR: 0.009, CSA: 0.17, EAS: 0.08, EUR: 0.38, MID: 0.26, OCE: 0.001 };
const result: RegionalAdmixtureResult = { proportions, markersUsed: 168, reporting: regionalReporting(proportions),
  note: REGIONAL_RANGE_NOTE, fit: { converged: true, iterations: 42 } };
function render(value: RegionalAdmixtureResult | null, initialWellSupportedOnly = true) {
  return renderToStaticMarkup(h(RegionalAncestryRegions, { subjectId: "synthetic-regional-subject", result: value,
    minMarkers: 168, shapes: regionalMapShapes(), panel: { markers: 168, version: manifest.referenceVersion },
    reference: manifest as RegionalReferenceFacts, initialWellSupportedOnly }));
}
const openingTags = (html: string) => [...html.matchAll(/<[a-z][^>]*>/g)].map(match => match[0]);

describe("seven-region ancestry surface", () => {
  it("attributes every share to one block and the new estimator; no fabricated interval is shown", () => {
    const html = render(result), tags = openingTags(html);
    expect(tags.filter(tag => tag.includes('data-claim-block="true"'))).toHaveLength(1);
    expect(html).toContain('data-subject-id="synthetic-regional-subject"');
    const figures = tags.filter(tag => tag.includes('data-figure-kind="ancestry-share"'));
    expect(figures).toHaveLength(10);
    for (const figure of figures) expect(figure).toContain('data-provenance="computed:src/lib/genome/regional-admixture.ts"');
    expect(html).toContain("no tested range yet"); expect(html).not.toContain("nine times in ten");
    expect(html).toContain("Keep small estimates hidden");
    expect(html).toContain("Hidden small estimates:");
    expect(html).not.toContain("well supported");
    expect(html).toContain('data-fit-converged="true"');
  });
  it("has one combined default row and path, with a native closed disclosure holding all three shares and the exact caveat", () => {
    const html = render(result), tags = openingTags(html);
    const rows = tags.filter(tag => tag.includes('data-slot="region-row"'));
    expect(rows).toHaveLength(5);
    expect(rows.some(row => row.includes('data-region="EUR-MID-CSA"') && !row.includes("hidden"))).toBe(true);
    const disclosure = /<details data-slot="regional-split">([\s\S]*?)<\/details>/.exec(html)![1];
    expect(disclosure).toContain(REGIONAL_CAVEAT);
    expect([...disclosure.matchAll(/data-split-region="([A-Z]+)"/g)].map(match => match[1])).toEqual(["EUR", "MID", "CSA"]);
    expect(html.split('<details data-slot="regional-split">')[0]).not.toContain('data-split-region=');
    expect(tags.filter(tag => tag.startsWith("<path") && tag.includes('data-region="EUR-MID-CSA"'))).toHaveLength(1);
    expect(html).toContain("North Africa"); expect(html).toContain("display rule");
  });
  it("switches map and table visibility together without changing row share values", () => {
    const on = render(result), off = render(result, false);
    expect(on).toContain('aria-checked="true"'); expect(off).toContain('aria-checked="false"');
    const paths = (html: string) => openingTags(html).filter(tag => tag.startsWith("<path") && tag.includes('role="button"'));
    expect(paths(on)).toHaveLength(3); expect(paths(off)).toHaveLength(5);
    const rows = (html: string) => [...html.matchAll(/<tr data-slot="region-row"[^>]*>([\s\S]*?)<\/tr>/g)].map(match => match[1]);
    expect(rows(on)).toEqual(rows(off));
  });
  it("keeps muted continents in the base when their estimated rows are filtered out", () => {
    const html = render(result), shapes = regionalMapShapes();
    const base = /<path d="([^"]+)" fill="var\(--line\)"/.exec(html)![1];
    for (const shape of shapes.regions) expect(base).toContain(shape.d);
    expect(html).not.toContain('data-region="AMR" data-lower-bound=');
    expect(html).not.toContain('data-region="OCE" data-lower-bound=');
  });
  it.each([1, 167])("keeps %i-marker raw derived rows inside a closed disclosure and shows a grey map without chips", markersUsed => {
    const html = render({ ...result, markersUsed });
    expect(html).toContain('data-mode="grey"'); expect(html).not.toContain('data-slot="ancestry-chip"');
    expect(html).not.toContain('data-slot="well-supported-toggle"');
    const [before, raw] = html.split('<details data-slot="raw-numbers">');
    expect(before).not.toContain('data-figure-kind="ancestry-share"');
    expect(raw).toContain("Show the unreliable raw numbers anyway");
    expect(raw).toContain("These raw estimates are unreliable."); expect(raw).toContain(REGIONAL_CAVEAT);
    expect((raw.match(/<ul/g) ?? [])).toHaveLength(1);
    expect(raw).toContain('data-region="EUR-MID-CSA"');
  });
  it("shows no fitted numbers at zero markers or without a saved result", () => {
    for (const value of [null, { ...result, proportions: null, markersUsed: 0, reporting: regionalReporting(null), note: REGIONAL_EMPTY_NOTE }]) {
      const html = render(value);
      expect(html).not.toContain('data-figure-kind="ancestry-share"'); expect(html).not.toContain('data-slot="raw-numbers"');
    }
  });
  it("makes a bounded fit failure visible rather than treating it as settled", () => {
    const html = render({ ...result, fit: { converged: false, iterations: 50_000 } });
    expect(html).toContain('data-fit-converged="false"'); expect(html).toContain('data-slot="fit-limit"');
    expect(html).toContain("calculation limit"); expect(html).toContain(result.note);
  });
});
