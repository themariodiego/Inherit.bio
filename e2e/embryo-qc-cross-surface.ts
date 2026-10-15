import assert from "node:assert/strict";
import fs from "node:fs";
import { z } from "zod";
import type { CollectedFigure } from "./figure-collector";
import { coverageSpec, rateSpec } from "@/components/embryo/qc-figures";
import { figureText } from "@/lib/figures/figure-text";
import { assertEmbryoDto, type QcDto } from "@/lib/embryos/policy";
import { qcFigureBasisSchema } from "@/lib/embryos/qc-basis";
import { QC_FIELD_LABELS } from "@/copy/embryos/qc";
import { POSITIONS_READ_TH } from "@/copy/embryos/compare";

const location = z.enum(["table", "block", "footer"]);
const occurrence = z.object({ location, count: z.number().int().positive(), caption: z.enum(["call_rate", "autosomal_het_rate", "positions-read"]) }).strict();
const register = z.object({
  spec: z.literal("e2e/embryo-ingest-journey.spec.ts"),
  fixture: z.literal("e2e/fixtures/embryo-pair-grch38.vcf"),
  producer: z.literal("embryo-split-calls-v1"),
  figuresPerEmbryo: z.object({ compare: z.literal(4), detail: z.literal(4) }).strict(),
  repeated: z.array(z.object({ field: z.enum(["coverage", "autosomal_het_rate"]), key: z.string(),
    sourceOfTruth: z.literal("src/lib/embryos/split-analysis.ts"), compare: z.array(occurrence), detail: z.array(occurrence) }).strict()).length(2),
}).strict();
export const EMBRYO_QC_CROSS_SURFACE = register.parse(JSON.parse(fs.readFileSync("docs/figures-register.json", "utf8")).crossSurface.embryo);

export type QcFigurePresentation = CollectedFigure & {
  field: string | null; subjectId: string | null; location: z.infer<typeof location> | null;
  unit: string | null; caption: string | null; modelledMarkers: string[]; exactMarkers: string[];
};
/** Adjacent presentation only; the existing collector remains the figure classifier. */
export function collectQcPresentations() {
  const text = (node: Element | null) => node?.textContent?.replace(/\s+/g, " ").trim() ?? null;
  return [...document.querySelectorAll<HTMLElement>("[data-figure-kind]")].map(node => {
    const tableRow = node.closest<HTMLElement>("tr[data-qc-row]");
    const dd = node.closest<HTMLElement>("dd");
    const footer = node.closest<HTMLElement>('[data-slot="column-footer"]');
    const block = node.closest<HTMLElement>("[data-claim-block]");
    const rawField = tableRow?.getAttribute("data-qc-row")
      ?? (dd?.getAttribute("data-slot") === "qc-coverage" ? "coverage" : dd?.getAttribute("data-field"))
      ?? (node.closest('[data-slot="footer-coverage"]') ? "coverage" : null);
    return {
      field: rawField === "call_rate" ? "coverage" : rawField,
      subjectId: block?.getAttribute("data-subject-id") ?? null,
      location: tableRow ? "table" as const : dd?.closest('[data-slot="qc-block"]') ? "block" as const : footer ? "footer" as const : null,
      unit: text(node.querySelector('[data-slot="figure-unit"]')),
      caption: tableRow ? text(tableRow.querySelector('th[scope="row"]'))
        : dd ? text(dd.previousElementSibling)
          : footer ? text(footer.parentElement?.querySelector('th[scope="row"]') ?? null) : null,
      modelledMarkers: [...(block?.querySelectorAll("[data-modelled-marker]") ?? [])].map(item => text(item)!),
      exactMarkers: [...(block?.querySelectorAll("[data-exact-marker]") ?? [])].map(item => text(item)!),
    };
  });
}

/** Closed census and equality against the actual saved QC producer receipt.
 * The separate footer's shorter caption is explicitly registered; the main
 * table and visible detail must carry the same exact field caption. */
export function assertRegisteredQcFigures(surface: "compare" | "detail", figures: readonly QcFigurePresentation[],
  sources: readonly { subjectId: string; qc: QcDto }[]) {
  assert(sources.length === (surface === "compare" ? 2 : 1) && new Set(sources.map(row => row.subjectId)).size === sources.length,
    "Exact current QC subject inventory required");
  assert.equal(figures.length, sources.length * EMBRYO_QC_CROSS_SURFACE.figuresPerEmbryo[surface], "Entire surface figure census changed");
  assert.deepEqual(EMBRYO_QC_CROSS_SURFACE.repeated.map(row => row.field).sort(), ["autosomal_het_rate", "coverage"]);
  for (const source of sources) {
    const qc = assertEmbryoDto("qc", source.qc);
    qcFigureBasisSchema.parse(qc.figure_basis);
    assert(qc.qc_verdict === "pass" && qc.mean_depth === null && qc.autosomal_het_rate !== null && qc.autosomal_het_rate > 0,
      "The actual GT-only all-pass source receipt must match its registered figure shape");
    const own = figures.filter(figure => figure.subjectId === source.subjectId);
    assert.equal(own.length, EMBRYO_QC_CROSS_SURFACE.figuresPerEmbryo[surface], "Missing or crossed QC attribution");
    for (const row of EMBRYO_QC_CROSS_SURFACE.repeated) {
      assert(fs.existsSync(row.sourceOfTruth), "Registered QC source of truth is missing");
      const spec = row.field === "coverage" ? coverageSpec(qc) : rateSpec(qc, "autosomal_het_rate");
      assert(spec, "Saved QC basis receipt unavailable");
      const text = figureText(spec);
      const actual = own.filter(figure => figure.field === row.field);
      assert.equal(actual.length, row[surface].reduce((sum, item) => sum + item.count, 0), "Repeated QC field census changed");
      for (const occurrence of row[surface]) {
        const shown = actual.filter(figure => figure.location === occurrence.location);
        assert.equal(shown.length, occurrence.count, "Registered QC presentation census changed");
        for (const figure of shown) {
          assert.equal([figure.kind, figure.figureClass, figure.basis, figure.provenance].join("|"), row.key, "QC figure classification changed");
          assert.equal(figure.context, null, "Unexpected QC figure identity wrapper");
          assert.equal(figure.value, text.value, "QC figure differs from its saved source");
          assert.equal(figure.unit, text.unit, "QC unit differs from its saved source");
          assert.equal(figure.caption, occurrence.caption === "positions-read" ? POSITIONS_READ_TH : QC_FIELD_LABELS[occurrence.caption], "QC caption differs from its registered field");
          assert.deepEqual(figure.modelledMarkers, [], "Measured QC gained a modelled caption");
          assert.deepEqual(figure.exactMarkers, [], "Measured QC gained an exact caption");
        }
      }
    }
  }
}
