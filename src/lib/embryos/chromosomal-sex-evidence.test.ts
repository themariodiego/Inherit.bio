import { describe, expect, it } from "vitest";
import { chromosomalSexEvidence, type SexEvidenceMarker, type SexEvidenceObservation } from "./chromosomal-sex-evidence";

// Invented positions/frequencies and calls, for arithmetic only. This panel is
// not a clinical reference, an assay validation, or a production configuration.
const panel: SexEvidenceMarker[] = [
  { chrom: 23, pos: 30_000_001, ref: "A", alt: "G", altFrequency: 0.5 },
  { chrom: 23, pos: 30_000_002, ref: "C", alt: "T", altFrequency: 0.5 },
  { chrom: 24, pos: 10_000_001, ref: "A", alt: "G", altFrequency: null },
  { chrom: 24, pos: 10_000_002, ref: "C", alt: "T", altFrequency: null },
];
const rows = (calls: string[]): SexEvidenceObservation[] => panel.slice(0, calls.length)
  .map((marker, index) => ({ chrom: marker.chrom, pos: marker.pos, genotype: calls[index] }));
const measure = (calls: string[]) => chromosomalSexEvidence("GRCh38", panel, rows(calls));

describe("chromosomal-sex evidence without a sex inference", () => {
  it("uses observed and expected X heterozygosity and explicit Y no-calls", () => {
    expect(measure(["A/G", "C/C", ".", "./."])).toEqual({
      x: { assayed: 2, observed: 2, called: 2, heterozygous: 1, expectedHeterozygous: 1, inbreedingCoefficient: 0 },
      y: { assayed: 2, observed: 2, called: 0, heterozygous: 0, validCallRate: 0 },
    });
  });

  it("keeps haploid, diploid homozygous and reference calls as observations", () => {
    const evidence = measure(["A", "T/T", "A", "T/T"]);
    expect(evidence.x.inbreedingCoefficient).toBe(1);
    expect(evidence.y).toMatchObject({ called: 2, validCallRate: 1 });
    expect(evidence).not.toHaveProperty("sex");
    expect(evidence).not.toHaveProperty("karyotype");
  });

  it("does not equate omitted Y records with assayed no-calls", () => {
    expect(measure(["A/G", "C/C"]).y).toMatchObject({ observed: 0, called: 0, validCallRate: null });
    expect(measure(["A/G", "C/C", "."]).y.validCallRate).toBeNull();
    expect(measure([]).x.inbreedingCoefficient).toBeNull();
  });

  it("does not turn a partial call into a complete call or include its expected heterozygosity", () => {
    expect(measure(["A/.", "C/T", "./G", "--"])).toMatchObject({
      x: { called: 1, heterozygous: 1, expectedHeterozygous: 0.5, inbreedingCoefficient: -1 },
      y: { observed: 2, called: 0, validCallRate: 0 },
    });
  });

  it("records discordant Y heterozygosity without counting it as a valid Y call", () => {
    expect(measure(["A/G", "C/C", "A/G", "T"])).toMatchObject({ y: { called: 1, heterozygous: 1, validCallRate: 0.5 } });
  });

  it.each(["A/A/A", "XY", "1", "N", "<NON_REF>"])("refuses unsupported source calls (%s)", call => {
    expect(() => measure([call])).toThrow("sex-evidence:unsupported-call");
  });

  it("refuses an allele mismatch and duplicate source positions", () => {
    expect(() => measure(["A/T"])).toThrow("sex-evidence:allele-mismatch");
    for (const duplicate of ["A/G", "A/A"]) {
      expect(() => chromosomalSexEvidence("GRCh38", panel, [...rows(["A/G"]), ...rows([duplicate])]))
        .toThrow("sex-evidence:duplicate-source-locus");
    }
  });

  it("ignores off-panel source calls and keeps the panel denominator", () => {
    expect(chromosomalSexEvidence("GRCh38", panel, [
      ...rows(["A/G", "C/C", ".", "."]), { chrom: 24, pos: 40_000_000, genotype: "A" },
    ]).y).toMatchObject({ assayed: 2, observed: 2, called: 0, validCallRate: 0 });
  });

  it.each([0, 1, -0.1, NaN, Infinity, null])("rejects missing or unusable reference frequencies (%s)", altFrequency => {
    expect(() => chromosomalSexEvidence("GRCh38", [{ ...panel[0], altFrequency }, ...panel.slice(1)], []))
      .toThrow("sex-evidence:invalid-panel");
  });

  it.each([
    ["GRCh37", 23, 2_699_520], ["GRCh37", 23, 154_931_044],
    ["GRCh38", 23, 2_781_479], ["GRCh38", 23, 155_701_383],
    ["GRCh37", 24, 2_649_520], ["GRCh37", 24, 59_034_050],
    ["GRCh38", 24, 2_781_479], ["GRCh38", 24, 56_887_903],
  ] as const)("rejects the %s chromosome %i pseudoautosomal boundary %i", (build, chrom, pos) => {
    const markers = panel.map((marker, index) => index === (chrom === 23 ? 0 : 2) ? { ...marker, pos } : marker);
    expect(() => chromosomalSexEvidence(build, markers, []))
      .toThrow("sex-evidence:invalid-panel");
  });

  it("rejects duplicate, empty or one-chromosome reference panels", () => {
    expect(() => chromosomalSexEvidence("GRCh38", [...panel, panel[0]], [])).toThrow("duplicate-panel-locus");
    expect(() => chromosomalSexEvidence("GRCh38", [], [])).toThrow("invalid-panel");
    expect(() => chromosomalSexEvidence("GRCh38", panel.slice(0, 2), [])).toThrow("incomplete-panel");
  });

  it("does not serialize an infinite coefficient from an unusable reference frequency", () => {
    const markers = panel.map(marker => marker.chrom === 23 ? { ...marker, altFrequency: Number.MIN_VALUE } : marker);
    expect(() => chromosomalSexEvidence("GRCh38", markers, rows(["A/G", "C/T"])))
      .toThrow("sex-evidence:unusable-reference-frequency");
  });
});
