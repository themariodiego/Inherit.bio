import { describe, expect, it } from "vitest";
import {
  DATA_ATTRIBUTES,
  EXACT_MARKER,
  FIGURE_BASES,
  FIGURE_CLASSES,
  FIGURE_KINDS,
  MODELLED_MARKER,
  NATURAL_FREQUENCY_DENOMINATORS,
  NATURAL_FREQUENCY_FLOOR,
  REFERENCE_GROUP_SHORT,
  RETAINED_TERMS,
  provenanceAttribute,
  subjectAttributes,
} from "./contract";

describe("figure contract vocabulary", () => {
  it("pins the enumerations and exact strings", () => {
    expect(FIGURE_KINDS).toEqual([
      "absolute",
      "relative",
      "difference-pp",
      "natural-frequency",
      "percentile",
      "coverage",
      "interval",
      "ancestry-share",
      "genotype",
      "carrier-status",
    ]);
    expect(FIGURE_CLASSES).toEqual(["variant-call", "estimate", "ancestry", "quality"]);
    expect(FIGURE_BASES).toEqual(["observed", "modelled", "exact"]);
    expect(NATURAL_FREQUENCY_DENOMINATORS).toEqual([100, 1000, 10000, 100000, 1000000]);
    expect(MODELLED_MARKER).toBe("This is a model, not an observed outcome.");
    expect(EXACT_MARKER).toBe("This is exact arithmetic, not an estimate.");
    expect(NATURAL_FREQUENCY_FLOOR).toBe(
      "Fewer than 1 in a million, both for you and for the comparison group.",
    );
    expect(REFERENCE_GROUP_SHORT).toBe("people like you");
    expect(RETAINED_TERMS).toEqual(["baseline", "percentile", "haplogroup"]);
    expect(Object.values(DATA_ATTRIBUTES)).toEqual([
      "data-claim-block",
      "data-figure-kind",
      "data-figure-class",
      "data-figure-basis",
      "data-provenance",
      "data-subject-id",
      "data-subject-pair",
      "data-modelled-marker",
      "data-exact-marker",
    ]);
  });

  it("serialises provenance as citation:<id>, seed:<table>/<id>, computed:<module>", () => {
    expect(provenanceAttribute({ kind: "citation", id: "pmid:123" })).toBe("citation:pmid:123");
    expect(provenanceAttribute({ kind: "seed", table: "prs_scores", id: "PGS000011" })).toBe(
      "seed:prs_scores/PGS000011",
    );
    expect(provenanceAttribute({ kind: "computed", module: "genome/prs" })).toBe("computed:genome/prs");
  });

  it("serialises subject attribution to one of the two attributes", () => {
    expect(subjectAttributes({ subjectId: "s1" })).toEqual({ "data-subject-id": "s1" });
    expect(subjectAttributes({ subjectPair: ["a", "b"] })).toEqual({ "data-subject-pair": "a:b" });
  });
});
