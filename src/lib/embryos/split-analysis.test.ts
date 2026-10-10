import { CompareCell } from "@/components/embryo/compare/compare-cell";
import { widenForDropout } from "./qc-policy";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { embryoVcfChunks, validateEmbryoVcfChunk } from "./vcf-transport";
import { analyseEmbryoFragment, embryoOrdinalOutcome } from "./split-analysis";
import { projectQc } from "./projection";
import { syntheticQcRow, syntheticAbsoluteFinding } from "./synthetic";
import { QcBlock } from "@/components/embryo/detail/qc-block";
import { QcValue } from "@/components/embryo/compare/qc-table";
import { QC_BASIS_NOT_RECORDED, DROPOUT_NOT_MEASURED, DROPOUT_NOT_MEASURED_NO_RANGE } from "@/copy/embryos/qc";
import { coverageSpec, depthSpec, rateSpec, dropoutSpec } from "@/components/embryo/qc-figures";

const binding = { challenge: "s".repeat(43), revision: 3, build: "GRCh38" as const, sampleCount: 2,
  handles: ["h".repeat(43), "k".repeat(43)] };

it.each(["e2e/fixtures/embryo-pair-grch38.vcf", "e2e/fixtures/embryo-pair-qc-b-grch38.vcf"])("round trips the actual sanitized fragment measurement through the saved row, reader and rendered figures (%s)", async (path) => {
  const file = readFileSync(path, "utf8");
  const chunks = await Array.fromAsync(embryoVcfChunks(new Blob([file]), binding));
  expect(chunks).toHaveLength(1);
  const fragments = validateEmbryoVcfChunk(chunks[0], { ...binding, resolveHandle: (handle) => {
    const i = binding.handles.indexOf(handle); return i < 0 ? null : i;
  } });
  for (const fragment of fragments) {
    const measure = await analyseEmbryoFragment(new TextEncoder().encode(fragment.vcf), fragment.ordinal, "GRCh38", () => {});
    const actual = embryoOrdinalOutcome(measure).qc;
    const saved = JSON.parse(JSON.stringify({ ...syntheticQcRow("synthetic-qc"), ...actual }));
    const read = projectQc(saved);
    expect(read.figure_basis).toEqual(actual.figure_basis);
    expect(read.call_rate).toBe(measure.called / measure.sites);
    if (path === "e2e/fixtures/embryo-pair-qc-b-grch38.vcf" && fragment.ordinal === 1) {
      expect(measure.sites).toBe(1200); expect(measure.called).toBe(1184);
      expect(read.call_rate).toBe(0.9866666666666667);
    }
    expect(coverageSpec(read)?.basis).toBe(actual.figure_basis.coverage.basis);
    expect(rateSpec(read, "call_rate")?.basis).toBe(actual.figure_basis.call_rate.basis);
    expect(depthSpec(read)?.basis ?? null).toBe(actual.figure_basis.mean_depth?.basis ?? null);
    expect(dropoutSpec(read, "synthetic-qc")).toBeNull();
    const html = renderToStaticMarkup(createElement(QcBlock, { qc: read, embryoId: "synthetic-qc", subjectId: "synthetic-subject" }));
    expect(html).toContain('data-figure-basis="observed"');
    expect(html).not.toContain('data-figure-basis="modelled"');
    expect(html).not.toContain('data-figure-basis="exact"');
  }
});

describe("saved QC refuses changed provenance", () => {
  it.each(["modelled", "exact", "revision", "extra", "missing-field", "missing-measure", "invented-dropout", "changed-ratio"])("refuses %s", (fault) => {
    const row = JSON.parse(JSON.stringify(syntheticQcRow("synthetic-qc")));
    if (fault === "modelled" || fault === "exact") row.figure_basis.coverage.basis = fault;
    if (fault === "revision") row.figure_basis.version = 2;
    if (fault === "extra") row.figure_basis.extra = true;
    if (fault === "missing-field") delete row.figure_basis.call_rate;
    if (fault === "changed-ratio") row.call_rate = 0.1;
    if (fault === "missing-measure") row.autosomal_het_rate = null;
    if (fault === "invented-dropout") {
      row.allelic_dropout_estimate = 0.02; row.allelic_dropout_interval_low = 0.01; row.allelic_dropout_interval_high = 0.03;
    }
    expect(() => projectQc(row)).toThrow();
  });
});

it.each([0, 0.01])("keeps historical numbers and source context unchanged, while withholding every unsupported figure (contamination %s)", (contamination) => {
  const row = syntheticQcRow("synthetic-qc", { figure_basis: null, source_laboratory: null,
    parent_a_concordance: 0.8, contamination_estimate: contamination, allelic_dropout_estimate: 0.02,
    allelic_dropout_interval_low: 0.01, allelic_dropout_interval_high: 0.03 });
  const before = JSON.stringify(row);
  const read = projectQc(JSON.parse(before));
  expect(read.figure_basis).toBeNull();
  expect(read.parent_a_concordance).toBe(0.8);
  expect(read.contamination_estimate).toBe(contamination);
  expect(read.allelic_dropout_estimate).toBe(0.02);
  const html = renderToStaticMarkup(createElement(QcBlock, { qc: read, embryoId: row.embryo_id, subjectId: "synthetic-subject" }));
  expect(html).toContain(QC_BASIS_NOT_RECORDED);
  expect(html).not.toContain('data-slot="figure"');
  expect(html).toContain("Quality check passed");
  for (const field of ["parent_a_concordance", "contamination_estimate", "allelic_dropout_estimate"] as const) {
    const cell = renderToStaticMarkup(createElement(QcValue, { row: field, qc: read, embryoId: row.embryo_id, subjectId: "synthetic-subject" }));
    expect(cell).toContain(QC_BASIS_NOT_RECORDED);
    expect(cell).not.toContain('data-slot="figure"');
  }
  expect(JSON.stringify(row)).toBe(before);
});


it("states widening only when risk ranges exist, retaining the exact mandated fallback", () => {
  const qc = projectQc(syntheticQcRow("synthetic-qc"));
  const absent = renderToStaticMarkup(createElement(QcBlock, { qc, embryoId: "synthetic-qc", subjectId: "synthetic-subject" }));
  expect(absent).toContain(DROPOUT_NOT_MEASURED_NO_RANGE);
  expect(absent).not.toContain(DROPOUT_NOT_MEASURED);
  const widened = widenForDropout({ point: 0.1, low: 0.08, high: 0.12 }, null);
  expect(widened.widened).toBe(true);
  const finding = syntheticAbsoluteFinding("Embryo 1", "synthetic-condition", widened.point);
  if (finding.finding?.kind !== "absolute_risk") throw new Error("synthetic risk fixture missing");
  finding.finding.interval_low = widened.low; finding.finding.interval_high = widened.high;
  const present = renderToStaticMarkup(createElement("div", null,
    createElement(CompareCell, { finding, subjectId: "synthetic-subject" }),
    createElement(QcBlock, { qc, embryoId: "synthetic-qc", subjectId: "synthetic-subject", hasRiskRanges: true })));
  expect(present).toContain('data-figure-kind="interval"');
  expect(present).toContain(DROPOUT_NOT_MEASURED);
  expect(present).not.toContain(DROPOUT_NOT_MEASURED_NO_RANGE);
  const cell = (hasRiskRanges: boolean) => renderToStaticMarkup(createElement(QcValue, { row: "allelic_dropout_estimate", qc,
    embryoId: "synthetic-qc", subjectId: "synthetic-subject", hasRiskRanges }));
  expect(cell(false)).toContain(DROPOUT_NOT_MEASURED_NO_RANGE);
  expect(cell(false)).not.toContain(DROPOUT_NOT_MEASURED);
  expect(cell(true)).toContain(DROPOUT_NOT_MEASURED);
});
