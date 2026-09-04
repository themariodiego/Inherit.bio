import type { EstimateKind, FindingLayer } from "../src/lib/genome/taxonomy";

/**
 * The layer and estimate kind a seed template is stored with (X5). A seed
 * file may omit both: the layer is then `estimate`, and the kind follows
 * from `pgs_id`. A `variant_call` template never carries an estimate kind
 * (ADR 0021): it is a reading of letters, not an estimate of anything, so
 * the kind is null whatever the file says or omits.
 */
export function seedLayerAndKind(template: {
  layer?: FindingLayer;
  estimate_kind?: EstimateKind | null;
  pgs_id: string | null;
}): { layer: FindingLayer; estimate_kind: EstimateKind | null } {
  const layer = template.layer ?? "estimate";
  if (layer === "variant_call") return { layer, estimate_kind: null };
  const estimate_kind =
    template.estimate_kind ?? (template.pgs_id ? "polygenic_score" : "single_locus");
  return { layer, estimate_kind };
}
