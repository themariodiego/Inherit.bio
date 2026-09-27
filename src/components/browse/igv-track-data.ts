import { chromToName, type VariantRecord } from "@/lib/genome/types";

export interface TrackFeature {
  chr: string;
  start: number;
  end: number;
  name: string;
  /** Native whole-genome projections keep their original feature here. */
  _f?: TrackFeature;
}

export interface TrackRow extends VariantRecord { key: string }

/** Keep the exact native feature identity without adding popup properties. */
export function createLoadedTrack(variants: VariantRecord[]) {
  const rows = new WeakMap<TrackFeature, TrackRow>();
  const features = variants.map((variant, index) => {
    const chromosome = chromToName(variant.chrom);
    const feature = {
      chr: `chr${chromosome === "MT" ? "M" : chromosome}`,
      start: variant.pos - 1,
      end: variant.pos,
      name: `${variant.rsid ? `rs${variant.rsid} ` : ""}${variant.genotype}${variant.ref && variant.alt ? ` (${variant.ref}→${variant.alt})` : ""}`,
    };
    rows.set(feature, { ...variant, key: `${variant.chrom}:${variant.pos}:${index}` });
    return feature;
  });
  return { features, rows };
}

export interface TrackTextView {
  range: string;
  outsideLoadedRange: boolean;
  rows: TrackRow[];
}

export interface TrackTextSnapshot {
  status: "loading" | "ready" | "removed" | "error";
  views: TrackTextView[];
}

interface NativeFrame {
  chr: string;
  start: number;
  bpPerPixel: number;
  getLocusString(): string;
}

export interface TrackTextBrowser {
  trackViews: {
    track: {
      config?: { id?: string };
      getFeatures(chr: string, start: number, end: number, scale: number): Promise<TrackFeature[]>;
    };
    viewports: { referenceFrame: NativeFrame; getWidth(): number }[];
  }[];
  on(event: string, handler: () => void): void;
  un(event: string, handler: () => void): void;
}

/** Read the same static native feature source and intersections as the canvas.
 * No region request is made here. A revision guard drops older asynchronous
 * reads and disposal invalidates every pending callback before unsubscription.
 */
export function observeTrackText(
  browser: TrackTextBrowser,
  trackId: string,
  loaded: { chromosome: string; start: number; end: number; rows: WeakMap<TrackFeature, TrackRow> },
  receive: (snapshot: TrackTextSnapshot) => void,
): () => void {
  let revision = 0;
  let stopped = false;
  let queued = false;
  const update = () => {
    revision++;
    if (stopped || queued) return;
    queued = true;
    queueMicrotask(() => {
      queued = false;
      if (stopped) return;
      const current = revision;
      const view = browser.trackViews.find(item => item.track.config?.id === trackId);
      if (!view) { receive({ status: "removed", views: [] }); return; }
      receive({ status: "loading", views: [] });
      const requests = view.viewports.map(viewport => {
        const frame = viewport.referenceFrame;
        const { chr, start, bpPerPixel } = frame;
        const end = start + bpPerPixel * viewport.getWidth();
        const range = frame.getLocusString();
        const outsideLoadedRange = chr !== loaded.chromosome || start < loaded.start - 1 || end > loaded.end;
        return Promise.resolve().then(() => view.track.getFeatures(chr, start, end, bpPerPixel)).then(features => ({
          range,
          outsideLoadedRange,
          rows: features.filter(feature => feature.end >= start && feature.start <= end).map(feature => {
            const row = loaded.rows.get(feature._f ?? feature);
            // An unrecognised feature cannot be silently omitted from its
            // purported equivalent; report the unavailable state instead.
            if (!row) throw new Error("unknown track feature");
            return row;
          }),
        }));
      });
      Promise.all(requests).then(views => {
        if (!stopped && revision === current) receive({ status: "ready", views });
      }, () => {
        if (!stopped && revision === current) receive({ status: "error", views: [] });
      });
    });
  };
  const events = ["locuschange", "featuresloaded", "trackremoved"];
  for (const event of events) browser.on(event, update);
  update();
  return () => {
    stopped = true;
    revision++;
    for (const event of events) browser.un(event, update);
  };
}
