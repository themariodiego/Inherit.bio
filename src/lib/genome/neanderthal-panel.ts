/**
 * The Neanderthal marker panel's identity and size, read from the committed
 * manifest only (not the 3,110-site table, which `neanderthal.ts` loads on the
 * server). This module stays light so the content schema and the capture
 * readers can pin the panel's literals without pulling the marker list into a
 * bundle. The manifest and the table are built and verified offline by
 * `scripts/build-neanderthal-sites.ts`; see `data/ref/neanderthal/PROVENANCE.md`.
 */
import manifest from "../../../data/ref/neanderthal/manifest.json";

export const NEANDERTHAL_PANEL = {
  id: manifest.panelId,
  version: manifest.panelVersion,
  /** SHA-256 over the canonical `sites` serialisation; the stored estimate pins it. */
  markerSha256: manifest.sitesSha256,
  siteCount: manifest.siteCount,
  /** The published source these sites were derived from; an engineering record, not a review. */
  sourceDoi: manifest.sourceDoi,
} as const;

/** Resamples behind the bootstrap interval (brief line 2265: a 200-resample 90% interval). */
export const NEANDERTHAL_RESAMPLES = 200;
