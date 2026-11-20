import { z } from "zod";
import { NEANDERTHAL_PANEL, NEANDERTHAL_RESAMPLES } from "../genome/neanderthal-panel";
import type { NeanderthalResult } from "../genome/neanderthal";
import { ownAncestryContentV4Schema } from "./own-ancestry-content-v4";
import type { computeOwnAncestryContentV4 } from "./own-ancestry-content-v4";

/**
 * Revision 5 captures the Neanderthal estimate beside the seven-region
 * admixture of revision 4 (owner decision 2026-10-16, G7.4). The admixture,
 * lineage and figure-basis halves are byte-for-byte revision 4; the estimator
 * and its panel are separately versioned and recorded in the `neanderthal`
 * block. The estimate is the fraction of covered panel sites carrying at least
 * one archaic-derived allele, with the number of covered sites and a
 * 200-resample 90% interval; it is not a genome-wide proportion.
 *
 * `estimate` and `interval` are present and nullable rather than optional, so
 * every stored revision-5 result has the same key set whether or not the file
 * covered any of the panel's sites — the same shape rule the lineage block
 * follows. No comparison figure is captured: the comparator sentence stays off
 * until the owner's source review is recorded (`docs/neanderthal-source-review.md`).
 */
const share = z.number().min(0).max(1);
const count = z.number().int().min(0).max(NEANDERTHAL_PANEL.siteCount);
const ESTIMATE_TOLERANCE = 1e-9;

export const neanderthalContentSchema = z.object({
  panelId: z.literal(NEANDERTHAL_PANEL.id),
  panelVersion: z.literal(NEANDERTHAL_PANEL.version),
  markerSha256: z.literal(NEANDERTHAL_PANEL.markerSha256),
  panelSites: z.literal(NEANDERTHAL_PANEL.siteCount),
  coveredSites: count,
  archaicSites: count,
  estimate: share.nullable(),
  interval: z.object({ low: share, high: share }).strict().nullable(),
  resamples: z.literal(NEANDERTHAL_RESAMPLES),
  basis: z.literal("modelled"),
}).strict().superRefine((value, ctx) => {
  const covered = value.coveredSites > 0;
  const estimateOk = covered
    ? value.estimate !== null && Math.abs(value.estimate * value.coveredSites - value.archaicSites) <= ESTIMATE_TOLERANCE
    : value.estimate === null;
  const intervalOk = value.interval === null
    || (covered && value.interval.low < value.interval.high
      && value.estimate !== null
      && value.interval.low <= value.estimate && value.estimate <= value.interval.high);
  if (value.archaicSites > value.coveredSites || !estimateOk || !intervalOk) {
    ctx.addIssue({ code: "custom", message: "Inconsistent Neanderthal estimate" });
  }
});
export type NeanderthalContent = z.infer<typeof neanderthalContentSchema>;

export const ownAncestryContentV5Schema = z.object({
  ...ownAncestryContentV4Schema.shape,
  schemaVersion: z.literal(5),
  computationRevision: z.literal("own-ancestry-content-v5"),
  neanderthal: neanderthalContentSchema,
}).strict().superRefine((content, ctx) => {
  // The revision-4 half, unchanged: drop the estimate and re-check as v4.
  const v4: Record<string, unknown> = { ...content, schemaVersion: 4, computationRevision: "own-ancestry-content-v4" };
  delete v4.neanderthal;
  const unchanged = ownAncestryContentV4Schema.safeParse(v4);
  if (!unchanged.success) ctx.addIssue({ code: "custom", message: "Inconsistent ancestry content" });
});
export type OwnAncestryContentV5 = z.infer<typeof ownAncestryContentV5Schema>;

/** Assemble revision 5 from the revision-4 content and the separately computed estimate. */
export function computeOwnAncestryContentV5(
  computed: ReturnType<typeof computeOwnAncestryContentV4>,
  neanderthal: NeanderthalResult,
): OwnAncestryContentV5 {
  return ownAncestryContentV5Schema.parse({
    ...computed,
    schemaVersion: 5,
    computationRevision: "own-ancestry-content-v5",
    neanderthal: {
      panelId: NEANDERTHAL_PANEL.id, panelVersion: NEANDERTHAL_PANEL.version,
      markerSha256: NEANDERTHAL_PANEL.markerSha256, panelSites: neanderthal.panelSites,
      coveredSites: neanderthal.coveredSites, archaicSites: neanderthal.archaicSites,
      estimate: neanderthal.estimate, interval: neanderthal.interval,
      resamples: neanderthal.resamples, basis: "modelled",
    },
  });
}
