import { describe, expect, it } from "vitest";
import { seedLayerAndKind } from "./seed-layer";

describe("seedLayerAndKind", () => {
  it("stores a variant_call template with a null kind, whatever the file says", () => {
    expect(seedLayerAndKind({ layer: "variant_call", pgs_id: null })).toEqual({ layer: "variant_call", estimate_kind: null });
    expect(seedLayerAndKind({ layer: "variant_call", estimate_kind: null, pgs_id: null })).toEqual({
      layer: "variant_call",
      estimate_kind: null,
    });
    expect(seedLayerAndKind({ layer: "variant_call", estimate_kind: "single_locus", pgs_id: null }).estimate_kind).toBeNull();
  });

  it("derives an estimate's kind from pgs_id when the file omits it", () => {
    expect(seedLayerAndKind({ pgs_id: null })).toEqual({ layer: "estimate", estimate_kind: "single_locus" });
    expect(seedLayerAndKind({ pgs_id: "PGS000018" })).toEqual({ layer: "estimate", estimate_kind: "polygenic_score" });
    expect(seedLayerAndKind({ layer: "estimate", estimate_kind: "polygenic_score", pgs_id: null }).estimate_kind).toBe(
      "polygenic_score",
    );
  });
});
