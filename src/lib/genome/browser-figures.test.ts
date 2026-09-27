import { describe, expect, it, vi } from "vitest";
import { GENOTYPE_LABEL } from "@/copy/reports/strings";
import { provenanceAttribute } from "@/lib/figures/contract";
import { browserCoverage, genotypeFigures, loadedTrackFigures } from "./browser-figures";

// Fail on any server-only import in this client entry's runtime dependency graph.
vi.mock("server-only", () => {
  throw new Error("Browser figure helpers must not import server-only modules");
});

describe("client-safe genome browser figures", () => {
  it("preserves row mapping and coverage without server search data", () => {
    const rows = [
      { genotype: "A/C", conflict: false },
      { genotype: null, conflict: false },
      { genotype: "--", conflict: false },
      { genotype: "T/T", conflict: true },
    ];
    const { specs, figureIndex } = genotypeFigures(rows);
    expect(figureIndex).toEqual([0, null, 1, 2]);
    expect(specs.map((spec) => spec.genotype)).toEqual(["A/C", "--", "T/T"]);
    expect(specs.every((spec) => spec.basis === "observed" && spec.class === "variant-call")).toBe(true);
    expect(specs.map((spec) => provenanceAttribute(spec.provenance))).toEqual([
      "computed:genome/browser",
      "computed:genome/browser",
      "computed:genome/browser",
    ]);
    expect(browserCoverage(rows)).toEqual({ read: 1, needed: 4, module: "genome/browser" });
  });

  it("preserves every recorded genotype and no-call in loaded row order", () => {
    const specs = loadedTrackFigures([{ genotype: "A|C" }, { genotype: "--" }, { genotype: "T/T" }]);
    expect(specs).toEqual(["A|C", "--", "T/T"].map((genotype) => ({
      kind: "genotype",
      class: "variant-call",
      basis: "observed",
      provenance: { kind: "computed", module: "genome/browser" },
      genotype,
      label: GENOTYPE_LABEL,
    })));
  });

  it("emits no figures when the current view has no loaded calls", () => {
    expect(loadedTrackFigures([])).toEqual([]);
  });
});
