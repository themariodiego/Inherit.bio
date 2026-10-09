import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { chromium, type Browser } from "@playwright/test";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { assertRegisteredQcFigures, collectQcPresentations, EMBRYO_QC_CROSS_SURFACE, type QcFigurePresentation } from "../e2e/embryo-qc-cross-surface";
import { collectFigures } from "../e2e/figure-collector";
import { syntheticQc } from "@/lib/embryos/synthetic";
import { vcfQcFigureBasis } from "@/lib/embryos/qc-basis";
import { LAYERS } from "@/lib/genome/taxonomy";
import type { ComparisonEmbryo } from "@/lib/embryos/policy";

vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: unknown }) => h("a", { href, ...rest }, children as never) }));
const { QcTable } = await import("@/components/embryo/compare/qc-table");
const { QcBlock } = await import("@/components/embryo/detail/qc-block");
const { CompareTable } = await import("@/components/embryo/compare/compare-table");
const subjects = ["07000000-0000-4000-8000-000000000001", "07000000-0000-4000-8000-000000000002"];
const sources = subjects.map((subjectId, index) => ({ subjectId, qc: syntheticQc({ sites_expected: 1000,
  sites_called: 990, call_rate: 0.99, autosomal_het_rate: index === 0 ? 0.4 : 0.2, mean_depth: null,
  parent_a_concordance: null, parent_b_concordance: null, allelic_dropout_estimate: null, contamination_estimate: null,
  figure_basis: vcfQcFigureBasis({ autosomal_het_rate: index === 0 ? 0.4 : 0.2, mean_depth: null }) }) }));
const embryos: ComparisonEmbryo[] = sources.map((row, index) => ({ id: `08000000-0000-4000-8000-00000000000${index+1}`,
  sample_ordinal: index, display_label: `Embryo ${index+1}`, status: "qc_pass", qc: row.qc }));
const subjectIds = new Map(embryos.map((row, index) => [row.id, sources[index].subjectId]));
let browser: Browser;
beforeAll(async () => { browser = await chromium.launch({ headless: true }); });
afterAll(async () => { await browser?.close(); });
async function capture(html: string) {
  const page = await browser.newPage();
  try {
    await page.setContent(html);
    if (await page.locator("details").count()) await page.locator("details summary").click();
    const figures = await page.evaluate(collectFigures), adjacent = await page.evaluate(collectQcPresentations);
    expect(adjacent).toHaveLength(figures.length);
    return figures.map((figure, index) => ({ ...figure, ...adjacent[index] }));
  } finally { await page.close(); }
}

describe("closed repeated QC figures on actual renderer markup (synthetic unit boundary)", () => {
  it("collects every footer/table/detail copy with the existing classifier and exact observed source receipt", async () => {
    const compare = await capture(renderToStaticMarkup(h("main", {},
      ...LAYERS.map(layer => h(CompareTable, { layer, embryos, rows: [], subjectIds })),
      h(QcTable, { embryos, subjectIds }))));
    expect(() => assertRegisteredQcFigures("compare", compare, sources)).not.toThrow();
    expect(compare).toHaveLength(8);
    for (let index=0; index<2; index++) {
      const detail = await capture(renderToStaticMarkup(h("main", {}, h(QcBlock, { qc: sources[index].qc,
        embryoId: embryos[index].id, subjectId: sources[index].subjectId }),
      h("details", {}, h("summary", {}, "Full QC"), h(QcTable, { embryos: [embryos[index]], subjectIds })))));
      expect(detail).toHaveLength(4);
      expect(() => assertRegisteredQcFigures("detail", detail, [sources[index]])).not.toThrow();
      const identity = (rows: QcFigurePresentation[]) => rows.map(({ field, kind, figureClass, basis, provenance, value, unit, caption }) =>
        ({ field, kind, figureClass, basis, provenance, value, unit, caption })).sort((a,b)=>a.field!.localeCompare(b.field!));
      expect(identity(detail.filter(row=>row.location==="block"))).toEqual(identity(compare.filter(row=>row.subjectId===sources[index].subjectId&&row.location==="table")));
      for (const [field, value] of [["value", "changed"], ["unit", "changed"], ["caption", "changed"], ["basis", "modelled"],
        ["provenance", "computed:other"], ["subjectId", subjects[1-index]], ["field", "unknown"], ["modelledMarkers", ["invented caption"]]] as const) {
        const changed = structuredClone(detail);Object.assign(changed[0], { [field]: value });
        expect(() => assertRegisteredQcFigures("detail", changed, [sources[index]]), field).toThrow();
      }
      expect(() => assertRegisteredQcFigures("detail", detail.slice(1), [sources[index]])).toThrow("census");
      expect(() => assertRegisteredQcFigures("detail", [...detail, detail[0]], [sources[index]])).toThrow("census");
      expect(() => assertRegisteredQcFigures("detail", detail, [{ ...sources[index], qc: { ...sources[index].qc, figure_basis: null } }])).toThrow();
      expect(() => assertRegisteredQcFigures("detail", detail, [{ ...sources[index], qc: { ...sources[index].qc, sites_called: 980, call_rate: 0.98 } }])).toThrow();
    }
  });
  it("pins registered identities and runs the genuine capture after original depth but before grant revocation", () => {
    expect(EMBRYO_QC_CROSS_SURFACE.repeated.map(row=>row.field).sort()).toEqual(["autosomal_het_rate", "coverage"]);
    expect(readFileSync("src/app/(app)/embryos/compare/page.tsx", "utf8")).toContain('(["variant_call", "estimate"] as const).map');
    expect(LAYERS).toEqual(["variant_call", "estimate"]);
    const source=readFileSync("e2e/embryo-ingest-journey.spec.ts","utf8");
    expect(source.indexOf("await provePublishedQcCrossSurface(")).toBeGreaterThan(source.indexOf("await auditPublishedEmbryoSurfaces("));
    expect(source.indexOf("await provePublishedQcCrossSurface(")).toBeLessThan(source.indexOf("await proveNativeDispositionAndProfile("));
    expect(source).toContain("test.setTimeout(300_000)");
    const helper=readFileSync("e2e/helpers/embryo-qc-cross-surface.ts","utf8");
    expect(helper).toContain("expect(await readQc()).toEqual(sources)");
    expect(helper).toContain("expect(await current()).toEqual(publication)");
    expect(helper).not.toMatch(/\.(?:insert|update|delete|upsert)\(/);
  });
});
