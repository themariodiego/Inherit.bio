import { describe, expect, it } from "vitest";
import { provenanceAttribute } from "@/lib/figures/contract";
import { browserCoverage, genotypeFigures, type Hit } from "./browser";

/**
 * The browser's two figure derivations over hits, without a page or a
 * database: the letters a row shows, and the coverage pair beneath the table.
 * Both name this module as where their number came from, so both pin that
 * string here.
 */
const hit = (overrides: Partial<Hit> = {}): Hit => ({
  rsid: 762551,
  chrom: 15,
  pos: 74749576,
  ref: "C",
  alt: "A",
  gene: "CYP1A2",
  genotype: "A/C",
  conflict: false,
  ...overrides,
});

describe("genome browser figures", () => {
  it("renders one observed genotype figure per covered row, in row order", () => {
    const { specs, figureIndex } = genotypeFigures([
      hit(),
      hit({ rsid: 1, genotype: null }),
      hit({ rsid: 2, genotype: "T/T" }),
    ]);
    expect(figureIndex).toEqual([0, null, 1]);
    expect(specs.map((spec) => [spec.kind, spec.class, spec.basis, spec.genotype])).toEqual([
      ["genotype", "variant-call", "observed", "A/C"],
      ["genotype", "variant-call", "observed", "T/T"],
    ]);
  });

  it("names this module on the genotype figures and on the coverage pair", () => {
    const hits = [hit()];
    expect(genotypeFigures(hits).specs.map((spec) => provenanceAttribute(spec.provenance))).toEqual([
      "computed:genome/browser",
    ]);
    expect(provenanceAttribute({ kind: "computed", module: browserCoverage(hits).module })).toBe(
      "computed:genome/browser",
    );
  });

  it("counts a position as read only when it yielded letters", () => {
    expect(browserCoverage([hit(), hit({ rsid: 1, genotype: "T/T" })])).toMatchObject({ read: 2, needed: 2 });
    // A no-call, a position no file covers and a position the files disagree
    // about were each not read, and none of the three is counted.
    expect(browserCoverage([hit({ genotype: "--" }), hit({ genotype: null }), hit({ conflict: true })])).toMatchObject({
      read: 0,
      needed: 3,
    });
    expect(browserCoverage([])).toMatchObject({ read: 0, needed: 0 });
  });
});
