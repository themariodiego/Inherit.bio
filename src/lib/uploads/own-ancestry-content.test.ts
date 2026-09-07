import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { MIN_MARKERS, PANEL } from "../ancestry/panel";
import { AIMS, estimateAdmixture } from "../genome/admixture";
import { parseVcf } from "../genome/parsers/vcf";
import { computeOwnAncestryContent, CURRENT_OWN_ANCESTRY_PANEL, type OwnAncestryCall, type OwnAncestrySource } from "./own-ancestry-content";

const fileId = "77900000-0000-4000-8000-000000000040";
const source: OwnAncestrySource = { fileId, subjectId: "77900000-0000-4000-8000-000000000041",
  normalizedBuild: "GRCh38", callEncoding: "vcf-literal", sourceRevision: 1, sourceSha256: "a".repeat(64), normalizedAt: "2026-09-07T12:00:00.000Z" };
const panel = CURRENT_OWN_ANCESTRY_PANEL;
const compute = (calls: readonly OwnAncestryCall[]) => computeOwnAncestryContent({ source, panel, calls });
function call(index = 0, genotype = `${AIMS[index].ref}/${AIMS[index].alt}`): OwnAncestryCall {
  const m = AIMS[index];
  return { file_id: fileId, chrom: m.chrom, pos: m.pos38, ref: m.ref, alt: m.alt, genotype, usable: true };
}
async function fixture(name: string) {
  const bytes = await readFile(`e2e/fixtures/${name}`);
  async function* lines() { yield* bytes.toString("utf8").split(/\r?\n/); }
  const parsed = await parseVcf(lines());
  expect(parsed.build).toBe("GRCh38");
  const calls: OwnAncestryCall[] = (parsed.observedCalls ?? []).map(row => ({ file_id: fileId, chrom: row.chrom,
    pos: row.pos, ref: row.ref, alt: row.alt, genotype: row.genotype, usable: row.usable }));
  return { calls, parsed, source: { ...source, sourceSha256: createHash("sha256").update(bytes).digest("hex") } };
}

describe("canonical own ancestry content prerequisite", () => {
  it("computes the existing shown fixture from actual literal observations, including reference calls", async () => {
    const input = await fixture("aims-mixed-grch38.vcf");
    expect(input.calls).toHaveLength(168);
    expect(input.parsed.records.length).toBeLessThan(input.calls.length);
    const result = computeOwnAncestryContent({ source: input.source, panel, calls: input.calls });
    expect(result.source).toEqual(input.source);
    expect(result.admixture).toMatchObject({ kind: "admixture", result_state: "available", coverage: 1,
      model_id: PANEL.id, model_version: PANEL.version, range: { unavailable: true }, basis: "modelled", resolution: "five-broad-regions" });
    expect(result.panelPositions).toEqual({ called: 168, missing: 0, noCall: 0, filtered: 0, conflicting: 0, unsupported: 0 });
    const lookup = new Map(input.calls.map(row => [`${row.chrom}:${row.pos}`, row.genotype]));
    expect(result.admixture.result).toEqual(estimateAdmixture((chrom, pos) => lookup.get(`${chrom}:${pos}`) ?? null));
    expect(result.admixture.result.proportions).toMatchInlineSnapshot(`
      {
        "AFR": 0.337,
        "AMR": 0.01,
        "EAS": 0.12,
        "EUR": 0.533,
        "SAS": 0,
      }
    `);
    expect(Object.values(result.admixture.result.proportions).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 10);
    expect(computeOwnAncestryContent({ source: input.source, panel, calls: [...input.calls].reverse() })).toEqual(result);
  });

  it("keeps the existing grey fixture below threshold while retaining its one observed reference marker", async () => {
    const input = await fixture("tiny-grch38.vcf");
    expect(input.calls.length).toBeGreaterThan(0);
    const result = compute(input.calls);
    // rs671 at 12:111803962 is an explicit 0/0. The old process's variant-only
    // lookup omitted it; canonical observed calls correctly count it as 1/168.
    expect(input.calls.find(row => row.chrom === 12 && row.pos === 111803962)?.genotype).toBe("G/G");
    expect(result.admixture).toMatchObject({ result_state: "partial", coverage: 1 / 168, result: { markersUsed: 1 } });
    expect(result.panelPositions).toEqual({ called: 1, missing: 167, noCall: 0, filtered: 0, conflicting: 0, unsupported: 0 });
    expect(result.lineages).toEqual([
      { kind: "mtdna", state: "unavailable", reason: "no_supplied_positions", observedPositions: 0 },
      { kind: "ydna", state: "unavailable", reason: "no_supplied_positions", observedPositions: 0 },
    ]);
  });

  it("pins the exact current panel, threshold and a deterministic marker-content fingerprint", () => {
    const result = compute([]);
    expect(result.panel).toMatchObject({ id: "aims-kidd-seldin-168", version: "2026-08-28",
      provenance: "data/ref/AIMS_PROVENANCE.md", markerCount: 168, minimumMarkers: 42 });
    expect(result.panel.markerSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(compute([]).panel).toEqual(result.panel);
    expect(result.source).toEqual(source);
    expect(result.admixture).toMatchObject({ result_state: "not_covered", coverage: 0, result: { markersUsed: 0 } });
    expect(result.panelPositions.missing).toBe(168);
  });

  it.each([MIN_MARKERS - 1, MIN_MARKERS])("retains the current reliability boundary with %i usable markers", n => {
    const result = compute(AIMS.slice(0, n).map((_, i) => call(i)));
    expect(result.admixture.result_state).toBe(n < MIN_MARKERS ? "partial" : "available");
    expect(result.admixture.coverage).toBe(n / AIMS.length);
    expect(result.admixture.result.markersUsed).toBe(n);
  });

  it("does not count duplicate agreeing records twice or depend on allele order", () => {
    const first = call();
    const reversed = { ...first, genotype: first.genotype.split("/").reverse().join("|") };
    expect(compute([first, reversed])).toEqual(compute([first]));
  });

  it("excludes a conflict even when a later record would otherwise win", () => {
    const rows = [call(), call(0, `${AIMS[0].ref}/${AIMS[0].ref}`)];
    const result = compute(rows);
    expect(result.panelPositions).toMatchObject({ called: 0, conflicting: 1, missing: 167 });
    expect(result.admixture.result.markersUsed).toBe(0);
    expect(compute([...rows].reverse())).toEqual(result);
  });

  it("keeps an explicit no-call distinct from both missing and filtered positions", () => {
    const result = compute([{ ...call(), genotype: "--", usable: false }, { ...call(1), usable: false }]);
    expect(result.panelPositions).toEqual({ called: 0, missing: 166, noCall: 1, filtered: 1, conflicting: 0, unsupported: 0 });
    expect(result.admixture.coverage).toBe(0);
  });

  it("never lets a good duplicate erase no-call or filtered evidence", () => {
    expect(compute([call(), { ...call(), genotype: "--", usable: false }]).panelPositions.noCall).toBe(1);
    expect(compute([call(), { ...call(), usable: false }]).panelPositions.filtered).toBe(1);
  });

  it.each(["A", "0/0", "<NON_REF>", "A/A/A"])("does not reinterpret unsupported genotype %s", genotype => {
    const result = compute([{ ...call(), genotype }]);
    expect(result.panelPositions.unsupported).toBe(1);
    expect(result.admixture.result.markersUsed).toBe(0);
  });

  it("does not accept symbolic alleles or a genotype that disagrees with its literal REF/ALT", () => {
    expect(compute([{ ...call(), alt: "<NON_REF>" }]).panelPositions.unsupported).toBe(1);
    expect(compute([{ ...call(), genotype: "A/A" }]).panelPositions.unsupported).toBe(1); // first marker T/C
    const row = { ...call(), ref: null, alt: null, genotype: "A/C" };
    expect(computeOwnAncestryContent({ source: { ...source, callEncoding: "array-genotype" }, panel, calls: [row] })
      .panelPositions.unsupported).toBe(1); // neither direct nor complemented T/C pair
  });

  it("rejects a forward-reference third allele instead of complementing it into a panel signal", () => {
    expect(AIMS[0]).toMatchObject({ rsid: "rs2986742", chrom: 1, pos38: 6490316, ref: "T", alt: "C" });
    const result = compute([{ ...call(), ref: "T", alt: "G", genotype: "G/G" }]);
    expect(result.panelPositions).toMatchObject({ called: 0, unsupported: 1, missing: 167 });
    expect(result.admixture).toMatchObject({ result_state: "not_covered", coverage: 0, result: { markersUsed: 0 } });
  });

  it.each(["T/T", "T/C", "C/C"])("retains literal T/C-panel positive control %s", genotype => {
    const result = compute([call(0, genotype)]);
    expect(result.panelPositions).toMatchObject({ called: 1, unsupported: 0 });
    expect(result.admixture.result.markersUsed).toBe(1);
    expect(result.admixture.result).toEqual(estimateAdmixture((chrom, pos) => chrom === 1 && pos === 6490316 ? genotype : null));
  });

  it("refuses unknown or absent source encodings rather than guessing orientation", () => {
    for (const callEncoding of [undefined, "unknown"]) {
      const invalidSource = { ...source, callEncoding } as OwnAncestrySource;
      expect(() => computeOwnAncestryContent({ source: invalidSource, panel, calls: [call()] })).toThrow("ancestry_input_invalid");
    }
    expect(() => compute([{ ...call(), ref: null }])).toThrow("ancestry_call_encoding_mismatch");
    expect(() => compute([{ ...call(), alt: null }])).toThrow("ancestry_call_encoding_mismatch");
    expect(compute([{ ...call(), ref: "TT" }]).panelPositions.unsupported).toBe(1);
  });

  it("retains the old complement behavior only for explicitly identified array calls", () => {
    const array = computeOwnAncestryContent({ source: { ...source, callEncoding: "array-genotype" }, panel,
      calls: [{ ...call(), ref: null, alt: null, genotype: "G/G" }] });
    expect(array.admixture.result).toEqual(compute([call(0, "C/C")]).admixture.result);
    expect(array.panelPositions.called).toBe(1);
    expect(() => compute([{ ...call(), ref: null, alt: null, genotype: "G/G" }])).toThrow("ancestry_call_encoding_mismatch");
    expect(() => computeOwnAncestryContent({ source: { ...source, callEncoding: "array-genotype" }, panel,
      calls: [call()] })).toThrow("ancestry_call_encoding_mismatch");
  });

  it.each([24, 25])("does not take the first allele or invent a lineage for chromosome %i", chrom => {
    for (const genotype of ["A", "A/G", "A/A", "--"]) {
      const result = compute([{ ...call(), chrom, genotype }]);
      expect(result.lineages.find(row => row.kind === (chrom === 24 ? "ydna" : "mtdna"))).toEqual({
        kind: chrom === 24 ? "ydna" : "mtdna", state: "unavailable", reason: "lineage_interpretation_not_supported", observedPositions: 1,
      });
      expect(JSON.stringify(result.lineages)).not.toContain("haplogroup");
    }
  });

  it("refuses another file even if the foreign row is not a panel marker", () => {
    expect(() => compute([{ ...call(), file_id: "77900000-0000-4000-8000-000000000099", pos: 1 }])).toThrow("ancestry_source_mismatch");
  });

  it("rejects malformed source identity without echoing source data", () => {
    expect(() => computeOwnAncestryContent({ source: { ...source, sourceRevision: 0 }, panel, calls: [] })).toThrow("ancestry_input_invalid");
    expect(() => computeOwnAncestryContent({ source: { ...source, sourceSha256: "invalid" }, panel, calls: [] })).toThrow("ancestry_input_invalid");
  });

  it("refuses changed panel metadata, threshold, order or allele frequencies", () => {
    const changedMarkers = panel.markers.map((marker, i) => i ? marker : { ...marker, freqs: { ...marker.freqs, AFR: 0.99 } });
    for (const changed of [{ ...panel, id: "different" }, { ...panel, version: "later" },
      { ...panel, minimumMarkers: 1 }, { ...panel, markers: changedMarkers }, { ...panel, markers: [...panel.markers].reverse() }]) {
      expect(() => computeOwnAncestryContent({ source, panel: changed, calls: [] })).toThrow("ancestry_panel_mismatch");
    }
  });
});
