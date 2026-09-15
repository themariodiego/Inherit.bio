import { createHash } from "node:crypto";
import { z } from "zod";
import manifest from "../../../data/ref/aims-seven-region-manifest.json";
import regionRelease from "../../../data/ref/regions/regions-v3.json";
import { LINEAGE_KINDS } from "../ancestry/lineage-panel";
import { estimateRegionalAdmixture, REGIONAL_AIMS, REGIONAL_CAVEAT, REGIONAL_EMPTY_NOTE, REGIONAL_FIT_LIMIT,
  REGIONAL_MERGE_THRESHOLD, REGIONAL_RANGE_NOTE, REGIONAL_REPORTING_POLICY, REGIONAL_UNSETTLED_NOTE,
  regionalReporting, type RegionalMarker } from "../genome/regional-admixture";
import { computeLineage, lineageV2Schema, parseOwnAncestryInputs, resolveOwnAncestryPositions,
  sourceSchema, validAncestryLineages, type OwnAncestryCall, type OwnAncestrySource } from "./own-ancestry-content";

export const SEVEN_ANCESTRY_PANEL = {
  id: "aims-hgdp-tgp-168", version: "hgdp-1kg-v3.1.2-cap30-168-v1",
  provenance: "data/ref/AIMS_SEVEN_REGION_PROVENANCE.md", markers: REGIONAL_AIMS.length,
  // The initial release shows only the complete panel used in its evaluation.
  // This is a coverage policy, not a claim of calibrated reliability.
  minimumMarkers: regionRelease.panel.minimum_markers,
} as const;
const MARKER_JSON = JSON.stringify(REGIONAL_AIMS);
const MARKER_SHA256 = createHash("sha256").update(MARKER_JSON).digest("hex");
if (manifest.panelId !== SEVEN_ANCESTRY_PANEL.id || manifest.referenceVersion !== SEVEN_ANCESTRY_PANEL.version
  || manifest.markerSha256 !== MARKER_SHA256 || manifest.markerCount !== REGIONAL_AIMS.length
  || regionRelease.panel.id !== SEVEN_ANCESTRY_PANEL.id || regionRelease.panel.version !== SEVEN_ANCESTRY_PANEL.version
  || regionRelease.panel.markers !== REGIONAL_AIMS.length || regionRelease.panel.minimum_markers !== REGIONAL_AIMS.length) {
  throw new Error("ancestry_reference_manifest_mismatch");
}
export const SEVEN_OWN_ANCESTRY_PANEL = Object.freeze({ ...SEVEN_ANCESTRY_PANEL, markers: REGIONAL_AIMS });
const count = z.number().int().min(0).max(REGIONAL_AIMS.length);
const share = z.number().min(0).max(1);
const proportionsSchema = z.object({ AFR: share, AMR: share, CSA: share, EAS: share, EUR: share, MID: share, OCE: share }).strict();
export const regionalAdmixtureResultSchema = z.object({
  proportions: proportionsSchema.nullable(), markersUsed: count, note: z.string().min(1).max(4096),
  reporting: z.object({ policy: z.literal(REGIONAL_REPORTING_POLICY), threshold: z.literal(REGIONAL_MERGE_THRESHOLD),
    merged: z.boolean(), caveat: z.literal(REGIONAL_CAVEAT) }).strict(),
  fit: z.object({ iterations: z.number().int().min(0).max(REGIONAL_FIT_LIMIT), converged: z.boolean() }).strict(),
}).strict().superRefine((value, ctx) => {
  const empty = value.markersUsed === 0;
  const fits = empty ? !value.fit.converged && value.fit.iterations === 0
    : value.fit.iterations > 0 && (value.fit.converged || value.fit.iterations === REGIONAL_FIT_LIMIT);
  const expectedNote = empty ? REGIONAL_EMPTY_NOTE : value.fit.converged ? REGIONAL_RANGE_NOTE
    : `${REGIONAL_RANGE_NOTE} ${REGIONAL_UNSETTLED_NOTE}`;
  if (empty !== (value.proportions === null) || !fits || value.note !== expectedNote
    || (value.proportions !== null && Math.abs(Object.values(value.proportions).reduce((a, b) => a + b, 0) - 1) > 1e-12)
    || value.reporting.merged !== regionalReporting(value.proportions).merged) {
    ctx.addIssue({ code: "custom", message: "Inconsistent regional ancestry result" });
  }
});
export const ownAncestryContentV3Schema = z.object({
  schemaVersion: z.literal(3), computationRevision: z.literal("own-ancestry-content-v3"), source: sourceSchema,
  panel: z.object({ id: z.literal(SEVEN_ANCESTRY_PANEL.id), version: z.literal(SEVEN_ANCESTRY_PANEL.version),
    provenance: z.literal(SEVEN_ANCESTRY_PANEL.provenance), markerSha256: z.literal(MARKER_SHA256),
    markerCount: z.literal(REGIONAL_AIMS.length), minimumMarkers: z.literal(SEVEN_ANCESTRY_PANEL.minimumMarkers) }).strict(),
  admixture: z.object({ kind: z.literal("admixture"), result: regionalAdmixtureResultSchema,
    support_note: z.string().min(1).max(4096), model_id: z.literal(SEVEN_ANCESTRY_PANEL.id), model_version: z.literal(SEVEN_ANCESTRY_PANEL.version),
    coverage: share, result_state: z.enum(["available", "partial", "not_covered"]), basis: z.literal("modelled"),
    range: z.object({ unavailable: z.literal(true) }).strict(), resolution: z.literal("seven-regions-adaptive-v1") }).strict(),
  panelPositions: z.object({ called: count, missing: count, noCall: count, filtered: count, conflicting: count, unsupported: count }).strict(),
  lineages: z.array(lineageV2Schema).length(2),
}).strict().superRefine((value, ctx) => {
  const used = value.admixture.result.markersUsed;
  if (Object.values(value.panelPositions).reduce((a, b) => a + b, 0) !== REGIONAL_AIMS.length
    || value.panelPositions.called !== used || value.admixture.coverage !== used / REGIONAL_AIMS.length
    || value.admixture.result_state !== (used === 0 ? "not_covered" : used < SEVEN_ANCESTRY_PANEL.minimumMarkers ? "partial" : "available")
    || value.admixture.support_note !== value.admixture.result.note || !validAncestryLineages(value.lineages)
    || value.lineages.some(lineage => lineage.call !== null && (lineage.call.path.at(-1) !== lineage.call.haplogroup
      || lineage.call.matched > lineage.call.tested || lineage.call.tested > lineage.readablePositions))) {
    ctx.addIssue({ code: "custom", message: "Inconsistent ancestry content" });
  }
});
export type OwnAncestryContentV3 = z.infer<typeof ownAncestryContentV3Schema>;

/** Same source admission and lineage rules, with a separately versioned estimator. */
export function computeOwnAncestryContentV3(input: {
  source: OwnAncestrySource; calls: readonly OwnAncestryCall[]; lineageCalls?: readonly OwnAncestryCall[];
  panel: { id: string; version: string; provenance: string; minimumMarkers: number; markers: readonly RegionalMarker[] };
}): OwnAncestryContentV3 {
  const { source, calls, lineageCalls } = parseOwnAncestryInputs(input);
  const panel = input.panel;
  if (!panel || panel.id !== SEVEN_ANCESTRY_PANEL.id || panel.version !== SEVEN_ANCESTRY_PANEL.version
    || panel.provenance !== SEVEN_ANCESTRY_PANEL.provenance || panel.minimumMarkers !== SEVEN_ANCESTRY_PANEL.minimumMarkers
    || JSON.stringify(panel.markers) !== MARKER_JSON) throw new Error("ancestry_panel_mismatch");
  const { genotypes, panelPositions } = resolveOwnAncestryPositions(calls, panel.markers, source.callEncoding);
  const result = estimateRegionalAdmixture((chrom, pos) => genotypes.get(`${chrom}:${pos}`) ?? null);
  panelPositions.unsupported += panelPositions.called - result.markersUsed;
  panelPositions.called = result.markersUsed;
  return { schemaVersion: 3, computationRevision: "own-ancestry-content-v3", source,
    panel: { id: SEVEN_ANCESTRY_PANEL.id, version: SEVEN_ANCESTRY_PANEL.version, provenance: SEVEN_ANCESTRY_PANEL.provenance,
      markerSha256: MARKER_SHA256, markerCount: REGIONAL_AIMS.length, minimumMarkers: SEVEN_ANCESTRY_PANEL.minimumMarkers },
    admixture: { kind: "admixture", result, support_note: result.note, model_id: SEVEN_ANCESTRY_PANEL.id, model_version: SEVEN_ANCESTRY_PANEL.version,
      coverage: result.markersUsed / REGIONAL_AIMS.length,
      result_state: result.markersUsed === 0 ? "not_covered" : result.markersUsed < SEVEN_ANCESTRY_PANEL.minimumMarkers ? "partial" : "available",
      basis: "modelled", range: { unavailable: true }, resolution: "seven-regions-adaptive-v1" },
    panelPositions, lineages: LINEAGE_KINDS.map(kind => computeLineage(kind, lineageCalls)) };
}
